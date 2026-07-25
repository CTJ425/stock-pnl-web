/**
 * 籌碼數字格式化。單位陷阱：三大法人是「股」、融資融券是「張（交易單位）」，
 * 兩者不可互換，故分成 fmtShares / fmtLots 兩組函式，呼叫端不需再自己換算。
 */

/** 千分位整數；無資料回「—」 */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** 帶正負號的整數（買賣超、增減） */
export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const base = Math.round(n).toLocaleString('en-US')
  return n > 0 ? `+${base}` : base
}

/** 股數 → 約當張數（1 張 = 1000 股），帶正負號 */
export function fmtLotsFromShares(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const lots = Math.round(n / 1000)
  return `${lots > 0 ? '+' : ''}${lots.toLocaleString('en-US')}`
}

/** 連買連賣（法人）：+3 → 連 3 買 */
export function fmtTradeStreak(n: number): string {
  if (!n) return '—'
  return n > 0 ? `連 ${n} 買` : `連 ${-n} 賣`
}

/** 連增連減（融資融券餘額）：-2 → 連 2 減 */
export function fmtBalanceStreak(n: number): string {
  if (!n) return '—'
  return n > 0 ? `連 ${n} 增` : `連 ${-n} 減`
}

/** 紅正綠負的 class（對應 index.css 的 .pnl-up / .pnl-down / .pnl-flat） */
export function chipClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return 'pnl-flat'
  return n > 0 ? 'pnl-up' : 'pnl-down'
}

/** YYYY-MM-DD → MM/DD（X 軸標籤用） */
export function shortDate(date: string): string {
  return date.length >= 10 ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : date
}

/**
 * 報告產生時間（ISO UTC）→ 觀看者所在時區的 `YYYY-MM-DD HH:mm`。
 * 不用 toLocaleString 是為了格式固定，避免不同 locale 輸出不同樣子（PDF 也要看）。
 */
export function fmtUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
