/**
 * Fugle `historical/candles` → `DailyRow[]` (Task 195). Pure; the HTTP side lives in the callers
 * (`syncDaily`, stock-price `daily`), which fall back to Yahoo whenever this yields nothing.
 *
 * Measured 2026-10-06 (free plan):
 * - `from`..`to` must span less than a year, for every timeframe including `M`
 *   (`400 Date range must be less than one year`); 2025-10-07..2026-10-06 is accepted.
 * - A range with no data answers **404**, not an empty array.
 * - Daily `volume` is in shares and equals TWSE STOCK_DAY 成交股數 exactly (2330, 2026-10-01..06).
 *   Yahoo's figure is lower on some days (2026-10-05: Yahoo 24,042,447 vs TWSE 26,800,187).
 * - Default `sort` is `desc`; we sort ourselves anyway.
 * - `adjusted=false` returns raw prices: 0050's 1:4 split on 2025-06-18 shows as 188.65 → 47.57.
 *   `adjusted=true` also removes dividends (0050 2025-06-10 close 45.90, not 188.65 / 4 = 47.16).
 *   Yahoo's chart is split-adjusted but **not** dividend-adjusted (0050.TW monthly 2025-03 close
 *   43.1875 = 172.75 / 4), so neither Fugle mode matches it. `splitAdjust` reproduces Yahoo's.
 */
import { isTwMarketClosed, tradingDateOf, type DailyRow } from './twDaily.ts'

export interface FugleCandle {
  date?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
  change?: unknown
}

export interface FugleCandlesResponse {
  data?: FugleCandle[]
}

/** Query string fields: `change` is what `splitAdjust` reads the exchange's reference price from. */
export const FUGLE_DAILY_FIELDS = 'open,high,low,close,volume,change'

/** Longest accepted span, inclusive of both ends (`to - from` = 364 days). */
const MAX_SPAN_DAYS = 365

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Split `fromYmd..toYmd` (YYYY-MM-DD, inclusive) into the fewest ranges Fugle accepts, oldest first. */
export function fugleDateRanges(fromYmd: string, toYmd: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let start = fromYmd
  while (start <= toYmd) {
    const end = addDays(start, MAX_SPAN_DAYS - 1)
    out.push([start, end < toYmd ? end : toYmd])
    start = addDays(end, 1)
  }
  return out
}

/** Taipei calendar date `years` years before `now`, plus one day (Yahoo `range=1y` starts the day after). */
export function yearsBack(now: Date, years: number): string {
  const today = tradingDateOf(Math.floor(now.getTime() / 1000), 28800)
  const [y, m, d] = today.split('-').map(Number)
  const back = new Date(Date.UTC(y - years, m - 1, d))
  back.setUTCDate(back.getUTCDate() + 1)
  return back.toISOString().slice(0, 10)
}

/**
 * Below / above these, the gap between a day's reference price and the previous close is a split,
 * reverse split or capital reduction, not a dividend. A design threshold, not an exchange figure:
 * the ±10% price limit bounds close vs reference, not reference vs previous close. A cash dividend
 * above 20% of the price would be mistaken for a split; none has been looked for.
 */
const SPLIT_LOW = 0.8
const SPLIT_HIGH = 1.25

/**
 * Rows (oldest first) carrying the raw `change` (close − reference). Every row before a split day
 * is scaled by reference / previous close, volume the other way, so the series reads like Yahoo's.
 */
export function splitAdjust(rows: Array<{ row: DailyRow; change: number | null }>): DailyRow[] {
  const out: DailyRow[] = rows.map(({ row }) => [...row] as DailyRow)
  let factor = 1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (factor !== 1) {
      const r = out[i]
      for (let k = 1; k <= 4; k++) r[k] = Math.round((r[k] as number) * factor * 10_000) / 10_000
      r[5] = Math.round(r[5] / factor)
    }
    const change = rows[i].change
    if (i > 0 && change !== null) {
      const prevClose = rows[i - 1].row[4]
      const reference = rows[i].row[4] - change
      const f = prevClose > 0 ? reference / prevClose : 1
      if (f > 0 && (f < SPLIT_LOW || f > SPLIT_HIGH)) factor *= f
    }
  }
  return out
}

/**
 * Daily rows from one or more `historical/candles` responses (timeframe `D`, `adjusted=false`).
 * Like `extractDaily`, today's bar is dropped before 13:30 Taipei: it would carry half a day's volume.
 */
export function fugleDailyRows(responses: FugleCandlesResponse[], now: Date = new Date()): DailyRow[] {
  const todayYmd = tradingDateOf(Math.floor(now.getTime() / 1000), 28800)
  const closed = isTwMarketClosed(now)
  const byDate = new Map<string, { row: DailyRow; change: number | null }>()
  for (const resp of responses) {
    for (const c of resp?.data ?? []) {
      const date = typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? c.date : null
      const open = num(c.open)
      const high = num(c.high)
      const low = num(c.low)
      const close = num(c.close)
      if (date === null || open === null || high === null || low === null || close === null) continue
      if (date >= todayYmd && !closed) continue
      byDate.set(date, { row: [date, open, high, low, close, num(c.volume) ?? 0], change: num(c.change) })
    }
  }
  const rows = [...byDate.values()].sort((a, b) => a.row[0].localeCompare(b.row[0]))
  return splitAdjust(rows)
}
