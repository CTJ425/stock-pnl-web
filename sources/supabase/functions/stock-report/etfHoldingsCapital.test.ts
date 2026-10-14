import { describe, expect, it } from 'vitest'
import { CAPITAL_API, capitalRatioPageUrl, createCapitalSession, parseCapitalHoldings } from './etfHoldingsCapital.ts'
import { DEFAULT_HOLDINGS_RULES, validateHoldingsDay } from './etfHoldings.ts'
import { CAPITAL_00685L_20261013, CAPITAL_00919_20261013, CAPITAL_LIST_20261014 } from './etfHoldingsCapital.fixture.ts'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
/** The parsed day; fails the test when the parser answered null or `{ unsupported }`. */
function parsed(raw: unknown) {
  const p = parseCapitalHoldings(raw)
  if (!p || 'unsupported' in p) throw new Error(`not a day: ${JSON.stringify(p)}`)
  return p
}

describe('parseCapitalHoldings', () => {
  // Expected values: Capital's own 00919 / 00685L 「投資組合」 data for trade date 2026-10-13, read
  // 2026-10-14 (docs/agent/specs/200-etf-holdings.md § Release 2).
  it('reads 00919 as published, trade date from date2 (date1 is the announcement date)', () => {
    const p = parsed(clone(CAPITAL_00919_20261013))
    expect(p.fundName).toBe('群益台灣精選高息ETF基金')
    const d = p.day
    expect(d.tradeDate).toBe('2026-10-13')
    expect(d.navTotal).toBe(631_025_345_971)
    expect(d.unitsOutstanding).toBe(19_396_635_000)
    expect(d.navPerUnit).toBe(32.53)
    expect(d.fundSize).toBe(d.navTotal)
    expect(d.assets).toBeNull()
    expect(d.stocks).toHaveLength(40)
    expect(d.stocks[0]).toEqual({ code: '2881', name: '富邦金', shares: 611_370_000, weight: 15.5016, market: 'TW' })
    expect(d.futures).toEqual([{ code: 'TX', name: '台指期', contracts: 276, weight: 0.4233, month: '202610' }])
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261014')).toEqual({ ok: true })
  })

  it('reads 00685L as a futures-led day: no stocks, 台指期 at 200.94 %', () => {
    const d = parsed(clone(CAPITAL_00685L_20261013)).day
    expect(d.stocks).toEqual([])
    expect(d.futures).toEqual([{ code: 'TX', name: '台指期', contracts: 15_866, weight: 200.9432, month: '202610' }])
    expect(d.navPerUnit).toBe(12.93)
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261014')).toEqual({ ok: true })
  })

  it.each([
    ['not an object', null],
    ['no pcf', { stocks: [], futures: [] }],
    ['a bad date2', (() => { const r = clone(CAPITAL_00919_20261013); r.pcf.date2 = '2026/10/13'; return r })()],
    ['a stock without weight', (() => { const r = clone(CAPITAL_00919_20261013) as { stocks: Array<Record<string, unknown>> }; delete r.stocks[3].weight; return r })()],
    ['stocks that are not a list', { ...clone(CAPITAL_00919_20261013), stocks: 'x' }],
  ])('returns null for %s', (_l, raw) => {
    expect(parseCapitalHoldings(raw)).toBeNull()
  })
})

describe('parseCapitalHoldings: funds it has no screen for (review RISK 4–6)', () => {
  it('skips bond, foreign-currency and foreign-stock funds quietly instead of failing them', () => {
    expect(parseCapitalHoldings({ ...clone(CAPITAL_00919_20261013), bonds: [{ x: 1 }] })).toEqual({ unsupported: 'bonds' })
    const usd = clone(CAPITAL_00919_20261013)
    usd.pcf.dollar = 'USD'
    expect(parseCapitalHoldings(usd)).toEqual({ unsupported: 'currency' })
    const us = clone(CAPITAL_00919_20261013)
    us.stocks[0].stocNo = 'AAPL US'
    expect(parseCapitalHoldings(us)).toEqual({ unsupported: 'foreign-stock' })
  })

  it('reads a missing or null futures list as empty', () => {
    const r = clone(CAPITAL_00919_20261013) as Record<string, unknown>
    r.futures = null
    expect(parsed(r).day.futures).toEqual([])
    delete r.futures
    expect(parsed(r).day.futures).toEqual([])
  })
})

describe('createCapitalSession', () => {
  function fakeApi() {
    const calls: Array<{ url: string; body: unknown }> = []
    const post = async (url: string, body: unknown) => {
      calls.push({ url, body })
      // The real list response (an object with `funds`), not a hand-built shape: a fake array here
      // once hid that the parser read the wrong level, and every fund ended fetch-failed on DEV.
      if (url.endsWith('etf/list')) return clone(CAPITAL_LIST_20261014)
      if (url.endsWith('etf/buyback')) return { code: 200, data: { echo: (body as { fundId: string }).fundId } }
      return null
    }
    return { calls, post }
  }

  it('loads the list once per run, asks by fundNo for the latest day, and links the fund page', async () => {
    const api = fakeApi()
    const s = createCapitalSession(api.post)
    expect(s.pendingCalls()).toBe(2)
    expect(await s.fundNoOf('00919')).toBeNull()
    expect(await s.fetchHoldings('00919')).toEqual({ echo: '195' })
    expect(s.pendingCalls()).toBe(1)
    expect(await s.fetchHoldings('00685L')).toEqual({ echo: '094' })
    expect(api.calls.map((c) => c.url.replace(CAPITAL_API, ''))).toEqual(['etf/list', 'etf/buyback', 'etf/buyback'])
    // The list call wants the literal JSON body null (an empty body answers 411).
    expect(api.calls[0].body).toBeNull()
    expect(api.calls[1].body).toEqual({ fundId: '195', date: null })
    expect(await s.fundNoOf('00919')).toBe('195')
    expect(capitalRatioPageUrl('195')).toBe('https://www.capitalfund.com.tw/etf/product/detail/195/portfolio')
  })

  it('answers null for a ticker Capital does not list, and when the list call fails', async () => {
    expect(await createCapitalSession(fakeApi().post).fetchHoldings('00999')).toBeNull()
    expect(await createCapitalSession(async () => ({ code: 500 })).fetchHoldings('00919')).toBeNull()
  })
})
