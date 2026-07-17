/** 使用者偏好（手續費率、外觀主題）：存於 localStorage，與 GAS 版的全域預設手續費率同構 */
import { DEFAULT_FEE_RATE } from './fees'

const FEE_RATE_KEY = 'stock-pnl-web/fee-rate'
const THEME_KEY = 'stock-pnl-web/theme'

export type ThemePref = 'system' | 'dark' | 'light'

export function getThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    // 讀取失敗即用預設值
  }
  return 'system'
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // 寫入失敗不影響功能
  }
}

/** 將偏好解析為實際主題並套用到 <html>（system 依作業系統設定） */
export function applyTheme(pref: ThemePref): void {
  const systemDark =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
  document.documentElement.dataset.theme = resolved
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', resolved)
}

function readRate(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    const rate = Number(raw)
    if (raw !== null && Number.isFinite(rate) && rate >= 0 && rate < 1) return rate
  } catch {
    // 讀取失敗視同未設定
  }
  return null
}

/**
 * 預設手續費率可依工作區各自記憶（例如「玉山」0.001425、「元大」0.0004275）。
 * 讀取順序：該工作區設定 → 全域設定（舊版遺留） → 法定標準值
 */
export function getFeeRate(workspaceId?: string): number {
  if (workspaceId) {
    const wsRate = readRate(`${FEE_RATE_KEY}/${workspaceId}`)
    if (wsRate !== null) return wsRate
  }
  return readRate(FEE_RATE_KEY) ?? DEFAULT_FEE_RATE
}

export function setFeeRate(rate: number, workspaceId?: string): void {
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return
  try {
    localStorage.setItem(workspaceId ? `${FEE_RATE_KEY}/${workspaceId}` : FEE_RATE_KEY, String(rate))
  } catch {
    // 寫入失敗不影響功能
  }
}
