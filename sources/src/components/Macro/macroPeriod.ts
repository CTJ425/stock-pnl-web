/**
 * 月頻總經指標的「期別」判定（純函式，方便單獨測試）。
 *
 * 放在 Macro 而不是 Admin：這是總經資料本身的領域邏輯，
 * 管理員後台的「抓取狀況」頁只是借來監看而已 —— 依賴方向是 Admin → Macro。
 */

export type PeriodState = 'ok' | 'warn' | 'idle'

/**
 * 月頻資料的落後判定：與**同組其他來源的最新期別**比，而不是查發布行事曆。
 *
 * 發布日每個指標都不一樣（非農每月第一個週五、CPI 月中、PCE 月底），
 * 維護行事曆等於維護一個一定會過期的常數表；但「其他四個都到 2026-06 了、
 * 只有你還在 2026-05」這件事不必查行事曆也成立。
 */
export function judgePeriod(period: string | null, peerLatest: string | null): PeriodState {
  if (!period) return 'idle'
  if (!peerLatest || period >= peerLatest) return 'ok'
  return 'warn'
}

/** 一組期別字串裡最新的那個（'YYYY-MM' 字典序即時序） */
export function latestPeriod(periods: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null
  for (const p of periods) if (typeof p === 'string' && p && (best === null || p > best)) best = p
  return best
}

/**
 * 落後幾期。0 代表沒落後。
 *
 * 畫面上「落後一期」與「落後三期」是完全不同的意思：前者多半只是還沒發布，
 * 後者代表來源可能停更了（實測 UMCSENT 就是如此 —— 依規律 2026-06 該在
 * 07-01 就發布，但 07-01 / 07-15 / 07-31 三個 vintage 全都還停在 2026-05）。
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
