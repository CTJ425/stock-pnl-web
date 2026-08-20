/**
 * Amount and number formatting (same as the partition format of the GAS version of Dashboard):
 * - Taiwan Stocks (TWD): Profit/loss/market capitalization is rounded to an integer; current price/average price is rounded to two decimal places.
 * - US stocks (USD): rounded to two decimal places
 */
import type { Currency } from '../types/models'

const CURRENCY_PREFIX: Record<Currency, string> = { TWD: 'NT$', USD: 'US$' }

function withThousands(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Amount (TWD defaults to an integer, USD defaults to two decimal places), negative values ​​are displayed as -NT$1,234*/
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

/** Current price / average cost: rounded to two decimal places in both currencies*/
export function fmtPrice(value: number | null | undefined, currency: Currency): string {
  return fmtMoney(value, currency, 2)
}

/**
 * Decimal half-up rounding to 2 decimals, immune to the binary-representation trap:
 * 416900 / 4000 === 104.224999999999994 in IEEE-754, so a naive `.toFixed(2)` rounds
 * down to 104.22 instead of the 104.23 a decimal calculator (and 庫存總覽's `fmtPrice`) gives.
 */
export function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

/** Profit and loss amount: Positive values ​​are marked with a + sign (increases and decreases are not identified solely by color)*/
export function fmtSignedMoney(
  value: number | null | undefined,
  currency: Currency,
  decimals?: number,
): string {
  const base = fmtMoney(value, currency, decimals)
  if (base === '—') return base
  return value! > 0 ? `+${base}` : base
}

/** Rate of return: positive value with + sign*/
export function fmtSignedPercent(value: number | null | undefined): string {
  const base = fmtPercent(value)
  if (base === '—') return base
  return value! > 0 ? `+${base}` : base
}

export function fmtQty(value: number): string {
  return withThousands(value, 0)
}

/**
 * Profit and loss color class: red up, green down (Taiwanese market reading habit).
 * Corresponding to .pnl-up / .pnl-down / .pnl-flat of index.css.
 */
export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return 'pnl-flat'
  return value > 0 ? 'pnl-up' : 'pnl-down'
}
