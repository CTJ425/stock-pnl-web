import { describe, expect, it } from 'vitest'
import { extractMarketMarginTotals, marginSummaryUrl, type MarginSummaryResponse } from './marketMargin.ts'
import { MARGIN_MS_0916, MARGIN_MS_EMPTY } from './discordTestFixtures.ts'

function clone(): MarginSummaryResponse {
  return JSON.parse(JSON.stringify(MARGIN_MS_0916))
}

describe('marginSummaryUrl', () => {
  it('asks TWSE for the market summary only', () => {
    expect(marginSummaryUrl('20260916')).toBe(
      'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=20260916&selectType=MS&response=json',
    )
  })
})

describe('extractMarketMarginTotals', () => {
  it('reads the real 2026-09-16 totals', () => {
    expect(extractMarketMarginTotals(MARGIN_MS_0916)).toEqual({
      date: '2026-09-16',
      marginLots: { prev: 9190511, today: 9248877, change: 58366 },
      shortLots: { prev: 198052, today: 197048, change: -1004 },
      marginAmountThousandTwd: { prev: 582240465, today: 586166660, change: 3926195 },
    })
  })

  it('returns null when TWSE has no data for the date', () => {
    expect(extractMarketMarginTotals(MARGIN_MS_EMPTY)).toBeNull()
  })

  it('returns null for an empty or malformed response', () => {
    expect(extractMarketMarginTotals({})).toBeNull()
    expect(extractMarketMarginTotals({ stat: 'OK', date: '20260916' })).toBeNull()
    expect(extractMarketMarginTotals({ stat: 'OK', date: '2026-09-16', tables: clone().tables })).toBeNull()
  })

  it('returns null when the header layout changes', () => {
    const r = clone()
    r.tables![0].fields = ['項目', '買進', '賣出', '現金(券)償還', '今日餘額', '前日餘額']
    expect(extractMarketMarginTotals(r)).toBeNull()
  })

  it('returns null when a required row is missing', () => {
    const r = clone()
    r.tables![0].data = r.tables![0].data!.filter((row) => row[0] !== '融券(交易單位)')
    expect(extractMarketMarginTotals(r)).toBeNull()
  })

  it('tolerates whitespace in the first header and row labels', () => {
    const r = clone()
    r.tables![0].fields![0] = ' 項目 '
    r.tables![0].data![0][0] = ' 融資(交易單位) '
    expect(extractMarketMarginTotals(r)?.marginLots.today).toBe(9248877)
  })

  it('leaves change null when a value is not numeric', () => {
    const r = clone()
    r.tables![0].data![1][4] = '--'
    expect(extractMarketMarginTotals(r)?.shortLots).toEqual({ prev: null, today: 197048, change: null })
  })
})
