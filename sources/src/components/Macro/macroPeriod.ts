/**
 * "Period" determination of the monthly frequency total economic indicator (pure function, convenient for independent testing).
 *
 * Put it in Macro instead of Admin: This is the domain logic of the general manager data itself.
 * The "Crawling Status" page in the administrator's backend is only used for monitoring - the dependent direction is Admin → Macro.
 */

export type PeriodState = 'ok' | 'warn' | 'idle'

/**
 * Determining the backwardness of monthly frequency data: comparing the latest period with other sources in the same group, rather than checking the release calendar.
 *
 * Each indicator is different on the release day (non-farm payrolls on the first Friday of each month, CPI in the middle of the month, PCE at the end of the month),
 * Maintaining the calendar is equivalent to maintaining a constant table that will definitely expire; but "the other four are all up to 2026-06,
 * Only you are still in 2026-05" This is true without checking the calendar.
 */
export function judgePeriod(period: string | null, peerLatest: string | null): PeriodState {
  if (!period) return 'idle'
  if (!peerLatest || period >= peerLatest) return 'ok'
  return 'warn'
}

/** The latest one in a set of period strings ('YYYY-MM' dictionary sequence)*/
export function latestPeriod(periods: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null
  for (const p of periods) if (typeof p === 'string' && p && (best === null || p > best)) best = p
  return best
}

/**
 * A few issues behind. 0 means after decline.
 *
 * On the screen, "one issue behind" and "three issues behind" have completely different meanings: the former is probably just not released yet.
 * The latter means that the source may have stopped updating (actually measured UMCSENT is like this - according to the rules, 2026-06 should be in
 * It was released on 07-01, but the three vintages of 07-01 / 07-15 / 07-31 are all still stopped at 2026-05).
 */
export function periodsBehind(period: string | null, peerLatest: string | null): number {
  if (!period || !peerLatest) return 0
  const a = /^(\d{4})-(\d{2})$/.exec(period)
  const b = /^(\d{4})-(\d{2})$/.exec(peerLatest)
  if (!a || !b) return 0
  const ma = Number(a[1]) * 12 + Number(a[2])
  const mb = Number(b[1]) * 12 + Number(b[2])
  return Math.max(0, mb - ma)
}
