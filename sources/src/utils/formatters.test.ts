import { describe, it, expect } from 'vitest'
import { fmtPercent, roundPrice } from './formatters'

describe('roundPrice', () => {
  it('以十進位四捨五入到分，不受二進位表示影響', () => {
    // 416900 / 4000 = 104.225，二進位實際是 104.224999999999994，toFixed(2) 會給 104.22
    expect(roundPrice(416900 / 4000)).toBe(104.23)
    expect(roundPrice(104.225)).toBe(104.23)
    expect(roundPrice(0.145)).toBe(0.15)
    expect(roundPrice(1.005)).toBe(1.01)
  })

  it('已經是兩位小數或整數時原樣返回', () => {
    expect(roundPrice(103.8)).toBe(103.8)
    expect(roundPrice(100)).toBe(100)
    expect(roundPrice(104.22)).toBe(104.22)
  })
})

describe('fmtPercent', () => {
  it('BUG-034: .005 邊界以十進位四捨五入，不被二進位表示壓下去', () => {
    // 0.01005 * 100 的二進位實際是 1.0049999999999999，toFixed(2) 會給 1.00%
    expect(fmtPercent(0.01005)).toBe('1.01%')
    expect(fmtPercent(0.07005)).toBe('7.01%')
  })

  it('一般值與既有輸出相同', () => {
    expect(fmtPercent(0.0163)).toBe('1.63%')
    expect(fmtPercent(-0.0523)).toBe('-5.23%')
    expect(fmtPercent(0)).toBe('0.00%')
  })

  it('負值在 .005 邊界同樣進位，方向與正值對稱', () => {
    // Math.round 的中間值是往 +Infinity 進，直接加 EPSILON 會讓負值少進一位
    expect(fmtPercent(-0.01005)).toBe('-1.01%')
    expect(fmtPercent(-0.07005)).toBe('-7.01%')
    // 負零不得印成 -0.00%
    expect(fmtPercent(-0)).toBe('0.00%')
  })

  it('無值或非有限值顯示破折號，不印出 Infinity%', () => {
    expect(fmtPercent(null)).toBe('—')
    expect(fmtPercent(undefined)).toBe('—')
    expect(fmtPercent(NaN)).toBe('—')
    expect(fmtPercent(Infinity)).toBe('—')
    expect(fmtPercent(-Infinity)).toBe('—')
  })
})
