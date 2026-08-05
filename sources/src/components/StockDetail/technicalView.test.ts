import { describe, it, expect } from 'vitest'
import { buildTechnicalView, pickLabelIndices } from './technicalView'
import type { DailyRow } from '../../services/dailyProxy'

/** Create n increasing daily lines, closing = 100 + i, so that the expected value can be calculated by hand*/
function makeRows(n: number): DailyRow[] {
  const rows: DailyRow[] = []
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    const close = 100 + i
    rows.push([day, close - 1, close + 1, close - 2, close, 1000 + i])
  }
  return rows
}

describe('buildTechnicalView', () => {
  it('指標以完整序列計算後才裁切 —— 切到近 3 月時 MA60 仍必須有值', () => {
    // This is the most common mistake in writing the entire technical aspect: if you crop first and then calculate the indicators,
    // When 60 lines are displayed, MA60 will only have a value in the last line, and the first 59 lines will be null, and the entire line will disappear.
    const view = buildTechnicalView(makeRows(200), '3m')!
    expect(view.candles).toHaveLength(60)
    expect(view.ma60).toHaveLength(60)
    expect(view.ma60.every((v) => v !== null)).toBe(true)
    expect(view.ma20.every((v) => v !== null)).toBe(true)

    // The closing price is 100+i, a total of 200 bars → the last bar close = 299,
    // MA60 = average of the first 60 roots (240..299) = 269.5
    expect(view.ma60[59]).toBeCloseTo(269.5, 6)
  })

  it('資料本身不足 60 根時 MA60 才會是 null', () => {
    const view = buildTechnicalView(makeRows(30), '1y')!
    expect(view.candles).toHaveLength(30)
    expect(view.ma60.every((v) => v === null)).toBe(true)
    expect(view.ma20[29]).not.toBeNull()
  })

  it('區間短於資料時只裁切顯示範圍，摘要仍取最新一根', () => {
    const rows = makeRows(200)
    const short = buildTechnicalView(rows, '3m')!
    const full = buildTechnicalView(rows, '1y')!
    expect(short.candles).toHaveLength(60)
    expect(full.candles).toHaveLength(200)
    // The summary has nothing to do with the display interval, they must be completely consistent
    expect(short.latest).toEqual(full.latest)
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
