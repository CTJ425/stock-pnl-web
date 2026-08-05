/**
 * Report data model assembly: Synthesize the captured chips + the holding context (cost/profit and loss) brought in by the front end into ReportData.
 * Pure data layer, does not touch the network or DB, which is convenient for unit testing.
 *
 * Schema 2 (from v0.3.7-dev.3): The server only returns structured data and no longer generates HTML;
 * Embedded history of up to 7 trading days for front-end self-drawn trend charts.
 * Schema 3 (from v0.4.0): Added `sources` - the data date and fetch time of each data source.
 * The front end accepts schema >= 2, `sources` is considered optional.
 */
import type { ChipLeg, InstitutionalChip, MarginChip, BorrowChip } from './twChips.ts'

/** Report structure version*/
export const REPORT_SCHEMA = 3

/** The shareholding context brought in by the front-end (all values ​​have been calculated by the front-end, Worker does not recalculate)*/
export interface HoldingContext {
  qty: number
  avgCost: number
  price: number | null
  unrealized: number | null
  roi: number | null
}

/** Chip snapshot of a single trading day*/
export interface ChipDay {
  /** The trading day to which the data belongs YYYY-MM-DD*/
  date: string
  institutional: InstitutionalChip | null
  margin: MarginChip | null
}

/** Continuous buying and selling/continuous increasing and decreasing: positive number = overbuying (increasing) for N consecutive days, negative number = overselling (decreasing) for N consecutive days, 0 = interruption*/
export interface ChipStreaks {
  foreign: number
  foreignDealer: number
  trust: number
  dealer: number
  total: number
  /** Financing balance continues to increase and decrease*/
  margin: number
  /** The balance of securities lending continued to increase and decrease*/
  short: number
}

/**
 * Freshness from a single source.
 *
 * Reason for existence: The release times of the three data sources are very different (approximately 15:00–15:30 for the three major legal persons, approximately 21:00–22:00 for margin trading,
 * (approximately 21:00–22:30), the batches are executed in segments, so the freshness of each block in the same report is inherently different.
 * Giving only one generatedAt to the entire report can fool the user into thinking that every block is equally new.
 */
export interface SourceStamp {
  /** The date this data itself belongs to is YYYY-MM-DD (the borrowing period is the "next trading day", so it may be different from the data date of chips)*/
  date: string | null
  /** The time when we actually captured it ISO; null means that the data does not exist yet*/
  fetchedAt: string | null
}

/** The freshness of each data source. If an item is missing, it means that the item has not been obtained today.*/
export interface ReportSources {
  institutional: SourceStamp | null
  margin: SourceStamp | null
  borrow: SourceStamp | null
}

export interface ReportData {
  schema: typeof REPORT_SCHEMA
  ticker: string
  name: string
  market: 'TPE'
  /** Latest trading day YYYY-MM-DD (= last transaction in history)*/
  dataDate: string
  /** Creation time ISO*/
  generatedAt: string
  holding: HoldingContext | null
  /** The three major legal persons of the latest trading day (= the last transaction in history, convenient for direct access by the front end)*/
  institutional: InstitutionalChip | null
  /** Margin margin trading on the latest trading day*/
  margin: MarginChip | null
  /** Borrow bonds (the source has no date parameter, only the latest trading day)*/
  borrow: BorrowChip | null
  /** Old to new, up to 7 trading days*/
  history: ChipDay[]
  streaks: ChipStreaks
  /** The data date and crawl time of each data source (schema 3 and above)*/
  sources: ReportSources
  /** Missing/downgraded instructions (if listing is not currently supported, historical data is being replenished)*/
  notes: string[]
}

/** YYYYMMDD in Taipei time zone (UTC+8)*/
export function taipeiYmd(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, '0')
  const day = String(t.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * Push back transaction day candidates (including several days before the current day, from new to old), used for rwd endpoint attempts;
 * On weekends/holidays/when the market has not yet closed, the previous candidate will not be captured, so try an earlier one instead.
 */
export function tradingDateCandidates(now: Date, back = 7): string[] {
  const out: string[] = []
  for (let i = 0; i <= back; i++) {
    out.push(taipeiYmd(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)))
  }
  return out
}

/**
 * Saturdays and Sundays must be non-trading days. First eliminate external requests that can save wasted time (holidays still need to be implemented to know).
 * Calculate the day of the week directly using YYYYMMDD as the UTC date, which is not affected by the execution environment time zone.
 */
export function isWeekendYmd(ymd: string): boolean {
  const dow = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay()
  return dow === 0 || dow === 6
}

/** YYYYMMDD → YYYY-MM-DD */
export function dashDate(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

/**
 * Calculate the number of consecutive days from the "oldest to newest" sequence:
 * Count the number of consecutive transactions with the same number from the latest one, and it will be interrupted when it encounters 0 or null (no data on the current day).
 * The returned value has a positive or negative sign (+3 = 3 consecutive buys/3 consecutive increases; -2 = 2 consecutive sells/2 consecutive decreases).
 */
export function computeStreak(series: Array<number | null>): number {
  const last = series[series.length - 1]
  if (last === null || last === undefined || last === 0) return 0
  const sign = last > 0 ? 1 : -1
  let n = 0
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i]
    if (v === null || v === undefined || v === 0) break
    if (Math.sign(v) !== sign) break
    n++
  }
  return sign * n
}

/** Get a certain transaction super sequence in history (from old to new)*/
function netSeries(
  history: ChipDay[],
  pick: (i: InstitutionalChip) => ChipLeg,
): Array<number | null> {
  return history.map((d) => (d.institutional ? pick(d.institutional).net : null))
}

export function computeStreaks(history: ChipDay[]): ChipStreaks {
  return {
    foreign: computeStreak(netSeries(history, (i) => i.foreign)),
    foreignDealer: computeStreak(netSeries(history, (i) => i.foreignDealer)),
    trust: computeStreak(netSeries(history, (i) => i.trust)),
    dealer: computeStreak(netSeries(history, (i) => i.dealer)),
    total: computeStreak(netSeries(history, (i) => i.total)),
    margin: computeStreak(history.map((d) => d.margin?.marginChange ?? null)),
    short: computeStreak(history.map((d) => d.margin?.shortChange ?? null)),
  }
}

export interface BuildReportParams {
  ticker: string
  name: string
  dataDateYmd: string
  holding: HoldingContext | null
  /** Trading day sequence from old to new (last transaction = latest trading day)*/
  history: ChipDay[]
  borrow: BorrowChip | null
  sources?: ReportSources
  notes: string[]
  now?: Date
}

export function buildReport(p: BuildReportParams): ReportData {
  const latest = p.history[p.history.length - 1] ?? null
  return {
    schema: REPORT_SCHEMA,
    ticker: p.ticker,
    name: p.name,
    market: 'TPE',
    dataDate: dashDate(p.dataDateYmd),
    generatedAt: (p.now ?? new Date()).toISOString(),
    holding: p.holding,
    institutional: latest?.institutional ?? null,
    margin: latest?.margin ?? null,
    borrow: p.borrow,
    history: p.history,
    streaks: computeStreaks(p.history),
    sources: p.sources ?? { institutional: null, margin: null, borrow: null },
    notes: p.notes,
  }
}
