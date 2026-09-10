import { describe, it, expect } from 'vitest'
import {
  buildTechnicalView,
  isRemoteRange,
  pickLabelIndices,
  rangeBars,
  remoteRangeOf,
} from './technicalView'
import type { DailyRow } from '../../services/dailyProxy'

/** Create n increasing daily lines, closing = 100 + i, so that the expected value can be calculated by hand*/
function makeRows(n: number, startUtc = Date.UTC(2026, 0, 1)): DailyRow[] {
  const rows: DailyRow[] = []
  for (let i = 0; i < n; i++) {
    const day = new Date(startUtc + i * 86400000).toISOString().slice(0, 10)
    const close = 100 + i
    rows.push([day, close - 1, close + 1, close - 2, close, 1000 + i])
  }
  return rows
}

describe('buildTechnicalView', () => {
  it('指標以完整序列計算後才裁切 —— 切到近 1 月時 MA60 仍必須有值', () => {
    // This is the most common mistake in writing the entire technical aspect: if you crop first and then calculate the indicators,
    // When 20 lines are displayed, MA60 will have no value at all, and the entire line will disappear.
    const view = buildTechnicalView(makeRows(200), '1m')!
    expect(view.candles).toHaveLength(20)
    expect(view.ma60).toHaveLength(20)
    expect(view.ma60.every((v) => v !== null)).toBe(true)
    expect(view.ma20.every((v) => v !== null)).toBe(true)

    // The closing price is 100+i, a total of 200 bars → the last bar close = 299,
    // MA60 = average of the last 60 roots (240..299) = 269.5
    expect(view.ma60[19]).toBeCloseTo(269.5, 6)
  })

  it('資料本身不足 60 根時 MA60 才會是 null', () => {
    const view = buildTechnicalView(makeRows(30), '1y')!
    expect(view.candles).toHaveLength(30)
    expect(view.ma60.every((v) => v === null)).toBe(true)
    expect(view.ma20[29]).not.toBeNull()
  })

  it('區間短於資料時只裁切顯示範圍，摘要仍取最新一根', () => {
    const rows = makeRows(200)
    const short = buildTechnicalView(rows, '1m')!
    const full = buildTechnicalView(rows, '1y')!
    expect(short.candles).toHaveLength(20)
    expect(full.candles).toHaveLength(200)
    // The summary has nothing to do with the display interval, they must be completely consistent
    expect(short.latest).toEqual(full.latest)
  })

  it('5y 與 all 不裁切 —— 列數由 Edge Function 決定', () => {
    const rows = makeRows(500)
    expect(buildTechnicalView(rows, '5y')!.candles).toHaveLength(500)
    expect(buildTechnicalView(rows, 'all')!.candles).toHaveLength(500)
  })

  it('本年迄今只取當年度的列', () => {
    // 2025-11-02 起算 100 天 → 跨過年，2026-01-01 之後共 40 根
    const rows = makeRows(100, Date.UTC(2025, 10, 2))
    const view = buildTechnicalView(rows, 'ytd')!
    expect(view.candles.every((c) => !c.label.startsWith('12/'))).toBe(true)
    expect(view.candles).toHaveLength(rows.filter((r) => r[0] >= '2026-01-01').length)
  })

  it('摘要含漲跌與量能比', () => {
    const view = buildTechnicalView(makeRows(100), '1y')!
    expect(view.latest.close).toBe(199)
    expect(view.latest.change).toBe(1)
    expect(view.latest.changePct).toBeCloseTo(1 / 198, 8)
    expect(view.latest.alignment).toBe('多頭排列') // 一路上漲 → MA5 > MA20 > MA60
    expect(view.latest.volRatio).not.toBeNull()
  })

  it('空序列回 null', () => {
    expect(buildTechnicalView([], '1y')).toBeNull()
  })
})

describe('rangeBars', () => {
  const rows = makeRows(300)

  it('固定根數的區間', () => {
    expect(rangeBars(rows, '1m')).toBe(20)
    expect(rangeBars(rows, '6m')).toBe(120)
  })

  it('1y / 5y / all 取全部列', () => {
    expect(rangeBars(rows, '1y')).toBe(300)
    expect(rangeBars(rows, '5y')).toBe(300)
    expect(rangeBars(rows, 'all')).toBe(300)
  })

  it('ytd 的年份取自最後一列，不看系統時鐘', () => {
    // 這樣這個函式才是純函式，也不必處理時區。
    const crossYear = makeRows(100, Date.UTC(2025, 10, 2))
    const expected = crossYear.filter((r) => r[0] >= '2026-01-01').length
    expect(rangeBars(crossYear, 'ytd')).toBe(expected)
  })

  it('整批同一年時 ytd 取全部 —— 年份來自最後一列', () => {
    const oneYearOnly = makeRows(10, Date.UTC(2025, 10, 2))
    expect(rangeBars(oneYearOnly, 'ytd')).toBe(10)
  })

  it('空列不會回負數', () => {
    expect(rangeBars([], 'ytd')).toBeGreaterThanOrEqual(0)
  })
})

describe('remoteRangeOf', () => {
  it('只有 5y 與 all 走 Edge Function', () => {
    expect(remoteRangeOf('5y')).toBe('5y')
    expect(remoteRangeOf('all')).toBe('max')
    expect(remoteRangeOf('1m')).toBeNull()
    expect(remoteRangeOf('6m')).toBeNull()
    expect(remoteRangeOf('ytd')).toBeNull()
    expect(remoteRangeOf('1y')).toBeNull()
  })

  it('isRemoteRange 與 remoteRangeOf 一致', () => {
    expect(isRemoteRange('5y')).toBe(true)
    expect(isRemoteRange('all')).toBe(true)
    expect(isRemoteRange('1y')).toBe(false)
    expect(isRemoteRange('ytd')).toBe(false)
  })
})

describe('pickLabelIndices', () => {
  it('點數少於上限時全標', () => {
    expect(pickLabelIndices(4, 6)).toEqual([0, 1, 2, 3])
  })

  it('等距挑選且含頭尾', () => {
    const out = pickLabelIndices(244, 6)
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(243)
    expect(out).toHaveLength(6)
    // Strictly incremental, no duplication
    expect([...new Set(out)]).toEqual(out)
    expect([...out].sort((a, b) => a - b)).toEqual(out)
  })
})
