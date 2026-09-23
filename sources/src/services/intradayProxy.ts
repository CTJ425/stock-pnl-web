/**
 * Fetch intraday chart bars for one symbol via the Edge Function's `intraday` action
 * (see supabase/functions/stock-price/index.ts). The series is large and per-range,
 * so it is cached in memory only (module-level, TTL 60s) — not localStorage, whose quota
 * priceProxy already shares.
 */
import { isSupabaseConfigured, supabase } from './supabase'
import type { IntradayRange, IntradaySeries } from '../../supabase/functions/stock-price/intradayParse'

export interface IntradayRequestItem {
  market: 'TPE' | 'US' | 'IDX'
  ticker: string
}

interface CacheEntry {
  series: IntradaySeries | null
  at: number
}

const CACHE_TTL_MS = 60_000

/** PR-03: bound the in-memory cache so a long session paging many tickers/ranges cannot grow it without limit. */
const CACHE_MAX_ENTRIES = 200

const cache = new Map<string, CacheEntry>()

/** Evict the oldest entry once the cache exceeds its bound (simple LRU, PR-03). */
function capCache(): void {
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

interface EdgeIntradayResponse {
  series: IntradaySeries | null
}

/**
 * `fetchIntraday`'s result, tagged with the ticker it belongs to and when it was actually
 * captured (DT-01). The tag lets a caller that re-uses this series across ticker switches
 * (QuoteTab) verify it still matches what is on screen, and show a 「快取於」badge for a
 * hit served from `cache` instead of a fresh Edge call.
 */
export type IntradayResult = IntradaySeries & { ticker: string; fetchedAt: string }

export async function fetchIntraday(
  item: IntradayRequestItem,
  range: IntradayRange,
  options?: { force?: boolean },
): Promise<IntradayResult | null> {
  const key = `${item.market}:${item.ticker}:${range}`
  const now = Date.now()
  if (!options?.force) {
    const cached = cache.get(key)
    if (cached && now - cached.at < CACHE_TTL_MS) {
      return cached.series
        ? { ...cached.series, ticker: item.ticker, fetchedAt: new Date(cached.at).toISOString() }
        : null
    }
  }

  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke<EdgeIntradayResponse>('stock-price', {
      body: { action: 'intraday', symbol: item, range },
      timeout: 15_000,
    })
    if (error || !data) return null
    const series = data.series ?? null
    cache.set(key, { series, at: now })
    capCache()
    return series ? { ...series, ticker: item.ticker, fetchedAt: new Date(now).toISOString() } : null
  } catch {
    return null
  }
}
