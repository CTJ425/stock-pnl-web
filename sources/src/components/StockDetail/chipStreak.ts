/**
 * 連買連賣 / 連增連減的計算。
 *
 * 為什麼前端要自己算：伺服器回的 `report.streaks` 只是「最新交易日」那一天的連續天數，
 * 但表格可以切換檢視 7 天中的任一天，那幾天各自的連續天數只有前端算得出來
 * （history 本來就在手上）。UI 一律走這裡，不混用 `report.streaks`，避免同一欄
 * 有兩種來源。
 *
 * ⚠️ 必須與 `sources/supabase/functions/stock-report/report.ts` 的 `computeStreak`
 * 行為一致（同一套規則跨網路邊界，兩邊各有測試把關）。
 */

/**
 * 由「由舊到新」的序列算到 endIndex 為止的連續天數：
 * 從 endIndex 往回數同號的連續筆數，遇 0 或 null（當日無資料）即中斷。
 * 回傳值帶正負號（+3 = 連 3 買 / 連 3 增；-2 = 連 2 賣 / 連 2 減）。
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
