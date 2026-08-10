import { describe, expect, it } from 'vitest'
import {
  buildTopTickersDay,
  latestTopTickers,
  mergeTopTickersArchive,
  normalizeTopTickersFile,
  parseTradeValue,
  rankTopByTradeValue,
  tradingYmdFromSource,
  TOP_TICKERS_DEFAULT_N,
} from './topTickers.ts'

describe('tradingYmdFromSource', () => {
  it('maps ROC 7-digit and AD forms to YYYYMMDD', () => {
    expect(tradingYmdFromSource('1150807')).toBe('20260807')
    expect(tradingYmdFromSource('20260807')).toBe('20260807')
    expect(tradingYmdFromSource('2026-08-07')).toBe('20260807')
    expect(tradingYmdFromSource(null)).toBeNull()
    expect(tradingYmdFromSource('x')).toBeNull()
  })
})

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

  it('ranks by volume / TradeValue and keeps ETFs (00xx / letter codes)', () => {
    const top = rankTopByTradeValue(rows, 3)
    expect(top.map((t) => t.ticker)).toEqual(['2330', '00631L', '2408'])
    expect(top[0]).toMatchObject({ rank: 1, name: '台積電', tradeValue: 1000 })
    expect(top[1].ticker).toBe('00631L')
  })

  it('prefers official Rank and TradeVolume (MI_INDEX20 shape)', () => {
    const mi = [
      {
        Date: '20260807',
        Rank: '2',
        Code: '2317',
        Name: '鴻海',
        TradeVolume: '100',
      },
      {
        Date: '20260807',
        Rank: '1',
        Code: '3481',
        Name: '群創',
        TradeVolume: '200',
      },
    ]
    const top = rankTopByTradeValue(mi, 20)
    expect(top.map((t) => t.ticker)).toEqual(['3481', '2317'])
    expect(top[0]).toMatchObject({ rank: 1, tradeValue: 200 })
  })

  it('default n is 20 (MI_INDEX20)', () => {
    expect(TOP_TICKERS_DEFAULT_N).toBe(20)
    const many = Array.from({ length: 40 }, (_, i) => ({
      Code: String(1000 + i),
      Name: `n${i}`,
      TradeVolume: String(40 - i),
    }))
    expect(rankTopByTradeValue(many)).toHaveLength(20)
  })
})

describe('mergeTopTickersArchive', () => {
  const mon = buildTopTickersDay({
    ymd: '20260810',
    sourceDate: '1150807',
    asOf: '2026-08-10T08:00:00.000Z',
    tickers: [{ ticker: '2330', name: '台積電', rank: 1, tradeValue: 1 }],
  })
  const fri = buildTopTickersDay({
    ymd: '20260807',
    sourceDate: '1150804',
    asOf: '2026-08-07T08:00:00.000Z',
    tickers: [{ ticker: '2317', name: '鴻海', rank: 1, tradeValue: 2 }],
  })
  const thu = buildTopTickersDay({
    ymd: '20260806',
    sourceDate: '1150803',
    asOf: '2026-08-06T08:00:00.000Z',
    tickers: [{ ticker: '2454', name: '聯發科', rank: 1, tradeValue: 3 }],
  })

  it('keeps newest + previous only (drops older third)', () => {
    const a = mergeTopTickersArchive(null, fri)
    const b = mergeTopTickersArchive(a, mon)
    const c = mergeTopTickersArchive(b, thu)
    // mon + fri stay; thu is older than fri when mon present — actually thu is oldest and dropped
    expect(c.days.map((d) => d.ymd)).toEqual(['20260810', '20260807'])
    expect(latestTopTickers(c)[0]?.ticker).toBe('2330')
  })

  it('same ymd replaces in place', () => {
    const a = mergeTopTickersArchive(null, mon)
    const mon2 = buildTopTickersDay({
      ...mon,
      tickers: [{ ticker: '2408', name: '南亞科', rank: 1, tradeValue: 9 }],
    })
    const b = mergeTopTickersArchive(a, mon2)
    expect(b.days).toHaveLength(1)
    expect(b.days[0]?.tickers[0]?.ticker).toBe('2408')
  })
})

describe('normalizeTopTickersFile', () => {
  it('upgrades v1 single snapshot', () => {
    const f = normalizeTopTickersFile({
      schema: 1,
      sourceDate: '1150807',
      asOf: '2026-08-07T08:00:00.000Z',
      tickers: [{ ticker: '2330', name: '台積電', rank: 1, tradeValue: 1 }],
    })
    expect(f?.days).toHaveLength(1)
    expect(f?.days[0]?.ymd).toBe('20260807')
    expect(latestTopTickers(f)[0]?.ticker).toBe('2330')
  })

  it('collapses write-clock ymd + sourceDate into one trading day', () => {
    const f = normalizeTopTickersFile({
      schema: 2,
      days: [
        {
          ymd: '20260810',
          sourceDate: '1150807',
          asOf: '2026-08-10T06:17:54.000Z',
          tickers: [{ ticker: '2330', name: '台積電', rank: 1, tradeValue: 1 }],
        },
        {
          ymd: '20260807',
          sourceDate: '1150807',
          asOf: '2026-08-07T08:00:00.000Z',
          tickers: [{ ticker: '2408', name: '南亞科', rank: 1, tradeValue: 2 }],
        },
      ],
    })
    expect(f?.days).toHaveLength(1)
    expect(f?.days[0]?.ymd).toBe('20260807')
    // newer asOf (Mon rewrite of Fri session) wins
    expect(f?.days[0]?.tickers[0]?.ticker).toBe('2330')
  })
})
