import { describe, it, expect } from 'vitest'
import {
  TREND_LABELS,
  TREND_RANGES,
  dailyKeyOf,
  epochOfTradingDate,
  isIntradayRange,
  seriesFromDailyRows,
} from './trendRange'
import type { DailyRow } from '../../services/dailyProxy'

/** n 根日線，收盤價 100 + i，日期自 startUtc 起逐日遞增 */
function makeRows(n: number, startUtc = Date.UTC(2026, 0, 1)): DailyRow[] {
  const rows: DailyRow[] = []
  for (let i = 0; i < n; i++) {
    const day = new Date(startUtc + i * 86400000).toISOString().slice(0, 10)
    const close = 100 + i
    rows.push([day, close - 1, close + 1, close - 2, close, 1000 + i])
  }
  return rows
}

describe('TREND_RANGES', () => {
  it('八個區間，順序由短到長', () => {
    expect(TREND_RANGES).toEqual(['1d', '5d', '1m', '6m', 'ytd', '1y', '5y', 'all'])
  })

  it('每個區間都有標籤', () => {
    expect(TREND_RANGES.map((r) => TREND_LABELS[r])).toEqual([
      '一日',
      '五日',
      '近 1 月',
      '近 6 月',
      '本年迄今',
      '近 1 年',
      '近 5 年',
      '全部',
    ])
  })
})

describe('isIntradayRange', () => {
  it('只有 1d 與 5d 是盤中區間', () => {
    expect(isIntradayRange('1d')).toBe(true)
    expect(isIntradayRange('5d')).toBe(true)
    for (const r of ['1m', '6m', 'ytd', '1y', '5y', 'all'] as const) {
      expect(isIntradayRange(r)).toBe(false)
    }
  })
})

describe('dailyKeyOf', () => {
  it('盤中區間沒有對應的日線區間', () => {
    expect(dailyKeyOf('1d')).toBeNull()
    expect(dailyKeyOf('5d')).toBeNull()
  })

  it('其餘六個直接對應 technicalView 的 RangeKey', () => {
    expect(dailyKeyOf('1m')).toBe('1m')
    expect(dailyKeyOf('6m')).toBe('6m')
    expect(dailyKeyOf('ytd')).toBe('ytd')
    expect(dailyKeyOf('1y')).toBe('1y')
    expect(dailyKeyOf('5y')).toBe('5y')
    expect(dailyKeyOf('all')).toBe('all')
  })
})

describe('epochOfTradingDate', () => {
  it('用 UTC 換算，來回不位移一天', () => {
    const t = epochOfTradingDate('2026-09-10')
    expect(new Date(t * 1000).toISOString().slice(0, 10)).toBe('2026-09-10')
  })

  it('跨年首日也不位移', () => {
    const t = epochOfTradingDate('2026-01-01')
    expect(new Date(t * 1000).toISOString().slice(0, 10)).toBe('2026-01-01')
  })
})

describe('seriesFromDailyRows', () => {
  it('盤中區間不由日線組合', () => {
    expect(seriesFromDailyRows('2330', makeRows(100), '1d')).toBeNull()
    expect(seriesFromDailyRows('2330', makeRows(100), '5d')).toBeNull()
  })

  it('沒有列時回 null', () => {
    expect(seriesFromDailyRows('2330', [], '1y')).toBeNull()
  })

  it('近 1 月取最後 20 根', () => {
    const s = seriesFromDailyRows('2330', makeRows(100), '1m')!
    expect(s.points).toHaveLength(20)
    expect(s.symbol).toBe('2330')
  })

  it('近 6 月取最後 120 根，資料不足時取全部', () => {
    expect(seriesFromDailyRows('2330', makeRows(300), '6m')!.points).toHaveLength(120)
    expect(seriesFromDailyRows('2330', makeRows(50), '6m')!.points).toHaveLength(50)
  })

  it('本年迄今只取當年度的列', () => {
    const rows = makeRows(100, Date.UTC(2025, 10, 2))
    const expected = rows.filter((r) => r[0] >= '2026-01-01').length
    expect(seriesFromDailyRows('2330', rows, 'ytd')!.points).toHaveLength(expected)
  })

  it('prevClose 取裁切點前一根，否則第一根的漲跌與顏色會算錯', () => {
    const rows = makeRows(100)
    const s = seriesFromDailyRows('2330', rows, '1m')!
    // 取最後 20 根 → 起點 index 80，前一根 index 79 的收盤價是 179
    expect(s.prevClose).toBe(rows[79][4])
    expect(s.prevClose).toBe(179)
  })

  it('整段資料都被取用時 prevClose 是 null', () => {
    const s = seriesFromDailyRows('2330', makeRows(10), '1y')!
    expect(s.points).toHaveLength(10)
    expect(s.prevClose).toBeNull()
  })

  it('點位形狀是 { t, c, v }，取收盤價與成交量', () => {
    const rows: DailyRow[] = [['2026-09-09', 1, 4, 0.5, 3, 777]]
    const s = seriesFromDailyRows('2330', rows, '1y')!
    expect(s.points[0]).toEqual({ t: epochOfTradingDate('2026-09-09'), c: 3, v: 777 })
  })

  it('點位由舊到新，與日線同序', () => {
    const s = seriesFromDailyRows('2330', makeRows(30), '1y')!
    const ts = s.points.map((p) => p.t)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
  })
})
