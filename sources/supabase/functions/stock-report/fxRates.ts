/**
 * Capture and parse exchange rates of the Taiwan dollar against major foreign currencies (Yahoo Finance chart endpoint).
 *
 * **Why is it not the exchange rate announced by the Bank of Taiwan** (0.6.7 measured during planning, 2026-07-29):
 * `https://rate.bot.com.tw/xrt/flcsv/0/day` with
 * `https://rate.bot.com.tw/xrt/flcsv/0/{YYYY-MM}/{currency}` Two CSV endpoints
 * All return the JS proof-of-work human-machine verification page of `<title>Challenge Validation</title>`,
 * The same goes for browser UA (it’s a different level from FRED’s “UA picky eaters” – this one needs to actually execute JS
 * Just got by, Deno Edge Function can't do it).
 *
 * The price must be made clear: ** Therefore, we cannot get the four "cash/spot, buy/sell" price tags, only the market price. **
 * The screen must be marked with "The exchange rate is not quoted by the bank. Please refer to the bank for actual exchange settlement" and cannot be ignored.
 *
 * The reason for switching to Yahoo is that it was already in the project: twDaily.ts uses the same API to capture the daily line of Taiwan stocks.
 * The same `interval=1d&range=1y`, even the `ChartResponse` type and `tradingDateOf()` are directly used.
 *
 * The analysis is a pure function and does not touch the network. Compare the division of labor of twDaily.ts / usMacro.ts.
 */

import { type ChartResponse, tradingDateOf } from './twDaily.ts'

/**
 * Structured version of fx/twd.json. Front-end gatekeeping must use `>=` (see src/services/fxProxy.ts)——
 * Adding fields is a harmless addition to the old front-end. Using the equal sign will cause the entire paging to hang on the spot when the back-end is upgraded.
 */
export const FX_SCHEMA = 1

/**
 * exchange rate for one day. Tuple is to reduce Storage volume (the reason for using twDaily.DailyRow:
 * The object array is approximately 3 times the size of the tuple). 8 currencies × 260 days, the object writing method will approach 150KB.
 *
 * `rate` is always "**How ​​many Taiwan dollars can be exchanged for 1 unit of foreign currency**". Reverse (how much foreign currency is exchanged for 1 Taiwan dollar) is the reciprocal from the front end,
 * Don’t save another copy – two copies will keep the clock running.
 */
export type FxPoint = [date: string, rate: number]

export interface FxSpec {
  /** ISO 4217 code name*/
  code: string
  name: string
  /**
   * The number of decimal places displayed on the screen. The magnitude of each currency is very different: USD 32.387 only needs 3 digits.
   * KRW 0.022289 will become 0.022 with 3 digits, and no change will be seen.
   */
  decimals: number
  /**
   * Yahoo currency pair candidates, **try in order**. `invert` is true, which means the currency is quoted as
   * "How much foreign currency is exchanged for 1 Taiwan dollar?" The reciprocal is the direction we want to save.
   *
   * ⚠️ **Why two candidates are needed instead of using a certain direction** (actual measurement of 8 currencies on 2026-07-29):
   * There are coins in both directions that are dead, and the way of death is exactly the same - return to 200, complete structure,
   * But `timestamp` only has 1 cell (only the current quote, without any history):
   *
   *   `CNYTWD=X` → 1 grid ❌ / `TWDCNY=X` → 263 grids ✅
   *   `TWDEUR=X` → 1 grid ❌ / `EURTWD=X` → 263 grids ✅
   *
   * No single direction holds true for all eight currencies. This kind of "quietly returning only one frame" will not be wrong,
   * There will be no non-200 status code, it will only turn the trend chart into a point - so the judgment condition is
   * **Whether the points are enough** (see FX_MIN_POINTS), not whether the request is unsuccessful.
   *
   * The order of candidates is the side with more data at the moment of actual measurement. The second one is purely for insurance:
   * Which side has liquidity is Yahoo's own business. If the fallback is reversed in the future, it will automatically connect it.
   */
  symbols: readonly { symbol: string; invert: boolean }[]
}

/** Main 8 currencies. sequence i.e. screen sequence*/
export const FX_CURRENCIES: readonly FxSpec[] = [
  { code: 'USD', name: '美元', decimals: 3, symbols: pair('USD') },
  { code: 'JPY', name: '日圓', decimals: 4, symbols: pair('JPY') },
  { code: 'EUR', name: '歐元', decimals: 3, symbols: pair('EUR') },
  // The actual measurement of CNYTWD=X only returns one grid, so the side with the Taiwan dollar in front is ranked first.
  { code: 'CNY', name: '人民幣', decimals: 4, symbols: pairReversed('CNY') },
  { code: 'HKD', name: '港幣', decimals: 4, symbols: pair('HKD') },
  { code: 'GBP', name: '英鎊', decimals: 3, symbols: pair('GBP') },
  { code: 'AUD', name: '澳幣', decimals: 3, symbols: pair('AUD') },
  { code: 'KRW', name: '韓元', decimals: 5, symbols: pair('KRW') },
]

/** The foreign currency comes first (`USDTWD=X` is directly 1 foreign currency = N Taiwan dollars), and the side with Taiwan dollars in front is used as a backup*/
function pair(code: string): readonly { symbol: string; invert: boolean }[] {
  return [
    { symbol: `${code}TWD=X`, invert: false },
    { symbol: `TWD${code}=X`, invert: true },
  ]
}

/** The reverse order version is used for currencies that have been measured as "Foreign currency is dead on the front side"*/
function pairReversed(code: string): readonly { symbol: string; invert: boolean }[] {
  return [
    { symbol: `TWD${code}=X`, invert: true },
    { symbol: `${code}TWD=X`, invert: false },
  ]
}

/**
 * The threshold to determine "whether this currency pair has history".
 *
 * The actual daily measurement of a year is 260 trading days; the dead side is 1 square. 60 This value is taken between the two,
 * And it is exactly the number of trading days in three months - below it, even the shortest three-month trend chart cannot be drawn.
 * Then it’s time to try the next candidate pair.
 */
export const FX_MIN_POINTS = 60

/** One year, the same set of parameters as twDaily*/
export function fxUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * The precision of storing into Storage. Six decimal places are enough for each currency:
 * The smallest KRW is 0.022289, which is six decimal places and still has four significant figures.
 * If you don't do this step, Yahoo's original value will look like this: 0.19965200126171112 (a single file will be nearly twice the size).
 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Extract the daily sequence of "1 foreign currency = N Taiwan dollars" from the chart response (from old to new).
 * If the structure does not match or there is no valid data, an empty array will be returned, and the caller will try the next candidate currency pair accordingly.
 *
 * Three measured treatments (2026-07-29, one for each of the eight currency pairs):
 *
 * 1. **The cells that close as null should be discarded**: According to actual measurement, each currency pair has 3 cells, which are Christmas and New Year’s Day.
 *    and "The daily line for the day has not been confiscated yet." Same as twDaily's extractDaily.
 *
 * 2. **timestamp must first add `meta.gmtoffset` and then get the UTC date**. The time zone for the exchange rate is **London**
 *    (gmtoffset=3600, timezone=BST), and the raw seconds point to 23:00Z ——
 *    Directly `toISOString().slice(0,10)` will move the entire sequence **backward by one day**.
 *    twDaily's note says that "Taiwan stock time zones coincidentally match", but the exchange rates are not even coincidental here.
 *
 * 3. **Exclude the "real-time quote column" that Yahoo attaches to the end of the sequence**, which is not the daily closing.
 *
 *    The actual timestamp end of each currency pair looks like this:
 *      …, 1785193200 (23:00:00Z), 1785279600 (23:00:00Z), 1785289523 (01:45:23Z)
 *    Each of the previous cells falls on local midnight (23:00Z in BST), and only the last cell captures the current seconds.
 *    And it is **exactly equal to `meta.regularMarketTime`** - it is true once for both currency pairs.
 *    Therefore, the judgment is deterministic and there is no need to guess the time alignment.
 *
 *    **Why it must be eliminated** (actual measurement on 2026-07-29, this is a bug that really displays wrong numbers):
 *    The side of the inverse currency pair (TWD first) has poor liquidity, and the real-time quotes are inconsistent with its own daily sequence.
 *    The daily line of RMB that day is 4.7766, and the attached real-time column is converted to 4.9900 - the daily change **+4.47%**,
 *    On the same day, the other seven currencies moved only 0.4%. Hanging on the screen is an obvious mistake.
 *
 *    The price is that `latest` becomes the "last full daily line" instead of the current quote. This is consistent with the original promise of this page
 *    ("Updated twice a day, non-real-time quotes") are consistent, but more honest.
 *
 * Keeping Map overwrites (the last one on the same day shall prevail) is a defense: after removing the immediate column, theoretically there will be no duplicate days.
 * But it is only appropriate to take the new amount when it is repeated.
 */
export function extractFxPoints(resp: ChartResponse, invert: boolean): FxPoint[] {
  const result = resp?.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(ts) || !q) return []

  const offset = num(result?.meta?.gmtoffset) ?? 0
  const liveAt = num(result?.meta?.regularMarketTime)
  const byDate = new Map<string, number>()
  for (let i = 0; i < ts.length; i++) {
    // Real-time quotation column: It is not the daily closing price, and the value on that side of the inverse currency pair is not credible (see 3. above)
    if (liveAt !== null && ts[i] === liveAt) continue
    const close = num(q.close?.[i])
    if (close === null) continue
    // 0 must be excluded before taking the reciprocal: Yahoo has not returned 0, but 1/0 will be Infinity and all subsequent calculations will be broken.
    if (invert && close === 0) continue
    byDate.set(tradingDateOf(ts[i], offset), round6(invert ? 1 / close : close))
  }

  return [...byDate.entries()]
    .map(([date, rate]): FxPoint => [date, rate])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

export interface FxCurrency {
  code: string
  name: string
  decimals: number
  /** The actual Yahoo currency pair used for audit purposes (which side has data will change over time)*/
  symbol: string
  /** The latest exchange rate (1 foreign currency = N Taiwan dollars). null if there is no data*/
  latest: number | null
  /** The previous trading day, used to calculate daily changes*/
  prevClose: number | null
  /** From old to new, one year*/
  points: FxPoint[]
}

/** The structure of fx/twd.json in Storage. **Global single file, not per-ticker** (same as macro/us.json)*/
export interface FxFile {
  schema: number
  /** The time we actually produced it ISO*/
  asOf: string
  base: 'TWD'
  currencies: FxCurrency[]
}

/** Create a complete structure of a currency from the captured sequence*/
export function buildCurrency(spec: FxSpec, symbol: string, points: FxPoint[]): FxCurrency {
  return {
    code: spec.code,
    name: spec.name,
    decimals: spec.decimals,
    symbol,
    latest: points[points.length - 1]?.[1] ?? null,
    prevClose: points[points.length - 2]?.[1] ?? null,
    points,
  }
}
