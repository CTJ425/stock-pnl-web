/**
 * Long-range daily/monthly bars for the daily K chart's `近 5 年` / `全部` ranges (Route A).
 * These two ranges are fetched from Yahoo on demand instead of coming from the
 * nightly `daily/{ticker}.json` batch, because that file only holds about one year.
 *
 * `max` pitfalls (measured 2026-09-10, 2330.TW):
 * - Yahoo ignores `interval` for `range=max` and returns monthly bars regardless.
 * - The monthly timestamps are month start, but only once `meta.gmtoffset` is added;
 *   without it the dates read as the previous month's last day.
 * - `range=max` appends one extra live row for today after the current month's bar,
 *   stamped at `meta.regularMarketTime`. It must be dropped or the current month
 *   shows two bars.
 */
import { tradingDateOf, type ChartResponse, type DailyRow } from '../stock-report/twDaily.ts'

export type DailyRangeKey = '5y' | 'max'

/** Yahoo ignores `interval` for `range=max` and always answers with monthly bars. */
export function dailyRangeInterval(range: DailyRangeKey): '1d' | '1mo' {
  return range === 'max' ? '1mo' : '1d'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Extract monthly bars (from old to new) for `range=max`. Deliberately does not apply
 * `isTwMarketClosed`: that filter exists to drop today's still-open daily bar, and has
 * no meaning for monthly bars, which instead drop the live row by matching
 * `meta.regularMarketTime` directly.
 */
export function extractMonthly(resp: ChartResponse): DailyRow[] {
  const result = resp?.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(ts) || !q) return []

  const offset = num(result?.meta?.gmtoffset) ?? 28800
  const liveTime = result?.meta?.regularMarketTime

  const rows: DailyRow[] = []
  for (let i = 0; i < ts.length; i++) {
    const open = num(q.open?.[i])
    const high = num(q.high?.[i])
    const low = num(q.low?.[i])
    const close = num(q.close?.[i])
    if (open === null || high === null || low === null || close === null) continue
    if (liveTime !== undefined && ts[i] === liveTime) continue

    const date = tradingDateOf(ts[i], offset)
    const volume = num(q.volume?.[i])
    rows.push([date, open, high, low, close, volume ?? 0])
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]))
  return rows
}
