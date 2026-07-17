/**
 * Supabase Edge Function：stock-price（現價 / 搜尋代理）
 *
 * 由伺服器端代為請求 Yahoo Finance 等外部 API，解決瀏覽器 CORS 限制。
 * 部署方式（需安裝 Supabase CLI 並登入）：
 *   supabase functions deploy stock-price --no-verify-jwt
 *
 * 介面：
 *   POST { action: 'prices', symbols: [{ market: 'TPE'|'US', ticker: string }] }
 *     → { prices: { 'TPE:2330': { price: number }, ... } }
 *   POST { action: 'search', query: string }
 *     → { results: [{ symbol, name, market }] }
 */

interface SymbolItem {
  market: 'TPE' | 'US'
  ticker: string
}

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
  const entries = await Promise.all(
    symbols.slice(0, 50).map(async (item) => {
      const key = `${item.market}:${item.ticker}`
      for (const symbol of yahooSymbols(item)) {
        const price = await fetchYahooPrice(symbol)
        if (price !== null) return [key, { price }] as const
      }
      return null
    }),
  )
  const prices: Record<string, { price: number }> = {}
  for (const entry of entries) {
    if (entry) prices[entry[0]] = entry[1]
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
