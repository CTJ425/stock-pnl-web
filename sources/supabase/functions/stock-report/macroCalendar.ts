/**
 * The official calendar released by the General Manager of the United States, and the decision of "should we really ask FRED this round" (purely functional, not online).
 *
 * Why is it an independent module: `index.ts` module is loaded as `Deno.serve`, and vitest cannot import it.
 * If the judgment is written there, it means there is no test (lesson from `pollPlan.ts:2-9`).
 *
 * ## Why do we need a calendar?
 *
 * Before 0.6.14, there were two shifts of blind scanning every day, with a fixed number of 10 FRED requests every day, and the worst timeliness had to wait for the next day.
 * The official actually announced the confirmed release date in advance (not the range), so you can do the opposite:
 * Normally, I only scan once a day (to keep up with FRED and go back to correct the historical values). On the release day, I scan intensively from the time of release.
 * Stop fighting FRED** completely once caught. On the contrary, the number of requests has decreased, and the timeliness has changed from "the next day at the latest" to "within half an hour".
 *
 * ## True uncertainty interval
 *
 * The release date is confirmed, but what is uncertain is the delay of "official release → FRED import is available".
 * Empirical evidence: The PCE of 2026-07-30 was officially released at 20:30 in Taipei, but we couldn’t catch it at 21:00
 * (The yoy in the online file at that time corresponds to the 2026-05 value that has been corrected on the same day - the sequence has been updated,
 * It’s just that the 2026-06 sum hasn’t gone in yet). `SCAN_WINDOW_HOURS` is reserved for this delay.
 *
 * ## ⚠️ Maintenance instructions
 *
 * `RELEASE_CALENDAR` requires **manual updating of the following year's date in December each year**.
 * The schedule page of BLS always returns 403 (the same goes for changing the browser UA), and **cannot be automatically synchronized**.
 * When the calendar is used up, it will automatically fallback to the mid-month/end-of-month rules of `FALLBACK_RULE` and mark `stale`.
 * So forgetting to update will not invalidate the entire set, just a loss of accuracy.
 *
 * Data source (verified on 2026-07-31):
 * - BLS <https://www.bls.gov/schedule/news_release/> — CPI / PPI / Nonfarm, both US East 8:30
 * - BEA <https://www.bea.gov/news/schedule> — PCE, 8:30 ET
 * - U of M <https://www.sca.isr.umich.edu/> — Consumer Confidence, **10:00** (different from the other four)
 *
 * The actual release date checked using ALFRED vintage is completely consistent with the official list (see scripts/find-release-dates.py).
 */

/** One release: which day and issue*/
export interface ReleaseEntry {
  /** Release date, US East local day 'YYYY-MM-DD'*/
  date: string
  /** The data issue released this time is 'YYYY-MM'*/
  period: string
}

/**
 * Officially announced release date. **Valid until the end of 2026**, then go to `FALLBACK_RULE`.
 *
 * Only the verified parts are listed: non-agricultural and PCE in the first half of the year, PPI from January to March are not verified,
 * But those are in the past tense and have no impact on the judgment of "when will the next issue arrive?"
 */
export const RELEASE_CALENDAR: Record<string, readonly ReleaseEntry[]> = {
  CPILFESL: [
    { date: '2026-07-14', period: '2026-06' },
    { date: '2026-08-12', period: '2026-07' },
    { date: '2026-09-11', period: '2026-08' },
    { date: '2026-10-14', period: '2026-09' },
    { date: '2026-11-10', period: '2026-10' },
    { date: '2026-12-10', period: '2026-11' },
  ],
  PPIFES: [
    { date: '2026-07-15', period: '2026-06' },
    { date: '2026-08-13', period: '2026-07' },
    { date: '2026-09-10', period: '2026-08' },
    { date: '2026-10-15', period: '2026-09' },
  ],
  PAYEMS: [
    { date: '2026-08-07', period: '2026-07' },
    { date: '2026-09-04', period: '2026-08' },
    { date: '2026-10-02', period: '2026-09' },
  ],
  PCEPILFE: [
    { date: '2026-07-30', period: '2026-06' },
    { date: '2026-08-26', period: '2026-07' },
    { date: '2026-09-30', period: '2026-08' },
    { date: '2026-10-29', period: '2026-09' },
    { date: '2026-11-25', period: '2026-10' },
    { date: '2026-12-23', period: '2026-11' },
  ],
  // UMCSENT intentionally left blank - see SKIP_INTENSIVE
}

/** Release time of each indicator (Eastern United States local time, hours in 24-hour format)*/
export const RELEASE_HOUR_ET: Record<string, number> = {
  CPILFESL: 8.5,
  PPIFES: 8.5,
  PAYEMS: 8.5,
  PCEPILFE: 8.5,
  UMCSENT: 10, // 密大是 10:00，與其他四項不同
}

/**
 * **Indicators that are not included in calendar-driven intensive scanning**.
 *
 * `UMCSENT`: The actual measurement has been stopped on FRED - according to the rule of "enter FRED on the 1st of the next month", issue 2026-06
 * It should appear in 07-01, but the three vintages 07-01 / 07-15 / 07-31 are all stopped in 2026-05.
 * Including intensive scanning will only scan up to the upper limit on each release day. It is still followed by the **daily routine**,
 * It will be obtained automatically once the source is restored.
 * (Previous example: The OECD version `CSCICP03USM665S` recorded at the beginning of `usMacro.ts` has been discontinued on 2024-01.)
 */
export const SKIP_INTENSIVE: readonly string[] = ['UMCSENT']

/** Fallback when the calendar runs out: Calculate the day of the month that "should have been released". Taken from the **lower edge** of the actual measured interval*/
const FALLBACK_RULE: Record<string, number> = {
  PAYEMS: 8,
  UMCSENT: 3,
  CPILFESL: 14,
  PPIFES: 15,
  PCEPILFE: 30,
}

/** The number of hours to continue scanning after publishing. Covers delays in FRED imports from the official*/
export const SCAN_WINDOW_HOURS = 6

/** The maximum number of scans for a single Taipei day (foolproof, compare pollPlan's MAX_RUNS_PER_DAY)*/
export const MAX_SCANS_PER_DAY = 16

/**
 * Whether a certain UTC point in time is Daylight Saving Time (EDT, UTC-4) in the Eastern United States.
 *
 * US rules: from 02:00 on the second Sunday in March to 02:00 on the first Sunday in November.
 * The two-hour error at the boundary does not affect the judgment (the releases are both at 8:30/10:00, which is far from the switching point).
 */
export function isEasternDst(d: Date): boolean {
  const y = d.getUTCFullYear()
  const secondSunOfMarch = nthSunday(y, 2, 2)
  const firstSunOfNov = nthSunday(y, 10, 1)
  const t = d.getTime()
  return t >= Date.UTC(y, 2, secondSunOfMarch, 7) && t < Date.UTC(y, 10, firstSunOfNov, 6)
}

/** What is the nth Sunday of a certain month in a certain year (month is 0-based)*/
function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7
}

/** Fill in zeros to make a two-digit number*/
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 'YYYY-MM' shifted by n months (n may be negative).
 * Converted to a "year × 12 + month" ordinal and back, so the year rolls over on its own.
 *
 * ⚠️ The month must be taken with a floored modulo, not `%` (0.6.43, AUDIT-07). JavaScript's `%` keeps the sign of
 * the dividend, so a negative ordinal yields a negative month and a period like `-1--2`. Today's years never reach
 * it —— this is a trap disarmed for whoever first calls it with a large negative `n`, not an observed defect.
 */
function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const month = ((total % 12) + 12) % 12
  return `${Math.floor(total / 12)}-${pad2(month + 1)}`
}

/** 'YYYY-MM-DD' in Taipei time zone (UTC+8 fixed offset, no daylight saving in Taiwan)*/
export function taipeiYmdOf(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3600_000)
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/**
 * The time (UTC milliseconds) at which scanning can actually begin for a certain release of a certain indicator.
 * Local day in the East United States + local time → UTC, converted according to whether daylight saving time exists on that day.
 */
export function releaseInstant(entry: ReleaseEntry, id: string): number {
  const [y, m, d] = entry.date.split('-').map(Number)
  const hourEt = RELEASE_HOUR_ET[id] ?? 8.5
  // First use EST (UTC-5) to roughly estimate the noon of the day to determine whether it is daylight saving or not, and then finalize the offset.
  const probe = new Date(Date.UTC(y, m - 1, d, 12))
  const offset = isEasternDst(probe) ? 4 : 5
  return Date.UTC(y, m - 1, d, 0, 0, 0) + (hourEt + offset) * 3600_000
}

export interface ExpectedPeriod {
  /** The latest issue that should have been published according to the calendar at this time; null if no issue is due*/
  period: string | null
  /** Have you exhausted the calendar and switched to rule calculation?*/
  stale: boolean
}

/**
 * Calculate "the latest period that should have been obtained at this time" according to the calendar.
 *
 * The basis of judgment is the **release time** rather than the release day - before 8:30 ET on the morning of the release day,
 * That period does not count as "should have existed", otherwise the indicator would be judged to be lagging behind before the release.
 */
export function expectedLatestPeriod(id: string, now: Date): ExpectedPeriod {
  const entries = RELEASE_CALENDAR[id] ?? []
  const t = now.getTime()
  let best: string | null = null
  let covered = false
  for (const e of entries) {
    const at = releaseInstant(e, id)
    if (at <= t && (best === null || e.period > best)) best = e.period
    if (at > t) covered = true // the calendar still has future entries → not exhausted
  }
  // ⚠️ "Is it exhausted?" is answered by **whether future entries exist**, not by whether best has a value ——
  // When the calendar expires, best will still be the last entry (for example, it stops at 2026-11).
  // If you return stale:false based on this, you will always be stuck in the last issue of last year after New Year's Eve without realizing it.
  if (covered) return { period: best, stale: false }

  // The calendar is exhausted (or there is no calendar for this indicator) → return to rule calculation
  const day = FALLBACK_RULE[id]
  if (day === undefined) return { period: null, stale: true }
  const taipeiYmd = taipeiYmdOf(now) // 以台北日曆判斷「這個月過了幾天」
  const dayOfMonth = Number(taipeiYmd.split('-')[2])
  // The current month has passed the estimation date → the data from the previous month should have been released; otherwise, go back to the previous month
  const back = dayOfMonth >= day ? 1 : 2
  return { period: shiftPeriod(taipeiYmd.slice(0, 7), -back), stale: true }
}

export interface NextRelease {
  /** Release date (Eastern US local day) 'YYYY-MM-DD'*/
  date: string
  /** The information released this time is 'YYYY-MM'*/
  period: string
  /** true means that the calendar has been used up and the date is calculated by the rules.*/
  estimated: boolean
}

/**
 * The release date of the "next issue" of an indicator.
 *
 * **The back-end calculates and then passes it back to the front-end** instead of letting the front-end also put a calendar——
 * The two constants will drift sooner or later, and the symptoms of drift (the screen says 8/12, but the backend judges it as 8/14)
 * It's almost impossible to tell from the picture. The single source of truth is in this archive.
 *
 * When the calendar is exhausted, return `estimated: true` and estimate based on the days of `FALLBACK_RULE`.
 * The screen is marked "Estimated" accordingly.
 */
export function nextReleaseFor(
  id: string,
  latestPeriod: string | null,
  now: Date,
): NextRelease | null {
  const entries = RELEASE_CALENDAR[id] ?? []
  const t = now.getTime()
  // It hasn’t happened yet, and don’t expect it to be newer than the first one in your hand.
  const upcoming = entries
    .filter((e) => releaseInstant(e, id) > t && (!latestPeriod || e.period > latestPeriod))
    .sort((a, b) => a.date.localeCompare(b.date))[0]
  if (upcoming) return { date: upcoming.date, period: upcoming.period, estimated: false }

  // The calendar is exhausted → Calculate the next issue according to the rules
  const day = FALLBACK_RULE[id]
  if (day === undefined || !latestPeriod) return null
  if (!/^\d{4}-\d{2}$/.test(latestPeriod)) return null
  // On hand is 2026-06 → next issue 2026-07, published on 2026-08
  return {
    date: `${shiftPeriod(latestPeriod, 2)}-${pad2(day)}`,
    period: shiftPeriod(latestPeriod, 1),
    estimated: true,
  }
}

export interface ScanInput {
  now: Date
  /** The latest period of each indicator in the existing file*/
  indicators: ReadonlyArray<{ id: string; latestPeriod: string | null }>
  /** How many times have I scanned today (Taipei Day)?*/
  scansToday: number
  /** The Taipei day of the last scan; if it is different from today, it means that it has not been scanned today.*/
  lastScanYmd: string | null
}

export type ScanReason =
  /** I haven’t scanned it yet today, I will scan it once a day (to keep up with FRED and go back and correct the historical values)*/
  | 'routine'
  /** There are indicators that have not been obtained when the release time comes, and they fall within the scanning window.*/
  | 'due'
  /** Got everything that should be taken*/
  | 'satisfied'
  /** There are indicators that have not been obtained yet, but they have exceeded the scanning window (waiting for tomorrow’s regular shift)*/
  | 'outside-window'
  /** The number of scans today has reached the limit*/
  | 'capped'

export interface ScanDecision {
  scan: boolean
  reason: ScanReason
  /** Indicators that trigger the scan (only available if reason='due')*/
  dueIds: string[]
}

/**
 * Should I really ask FRED this round?
 *
 * Follow the form of `pollPlan.decideSkip`: make "should you send a request or not" a testable pure function?
 * Instead of if scattered in the IO process.
 *
 * The order makes sense:
 * 1. **Maximum number of times** takes priority - unlimited scanning cannot be done when the source is really down (such as UMCSENT stopped updating).
 * 2. **Not scanned today → Scan**. Make sure you ask this question at least once a day.
 *    Because FRED will go back and correct the published historical values ​​(BUG-008 vintage changed two issues at the same time),
 *    Relying solely on release day scans will miss corrections.
 * 3. **Within the release window and not yet received → Scan**, this is "stretched scan".
 * 4. Do not scan the rest - **"Once caught, don't catch" is exactly where it ends** (satisfied).
 */
export function decideMacroScan(input: ScanInput): ScanDecision {
  const { now, indicators, scansToday, lastScanYmd } = input

  if (scansToday >= MAX_SCANS_PER_DAY) return { scan: false, reason: 'capped', dueIds: [] }

  if (lastScanYmd !== taipeiYmdOf(now)) return { scan: true, reason: 'routine', dueIds: [] }

  const t = now.getTime()
  const dueIds: string[] = []
  let anyPendingOutsideWindow = false

  for (const ind of indicators) {
    if (SKIP_INTENSIVE.includes(ind.id)) continue
    const expected = expectedLatestPeriod(ind.id, now)
    if (!expected.period) continue
    // Already got it (or updated) → No need to scan this item. This is "if you catch me, don't catch me."
    if (ind.latestPeriod && ind.latestPeriod >= expected.period) continue

    // Not got it yet: Only if it falls within the scanning window after the release of the issue, it is worth continuing to scan.
    const entry = (RELEASE_CALENDAR[ind.id] ?? []).find((e) => e.period === expected.period)
    if (!entry) {
      anyPendingOutsideWindow = true
      continue
    }
    const at = releaseInstant(entry, ind.id)
    if (t >= at && t <= at + SCAN_WINDOW_HOURS * 3600_000) dueIds.push(ind.id)
    else anyPendingOutsideWindow = true
  }

  if (dueIds.length > 0) return { scan: true, reason: 'due', dueIds }
  return {
    scan: false,
    reason: anyPendingOutsideWindow ? 'outside-window' : 'satisfied',
    dueIds: [],
  }
}
