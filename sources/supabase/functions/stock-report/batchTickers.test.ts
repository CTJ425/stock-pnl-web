import { describe, expect, it } from 'vitest'
import { mergeTwTickerLists } from './batchTickers.ts'

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
