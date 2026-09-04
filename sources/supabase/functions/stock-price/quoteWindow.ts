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

/**
 * Retry interval outside trading hours for a quote we cannot confirm as the settled close (0.6.42).
 *
 * 0.6.37 was right that such a quote must not be locked —— it may be an intraday snapshot, and locking freezes it
 * until the next morning (BUG-011). What it did not do is bound the retry: the Yahoo fallback **never** reports a
 * matching time, so during a MIS outage every TW quote refetched once a minute, all night, for every user, with no
 * backoff and no cap.
 *
 * Ten minutes keeps the recovery property that mattered (the row is still replaced as soon as a settled quote
 * appears) at a tenth of the traffic. It matches the US TTL for the same reason: outside its own session, a market
 * that cannot tell you it has settled is not worth asking every minute.
 */
const UNSETTLED_RETRY_MS = 10 * MINUTE_MS

/**
 * End of the post-close settle window: 14:00 (BUG-025).
 *
 * 0.6.42 applied `UNSETTLED_RETRY_MS` to **every** moment outside 08:25–13:30, and that swallowed the
 * one moment where a fast retry is exactly what is needed. At 13:30:30 the cached row is still the
 * 13:29 intraday snapshot: not settled, so the TTL jumped straight to ten minutes and the quote card
 * printed 「盤中」 with pre-close numbers until ~13:40 — even on manual refresh, because the Edge's
 * `price_cache` row is judged by this same function.
 *
 * Right after the close, "not settled yet" is a normal transient measured in seconds, not the outage
 * AUDIT-02 was about. Poll it at the intraday rate for half an hour, then fall back to the ten-minute
 * bound. Worst case (MIS down the whole window) is 30 extra requests per ticker — bounded, unlike the
 * all-night polling that motivated the backoff.
 */
const SETTLE_END_MS = 14 * 60 * MINUTE_MS

const CLOSE_TIME_TEXT = '13:30:00'

/** "Number of milliseconds elapsed on the current day" in Taipei time (starting from 00:00:00)*/
function taipeiMsOfDay(now: Date): number {
  return (now.getTime() + TAIPEI_OFFSET_MS) % DAY_MS
}

/**
 * Is `at` a Taipei moment where the TW market can produce no new price today —— at or after the
 * 14:00 settle-window end, or before the 08:25 resume time (BUG-050)?
 */
export function twIsAfterClose(at: Date): boolean {
  const t = taipeiMsOfDay(at)
  return t >= SETTLE_END_MS || t < RESUME_MS
}

/** Milliseconds until the next 08:25 Taipei resume, from a Taipei time-of-day `t` (ms since 00:00). */
function msUntilResume(t: number): number {
  return t < RESUME_MS ? RESUME_MS - t : DAY_MS - t + RESUME_MS
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
 *   Such a quote keeps being retried rather than locked —— but on a **10-minute** interval since 0.6.42, not every
 *   minute (AUDIT-02): the fallback path never reports a matching time, so an outage used to mean all-night
 *   per-minute polling with no cap. Retrying still replaces the row the moment a settled quote appears.
 * @param fetchedAt The cache row's own fetch time (0.9.32, BUG-050). When the matching time cannot prove the
 *   quote settled, a fetch time after the 14:00 settle window still proves it: the TW market can produce no
 *   later price that day, so this is the day's final available quote. It is still not locked just because it
 *   is old — omitting `fetchedAt`, or a `fetchedAt` still inside the session, must keep the 10-minute retry:
 *   such a row can be an intraday snapshot, and locking it is the exact defect BUG-011 was about.
 */
export function twQuoteTtlMs(now: Date, tradeTime?: string | null, fetchedAt?: Date | null): number {
  const t = taipeiMsOfDay(now)
  if (t >= RESUME_MS && t < CLOSE_MS) return POLL_MS
  if (tradeTime == null || tradeTime < CLOSE_TIME_TEXT) {
    // 13:30–14:00 的沉澱窗：收盤撮合馬上就會落地，這時退避十分鐘等於把盤中價停在畫面上
    if (t >= CLOSE_MS && t < SETTLE_END_MS) return POLL_MS
    if (fetchedAt != null && twIsAfterClose(fetchedAt)) return msUntilResume(t)
    return UNSETTLED_RETRY_MS
  }
  // After closing, it will be pushed back to 08:25 tomorrow; in the early morning (t < RESUME_MS), it will be 08:25 today
  return msUntilResume(t)
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
