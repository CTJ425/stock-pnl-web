import { describe, it, expect } from 'vitest'
import { judgePeriod, latestPeriod, periodsBehind } from './macroPeriod'

describe('judgePeriod / latestPeriod', () => {
  it('與同組最新期別相同 → 最新', () => {
    expect(judgePeriod('2026-06', '2026-06')).toBe('ok')
  })

  it('落後同組其他來源 → warn（消費者信心停在 2026-05 的情形）', () => {
    expect(judgePeriod('2026-05', '2026-06')).toBe('warn')
  })

  it('沒有期別 → idle，不是錯誤', () => {
    expect(judgePeriod(null, '2026-06')).toBe('idle')
  })

  it('同組全都沒有資料時不判為落後', () => {
    expect(judgePeriod('2026-05', null)).toBe('ok')
  })

  it('latestPeriod 忽略 null 與空字串', () => {
    expect(latestPeriod(['2026-05', null, '2026-06', undefined, ''])).toBe('2026-06')
    expect(latestPeriod([null, undefined])).toBeNull()
  })
})

describe('periodsBehind', () => {
  it('落後幾期算得出來——「落後一期」與「落後三期」意思完全不同', () => {
    expect(periodsBehind('2026-06', '2026-06')).toBe(0)
    expect(periodsBehind('2026-05', '2026-06')).toBe(1)
    expect(periodsBehind('2026-03', '2026-06')).toBe(3)
  })

  it('跨年相減正確', () => {
    expect(periodsBehind('2025-11', '2026-02')).toBe(3)
  })

  it('領先或缺值不得回負數', () => {
    expect(periodsBehind('2026-07', '2026-06')).toBe(0)
    expect(periodsBehind(null, '2026-06')).toBe(0)
    expect(periodsBehind('2026-06', null)).toBe(0)
  })
})
