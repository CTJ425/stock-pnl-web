/**
 * 金額與數字格式化（與 GAS 版 Dashboard 的分區段格式同構）：
 * - 台股 (TWD)：損益/市值取整數；現價/均價保留兩位小數
 * - 美股 (USD)：全面保留兩位小數
 */
import type { Currency } from '../types/models'

const CURRENCY_PREFIX: Record<Currency, string> = { TWD: 'NT$', USD: 'US$' }

function withThousands(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** 金額（TWD 預設整數、USD 預設兩位小數），負值顯示為 -NT$1,234 */
export function fmtMoney(
  value: number | null | undefined,
  currency: Currency,
  decimals?: number,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const d = decimals ?? (currency === 'TWD' ? 0 : 2)
  const sign = value < 0 ? '-' : ''
  return `${sign}${CURRENCY_PREFIX[currency]}${withThousands(Math.abs(value), d)}`
}

/** 現價 / 平均成本：兩種幣別皆保留兩位小數 */
export function fmtPrice(value: number | null | undefined, currency: Currency): string {
  return fmtMoney(value, currency, 2)
}

export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

/** 損益金額：正值帶 + 號（漲跌不單靠顏色辨識） */
export function fmtSignedMoney(
  value: number | null | undefined,
  currency: Currency,
  decimals?: number,
): string {
  const base = fmtMoney(value, currency, decimals)
  if (base === '—') return base
  return value! > 0 ? `+${base}` : base
}

/** 報酬率：正值帶 + 號 */
export function fmtSignedPercent(value: number | null | undefined): string {
  const base = fmtPercent(value)
  if (base === '—') return base
  return value! > 0 ? `+${base}` : base
}

export function fmtQty(value: number): string {
  return withThousands(value, 0)
}

/**
 * 損益顏色 class：紅漲綠跌（台灣看盤習慣）。
 * 對應 index.css 的 .pnl-up / .pnl-down / .pnl-flat。
 */
export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return 'pnl-flat'
  return value > 0 ? 'pnl-up' : 'pnl-down'
}
