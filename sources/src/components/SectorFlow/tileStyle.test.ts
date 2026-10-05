import { describe, expect, it } from 'vitest'
import { labelFor, tint } from './tileStyle'

describe('tint', () => {
  it('is red for a buy, green for a sell, and neutral for zero', () => {
    expect(tint(5, 10)).toContain('var(--up)')
    expect(tint(-5, 10)).toContain('var(--down)')
    expect(tint(0, 10)).toBe('var(--cds-layer-02)')
    expect(tint(5, 0)).toBe('var(--cds-layer-02)')
  })

  it('gets deeper with size, but a small figure is still visibly tinted', () => {
    const pct = (s: string) => Number(s.match(/\) (\d+)%/)![1])
    expect(pct(tint(1, 100))).toBeGreaterThan(10)
    expect(pct(tint(100, 100))).toBeGreaterThan(pct(tint(25, 100)))
    expect(pct(tint(25, 100))).toBeGreaterThan(pct(tint(1, 100)))
  })

  it('stops at the strongest fill, which keeps its text readable', () => {
    expect(tint(1e12, 100)).toBe(tint(100, 100))
    expect(Number(tint(100, 100).match(/\) (\d+)%/)![1])).toBeLessThanOrEqual(55)
  })
})

describe('labelFor', () => {
  it('writes name and figure when both fit, the name when only it fits, nothing otherwise', () => {
    expect(labelFor(120, 80)).toBe('full')
    expect(labelFor(74, 46)).toBe('full')
    expect(labelFor(60, 30)).toBe('name')
    expect(labelFor(120, 20)).toBe('none')
    expect(labelFor(30, 120)).toBe('none')
  })
})
