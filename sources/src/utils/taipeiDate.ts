/**
 * Calendar-date helpers shared by anything that needs "today" or month arithmetic on a
 * 'YYYY-MM-DD' key (Task 176). Dates are handled as strings on purpose: `tx_date` is already a
 * plain calendar date, and comparing strings keeps time zones out of the comparison entirely.
 */

/** 'YYYY-MM-DD' in Asia/Taipei for `now` ('en-CA' formats dates in that order). */
export function taipeiDateKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
}

/** Days in a month, 1-indexed month (handles February in leap years). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Shift a 'YYYY-MM-DD' key by whole months, clamping the day to the target month's length —
 * `addMonthsKey('2026-03-31', -1)` is `2026-02-28`, not March 3rd, which is what
 * `Date.setUTCMonth` would roll it into.
 */
export function addMonthsKey(key: string, months: number): string {
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))
  const day = Number(key.slice(8, 10))
  const shifted = month - 1 + months
  const targetYear = year + Math.floor(shifted / 12)
  const targetMonth = ((shifted % 12) + 12) % 12 + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth))
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}
