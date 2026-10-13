/**
 * Pure display helpers for the 成分股 tab (Task 200). Formatting only: every figure is the issuer's.
 */
import type { EtfHoldingsStock } from '../../services/etfHoldingsProxy'

/** Rows shown before 「顯示全部」. */
export const HOLDINGS_TOP_N = 10

const nf = (digits: number) =>
  new Intl.NumberFormat('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** NT$ amount in 億元, two decimals: 2,553,551,300,844 → '25,535.51 億'. Zero stays '0'. */
export function formatYi(twd: number): string {
  if (twd === 0) return '0'
  return `${nf(2).format(twd / 1e8)} 億`
}

/** The full figure, for the hover title next to an 億 amount. */
export function formatTwdFull(twd: number): string {
  return `NT$ ${nf(0).format(twd)}`
}

/** Units outstanding in 億 units, two decimals: 22,307,000,000 → '223.07 億'. */
export function formatUnitsYi(units: number): string {
  return `${nf(2).format(units / 1e8)} 億`
}

export const formatInt = (n: number): string => nf(0).format(n)

/** Weight percent as published: 56.39 → '56.39%'. */
export const formatWeight = (w: number): string => `${nf(2).format(w)}%`

/** '202610' → '2026/10'; anything else as given. */
export function formatContractMonth(ym: string): string {
  return /^\d{6}$/.test(ym) ? `${ym.slice(0, 4)}/${ym.slice(4)}` : ym
}

/** '2026-10-12' → '2026/10/12'. */
export const formatTradeDate = (d: string): string => d.replace(/-/g, '/')

/** The issuer's stamp without seconds: '2026-10-12 16:06:52' → '10/12 16:06'. */
export function formatPublishedAt(stamp: string | null): string | null {
  const m = stamp?.match(/^\d{4}-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/)
  return m ? `${m[1]}/${m[2]} ${m[3]}:${m[4]}` : null
}

/** Stocks in the issuer's order (largest weight first), cut to the top N unless expanded. */
export function visibleStocks(stocks: EtfHoldingsStock[], expanded: boolean, n = HOLDINGS_TOP_N): EtfHoldingsStock[] {
  return expanded ? stocks : stocks.slice(0, n)
}
