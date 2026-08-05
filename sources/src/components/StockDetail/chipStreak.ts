/**
 * Calculation of continuous buying and selling/continuous increase and continuous decrease.
 *
 * Why does the front end have to calculate it by itself: the `report.streaks` returned by the server is only the number of consecutive days on the "latest trading day".
 * However, the table can be switched to view any day among the 7 days. The number of consecutive days in those days can only be calculated by the front end.
 * (history is already on hand). UI always go here, do not mix `report.streaks`, avoid the same column
 * There are two sources.
 *
 * ⚠️Must be used with `computeStreak` of `sources/supabase/functions/stock-report/report.ts`
 * Consistent behavior (the same set of rules across network boundaries, with testing on both sides).
 */

/**
 * Count the number of consecutive days from the "oldest to newest" sequence up to endIndex:
 * Counting back the number of consecutive transactions with the same number from endIndex, it will be interrupted when it encounters 0 or null (no data on the current day).
 * The returned value has a positive or negative sign (+3 = 3 consecutive buys/3 consecutive increases; -2 = 2 consecutive sells/2 consecutive decreases).
 */
export function streakAt(series: Array<number | null>, endIndex: number): number {
  const last = series[endIndex]
  if (last === null || last === undefined || last === 0) return 0
  const sign = last > 0 ? 1 : -1
  let n = 0
  for (let i = endIndex; i >= 0; i--) {
    const v = series[i]
    if (v === null || v === undefined || v === 0) break
    if (Math.sign(v) !== sign) break
    n++
  }
  return sign * n
}
