import { describe, expect, it } from 'vitest'
import { allowsTicker, mergeTwTickerLists } from './batchTickers.ts'

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
