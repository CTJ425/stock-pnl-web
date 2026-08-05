/**
 * Taiwan stock daily OHLCV capture and analysis (Yahoo Finance chart endpoint).
 *
 * Why Yahoo and not TWSE: TWSE's `exchangeReport/STOCK_DAY` is a "stock by stock and month by month" file.
 * To complete the 60 trading days required for the season line, you need to play 4 to 5 times, each time. Yahoo's chart endpoint returns an entire year at a time,
 * And this endpoint is already in the project (stock-price is already using it to get the current price, but the timestamp and indicators are lost).
 *
 * Actual measurement (2330.TW, range=1y&interval=1d): 244 trading days, 16.8KB,
 * The five open/high/low/close/volume fields of `indicators.quote[0]` are complete.
 *
 * Two pitfalls that must be dealt with (both are actual observations, not defensive speculation):
 * 1. **The response will include trading days with no data**: Actual test 2025-08-01 All five fields in that grid are null.
 *    This kind of column is discarded directly - it does not carry any information, and keeping it will only prevent the average calculation from being null.
 * 2. **timestamp is UTC seconds, pointing to the local opening time** (Taiwan stock market 09:00 → 01:00Z).
 *    Directly `toISOString().slice(0,10)` happens to be correct in the Taiwan stock time zone, but that is a coincidence and not a guarantee;
 *    Always add `meta.gmtoffset` first and then get the UTC date. This will work in any time zone.
 *
 * The parsing function is a pure function and does not touch the Internet, which is convenient for unit testing; HTTP crawling is combined in index.ts.
 */

/** A daily line. The tuple form is to compress the Storage size (a 244-day object array is about 3 times the size of a tuple)*/
export type DailyRow = [
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
]

/** The structure of daily/{ticker}.json in Storage*/
export interface DailyFile {
  schema: number
  ticker: string
  /** The time we actually caught it ISO*/
  asOf: string
  /** The trading day of the latest bar is YYYY-MM-DD; the batch will be judged based on this whether to re-draw. If no data is found, it will be an empty string.*/
  lastDate: string
  /** From old to new*/
  rows: DailyRow[]
  /**
   * When "already checked and no data found", record the current batch data date (YYYY-MM-DD).
   *
   * Why this field is needed: 0.6.0-dev.7 allows the front-end to click and produce when there is no daily line.
   * If no file is found, no filing will be made at all. Then the code for OTC stocks/newly listed/suspended trading will become
   * "Re-enter the Edge Function every time you open the page, and it will never stop" - that is the mode that will really burn up your credit limit.
   * Write a shell file and write down the query date, and click-to-produce will naturally become "maximum once per day per file".
   *
   * The night batch does not look at this field (still judged by lastDate), because the third shift should have given
   * There is a chance to try again for codenames that have just been launched and Yahoo has not yet provided the information.
   */
  emptyCheckedDate?: string
}

/**
 * The structural version of the daily file.
 * Front-end gatekeeping must use `>=` comparison (see src/services/dailyProxy.ts)——
 * Adding fields is a harmless addition to the old front-end. Using the equal sign will cause the entire technical paging to fail on the spot when the back-end is upgraded.
 * This is exactly the bug fixed in 0.4.1.
 */
export const DAILY_SCHEMA = 1

/** One year is enough to cover the quarterly line (60 trading days) and the warm-up period of each indicator, with the actual measurement back to 244 days.*/
export function dailyUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`
}

/** Taiwan stock code transfer to Yahoo format: listing .TW, if the search fails, the caller will try again to list .TWO (same structure as stock-price)*/
export function yahooDailySymbols(ticker: string): string[] {
  return [`${ticker}.TW`, `${ticker}.TWO`]
}

interface ChartQuote {
  open?: Array<number | null>
  high?: Array<number | null>
  low?: Array<number | null>
  close?: Array<number | null>
  volume?: Array<number | null>
}

export interface ChartResponse {
  chart?: {
    result?: Array<{
      // regularMarketTime is the timestamp of Yahoo's additional "real-time quote column".
      // extractDaily does not use it (the daily line of Taiwan stocks is one per day, and there is no problem), fxRates relies on it to remove that column
      meta?: { gmtoffset?: number; symbol?: string; regularMarketTime?: number }
      timestamp?: number[]
      indicators?: { quote?: ChartQuote[] }
    }> | null
    error?: unknown
  }
}

/** epoch seconds + time zone offset → local trading day YYYY-MM-DD*/
export function tradingDateOf(epochSeconds: number, gmtOffsetSeconds: number): string {
  return new Date((epochSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Extract the daily series (from old to new) from the chart response.
 * If the structure does not match or there is no valid data, an empty array will be returned, and the caller will try the next symbol accordingly.
 */
export function extractDaily(resp: ChartResponse): DailyRow[] {
  const result = resp?.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(ts) || !q) return []

  const offset = num(result?.meta?.gmtoffset) ?? 0
  const rows: DailyRow[] = []
  for (let i = 0; i < ts.length; i++) {
    const close = num(q.close?.[i])
    // The closing price is the basis for determining the existence of this K stick: it is actually measured that those holiday grids with "all five columns null" are filtered out in this way.
    if (close === null) continue
    const open = num(q.open?.[i])
    const high = num(q.high?.[i])
    const low = num(q.low?.[i])
    const volume = num(q.volume?.[i])
    if (open === null || high === null || low === null) continue
    rows.push([tradingDateOf(ts[i], offset), open, high, low, close, volume ?? 0])
  }
  // Yahoo's replies are originally from old to new, but the sorting cost is extremely low and the wrong order will make every moving average wrong.
  rows.sort((a, b) => a[0].localeCompare(b[0]))
  return rows
}
