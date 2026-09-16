import { describe, it, expect } from 'vitest'
import { INDEX_TREND_RANGES, indexTrendSource } from './indexTrend'
import { TREND_LABELS, type TrendRange } from '../StockDetail/trendRange'

/**
 * Task 164 §4.2. The index views offer seven of the eight stock ranges: 近 1 月 is
 * deliberately absent (user decision 2026-09-15). The stock pages keep all eight.
 */
describe('INDEX_TREND_RANGES', () => {
  it('是使用者指定的七個區間，順序固定', () => {
    expect([...INDEX_TREND_RANGES]).toEqual(['1d', '5d', '6m', 'ytd', '1y', '5y', 'all'])
  })

  it('不含近 1 月', () => {
    expect(INDEX_TREND_RANGES).not.toContain('1m')
  })

  it('每個區間都有既有的中文標籤，不另造詞彙', () => {
    for (const range of INDEX_TREND_RANGES) {
      expect(TREND_LABELS[range]).toBeTruthy()
    }
  })
})

describe('indexTrendSource', () => {
  it('一日與五日走 intraday', () => {
    expect(indexTrendSource('1d')).toEqual({ kind: 'intraday', range: '1d' })
    expect(indexTrendSource('5d')).toEqual({ kind: 'intraday', range: '5d' })
  })

  it('近 6 月 / 本年迄今 / 近 1 年 / 近 5 年 共用同一次 5y 日線抓取', () => {
    for (const range of ['6m', 'ytd', '1y', '5y'] as TrendRange[]) {
      expect(indexTrendSource(range)).toEqual({ kind: 'daily', remoteRange: '5y' })
    }
  })

  it('全部走 max', () => {
    expect(indexTrendSource('all')).toEqual({ kind: 'daily', remoteRange: 'max' })
  })
})
