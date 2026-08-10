import { describe, expect, it } from 'vitest'
import {
  buildTopTickersFile,
  parseTradeValue,
  rankTopByTradeValue,
  TOP_TICKERS_DEFAULT_N,
} from './topTickers.ts'

describe('parseTradeValue', () => {
  it('parses plain and comma integers', () => {
    expect(parseTradeValue('274179232')).toBe(274179232)
    expect(parseTradeValue('1,234,567')).toBe(1234567)
    expect(parseTradeValue(99)).toBe(99)
  })

  it('returns 0 on junk', () => {
    expect(parseTradeValue('')).toBe(0)
    expect(parseTradeValue(null)).toBe(0)
    expect(parseTradeValue('x')).toBe(0)
  })
})

describe('rankTopByTradeValue', () => {
  const rows = [
    { Code: '0050', Name: '元大台灣50', TradeValue: '500' },
    { Code: '2330', Name: '台積電', TradeValue: '1000' },
    { Code: '2408', Name: '南亞科', TradeValue: '800' },
    { Code: '!!', Name: 'bad', TradeValue: '99999' },
    { Code: '00631L', Name: '元大台灣50正2', TradeValue: '900' },
  ]

  it('ranks by TradeValue and keeps ETFs (00xx / letter codes)', () => {
    const top = rankTopByTradeValue(rows, 3)
    expect(top.map((t) => t.ticker)).toEqual(['2330', '00631L', '2408'])
    expect(top[0]).toMatchObject({ rank: 1, name: '台積電', tradeValue: 1000 })
    expect(top[1].ticker).toBe('00631L')
  })

  it('default n is 30', () => {
    expect(TOP_TICKERS_DEFAULT_N).toBe(30)
    const many = Array.from({ length: 40 }, (_, i) => ({
      Code: String(1000 + i),
      Name: `n${i}`,
      TradeValue: String(40 - i),
    }))
    expect(rankTopByTradeValue(many)).toHaveLength(30)
  })

  it('skips invalid codes', () => {
    expect(rankTopByTradeValue([{ Code: '!', Name: 'x', TradeValue: '9' }])).toEqual([])
  })
})

describe('buildTopTickersFile', () => {
  it('sets schema and n', () => {
    const f = buildTopTickersFile({
      sourceDate: '1150807',
      asOf: '2026-08-10T07:00:00.000Z',
      tickers: [{ ticker: '2330', name: '台積電', rank: 1, tradeValue: 1 }],
    })
    expect(f.schema).toBe(1)
    expect(f.n).toBe(1)
    expect(f.sourceDate).toBe('1150807')
  })
})
