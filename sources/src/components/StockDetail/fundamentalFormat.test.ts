import { describe, it, expect } from 'vitest'
import {
  fmtMultiple,
  fmtPerShare,
  fmtPercentValue,
  fmtQuarterLabel,
  fmtQuarterShort,
  fmtThousandsAsBillions,
} from './fundamentalFormat'

describe('fmtPerShare', () => {
  it('元 / 股，2 位小數，不加 NT$ 前綴（EPS 不是總額）', () => {
    expect(fmtPerShare(22.08)).toBe('22.08 元')
    expect(fmtPerShare(0)).toBe('0.00 元')
  })

  it('虧損保留負號', () => {
    expect(fmtPerShare(-1.5)).toBe('-1.50 元')
  })

  it('無資料回 —', () => {
    expect(fmtPerShare(null)).toBe('—')
    expect(fmtPerShare(undefined)).toBe('—')
    expect(fmtPerShare(NaN)).toBe('—')
  })
})

describe('fmtMultiple', () => {
  it('倍數 2 位小數', () => {
    expect(fmtMultiple(31.59)).toBe('31.59 倍')
    expect(fmtMultiple(null)).toBe('—')
  })
})

describe('fmtPercentValue', () => {
  it('來源已是百分比數值，原樣加 % 不再乘 100', () => {
    expect(fmtPercentValue(0.94)).toBe('0.94%')
    expect(fmtPercentValue(5)).toBe('5.00%')
    expect(fmtPercentValue(null)).toBe('—')
  })
})

describe('fmtThousandsAsBillions', () => {
  it('千元 → 億元（1 億元 = 100,000 千元）', () => {
    // 2330 實測 Q1 營收 1,134,103,440 千元 = 11,341.0 億元
    expect(fmtThousandsAsBillions(1_134_103_440)).toBe('11,341.0 億元')
    // 淨利 572,479,752 千元 = 5,724.8 億元
    expect(fmtThousandsAsBillions(572_479_752)).toBe('5,724.8 億元')
  })

  it('虧損保留負號', () => {
    expect(fmtThousandsAsBillions(-1_500_000)).toBe('-15.0 億元')
  })

  it('無資料回 —', () => {
    expect(fmtThousandsAsBillions(null)).toBe('—')
  })
})

describe('季別標籤', () => {
  it('完整與縮寫兩種格式', () => {
    expect(fmtQuarterLabel(2026, 1)).toBe('2026 Q1')
    expect(fmtQuarterShort(2026, 1)).toBe('26Q1')
    expect(fmtQuarterShort(2025, 4)).toBe('25Q4')
  })
})
