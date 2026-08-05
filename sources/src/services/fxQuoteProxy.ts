/**
 * Exchange rate **real-time quote**: obtained through `stock-price` Edge Function, with localStorage TTL cache.
 *
 * **Division of work with fxProxy** (reason for disassembly in 0.6.7):
 * - `fxProxy` reads `fx/twd.json` - **historical sequence** of daily scheduled production, used for trend charts.
 * - What is read here is the **current quotation**, currency card and daily change.
 *
 * Why it must be dismantled: The last stroke of `fx/twd.json` is "the latest **complete** daily line",
 * Today's daily line will not be established until London Day is over (07:00 the next morning in Taipei) -
 * The screen will stay at yesterday's closing price throughout the trading day. Actual measurement 2026-07-29 Taipei 11:00:
 * File 32.302, market actual 32.435, a difference of 0.42%.
 *
 * The cache strategy follows the three layers of priceProxy: localStorage in L1 and Edge Function in L2.
 * `price_cache`, L3 Yahoo. TTL is 10 minutes, the two levels are consistent, and `asOf` uses the actual acquisition time of the quote,
 * Two layers of TTL will not overlap (same as priceProxy's criteria).
 */
import { isSupabaseConfigured, supabase } from './supabase'

export interface FxQuote {
  /** How many Taiwan dollars can be exchanged for 1 unit of foreign currency (the same direction as fxProxy)*/
  price: number
  /** Actual acquisition time of quotation ISO*/
  asOf: string
}

export type FxQuoteMap = Record<string, FxQuote>

/** Consistent with FX_CACHE_TTL_MS of Edge Function*/
export const FX_QUOTE_TTL_MS = 10 * 60 * 1000

const CACHE_KEY = 'stock-pnl-web/fx-quotes-v1'

export function readFxQuoteCache(): FxQuoteMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const out: FxQuoteMap = {}
    for (const [code, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price <= 0) continue
      if (typeof o.asOf !== 'string') continue
      out[code] = { price: o.price, asOf: o.asOf }
    }
    return out
  } catch {
    return {}
  }
}

function writeFxQuoteCache(map: FxQuoteMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    // Incognito mode/Quota full: Failure to remember cache does not affect functionality
  }
}

export function isQuoteFresh(q: FxQuote | undefined, now: number): q is FxQuote {
  if (!q) return false
  const t = Date.parse(q.asOf)
  return Number.isFinite(t) && now - t < FX_QUOTE_TTL_MS
}

/**
 * Get real-time quotes for the specified currency.
 *
 * On failure, always return **Known cache value** instead of throwing an error - this page must still be viewable when the quote cannot be obtained
 * (The currency card will return the closing price of the daily period, see FxPage).
 *
 * @param force Ignore TTL and force re-capture (used for "refresh" on the screen)
 */
export async function fetchFxQuotes(codes: string[], force = false): Promise<FxQuoteMap> {
  const cached = readFxQuoteCache()
  if (!isSupabaseConfigured || !supabase || codes.length === 0) return cached

  const now = Date.now()
  const missing = force ? codes : codes.filter((c) => !isQuoteFresh(cached[c], now))
  if (missing.length === 0) return cached

  try {
    const { data, error } = await supabase.functions.invoke('stock-price', {
      body: { action: 'fx', codes: missing },
    })
    if (error) return cached

    const quotes = (data as { quotes?: unknown } | null)?.quotes
    if (!quotes || typeof quotes !== 'object') return cached

    const merged: FxQuoteMap = { ...cached }
    for (const [code, v] of Object.entries(quotes as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price <= 0) continue
      merged[code] = { price: o.price, asOf: typeof o.asOf === 'string' ? o.asOf : new Date().toISOString() }
    }
    writeFxQuoteCache(merged)
    return merged
  } catch {
    return cached
  }
}
