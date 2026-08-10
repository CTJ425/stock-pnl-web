/**
 * Soft threshold for on-demand warm (shared by StockDetailPage and background prefetch).
 *
 * Backend target is 12 months / 12 quarters (nightly). Warm only when the file is clearly
 * thin so partial histories still paint without blocking on Edge.
 */
import type { FundamentalData } from './fundamentalProxy'

/** Below this many revenue months, trigger on-demand warm. */
export const REVENUE_WARM_MIN = 6

/** Nightly / warm completion target (display + complete check). */
export const REVENUE_TARGET = 12
export const PROFIT_TARGET = 12

export function needsFundamentalBackfill(f: FundamentalData): boolean {
  if (f.revenueMonths.length === 0) return true
  if (f.revenueMonths.length < REVENUE_WARM_MIN) return true
  if (f.profitQuarters.length === 0) return true
  return false
}

/** True when history is short of the 12/12 target (UI "still filling" note). */
export function isFundamentalIncomplete(f: FundamentalData): boolean {
  return f.revenueMonths.length < REVENUE_TARGET || f.profitQuarters.length < PROFIT_TARGET
}
