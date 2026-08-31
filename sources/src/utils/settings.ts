/** User preferences (handling rate, appearance theme): stored in localStorage, isomorphic to the global default handling rate of the GAS version*/
import { DEFAULT_FEE_RATE } from './fees'

const FEE_RATE_KEY = 'stock-pnl-web/fee-rate'
const MIN_FEE_WHOLE_KEY = 'stock-pnl-web/min-fee-whole'
const MIN_FEE_ODD_KEY = 'stock-pnl-web/min-fee-odd'
const THEME_KEY = 'stock-pnl-web/theme'

/** The minimum handling fee for a single transaction of Taiwan stocks (yuan), most brokers are 20*/
export const DEFAULT_MIN_FEE_WHOLE = 20
/** The minimum handling fee for a single transaction of Taiwan stocks (yuan), most brokers are 1*/
export const DEFAULT_MIN_FEE_ODD = 1

export type ThemePref = 'system' | 'dark' | 'light'

export function getThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    // Use default value if read fails
  }
  return 'system'
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Failure to write does not affect functionality
  }
}

/** Parse preferences into actual themes and apply them to <html> (system depends on operating system settings)*/
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
    // Failure to read is treated as unset
  }
  return null
}

/**
 * The default handling fee can be memorized according to the work area (for example, "Yushan" 0.001425, "Yanta" 0.0004275).
 * Reading order: this workspace setting → global setting (legacy from the old version) → legal standard value
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
    // Failure to write does not affect functionality
  }
}

/** The stored rate, or null when the user never set one. Unlike getFeeRate, no default. */
export function getStoredFeeRate(workspaceId?: string): number | null {
  if (workspaceId) {
    const wsRate = readRate(`${FEE_RATE_KEY}/${workspaceId}`)
    if (wsRate !== null) return wsRate
  }
  return readRate(FEE_RATE_KEY)
}

function readMinFee(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    const fee = Number(raw)
    if (raw !== null && Number.isFinite(fee) && fee >= 0) return fee
  } catch {
    // Failure to read is treated as unset
  }
  return null
}

/** The minimum handling fee for a single transaction of Taiwan stocks (yuan), memory based on the workspace; unit distinguishes whole shares/odd shares*/
export function getMinFee(unit: 'whole' | 'odd', workspaceId?: string): number {
  const baseKey = unit === 'whole' ? MIN_FEE_WHOLE_KEY : MIN_FEE_ODD_KEY
  const fallback = unit === 'whole' ? DEFAULT_MIN_FEE_WHOLE : DEFAULT_MIN_FEE_ODD
  if (workspaceId) {
    const wsFee = readMinFee(`${baseKey}/${workspaceId}`)
    if (wsFee !== null) return wsFee
  }
  return readMinFee(baseKey) ?? fallback
}

export function setMinFee(unit: 'whole' | 'odd', fee: number, workspaceId?: string): void {
  if (!Number.isFinite(fee) || fee < 0) return
  const baseKey = unit === 'whole' ? MIN_FEE_WHOLE_KEY : MIN_FEE_ODD_KEY
  try {
    localStorage.setItem(workspaceId ? `${baseKey}/${workspaceId}` : baseKey, String(fee))
  } catch {
    // Failure to write does not affect functionality
  }
}
