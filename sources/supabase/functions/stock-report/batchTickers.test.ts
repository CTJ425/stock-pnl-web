import { describe, expect, it } from 'vitest'
import { allowsTicker, mergeTwTickerLists, netOpenTickers } from './batchTickers.ts'

describe('mergeTwTickerLists', () => {
  it('unions holdings and watchlist without duplicates', () => {
    const got = mergeTwTickerLists(
      [{ ticker: '2330', name: '台積電' }],
      [
        { ticker: '2330', name: 'TSMC' },
        { ticker: '2059', name: '川湖' },
      ],
    )
    expect(got).toEqual([
      { ticker: '2330', name: '台積電' },
      { ticker: '2059', name: '川湖' },
    ])
  })

  it('fills empty holding name from watchlist', () => {
    const got = mergeTwTickerLists(
      [{ ticker: '2303', name: '' }],
      [{ ticker: '2303', name: '聯電' }],
    )
    expect(got).toEqual([{ ticker: '2303', name: '聯電' }])
  })

  it('drops invalid tickers', () => {
    const got = mergeTwTickerLists([
      { ticker: 'x', name: 'bad' },
      { ticker: '2330', name: 'ok' },
    ])
    expect(got).toEqual([{ ticker: '2330', name: 'ok' }])
  })

  it('returns empty when all lists empty', () => {
    expect(mergeTwTickerLists([], [])).toEqual([])
  })
})

describe('allowsTicker', () => {
  const allowed = [
    { ticker: '2330', name: '台積電' },
    { ticker: '2059', name: '川湖' },
  ]

  it('lets through a ticker that is only on the watchlist', () => {
    expect(allowsTicker(allowed, '2059')).toBe(true)
  })

  it('lets through a held ticker', () => {
    expect(allowsTicker(allowed, '2330')).toBe(true)
  })

  it('rejects a ticker that is neither held nor watched', () => {
    expect(allowsTicker(allowed, '1101')).toBe(false)
  })

  it('trims the queried ticker before comparing', () => {
    expect(allowsTicker(allowed, ' 2330 ')).toBe(true)
  })

  it('rejects on an empty allow list', () => {
    expect(allowsTicker([], '2330')).toBe(false)
  })
})

describe('netOpenTickers', () => {
  const buy = (ticker: string, qty: number, name = '') => ({ ticker, name, tx_type: 'BUY', qty })
  const sell = (ticker: string, qty: number, name = '') => ({ ticker, name, tx_type: 'SELL', qty })

  it('keeps a 融券-only ticker: it nets negative, and net > 0 used to 403 籌碼分析', () => {
    // 融券 opens with a SELL. Under the old `net > 0` test 2303 disappeared from the whitelist
    // and `generate` answered 403 — the whole point of this rule.
    expect(netOpenTickers([sell('2303', 1000, '聯電')])).toEqual([{ ticker: '2303', name: '聯電' }])
  })

  it('keeps a long position', () => {
    expect(netOpenTickers([buy('2330', 1000, '台積電')])).toEqual([
      { ticker: '2330', name: '台積電' },
    ])
  })

  it('drops a ticker that nets to zero, long or short', () => {
    expect(netOpenTickers([buy('2330', 1000), sell('2330', 1000)])).toEqual([])
    expect(netOpenTickers([sell('2603', 1000), buy('2603', 1000)])).toEqual([])
  })

  it('nets partial covers: a half-covered short stays, a fully covered one goes', () => {
    expect(netOpenTickers([sell('8033', 5000), buy('8033', 2000)])).toEqual([
      { ticker: '8033', name: '' },
    ])
    expect(netOpenTickers([sell('8033', 5000), buy('8033', 5000)])).toEqual([])
  })

  it('rejects a malformed ticker and keeps the last non-empty name', () => {
    expect(netOpenTickers([buy('!!', 1000), buy('2330', 1000, '台積電'), buy('2330', 1000)])).toEqual([
      { ticker: '2330', name: '台積電' },
    ])
  })
})
