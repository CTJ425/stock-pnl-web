/**
 * Chip number formatting. Unit trap: The three major legal persons are "shares", and margin trading and securities lending are "pieces (trading units)".
 * The two are not interchangeable, so they are divided into two sets of functions: fmtShares / fmtLots. The caller does not need to convert by itself.
 */

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
