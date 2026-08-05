/**
 * Pure function of exchange rate conversion and trend range.
 *
 * The reason for pulling out is the same as technicalView.ts / chipStreak.ts: these are the features of this
 * The only real miscalculations (dividing by 0, misintervals, thousandth analysis) can only be done by keeping them in the component.
 * The string produced by render is inferred and cannot be measured cleanly.
 *
 * **Direction agreement: `rate` is always "how many Taiwan dollars can be exchanged for 1 unit of foreign currency"**, and the backend
 * The FxPoint of supabase/functions/stock-report/fxRates.ts is consistent. Reverse without saving a copy.
 *
 * 0.6.7 After removing the converter, amount conversion and input analysis (twdToForeign / foreignToTwd /
 * parseAmount / formatAmount) are deleted together - leaving functions without call-side will only be mistaken for being used by others.
 */
import type { FxPoint } from '../../services/fxProxy'

export type FxRange = '3m' | '6m' | '1y'

export const FX_RANGES: readonly { id: FxRange; label: string; months: number }[] = [
  { id: '3m', label: '3 個月', months: 3 },
  { id: '6m', label: '6 個月', months: 6 },
  { id: '1y', label: '1 年', months: 12 },
]

/** Exchange rate display: The magnitude of each currency is very different, and the number of decimal places is determined by the currency (KRW requires 5 digits)*/
export function formatRate(v: number | null, decimals: number): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toFixed(decimals)
}

/**
 * The number of decimal places is determined according to the magnitude of the value (approximately 5 significant digits), sandwiched between 2 and 6 digits.
 *
 * Used in the **reverse** picture: the `decimals` that come with the currency are selected for the forward vector magnitude, and the reverse is not applicable.
 * The amount of foreign currency that can be exchanged for 1 TWD spans four orders of magnitude:
 *   USD 0.030958 (6 digits required) / JPY 5.0710 (4 digits) / KRW 45.366 (3 digits)
 * Always use the positive number of digits, either completely changing to 0.031 or changing to 5.0710000.
 */
export function autoDecimals(v: number | null): number {
  if (v === null || !Number.isFinite(v) || v === 0) return 2
  const mag = Math.floor(Math.log10(Math.abs(v)))
  return Math.min(Math.max(4 - mag, 2), 6)
}

/**
 * Take the reciprocal sequence: "1 foreign currency = N Taiwan dollars" → "1 Taiwan dollar = N foreign currencies".
 *
 * Note that this is not flipping the graph upside down: 1/x is nonlinear, and the shapes of the two graphs are not mirror images of each other,
 * The dates of the high and low points are reversed (the highest point in the positive direction is the lowest point in the negative direction). This is a mathematical fact, not a bug.
 *
 * 0 is always skipped (not possible, but dividing by 0 would produce Infinity polluting the entire range calculation).
 */
export function invertPoints(points: FxPoint[]): FxPoint[] {
  const out: FxPoint[] = []
  for (const [date, rate] of points) {
    if (!Number.isFinite(rate) || rate === 0) continue
    out.push([date, 1 / rate])
  }
  return out
}

/**
 * Get the last N months of data.
 *
 * **The base point is the last day of the sequence, not today. ** If the data stops a few days ago (scheduling down, holiday),
 * Using today as the benchmark will actually leave "3 months" with just over two months left, and the picture will become inexplicably shorter;
 * If you push back based on the last day of the data itself, you will always see "the last three months of this data."
 */
export function sliceByRange(points: FxPoint[], range: FxRange): FxPoint[] {
  if (points.length === 0) return []
  const months = FX_RANGES.find((r) => r.id === range)?.months ?? 12
  const last = points[points.length - 1][0]
  const d = new Date(`${last}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return points
  /*
    Step the month by hand and clamp the day (0.6.42, AUDIT-03). `setUTCMonth(m - n)` keeps the day-of-month, so a
    series ending on the 29th–31st overflows into the following month: measured, 2026-05-31 minus 3 months landed on
    **2026-03-03**, and 2026-03-31 minus 1 month on the same date —— the window came out up to three days short and
    nothing on screen said so.
  */
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() - months
  const year = Math.floor(total / 12)
  const month = total % 12
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cutoffDate = new Date(
    Date.UTC(year, month, Math.min(d.getUTCDate(), lastDayOfMonth)),
  )
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  return points.filter((p) => p[0] >= cutoff)
}

/** Change percentage. Returns null when the base period is 0 (no hard calculation)*/
export function changePct(latest: number | null, base: number | null): number | null {
  if (latest === null || base === null) return null
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base === 0) return null
  return (latest / base - 1) * 100
}

export interface RangeStats {
  high: number
  highDate: string
  low: number
  lowDate: string
  /** The increase or decrease (%) at the beginning and end of the range, null if there is only one*/
  changePct: number | null
}

/** The high and low range and the first and last increase or decrease. Empty sequence returns null*/
export function rangeStats(points: FxPoint[]): RangeStats | null {
  if (points.length === 0) return null
  let hi = points[0]
  let lo = points[0]
  for (const p of points) {
    if (p[1] > hi[1]) hi = p
    if (p[1] < lo[1]) lo = p
  }
  return {
    high: hi[1],
    highDate: hi[0],
    low: lo[1],
    lowDate: lo[0],
    changePct: points.length > 1 ? changePct(points[points.length - 1][1], points[0][1]) : null,
  }
}

/**
 * Which cells should be marked on the X-axis? There are 260 points in a year, and all marks will turn into black.
 *
 * Take an average of `want` items (including head and tail) and give them to labelIndices of ChartFrame.
 */
export function labelIndicesFor(n: number, want = 6): number[] {
  if (n <= 0) return []
  if (n <= want) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (want - 1)
  return Array.from({ length: want }, (_, i) => Math.round(i * step))
}

/**
 * Whether the data has expired.
 *
 * Why is this judgment necessary: ​​the old files on Storage look exactly the same as the new files on the screen?
 * The numbers on this page will be used to make money decisions. The lesson learned in 0.6.4-dev.5 is exactly this
 * "The data displayed is wrong and cannot be seen by the user" (see description of services/reportsBucket.ts).
 */
export const FX_STALE_DAYS = 3

export function isStale(asOf: string, now: Date, days = FX_STALE_DAYS): boolean {
  const t = Date.parse(asOf)
  if (!Number.isFinite(t)) return false
  return now.getTime() - t > days * 86_400_000
}

/** 'YYYY-MM-DD' → 'MM/DD'; the year must be seen in the sequence across years, so the 1-year interval contains the year*/
export function fmtChartLabel(date: string, withYear: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return withYear ? `${m[1]}/${m[2]}` : `${m[2]}/${m[3]}`
}
