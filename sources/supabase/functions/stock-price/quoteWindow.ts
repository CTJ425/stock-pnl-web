/**
 * Fetching period rules for Taiwan stock quotes (0.6.36). Pure function, stateless, shared by front-end and Edge Function
 * (For front-end unit testing, see src/services/quoteWindow.test.ts).
 *
 * Why is it divided into time periods: the price is finalized after the market closes at 13:30, and asking MIS every 60 seconds is just a waste of time - externally
 * Endpoints, Edge Functions, DB caches are all. The TTL is extended all the way from closing to the next day's trial, which equals zero requests during the entire night.
 *
 * Why not check the trading calendar and save the "locked" flag: just look at the Taipei clock for judgment.
 * National holidays will naturally fall into long TTL after 13:30; if it is lifted at 08:25 the next day, if the market is closed that day,
 * Once it reaches 13:30, it falls into the long TTL again. There is one less holiday schedule to maintain and one less state that may be inaccurate.
 *
 * Weekends are the exception (BUG-110): they need no calendar, and treating them as sessions was not harmless.
 * On Sunday 2026-10-04 MIS served TWSE test-session matches as today's trades (d=20261004, t=09:07, most at
 * the limit-up price), and PROD cached them site-wide. A lock now runs to the next **trading day's** 08:25,
 * nothing polls on a closed day, and the Edge skips MIS on those days (see `twIsClosedDay`).
 *
 * Weekday holidays followed (0.10.26): the same test session can run on any day the market is shut, so the
 * "no calendar" argument above no longer holds. `TW_HOLIDAYS` is that calendar. A year it does not cover
 * falls back to the weekend rule alone, which is the 0.10.25 behaviour.
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
 * TWSE weekday closures, `YYYYMMDD` → name. Source: TWSE 「市場開休市日期」
 * https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=20260101 (fetched 2026-10-04).
 *
 * Only days the market does not trade. The source also lists trading days as markers — 「國曆新年開始交易日」
 * 01-02, 「農曆春節前最後交易日」 02-11, 「農曆春節後開始交易日」 02-23 — and those are left out on purpose: listing
 * one would freeze that day's prices. 「市場無交易，僅辦理結算交割作業」 (02-12, 02-13) has no trading, so it is in.
 * Holidays that fall on a weekend are left out too; the weekend rule already covers them.
 *
 * Refresh every December from the same URL with next year's `date` (Task 47). An uncovered year only loses the
 * holiday guard — see `TW_HOLIDAY_YEARS`.
 */
export const TW_HOLIDAYS: ReadonlyMap<string, string> = new Map([
  ['20260101', '中華民國開國紀念日'],
  ['20260212', '市場無交易，僅辦理結算交割作業'],
  ['20260213', '市場無交易，僅辦理結算交割作業'],
  ['20260216', '農曆除夕及春節'],
  ['20260217', '農曆除夕及春節'],
  ['20260218', '農曆除夕及春節'],
  ['20260219', '農曆除夕及春節'],
  ['20260220', '農曆除夕及春節'],
  ['20260227', '和平紀念日'],
  ['20260403', '兒童節及民族掃墓節'],
  ['20260406', '兒童節及民族掃墓節'],
  ['20260501', '勞動節'],
  ['20260619', '端午節'],
  ['20260925', '中秋節'],
  ['20260928', '孔子誕辰紀念日/ 教師節'],
  ['20261009', '國慶日'],
  ['20261026', '臺灣光復暨金門古寧頭大捷紀念日'],
  ['20261225', '行憲紀念日'],
])

/** Years `TW_HOLIDAYS` covers. Outside them only weekends count as closed. */
export const TW_HOLIDAY_YEARS: ReadonlySet<number> = new Set([2026])

/** `YYYYMMDD` of the Taipei calendar day that contains `at`. */
function taipeiYmd(at: Date): string {
  return new Date(at.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '')
}

/** Is a `YYYYMMDD` date a Saturday or Sunday? */
function ymdIsWeekend(ymd: string): boolean {
  const day = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)))).getUTCDay()
  return day === 0 || day === 6
}

/**
 * Is a `YYYYMMDD` trade date one the TWSE does not trade —— a weekend or a `TW_HOLIDAYS` day? A quote dated
 * then can only be a test-session match (BUG-110).
 */
export function twIsClosedDate(tradeDate: string | null | undefined): boolean {
  if (!tradeDate || !/^\d{8}$/.test(tradeDate)) return false
  return ymdIsWeekend(tradeDate) || TW_HOLIDAYS.has(tradeDate)
}

/** Is `at` on a Taipei day the TWSE does not trade? MIS can still serve test-session matches then (BUG-110). */
export function twIsClosedDay(at: Date): boolean {
  return twIsClosedDate(taipeiYmd(at))
}

/**
 * Is `at` a Taipei moment where the TW market can produce no new price today —— at or after the
 * 14:00 settle-window end, or before the 08:25 resume time (BUG-050), or on a closed day (BUG-110)?
 */
export function twIsAfterClose(at: Date): boolean {
  const t = taipeiMsOfDay(at)
  return twIsClosedDay(at) || t >= SETTLE_END_MS || t < RESUME_MS
}

/** Milliseconds from `at` until the next trading day's 08:25 Taipei resume (BUG-110: closed days are skipped). */
function msUntilResume(at: Date): number {
  const t = taipeiMsOfDay(at)
  let ms = t < RESUME_MS ? RESUME_MS - t : DAY_MS - t + RESUME_MS
  while (twIsClosedDay(new Date(at.getTime() + ms))) ms += DAY_MS
  return ms
}

/** Milliseconds from the latest trading day's 08:25 Taipei resume at or before `now` until `now`. */
function msSinceResume(now: Date): number {
  const t = taipeiMsOfDay(now)
  let ms = t >= RESUME_MS ? t - RESUME_MS : DAY_MS - RESUME_MS + t
  while (twIsClosedDay(new Date(now.getTime() - ms))) ms += DAY_MS
  return ms
}

/** Is `at` inside a trading day's 08:25–13:30, where a fetched quote can still be superseded the same day? */
function twInSession(at: Date): boolean {
  const t = taipeiMsOfDay(at)
  return !twIsClosedDay(at) && t >= RESUME_MS && t < CLOSE_MS
}

/**
 * The lock on a settled quote: it runs to the first 08:25 **after the row was fetched** (BUG-086).
 *
 * Both callers (the Edge `price_cache` read and the browser `isFresh`) compare this value with the
 * row's age, `now − fetchedAt`, so it must be measured from the fetch. Measuring it from `now` (up to
 * 0.10.3) made the check depend on when it was asked: a row fetched after Monday's close still passed
 * on Tuesday afternoon until its age caught up with "time left until Wednesday 08:25" (~15:45), so a
 * ticker nobody opened during Tuesday's session showed Monday's close; and a row fetched after the
 * close was refetched in the early morning, when it should have been locked.
 * Without `fetchedAt` the row is taken as fetched now, which is what both callers mean when they omit it.
 */
function lockMs(now: Date, fetchedAt?: Date | null): number {
  return msUntilResume(fetchedAt ?? now)
}

/**
 * The cache validity period of Taiwan stock quotes.
 *
 * - Trading-day 08:25–13:30 (trial and intraday): 60 seconds, consistent with immediate needs before closing
 * - The rest of the time period, closed days included: **Only lock the quotes that have been confirmed to be the closing value**, and lock them until the next trading day's 08:25
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
 *   The same holds for a 13:30:00 matching time on a row fetched inside the session: that is the previous
 *   day's close, served before today's trial trading starts, so it is not today's settled quote (BUG-086).
 * @returns A validity period measured from `fetchedAt` (from `now` when it is omitted); see `lockMs`.
 */
export function twQuoteTtlMs(now: Date, tradeTime?: string | null, fetchedAt?: Date | null): number {
  const t = taipeiMsOfDay(now)
  const tradingDay = !twIsClosedDay(now)
  if (tradingDay && t >= RESUME_MS && t < CLOSE_MS) return POLL_MS
  const settled =
    tradeTime != null && tradeTime >= CLOSE_TIME_TEXT && (fetchedAt == null || !twInSession(fetchedAt))
  if (!settled) {
    // 13:30–14:00 的沉澱窗：收盤撮合馬上就會落地，這時退避十分鐘等於把盤中價停在畫面上
    if (tradingDay && t >= CLOSE_MS && t < SETTLE_END_MS) return POLL_MS
    if (fetchedAt != null && twIsAfterClose(fetchedAt)) return lockMs(now, fetchedAt)
    return UNSETTLED_RETRY_MS
  }
  // Locked until the first trading-day 08:25 after the fetch; a row fetched in the early morning (before 08:25) unlocks at 08:25 that day
  return lockMs(now, fetchedAt)
}

/**
 * The coarse-filter lower bound for the DB query: the oldest a Taiwan row can be and still be fresh now.
 *
 * The coarse filter does not know each row's `trade_time`, so it takes the most generous case. Since a
 * lock ends at the first trading-day 08:25 after the fetch (see `lockMs`), no row fetched before the latest
 * trading-day 08:25 can still be fresh outside the session, and nothing older than one poll interval can be
 * fresh inside it. The actual judgment on a row-by-row basis is still the responsibility of `twQuoteTtlMs`.
 */
export function twMaxTtlMs(now: Date): number {
  if (twInSession(now)) return POLL_MS
  return msSinceResume(now)
}
