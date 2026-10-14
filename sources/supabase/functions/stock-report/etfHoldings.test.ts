import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOLDINGS_RULES,
  ETF_0050_RULES,
  appendHoldingsDay,
  expectedLatestTradeDate,
  holdingsFingerprint,
  parseYuantaHoldings,
  validateHoldingsDay,
  yuantaHoldingsUrl,
  type EtfHoldingsDay,
} from './etfHoldings.ts'
import { YUANTA_0050_20261012 } from './etfHoldings.fixture.ts'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const day1012 = (): EtfHoldingsDay => parseYuantaHoldings(clone(YUANTA_0050_20261012))!.day

describe('parseYuantaHoldings', () => {
  // Expected values are the figures on Yuanta's own 0050 「持股比重」 page for trade date
  // 2026-10-12, read on 2026-10-13 (docs/agent/specs/200-etf-holdings.md § Phase 0).
  it('reads the 2026-10-12 figures exactly as published', () => {
    const parsed = parseYuantaHoldings(clone(YUANTA_0050_20261012))
    expect(parsed?.fundName).toBe('元大台灣卓越50基金')
    const d = parsed!.day
    expect(d.tradeDate).toBe('2026-10-12')
    expect(d.publishedAt).toBe('2026-10-12 16:06:52')
    expect(d.navTotal).toBe(2_553_551_300_844)
    expect(d.navPerUnit).toBe(114.47)
    expect(d.unitsOutstanding).toBe(22_307_000_000)
    expect(d.fundSize).toBe(2_547_140_807_580)
    expect(d.assets).toEqual({ stock: 2_540_194_490_501, etf: 0, bond: 0, futures: 7_044_587_000 })
    expect(d.stocks).toHaveLength(50)
    expect(d.stocks[0]).toEqual({ code: '2330', name: '台積電', shares: 565_525_249, weight: 56.39, market: 'TW' })
    expect(d.stocks[1]).toEqual({ code: '2454', name: '聯發科', shares: 34_056_356, weight: 6.18, market: 'TW' })
    expect(d.futures).toEqual([
      { code: 'TX', name: '臺股期貨', contracts: 628, weight: 0.24, month: '202610' },
      { code: 'NYF', name: '台灣50ETF股票期貨', contracts: 738, weight: 0.03, month: '202610' },
    ])
  })

  it('orders stocks by published weight, largest first, whatever the response order', () => {
    const raw = clone(YUANTA_0050_20261012)
    raw.FundWeights.StockWeights.reverse()
    const d = parseYuantaHoldings(raw)!.day
    expect(d.stocks.slice(0, 2).map((s) => s.code)).toEqual(['2330', '2454'])
    expect(d.stocks.every((s, i, a) => i === 0 || a[i - 1].weight >= s.weight)).toBe(true)
  })

  it('takes the date from trandate, not from anything asked', () => {
    const raw = clone(YUANTA_0050_20261012)
    raw.PCF.anndate = '20261099'
    expect(parseYuantaHoldings(raw)?.day.tradeDate).toBe('2026-10-12')
  })

  it.each([
    ['not an object', null],
    ['an HTML page', '<!doctype html>'],
    ['no FundWeights', { PCF: YUANTA_0050_20261012.PCF }],
    ['a bad trandate', { ...clone(YUANTA_0050_20261012), PCF: { ...YUANTA_0050_20261012.PCF, trandate: '2026/10/12' } }],
    ['a stock row without qty', (() => {
      const r = clone(YUANTA_0050_20261012) as { FundWeights: { StockWeights: Array<Record<string, unknown>> } }
      delete r.FundWeights.StockWeights[3].qty
      return r
    })()],
  ])('returns null for %s', (_label, raw) => {
    expect(parseYuantaHoldings(raw)).toBeNull()
  })
})

describe('yuantaHoldingsUrl', () => {
  it('asks the PCF/Daily bridge for the ticker, with the announcement date only when given', () => {
    expect(yuantaHoldingsUrl('0050')).toMatch(/FuncId=PCF%2FDaily.*&ticker=0050$/)
    expect(yuantaHoldingsUrl('0050', '20261013')).toMatch(/&ticker=0050&date=20261013$/)
  })
})

describe('validateHoldingsDay', () => {
  it('passes the real 2026-10-12 day', () => {
    expect(validateHoldingsDay(day1012(), ETF_0050_RULES, '20261013')).toEqual({ ok: true })
  })

  const fails = (mutate: (d: EtfHoldingsDay) => void, today = '20261013') => {
    const d = day1012()
    mutate(d)
    return validateHoldingsDay(d, ETF_0050_RULES, today)
  }

  it.each<[string, (d: EtfHoldingsDay) => void]>([
    ['trade-date', (d) => { d.tradeDate = '2026-13-40' }],
    ['nav-positive', (d) => { d.navTotal = 0 }],
    ['nav-identity', (d) => { d.unitsOutstanding = 22_407_000_000 }],
    ['stock-count', (d) => { d.stocks = d.stocks.slice(0, 30) }],
    ['stock-duplicate', (d) => { d.stocks[5] = { ...d.stocks[5], code: d.stocks[4].code } }],
    ['stock-row', (d) => { d.stocks[7].shares = 1.5 }],
    ['stock-missing', (d) => { d.stocks[0].code = '9999' }],
    ['stock-weight-sum', (d) => { d.stocks[1].weight += 1 }],
    ['futures-missing', (d) => { d.futures = [] }],
    ['stock-weight-sum', (d) => { d.assets = null; d.stocks[0].weight += 50 }],
  ])('fails %s', (rule, mutate) => {
    expect(fails(mutate)).toEqual({ ok: false, rule })
  })

  it('tells holdings apart by market + code: a Tokyo and a Taiwan listing may share a code', () => {
    expect(fails((d) => { d.stocks[5] = { ...d.stocks[5], code: d.stocks[4].code, market: 'JP' } })).toEqual({ ok: true })
  })

  it('refuses a stock fund whose response lost its stocks (review BLOCKER): tiny futures are no proof', () => {
    const d = day1012()
    d.stocks = []
    d.assets = null
    d.futures = [{ code: 'TX', name: '臺股期貨', contracts: 276, weight: 0.42, month: '202610' }]
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261013')).toEqual({ ok: false, rule: 'stock-count' })
  })

  it('accepts a futures-led day only with futures carrying the fund, inverse included', () => {
    const d = day1012()
    d.stocks = []
    d.assets = null
    d.futures = [{ code: 'TX', name: '臺股期貨', contracts: 100, weight: -98.5, month: '202610' }]
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261013')).toEqual({ ok: true })
  })

  it('allows the 2-decimal NAV rounding of a low-priced fund (review RISK 1)', () => {
    const d = day1012()
    d.stocks = []
    d.assets = null
    d.futures = [{ code: 'TX', name: '臺股期貨', contracts: 100, weight: 200, month: '202610' }]
    // A true NAV of 8.005 published as 8.01: nav × units misses the total by 0.0625 % — over the old
    // flat 0.05 %, inside the rounding bound 0.006 / 8.01 = 0.075 %.
    d.navPerUnit = 8.01
    d.unitsOutstanding = 1_000_000
    d.navTotal = 8_005_000
    d.fundSize = d.navTotal
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261013')).toEqual({ ok: true })
    d.navTotal = 7_990_000 // 0.25 % off: a real mismatch still fails
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261013')).toEqual({ ok: false, rule: 'nav-identity' })
  })

  it('fails a trade date after today', () => {
    expect(fails(() => {}, '20261011')).toEqual({ ok: false, rule: 'trade-date-future' })
  })

  it('needs no futures list when the futures amount is zero', () => {
    expect(fails((d) => { d.futures = []; d.assets!.futures = 0 })).toEqual({ ok: true })
  })
})

describe('appendHoldingsDay', () => {
  const at = (tradeDate: string): EtfHoldingsDay => ({ ...day1012(), tradeDate })

  it('puts a new day first and replaces the same date', () => {
    const a = appendHoldingsDay([at('2026-10-08')], at('2026-10-12'))
    expect(a.map((d) => d.tradeDate)).toEqual(['2026-10-12', '2026-10-08'])
    const revised = { ...at('2026-10-12'), navPerUnit: 1 }
    const b = appendHoldingsDay(a, revised)
    expect(b.map((d) => d.tradeDate)).toEqual(['2026-10-12', '2026-10-08'])
    expect(b[0].navPerUnit).toBe(1)
  })

  it('keeps at most 20 days', () => {
    const days = Array.from({ length: 20 }, (_, i) => at(`2026-09-${String(i + 1).padStart(2, '0')}`)).reverse()
    const next = appendHoldingsDay(days, at('2026-10-01'))
    expect(next).toHaveLength(20)
    expect(next[0].tradeDate).toBe('2026-10-01')
    expect(next.at(-1)?.tradeDate).toBe('2026-09-02')
  })
})

describe('holdingsFingerprint', () => {
  it('ignores the publish stamp but not the figures', () => {
    const a = day1012()
    expect(holdingsFingerprint({ ...a, publishedAt: 'x' })).toBe(holdingsFingerprint(a))
    expect(holdingsFingerprint({ ...a, navPerUnit: 114.48 })).not.toBe(holdingsFingerprint(a))
  })
})

describe('expectedLatestTradeDate', () => {
  it('expects only the previous weekday when the publish hour is unknown (CTBC)', () => {
    expect(expectedLatestTradeDate(new Date('2026-10-13T10:00:00Z'), null)).toBe('2026-10-12')
    expect(expectedLatestTradeDate(new Date('2026-10-12T01:00:00Z'), null)).toBe('2026-10-09')
  })

  it.each([
    // [UTC instant, Taipei clock, expected]
    ['2026-10-13T07:59:00Z', 'Tue 15:59', '2026-10-12'],
    ['2026-10-13T08:00:00Z', 'Tue 16:00', '2026-10-13'],
    ['2026-10-12T01:00:00Z', 'Mon 09:00', '2026-10-09'],
    ['2026-10-10T12:00:00Z', 'Sat 20:00', '2026-10-09'],
    ['2026-10-11T17:00:00Z', 'Mon 01:00', '2026-10-09'],
  ])('%s (%s) → %s', (iso, _clock, expected) => {
    expect(expectedLatestTradeDate(new Date(iso))).toBe(expected)
  })
})
