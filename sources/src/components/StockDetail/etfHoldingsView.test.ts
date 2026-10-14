import { describe, expect, it } from 'vitest'
import {
  formatContractMonth,
  formatPublishedAt,
  formatTwdFull,
  formatUnitsYi,
  formatWeight,
  formatYi,
  assetSegments,
  concentrationSegments,
  marketSegments,
} from './etfHoldingsView'

describe('etfHoldingsView', () => {
  it('shows NT$ amounts in 億 with the full figure available', () => {
    expect(formatYi(2_553_551_300_844)).toBe('25,535.51 億')
    expect(formatYi(7_044_587_000)).toBe('70.45 億')
    expect(formatYi(0)).toBe('0')
    expect(formatTwdFull(2_553_551_300_844)).toBe('NT$ 2,553,551,300,844')
    expect(formatUnitsYi(22_307_000_000)).toBe('223.07 億')
  })

  it('prints weights, contract months and the publish stamp as given', () => {
    expect(formatWeight(56.39)).toBe('56.39%')
    expect(formatWeight(0.03)).toBe('0.03%')
    expect(formatContractMonth('202610')).toBe('2026/10')
    expect(formatContractMonth('')).toBe('')
    expect(formatPublishedAt('2026-10-12 16:06:52')).toBe('10/12 16:06')
    expect(formatPublishedAt(null)).toBeNull()
  })

  it('splits concentration into the largest, the next nine, the rest and what stocks leave of 100 %', () => {
    const stocks = [
      { code: '2330', name: '台積電', shares: 1, weight: 56.48, market: 'TW' },
      ...Array.from({ length: 9 }, (_, i) => ({ code: String(2000 + i), name: 'x', shares: 1, weight: 2.29, market: 'TW' })),
      ...Array.from({ length: 40 }, (_, i) => ({ code: String(3000 + i), name: 'y', shares: 1, weight: 0.5627, market: 'TW' })),
    ]
    const segs = concentrationSegments(stocks)
    expect(segs.map((g) => [g.key, g.label, g.weight])).toEqual([
      ['top1', '台積電', 56.48],
      ['next', '第 2–10 名', 20.61],
      ['rest', '其餘 40 檔', 22.51],
      ['other', '股票以外', 0.4],
    ])
  })

  it('drops empty segments for a fund with few holdings', () => {
    const segs = concentrationSegments([{ code: '2330', name: '台積電', shares: 1, weight: 100, market: 'TW' }])
    expect(segs.map((g) => g.key)).toEqual(['top1'])
    expect(concentrationSegments([])).toEqual([])
  })

  it('sizes asset segments by the amounts themselves, keeping zero classes listed', () => {
    const segs = assetSegments({ stock: 2_492_806_207_442, etf: 0, bond: 0, futures: 6_907_178_200 })
    expect(segs.map((a) => a.key)).toEqual(['stock', 'etf', 'bond', 'futures'])
    expect(segs[1].widthPct).toBe(0)
    expect(segs[0].widthPct + segs[3].widthPct).toBeCloseTo(100, 10)
    expect(segs[0].widthPct).toBeGreaterThan(99)
  })

  it('splits weight by market only when there are two or more', () => {
    const tw = { code: '3037', name: 'a', shares: 1, weight: 11.44, market: 'TW' }
    expect(marketSegments([tw])).toEqual([])
    expect(
      marketSegments([tw, { ...tw, code: '2383', weight: 8.92 }, { ...tw, code: '4062', weight: 9.77, market: 'JP' }]),
    ).toEqual([
      { market: 'TW', label: '台灣', weight: 20.36 },
      { market: 'JP', label: '日本', weight: 9.77 },
      { market: 'other', label: '股票以外', weight: 69.87 },
    ])
  })

  it('has no asset segments when the issuer publishes no NT$ totals', () => {
    expect(assetSegments(null)).toEqual([])
  })
})
