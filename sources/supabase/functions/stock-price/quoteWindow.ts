/**
 * Fetching period rules for Taiwan stock quotes (0.6.36). Pure function, stateless, shared by front-end and Edge Function
 * (For front-end unit testing, see src/services/quoteWindow.test.ts).
 *
 * Why is it divided into time periods: the price is finalized after the market closes at 13:30, and asking MIS every 60 seconds is just a waste of time - externally
 * Endpoints, Edge Functions, DB caches are all. The TTL is extended all the way from closing to the next day's trial, which equals zero requests during the entire night.
 *
 * Why not check the trading calendar and save the "locked" flag: just look at the Taipei clock for judgment.
 * Weekends and national holidays will naturally fall into long TTL after 13:30; if it is lifted at 08:25 the next day, if the market is closed that day,
 * Once it reaches 13:30, it falls into the long TTL again. There is one less holiday schedule to maintain and one less state that may be inaccurate.
 */

/** Taipei time zone is fixed at +8 (no daylight savings in Taiwan), consistent with the handling of stock-report/macroCalendar.ts*/
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** Resume price grabbing: 08:25, 5 minutes earlier than trial trading (08:30), so that the first trial trading price before the market opens is new*/
const RESUME_MS = (8 * 60 + 25) * MINUTE_MS
/** Closing: 13:30 Last match*/
const CLOSE_MS = (13 * 60 + 30) * MINUTE_MS
/** Intraday polling interval (maintains pre-0.6.35 behavior)*/
const POLL_MS = MINUTE_MS

const CLOSE_TIME_TEXT = '13:30:00'

/** "Number of milliseconds elapsed on the current day" in Taipei time (starting from 00:00:00)*/
function taipeiMsOfDay(now: Date): number {
  return (now.getTime() + TAIPEI_OFFSET_MS) % DAY_MS
}

/**
 * The cache validity period of Taiwan stock quotes.
 *
 * - 08:25–13:30 (trial and intraday): 60 seconds, consistent with immediate needs before closing
 * - The rest of the time period: **Only lock the quotes that have been confirmed to be the closing value**, and lock them until the next 08:25
 *
 * @param tradeTime The last matching time of the source return (`t` for MIS, HH:mm:ss).
 *   **It will not be locked until 13:30 or if it cannot be obtained at all** (0.6.37 correction):
 *   0.6.36 The original reasoning is "It is now after 13:30, and there will be no new prices that day"——
 *   That is true for "price", but not true for "whether this is the closing value".
 *   There are two sources of cache missing this field: old columns written before the upgrade, and backup paths that do not have this field.
 *   (Yahoo/TWSE OpenAPI). Both are just snapshots of a certain moment on the disk. Locking them will freeze them until the next morning.
 *   The screen displays "Intraday" all the way and the high and low volumes are all "-". Official area actually happened.
 *   The price is to maintain short polling all night long when the source continues to return non-finalized values ​​- that is an abnormal state and should continue to be retried.
 */
export function twQuoteTtlMs(now: Date, tradeTime?: string | null): number {
  const t = taipeiMsOfDay(now)
  if (t >= RESUME_MS && t < CLOSE_MS) return POLL_MS
  if (tradeTime == null || tradeTime < CLOSE_TIME_TEXT) return POLL_MS
  // After closing, it will be pushed back to 08:25 tomorrow; in the early morning (t < RESUME_MS), it will be 08:25 today
  return t < RESUME_MS ? RESUME_MS - t : DAY_MS - t + RESUME_MS
}

/**
 * At this moment, the "maximum possible validity period" of the Taiwan stock cache is used for the coarse filter lower bound of DB query.
 *
 * The coarse filter does not know the `trade_time` of each column and cannot directly call `twQuoteTtlMs(now)` ——
 * Then the TTL will be shortened (because there is no matching time), and the final price captured at yesterday's closing price will be filtered out, and the captured price will be wasted all night.
 * Here, "finalized" is assumed as the upper bound, and the actual judgment on a column-by-column basis is still the responsibility of `twQuoteTtlMs`.
 */
export function twMaxTtlMs(now: Date): number {
  return twQuoteTtlMs(now, CLOSE_TIME_TEXT)
}
