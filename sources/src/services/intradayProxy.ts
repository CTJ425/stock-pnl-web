/**
 * Fetch intraday chart bars for one symbol via the Edge Function's `intraday` action
 * (see supabase/functions/stock-price/index.ts). The series is large and per-range,
 * so it is cached in memory only (module-level, TTL 60s) — not localStorage, whose quota
 * priceProxy already shares.
 */
import { isSupabaseConfigured, supabase } from './supabase'
import type { IntradayRange, IntradaySeries } from '../../supabase/functions/stock-price/intradayParse'

export interface IntradayRequestItem {
  market: 'TPE' | 'US'
  ticker: string
}

interface CacheEntry {
  series: IntradaySeries | null
  at: number
}

const CACHE_TTL_MS = 60_000

const cache = new Map<string, CacheEntry>()

interface EdgeIntradayResponse {
  series: IntradaySeries | null
}

export async function fetchIntraday(
  item: IntradayRequestItem,
  range: IntradayRange,
  options?: { force?: boolean },
): Promise<IntradaySeries | null> {
  const key = `${item.market}:${item.ticker}:${range}`
  const now = Date.now()
  if (!options?.force) {
    const cached = cache.get(key)
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.series
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
    return series
  } catch {
    return null
  }
}
