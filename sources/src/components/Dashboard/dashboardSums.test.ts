import { describe, expect, it } from 'vitest'
import type { HoldingRow } from '../../utils/holdingRows'
import { asOfLabel, combine, marketSums, rowToday } from './dashboardSums'

const row = (over: Partial<HoldingRow> & { currency?: 'TWD' | 'USD'; cost?: number }): HoldingRow =>
  ({
    rowKey: 'k',
    direction: 'LONG',
    rowQty: 1000,
    price: 100,
    dayChange: 2,
    mktVal: 100_000,
    unrealized: 5_000,
    brokerUnrealized: 4_800,
    brokerNotApplicable: false,
    trial: false,
    closed: false,
    tradeDay: null,
    holding: { currency: over.currency ?? 'TWD', cost: over.cost ?? 95_000 },
    ...over,
  }) as unknown as HoldingRow

describe('rowToday', () => {
  it('is the move times the shares; a short row loses on a rise', () => {
    expect(rowToday(row({}))).toBe(2_000)
    expect(rowToday(row({ direction: 'SHORT', rowQty: -1000 }))).toBe(-2_000)
    expect(rowToday(row({ dayChange: null }))).toBeNull()
  })
})

describe('marketSums', () => {
  it('sums today, value and the chosen basis; cost counts the long leg only', () => {
    const s = marketSums(
      [row({}), row({ direction: 'SHORT', rowQty: -500, mktVal: 50_000, unrealized: -1_000, brokerUnrealized: -1_100 })],
      'TWD',
      'list',
      false,
    )
    expect(s.today).toBe(2_000 - 1_000)
    expect(s.netMkt).toBe(50_000)
    expect(s.cost).toBe(95_000)
    expect(s.unrealized).toBe(4_800 - 1_100)
    expect(s.prevValue).toBe(98_000 + 49_000)
  })

  it('a missing leg leaves the net value unknown instead of reading it as 0', () => {
    const s = marketSums([row({}), row({ direction: 'SHORT', rowQty: -500, mktVal: null, price: null })], 'TWD', 'net', false)
    expect(s.netMkt).toBeNull()
    expect(s.quoteMissing).toBe(true)
  })

  it('a short-only market has a long leg of 0, not unknown', () => {
    const s = marketSums([row({ direction: 'SHORT', rowQty: -500, mktVal: 50_000 })], 'TWD', 'net', true)
    expect(s.longMkt).toBe(0)
    expect(s.cost).toBe(0)
    expect(s.netMkt).toBe(-50_000)
    expect(s.quoteMissing).toBe(false)
  })
})

describe('combine', () => {
  it('converts US into TWD only when a rate is known', () => {
    expect(combine(1000, 10, true, true, 32)).toEqual({ value: 1320, currency: 'TWD', usLeftOut: false })
    expect(combine(1000, 10, true, true, null)).toEqual({ value: 1000, currency: 'TWD', usLeftOut: true })
    expect(combine(1000, null, true, true, 32)).toEqual({ value: 1000, currency: 'TWD', usLeftOut: true })
  })
  it('a single market stays in its own currency', () => {
    expect(combine(null, 10, false, true, null)).toEqual({ value: 10, currency: 'USD', usLeftOut: false })
    expect(combine(1000, null, true, false, null)).toEqual({ value: 1000, currency: 'TWD', usLeftOut: false })
  })
})

describe('asOfLabel', () => {
  it('names the close once every quoted TW row is final', () => {
    expect(asOfLabel([row({ closed: true, tradeDay: '9/25' })], null)).toBe('9/25 收盤')
  })
  it('says 試撮中 during an auction, otherwise the refresh time', () => {
    expect(asOfLabel([row({ trial: true })], null)).toBe('試撮中')
    expect(asOfLabel([row({})], new Date(2026, 8, 25, 10, 5, 7))).toBe('10:05:07 更新')
    expect(asOfLabel([row({})], null)).toBe('')
  })
})
