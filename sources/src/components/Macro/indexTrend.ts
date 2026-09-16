/**
 * Trend range vocabulary and upstream mapping for index views (task 164).
 *
 * Index detail views offer seven of the eight stock ranges: 近 1 月 is deliberately
 * absent (user decision 2026-09-15).
 */
import type { TrendRange } from '../StockDetail/trendRange'

/** The 7 ranges an index offers. '1m' (近 1 月) is deliberately absent — user decision 2026-09-15. */
export const INDEX_TREND_RANGES: readonly TrendRange[] = [
  '1d',
  '5d',
  '6m',
  'ytd',
  '1y',
  '5y',
  'all',
]

export type IndexTrendSource =
  | { kind: 'intraday'; range: '1d' | '5d' }
  | { kind: 'daily'; remoteRange: '5y' | 'max' }

/** Which upstream call a range needs. Throws for a range not in INDEX_TREND_RANGES. */
export function indexTrendSource(range: TrendRange): IndexTrendSource {
  switch (range) {
    case '1d':
    case '5d':
      return { kind: 'intraday', range }
    case '6m':
    case 'ytd':
    case '1y':
    case '5y':
      return { kind: 'daily', remoteRange: '5y' }
    case 'all':
      return { kind: 'daily', remoteRange: 'max' }
    default:
      throw new Error(`Unsupported index trend range: ${range}`)
  }
}
