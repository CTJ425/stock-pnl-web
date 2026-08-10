/**
 * Soft thresholds for on-demand warm (StockDetailPage + background prefetch).
 *
 * Backend target is 12 months / 12 quarters (nightly). On-demand warm only when the file is
 * clearly thin so partial histories still paint without blocking the UI — but "thin" must cover
 * **both** series. Until 0.6.46-dev.6 only revenue < 6 or zero quarters triggered warm, so a
 * stock that already had 12 months + 1–2 quarters (typical after one progressive
 * history pass that spent the budget on revenue first) never re-warmed and quarterly profit
 * stayed short forever except for the slow night batch (2 quarters/round).
 */
import type { FundamentalData } from './fundamentalProxy'

/** Below this many revenue months, trigger on-demand history (and core if empty). */
export const REVENUE_WARM_MIN = 6

/** Below this many profit quarters, trigger on-demand history (0.6.46-dev.6). */
export const PROFIT_WARM_MIN = 6

/** Nightly / warm completion target (display + complete check). */
export const REVENUE_TARGET = 12
export const PROFIT_TARGET = 12

/**
 * Need daily + latest fundamental (quota-charging `phase=core`).
 * Missing file / no months / no quarters at all — history alone cannot invent a shell file.
 */
export function needsCoreWarm(f: FundamentalData | null): boolean {
  if (!f) return true
  if (f.revenueMonths.length === 0) return true
  if (f.profitQuarters.length === 0) return true
  return false
}

/**
 * Need MOPS history backfill (`phase=history`, no second quota).
 * Soft mins for either series — not the full 12/12 (night batch still owns the last stretch).
 */
export function needsHistoryWarm(f: FundamentalData): boolean {
  if (f.revenueMonths.length < REVENUE_WARM_MIN) return true
  if (f.profitQuarters.length < PROFIT_WARM_MIN) return true
  return false
}

/**
 * Combined soft gate used by prefetch: anything that warrants an on-demand pass.
 * Prefer `needsCoreWarm` / `needsHistoryWarm` when choosing which phase to call.
 */
export function needsFundamentalBackfill(f: FundamentalData): boolean {
  return needsCoreWarm(f) || needsHistoryWarm(f)
}

/** True when history is short of the 12/12 target (UI "still filling" note). */
export function isFundamentalIncomplete(f: FundamentalData): boolean {
  return f.revenueMonths.length < REVENUE_TARGET || f.profitQuarters.length < PROFIT_TARGET
}
