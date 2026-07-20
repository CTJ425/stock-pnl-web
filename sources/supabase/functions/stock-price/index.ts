/**
 * Supabase Edge Function：stock-price（現價 / 搜尋代理）
 *
 * 由伺服器端代為請求 TWSE MIS / Yahoo Finance 等外部 API，解決瀏覽器 CORS 限制。
 * 現價來源：台股先走證交所 MIS 即時行情（秒級延遲），失敗退 Yahoo；美股走 Yahoo。
 * 現價帶 DB 共用快取（price_cache 資料表，見 build-docs/supabase_schema.sql）：
 * TTL 內全站共用同一份報價（台股 60 秒、美股 10 分鐘），同一支股票不重複請求外部 API。
 * 部署方式（需安裝 Supabase CLI 並登入）：
 *   supabase functions deploy stock-price --no-verify-jwt
 *
 * 介面：
 *   POST { action: 'prices', symbols: [{ market: 'TPE'|'US', ticker: string }] }
 *     → { prices: { 'TPE:2330': { price: number, asOf: string }, ... } }
 *       asOf 為報價的實際取得時間（ISO），供前端 TTL 判斷，避免與 DB 快取 TTL 疊加
 *   POST { action: 'search', query: string }
 *     → { results: [{ symbol, name, market }] }
 *   POST { action: 'twlist' }
 *     → { rows: [{ symbol, name, close }] }（台股全清單；TWSE/TPEx 不開放 CORS，
 *       正式環境由此代理供前端中文搜尋 / 代號反查 / 現價備援使用）
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildMisChannels, parseMisResponse } from './misParse.ts'

interface SymbolItem {
  market: 'TPE' | 'US'
  ticker: string
}

/** DB 快取有效期（與前端 localStorage 快取一致）：台股走 MIS 即時源用短 TTL，美股維持 10 分鐘 */
const CACHE_TTL_MS: Record<SymbolItem['market'], number> = {
  TPE: 60 * 1000,
  US: 10 * 60 * 1000,
}
const MAX_CACHE_TTL_MS = Math.max(...Object.values(CACHE_TTL_MS))

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 執行環境自動注入；
// service role 不受 RLS 限制，是 price_cache 唯一的寫入途徑
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** 台股代號轉 Yahoo 格式：上市 .TW；查無時呼叫端會再試 .TWO（上櫃） */
function yahooSymbols(item: SymbolItem): string[] {
  if (item.market === 'TPE') return [`${item.ticker}.TW`, `${item.ticker}.TWO`]
  return [item.ticker]
}

async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    const price = Number(meta?.regularMarketPrice)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

/** 台股即時報價（TWSE MIS）：回傳 ticker → 價格；整批失敗時回空 Map，交由 Yahoo fallback */
async function fetchMisPrices(tickers: string[]): Promise<Map<string, number>> {
  const resolved = new Map<string, number>()
  for (const channels of buildMisChannels(tickers)) {
    try {
      const res = await fetch(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${channels.join('|')}&json=1&delay=0&_=${Date.now()}`,
        {
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            Referer: 'https://mis.twse.com.tw/stock/index.jsp',
          },
        },
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const quote of parseMisResponse(data)) {
        if (!resolved.has(quote.ticker)) resolved.set(quote.ticker, quote.price)
      }
    } catch {
      // MIS 為非官方文件化端點，失敗時靜默交由 Yahoo fallback
    }
  }
  return resolved
}

async function handlePrices(symbols: SymbolItem[]): Promise<Response> {
  const items = symbols.slice(0, 50)
  const prices: Record<string, { price: number; asOf: string }> = {}
  const nowMs = Date.now()

  // 1) 先查 DB 共用快取：分市場 TTL 內的報價直接回傳（asOf = 實際抓價時間）
  const freshAfter = new Date(nowMs - MAX_CACHE_TTL_MS).toISOString()
  try {
    const { data } = await db
      .from('price_cache')
      .select('key, price, updated_at')
      .in('key', items.map((i) => `${i.market}:${i.ticker}`))
      .gte('updated_at', freshAfter)
    for (const row of data ?? []) {
      const key = String(row.key)
      const price = Number(row.price)
      const at = Date.parse(String(row.updated_at))
      const ttl = key.startsWith('TPE:') ? CACHE_TTL_MS.TPE : CACHE_TTL_MS.US
      if (!Number.isFinite(price) || price <= 0) continue
      if (!Number.isFinite(at) || nowMs - at >= ttl) continue
      prices[key] = { price, asOf: new Date(at).toISOString() }
    }
  } catch {
    // 快取表不可用（例如尚未建表）時，直接全部走外部 API
  }

  // 2) 台股缺漏者先走 MIS 即時行情（asOf = 向來源確認的時間，非最後成交時間，
  //    避免盤後把快取一律視為過期而重複請求）
  const missing = items.filter((i) => !prices[`${i.market}:${i.ticker}`])
  const fromMis = await fetchMisPrices(
    missing.filter((i) => i.market === 'TPE').map((i) => i.ticker),
  )
  for (const [ticker, price] of fromMis) {
    prices[`TPE:${ticker}`] = { price, asOf: new Date().toISOString() }
  }

  // 3) 仍缺者（含全部美股、MIS 失敗的台股）走 Yahoo
  const unresolved = missing.filter((i) => !prices[`${i.market}:${i.ticker}`])
  const entries = await Promise.all(
    unresolved.map(async (item) => {
      const key = `${item.market}:${item.ticker}`
      for (const symbol of yahooSymbols(item)) {
        const price = await fetchYahooPrice(symbol)
        if (price !== null) {
          return [key, { price, asOf: new Date().toISOString() }] as const
        }
      }
      return null
    }),
  )
  for (const entry of entries) {
    if (entry) prices[entry[0]] = entry[1]
  }

  // 4) 新抓到的價格回寫快取，供全站共用（updated_at 記實際報價時間，TTL 由此起算）
  const fetchedKeys = [
    ...[...fromMis.keys()].map((t) => `TPE:${t}`),
    ...entries.flatMap((e) => (e ? [e[0]] : [])),
  ]
  if (fetchedKeys.length > 0) {
    try {
      await db.from('price_cache').upsert(
        fetchedKeys.map((key) => ({
          key,
          price: prices[key].price,
          updated_at: prices[key].asOf,
        })),
      )
    } catch {
      // 回寫失敗不影響本次回應
    }
  }

  return json({ prices })
}

interface SearchResult {
  symbol: string
  name: string
  market: string
}

/** 代號型查詢（如 AAPL、2330）：曾解析過的名稱直接由 DB 快取回覆，不再請求 Yahoo */
async function lookupCachedNames(query: string): Promise<SearchResult[]> {
  if (!/^[A-Z0-9.-]{1,10}$/.test(query)) return []
  try {
    const { data } = await db
      .from('stock_names')
      .select('key, name')
      .in('key', [`US:${query}`, `TPE:${query}`])
    return (data ?? []).flatMap((row) => {
      const sep = String(row.key).indexOf(':')
      if (sep < 0 || !row.name) return []
      return [
        {
          market: String(row.key).slice(0, sep),
          symbol: String(row.key).slice(sep + 1),
          name: String(row.name),
        },
      ]
    })
  } catch {
    return []
  }
}

/** 解析成功的「代號 ↔ 名稱」回寫共用快取，之後所有使用者查詢免打 Yahoo */
async function persistNames(results: SearchResult[]): Promise<void> {
  if (results.length === 0) return
  try {
    await db.from('stock_names').upsert(
      results.map((r) => ({
        key: `${r.market}:${r.symbol}`,
        name: r.name,
        updated_at: new Date().toISOString(),
      })),
    )
  } catch {
    // 回寫失敗不影響本次回應
  }
}

async function handleSearch(query: string): Promise<Response> {
  const cached = await lookupCachedNames(query.toUpperCase())
  if (cached.length > 0) return json({ results: cached })

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    )
    if (!res.ok) return json({ results: [] })
    const data = await res.json()
    const quotes: Array<Record<string, unknown>> = Array.isArray(data?.quotes) ? data.quotes : []
    const results: SearchResult[] = quotes
      .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
      .map((q) => {
        let symbol = String(q.symbol)
        let market = 'US'
        if (symbol.endsWith('.TW') || symbol.endsWith('.TWO')) {
          symbol = symbol.replace(/\.TWO?$/, '')
          market = 'TPE'
        }
        return {
          symbol,
          name: String(q.shortname ?? q.longname ?? symbol),
          market,
        }
      })
      .slice(0, 10)
    // 只回寫美股：Yahoo 的台股名稱是英文，台股中文名以 twlist（TWSE/TPEx）為準
    await persistNames(results.filter((r) => r.market === 'US'))
    return json({ results })
  } catch {
    return json({ results: [] })
  }
}

function listNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 台股全清單（上市 TWSE + 上櫃 TPEx），欄位精簡為 symbol/name/close 以縮小回應 */
async function handleTwList(): Promise<Response> {
  const fetchJson = async (url: string): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as Array<Record<string, unknown>>
  }

  const [twse, tpex] = await Promise.allSettled([
    fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'),
    fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'),
  ])

  const rows: Array<{ symbol: string; name: string; close: number | null }> = []
  const seen = new Set<string>()
  const push = (symbol: unknown, name: unknown, close: unknown) => {
    const s = String(symbol ?? '').trim()
    const n = String(name ?? '').trim()
    if (!s || !n || seen.has(s)) return
    seen.add(s)
    rows.push({ symbol: s, name: n, close: listNumber(close) })
  }
  if (twse.status === 'fulfilled') {
    for (const r of twse.value) push(r.Code, r.Name, r.ClosingPrice)
  }
  if (tpex.status === 'fulfilled') {
    for (const r of tpex.value) push(r.SecuritiesCompanyCode ?? r.Code, r.CompanyName ?? r.Name, r.Close ?? r.ClosingPrice ?? r.LatestPrice)
  }

  if (rows.length === 0) return json({ error: '台股清單來源皆無回應' }, 502)
  return json({ rows })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: { action?: string; symbols?: SymbolItem[]; query?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'prices' && Array.isArray(body.symbols)) {
    return handlePrices(body.symbols)
  }
  if (body.action === 'search' && typeof body.query === 'string' && body.query.trim()) {
    return handleSearch(body.query.trim())
  }
  if (body.action === 'twlist') {
    return handleTwList()
  }
  return json({ error: 'Unknown action' }, 400)
})
