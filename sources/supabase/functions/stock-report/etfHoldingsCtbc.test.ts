import { describe, expect, it } from 'vitest'
import { CTBC_API, createCtbcSession, ctbcCallUrl, ctbcNumber, parseCtbcHoldings, splitCtbcCode } from './etfHoldingsCtbc.ts'
import { DEFAULT_HOLDINGS_RULES, validateHoldingsDay } from './etfHoldings.ts'
import { CTBC_009828_20261013 } from './etfHoldingsCtbc.fixture.ts'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('parseCtbcHoldings', () => {
  // Expected values: CTBC's own 009828 「投資組合」 data for 2026-10-13, read 2026-10-14
  // (docs/agent/specs/200-etf-holdings.md § CTBC Phase 0).
  it('reads the 2026-10-13 figures as published', () => {
    const p = parseCtbcHoldings(clone(CTBC_009828_20261013))!
    expect(p.fundName).toBe('中國信託台日韓PCB ETF證券投資信託基金')
    const d = p.day
    expect(d.tradeDate).toBe('2026-10-13')
    expect(d.navTotal).toBe(10_304_880_295)
    expect(d.unitsOutstanding).toBe(975_545_000)
    expect(d.navPerUnit).toBe(10.56)
    expect(d.fundSize).toBe(d.navTotal)
    expect(d.assets).toBeNull()
    expect(d.stocks).toHaveLength(30)
    expect(d.stocks[0]).toEqual({ code: '3037', name: '欣興電子', shares: 999_600, weight: 11.44, market: 'TW' })
    expect(d.stocks.find((s) => s.code === '4062')).toEqual({
      code: '4062', name: 'Ibiden Co Ltd', shares: 465_500, weight: 9.77, market: 'JP',
    })
    expect(d.futures).toEqual([])
  })

  it('splits holdings into markets by exchange suffix', () => {
    const d = parseCtbcHoldings(clone(CTBC_009828_20261013))!.day
    const byMarket = new Map<string, number>()
    for (const s of d.stocks) byMarket.set(s.market, (byMarket.get(s.market) ?? 0) + 1)
    expect(Object.fromEntries(byMarket)).toEqual({ TW: 17, JP: 9, KR: 4 })
  })

  it('leaves cash and receivable lines out of the holdings', () => {
    const d = parseCtbcHoldings(clone(CTBC_009828_20261013))!.day
    expect(d.stocks.some((s) => s.name === '現金' || s.code === '')).toBe(false)
    expect(Math.round(d.stocks.reduce((a, s) => a + s.weight, 0) * 100) / 100).toBe(98.97)
  })

  it('passes the shared checks', () => {
    const d = parseCtbcHoldings(clone(CTBC_009828_20261013))!.day
    expect(validateHoldingsDay(d, DEFAULT_HOLDINGS_RULES, '20261014')).toEqual({ ok: true })
  })

  it.each([
    ['not an object', null],
    ['no FundAssets', { FundAssetsDetail: [] }],
    ['a bad date', (() => { const r = clone(CTBC_009828_20261013); r.FundAssets[0]['資料日期'] = '2026-10-13'; return r })()],
    ['a stock row without weight', (() => { const r = clone(CTBC_009828_20261013); (r.FundAssetsDetail[0].Data[2] as Record<string, unknown>).weights_ = ''; return r })()],
  ])('returns null for %s', (_l, raw) => {
    expect(parseCtbcHoldings(raw)).toBeNull()
  })
})

describe('CTBC helpers', () => {
  it('reads numbers with thousands separators', () => {
    expect(ctbcNumber('10,304,880,295')).toBe(10_304_880_295)
    expect(ctbcNumber('11.44')).toBe(11.44)
    expect(Number.isNaN(ctbcNumber(''))).toBe(true)
  })

  it('maps exchange suffixes to markets', () => {
    expect(splitCtbcCode('3037')).toEqual({ code: '3037', market: 'TW' })
    expect(splitCtbcCode('4062 JP')).toEqual({ code: '4062', market: 'JP' })
    expect(splitCtbcCode('007660 KP')).toEqual({ code: '007660', market: 'KR' })
    expect(splitCtbcCode('950140 KQ')).toEqual({ code: '950140', market: 'KR' })
  })

  it('URL-encodes the token: a raw "+" reads as a space and the API rejects it', () => {
    expect(ctbcCallUrl('etf/ETFList', 'a+b/c=')).toBe(`${CTBC_API}etf/ETFList?token=a%2Bb%2Fc%3D`)
  })
})

describe('createCtbcSession', () => {
  function fakeApi() {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const post = async (url: string, body: Record<string, unknown>) => {
      calls.push({ url, body })
      if (url.includes('home/AuthToken')) return { ResultCode: 0, Data: { token: 'T+1' } }
      if (url.includes('etf/ETFList')) return { ResultCode: 0, Data: { Data: [{ ETF_ID: '009828', FID: 'E0039' }, { ETF_ID: '00891', FID: 'E0017' }] } }
      if (url.includes('etf/ETFHoldingWeight')) return { ResultCode: 0, Data: { echo: body.FID } }
      return null
    }
    return { calls, post }
  }

  it('opens one session per run and asks for the fund by its FID', async () => {
    const api = fakeApi()
    const s = createCtbcSession(api.post)
    expect(await s.fetchHoldings('009828', '20261014')).toEqual({ echo: 'E0039' })
    expect(await s.fetchHoldings('00891', '20261014')).toEqual({ echo: 'E0017' })
    const eps = api.calls.map((c) => c.url.split('/API/')[1].split('?')[0])
    expect(eps).toEqual(['home/AuthToken', 'etf/ETFList', 'etf/ETFHoldingWeight', 'etf/ETFHoldingWeight'])
    const hw = api.calls[2]
    expect(hw.body).toEqual({ token: 'T+1', FID: 'E0039', StartDate: '2026/10/14' })
    expect(hw.url).toContain('token=T%2B1')
  })

  it('answers null for a ticker CTBC does not list, and when auth fails', async () => {
    const api = fakeApi()
    expect(await createCtbcSession(api.post).fetchHoldings('009999', '20261014')).toBeNull()
    const down = createCtbcSession(async () => ({ ResultCode: 1, ResultMsg: 'Token 無效或過期' }))
    expect(await down.fetchHoldings('009828', '20261014')).toBeNull()
  })
})
