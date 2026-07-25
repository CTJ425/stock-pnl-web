import { describe, it, expect } from 'vitest'
import { niceDomain, domainTicks, scaleY, fmtAxisNumber } from './chartScale'

describe('niceDomain', () => {
  it('跨零資料含正負兩側，且級距對齊好看的數字', () => {
    const d = niceDomain([-1200, 3400, 800], { includeZero: true })
    expect(d.min).toBeLessThanOrEqual(-1200)
    expect(d.max).toBeGreaterThanOrEqual(3400)
    expect(d.min).toBeLessThan(0)
    expect(d.max).toBeGreaterThan(0)
  })

  it('全為正值時 includeZero 會把下界拉到 0', () => {
    expect(niceDomain([100, 200, 300], { includeZero: true }).min).toBe(0)
  })

  it('餘額走勢（不含零）不把下界拉到 0，避免變化被壓平', () => {
    const d = niceDomain([31823, 31928, 31900])
    expect(d.min).toBeGreaterThan(30000)
    expect(d.max).toBeGreaterThanOrEqual(31928)
  })

  it('全零回 -1..1（零軸留在中間）', () => {
    expect(niceDomain([0, 0, 0], { includeZero: true })).toEqual({ min: -1, max: 1 })
    expect(niceDomain([0, 0])).toEqual({ min: -1, max: 1 })
  })

  it('無有效資料（空陣列 / 全 null）回 0..1，不崩', () => {
    expect(niceDomain([])).toEqual({ min: 0, max: 1 })
    expect(niceDomain([null, undefined, NaN])).toEqual({ min: 0, max: 1 })
  })

  it('單一值上下各留一成', () => {
    const d = niceDomain([500])
    expect(d.min).toBeLessThan(500)
    expect(d.max).toBeGreaterThan(500)
  })

  it('忽略 null 只看有效值', () => {
    const d = niceDomain([null, 50, null, 150], { includeZero: true })
    expect(d.max).toBeGreaterThanOrEqual(150)
  })
})

describe('domainTicks', () => {
  it('刻度落在值域內、由小到大且含 0（跨零時）', () => {
    const d = niceDomain([-1000, 2000], { includeZero: true })
    const ticks = domainTicks(d)
    expect(ticks[0]).toBeGreaterThanOrEqual(d.min)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(d.max)
    expect(ticks).toContain(0)
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
  })

  it('值域退化時不無限迴圈', () => {
    expect(domainTicks({ min: 5, max: 5 })).toEqual([5])
  })
})

describe('scaleY', () => {
  it('最大值在頂端、最小值在底部', () => {
    const d = { min: 0, max: 100 }
    expect(scaleY(100, d, 200)).toBe(0)
    expect(scaleY(0, d, 200)).toBe(200)
    expect(scaleY(50, d, 200)).toBe(100)
  })

  it('值域退化時回中線', () => {
    expect(scaleY(5, { min: 5, max: 5 }, 100)).toBe(50)
  })
})

describe('fmtAxisNumber', () => {
  it('以萬 / 億縮寫大數字', () => {
    expect(fmtAxisNumber(12345678)).toBe('1235 萬')
    expect(fmtAxisNumber(-15000)).toBe('-1.5 萬')
    expect(fmtAxisNumber(250000000)).toBe('2.5 億')
    expect(fmtAxisNumber(850)).toBe('850')
    expect(fmtAxisNumber(0)).toBe('0')
  })
})
