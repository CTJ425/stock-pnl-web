/**
 * Chip number formatting. Unit trap: The three major legal persons are "shares", and margin trading and securities lending are "pieces (trading units)".
 * The two are not interchangeable, so they are divided into two sets of functions: fmtShares / fmtLots. The caller does not need to convert by itself.
 */
import type { CSSProperties } from 'react'
import { CHART_COLORS } from '../Charts/chartColors'

/** Thousandth place integer; no data returns "-"*/
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** Integer with plus or minus sign (buy and sell over, increase or decrease)*/
export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const base = Math.round(n).toLocaleString('en-US')
  return n > 0 ? `+${base}` : base
}

/** Number of shares → Approximate number of shares (1 share = 1000 shares), with plus or minus sign*/
export function fmtLotsFromShares(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const lots = Math.round(n / 1000)
  return `${lots > 0 ? '+' : ''}${lots.toLocaleString('en-US')}`
}

/**
 * Shares → lots **without a sign**, for 買進／賣出.
 *
 * Those are gross amounts and can never be negative, so the `+` that `fmtLotsFromShares` adds would be
 * noise on every single one of them —— a sign that always says the same thing says nothing.
 */
export function fmtLotsPlain(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n / 1000).toLocaleString('en-US')
}

/** Continuous buying and selling (legal person): +3 → 3 consecutive buys*/
export function fmtTradeStreak(n: number): string {
  if (!n) return '—'
  return n > 0 ? `連 ${n} 買` : `連 ${-n} 賣`
}

/** Consecutive increases and consecutive decreases (margin margin trading balance): -2 → 2 consecutive decreases*/
export function fmtBalanceStreak(n: number): string {
  if (!n) return '—'
  return n > 0 ? `連 ${n} 增` : `連 ${-n} 減`
}

/** Positive red, green and negative classes (corresponding to .pnl-up / .pnl-down / .pnl-flat of index.css)*/
export function chipClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return 'pnl-flat'
  return n > 0 ? 'pnl-up' : 'pnl-down'
}

/**
 * Cell tint by magnitude for the 單位 × 日期 matrices (0.7.6), **relative to the largest number in that row**.
 *
 * Row-relative on purpose: on the macro table 外資 moves in hundreds of 億 while 外資自營商 moves in single
 * digits, and on a single stock 外資 routinely dwarfs 投信. One table-wide scale would leave every row but the
 * biggest flat, which says nothing about that unit's own big days —— and "which day was big for this unit" is
 * exactly what a row is for.
 *
 * Shared by the two matrices so the two tables cannot drift into different tint scales; it is the same encoding
 * answering the same question, once for the market and once for one stock.
 */
export function heatStyle(v: number | null, rowMax: number): CSSProperties | undefined {
  if (v === null || v === 0 || rowMax === 0) return undefined
  const pct = (6 + Math.min(1, Math.abs(v) / rowMax) * 30).toFixed(1)
  const color = v > 0 ? CHART_COLORS.up : CHART_COLORS.down
  return { background: `color-mix(in srgb, ${color} ${pct}%, transparent)` }
}

/** YYYY-MM-DD → MM/DD (for X-axis label)*/
export function shortDate(date: string): string {
  return date.length >= 10 ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : date
}

/**
 * Report generation time (ISO UTC) → `YYYY-MM-DD HH:mm` in the viewer's time zone.
 * The reason for not using toLocaleString is to fix the format and avoid different output looks in different locales (PDF should also be viewed).
 */
export function fmtUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
