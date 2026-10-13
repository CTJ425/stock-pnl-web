import { describe, expect, it } from 'vitest'
import {
  HOLDINGS_TOP_N,
  formatContractMonth,
  formatPublishedAt,
  formatTwdFull,
  formatUnitsYi,
  formatWeight,
  formatYi,
  visibleStocks,
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

  it('cuts the stock list to the top 10 until expanded', () => {
    const stocks = Array.from({ length: 50 }, (_, i) => ({ code: String(1000 + i), name: 'x', shares: 1, weight: 1 }))
    expect(visibleStocks(stocks, false)).toHaveLength(HOLDINGS_TOP_N)
    expect(visibleStocks(stocks, false)[0].code).toBe('1000')
    expect(visibleStocks(stocks, true)).toHaveLength(50)
    expect(visibleStocks(stocks.slice(0, 3), false)).toHaveLength(3)
  })
})
