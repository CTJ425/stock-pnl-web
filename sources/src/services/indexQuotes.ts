/**
 * Foreign index quotes for the Macro 「國際指數」 subtab (task 162).
 *
 * Display only: no cache, no `Market` typing. `PriceRequestItem.market` is `'TPE' | 'US'`
 * (the holdings/P&L type) and widening it to include `'IDX'` would leak a display-only
 * concept into money code. `fetchPrices`'s own L1 cache also holds non-TPE keys for 10
 * minutes, which would stall this panel's 60 s poll — so this call bypasses it entirely.
 */
import { isSupabaseConfigured, supabase } from './supabase'

export interface IndexQuote {
  ticker: string
  price: number
  prevClose: number | null
  /** ISO string the Edge reports as the fetch time of this quote. Null when absent. */
  asOf: string | null
}

interface EdgeIndexQuote {
  price?: unknown
  prevClose?: unknown
  asOf?: unknown
}

interface EdgePricesResponse {
  prices?: Record<string, EdgeIndexQuote>
}

function parseAsOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : raw
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * Fetch quotes for the given tickers via the `stock-price` Edge Function, `market: 'IDX'`.
 * Never throws: an empty input, an Edge error, or a thrown exception all resolve to `{}`,
 * so the caller (GlobalIndices.tsx) can always keep whatever it already had on screen.
 */
export async function fetchIndexQuotes(tickers: string[]): Promise<Record<string, IndexQuote>> {
  if (tickers.length === 0) return {}
  if (!isSupabaseConfigured || !supabase) return {}
  try {
    const { data, error } = await supabase.functions.invoke('stock-price', {
      body: {
        action: 'prices',
        symbols: tickers.map((ticker) => ({ market: 'IDX', ticker })),
      },
      timeout: 15_000,
    })
    if (error || !data) return {}
    const prices = (data as EdgePricesResponse).prices
    if (!prices) return {}
    const out: Record<string, IndexQuote> = {}
    for (const [key, quote] of Object.entries(prices)) {
      if (!isPositiveFinite(quote?.price)) continue
      const ticker = key.startsWith('IDX:') ? key.slice('IDX:'.length) : key
      out[ticker] = {
        ticker,
        price: quote.price,
        prevClose: isPositiveFinite(quote.prevClose) ? quote.prevClose : null,
        asOf: parseAsOf(quote?.asOf),
      }
    }
    return out
  } catch {
    return {}
  }
}
