/**
 * Shared range vocabulary for the 行情 tab's 走勢圖 (0.9.42): the same eight ranges the
 * 技術面 tab already offers. `IntradayChart` stays a two-range component underneath —
 * this module is what teaches it about the other six without it ever reading a `DailyRow`
 * itself. See docs/agent/specs/quote-tab-trend-ranges.md.
 */
import type { DailyRow } from '../../services/dailyProxy'
import { rangeBars, type RangeKey } from './technicalView'
import type { IntradayRange } from '../../../supabase/functions/stock-price/intradayParse'
import type { TrendSeries } from './IntradayChart'

export type TrendRange = '1d' | '5d' | '1m' | '6m' | 'ytd' | '1y' | '5y' | 'all'

export const TREND_RANGES: readonly TrendRange[] = [
  '1d',
  '5d',
  '1m',
  '6m',
  'ytd',
  '1y',
  '5y',
  'all',
]

export const TREND_LABELS: Record<TrendRange, string> = {
  '1d': '一日',
  '5d': '五日',
  '1m': '近 1 月',
  '6m': '近 6 月',
  ytd: '本年迄今',
  '1y': '近 1 年',
  '5y': '近 5 年',
  all: '全部',
}

export function isIntradayRange(range: TrendRange): range is IntradayRange {
  return range === '1d' || range === '5d'
}

/** `null` for the two intraday ranges; otherwise the same string, already a valid `RangeKey`. */
export function dailyKeyOf(range: TrendRange): RangeKey | null {
  if (isIntradayRange(range)) return null
  return range
}

/**
 * `date` is `YYYY-MM-DD`. The chart formats the label back with **UTC** getters, so this
 * round trip is exact and no time zone can shift a bar by one day.
 */
export function epochOfTradingDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000
}

export function seriesFromDailyRows(
  symbol: string,
  rows: DailyRow[],
  range: TrendRange,
): TrendSeries | null {
  const key = dailyKeyOf(range)
  if (key === null || rows.length === 0) return null

  const take = Math.min(rangeBars(rows, key), rows.length)
  const from = rows.length - take
  // The row before the slice, not the first visible row — that is what makes the first
  // visible bar's colour and change figure correct.
  const prevClose = from > 0 ? rows[from - 1][4] : null
  const points = rows.slice(from).map((r) => ({ t: epochOfTradingDate(r[0]), c: r[4], v: r[5] }))

  return { symbol, prevClose, points }
}
