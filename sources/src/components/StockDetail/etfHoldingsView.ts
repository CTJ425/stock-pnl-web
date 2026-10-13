/**
 * Pure display helpers for the 成分股 tab (Task 200). Formatting only: every figure is the issuer's.
 */
import type { EtfHoldingsStock } from '../../services/etfHoldingsProxy'

/** Holdings drawn as bars; the rest are in the table under 「看全部明細」. */
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


/** Sum of published weights, rounded to the 2 decimals they are published with (no float noise). */
const sumWeights = (stocks: EtfHoldingsStock[]): number =>
  Math.round(stocks.reduce((s, x) => s + x.weight, 0) * 100) / 100

export interface ConcentrationSegment {
  key: 'top1' | 'next' | 'rest' | 'other'
  label: string
  /** Percent of fund size: a sum of published weights, or for `other` what they leave of 100. */
  weight: number
}

/**
 * The concentration bar: the largest holding, the next nine, the rest, and what the stock weights
 * leave of 100 % (cash, futures margin — the issuer's weights are over fund size, so stocks sum to
 * about 99.7 %). Every stock figure is a sum of published weights; nothing is recomputed.
 */
export function concentrationSegments(stocks: EtfHoldingsStock[]): ConcentrationSegment[] {
  if (stocks.length === 0) return []
  const [first, ...others] = stocks
  const next = others.slice(0, HOLDINGS_TOP_N - 1)
  const rest = others.slice(HOLDINGS_TOP_N - 1)
  const segs: ConcentrationSegment[] = [{ key: 'top1', label: first.name, weight: first.weight }]
  if (next.length > 0) {
    segs.push({ key: 'next', label: `第 2–${next.length + 1} 名`, weight: sumWeights(next) })
  }
  if (rest.length > 0) segs.push({ key: 'rest', label: `其餘 ${rest.length} 檔`, weight: sumWeights(rest) })
  const other = Math.round((100 - sumWeights(stocks)) * 100) / 100
  if (other > 0) segs.push({ key: 'other', label: '股票以外', weight: other })
  return segs
}

export interface AssetSegment {
  key: 'stock' | 'etf' | 'bond' | 'futures'
  label: string
  amount: number
  /** Bar width only: this amount over the four amounts together. Never printed as a percent. */
  widthPct: number
}

const ASSET_LABELS = [
  ['stock', '股票'],
  ['etf', 'ETF'],
  ['bond', '債券'],
  ['futures', '期貨'],
] as const

/**
 * Asset bar segments. Widths are each amount's share of the four amounts together — not a share of
 * the fund: the futures amount may be notional exposure, so a fund-size denominator could top 100 %.
 */
export function assetSegments(assets: Record<AssetSegment['key'], number>): AssetSegment[] {
  const total = ASSET_LABELS.reduce((s, [k]) => s + Math.max(0, assets[k]), 0)
  return ASSET_LABELS.map(([key, label]) => ({
    key,
    label,
    amount: assets[key],
    widthPct: total > 0 ? (Math.max(0, assets[key]) / total) * 100 : 0,
  }))
}
