/** 使用者偏好（手續費率）：存於 localStorage，與 GAS 版的全域預設手續費率同構 */
import { DEFAULT_FEE_RATE } from './fees'

const FEE_RATE_KEY = 'stock-pnl-web/fee-rate'

export function getFeeRate(): number {
  try {
    const raw = localStorage.getItem(FEE_RATE_KEY)
    const rate = Number(raw)
    if (raw !== null && Number.isFinite(rate) && rate >= 0 && rate < 1) return rate
  } catch {
    // 讀取失敗即用預設值
  }
  return DEFAULT_FEE_RATE
}

export function setFeeRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return
  try {
    localStorage.setItem(FEE_RATE_KEY, String(rate))
  } catch {
    // 寫入失敗不影響功能
  }
}
