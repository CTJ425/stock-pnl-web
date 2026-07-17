/**
 * Supabase Edge Function：stock-price（現價 / 搜尋代理）
 *
 * 由伺服器端代為請求 Yahoo Finance 等外部 API，解決瀏覽器 CORS 限制。
 * 現價帶 DB 共用快取（price_cache 資料表，見 build-docs/supabase_schema.sql）：
 * 10 分鐘內全站共用同一份報價，同一支股票不重複請求 Yahoo。
 * 部署方式（需安裝 Supabase CLI 並登入）：
 *   supabase functions deploy stock-price --no-verify-jwt
 *
 * 介面：
 *   POST { action: 'prices', symbols: [{ market: 'TPE'|'US', ticker: string }] }
 *     → { prices: { 'TPE:2330': { price: number }, ... } }
 *   POST { action: 'search', query: string }
 *     → { results: [{ symbol, name, market }] }
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface SymbolItem {
  market: 'TPE' | 'US'
  ticker: string
}

/** DB 快取有效期：與前端 localStorage 快取一致（10 分鐘） */
const CACHE_TTL_MS = 10 * 60 * 1000

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

async function handlePrices(symbols: SymbolItem[]): Promise<Response> {
  const items = symbols.slice(0, 50)
  const prices: Record<string, { price: number }> = {}

  // 1) 先查 DB 共用快取：TTL 內的報價直接回傳
  const freshAfter = new Date(Date.now() - CACHE_TTL_MS).toISOString()
  try {
    const { data } = await db
      .from('price_cache')
      .select('key, price')
      .in('key', items.map((i) => `${i.market}:${i.ticker}`))
      .gte('updated_at', freshAfter)
    for (const row of data ?? []) {
      const price = Number(row.price)
      if (Number.isFinite(price) && price > 0) prices[row.key] = { price }
    }
  } catch {
    // 快取表不可用（例如尚未建表）時，直接全部走 Yahoo
  }

  // 2) 快取沒有的才請求 Yahoo
  const missing = items.filter((i) => !prices[`${i.market}:${i.ticker}`])
  const entries = await Promise.all(
    missing.map(async (item) => {
      const key = `${item.market}:${item.ticker}`
      for (const symbol of yahooSymbols(item)) {
        const price = await fetchYahooPrice(symbol)
        if (price !== null) return [key, price] as const
      }
      return null
    }),
  )

  // 3) 新抓到的價格回寫快取，供全站共用
  const fetched = entries.filter((e): e is readonly [string, number] => e !== null)
  for (const [key, price] of fetched) {
    prices[key] = { price }
  }
  if (fetched.length > 0) {
    try {
      await db.from('price_cache').upsert(
        fetched.map(([key, price]) => ({
          key,
          price,
          updated_at: new Date().toISOString(),
        })),
      )
    } catch {
      // 回寫失敗不影響本次回應
    }
  }

  return json({ prices })
}

async function handleSearch(query: string): Promise<Response> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    )
    if (!res.ok) return json({ results: [] })
    const data = await res.json()
    const quotes: Array<Record<string, unknown>> = Array.isArray(data?.quotes) ? data.quotes : []
    const results = quotes
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
    return json({ results })
  } catch {
    return json({ results: [] })
  }
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
  return json({ error: 'Unknown action' }, 400)
})
