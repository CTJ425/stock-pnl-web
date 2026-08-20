import { describe, it, expect } from 'vitest'
import { roundPrice } from './formatters'

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
