import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./reportsBucket', () => ({
  downloadReportsJson: vi.fn(),
}))

import { downloadReportsJson } from './reportsBucket'
import { fetchTopTickers, formatTopYmd, formatTradeValueYi } from './topTickersProxy'

const download = vi.mocked(downloadReportsJson)

describe('formatTopYmd / formatTradeValueYi', () => {
  it('formats ymd and 億', () => {
    expect(formatTopYmd('20260807')).toBe('2026-08-07')
    expect(formatTradeValueYi(57_947_015_347)).toMatch(/億/)
  })
})

describe('fetchTopTickers', () => {
  beforeEach(() => download.mockReset())

  it('reads schema 2 days (newest first, max 2)', async () => {
    download.mockResolvedValue({
      schema: 2,
      days: [
        {
          ymd: '20260810',
          sourceDate: '1150807',
          asOf: 'x',
          tickers: [{ ticker: '2330', name: '台積電', rank: 1, tradeValue: 1 }],
        },
        {
          ymd: '20260807',
          sourceDate: '1150804',
          asOf: 'y',
          tickers: [{ ticker: '2317', name: '鴻海', rank: 1, tradeValue: 2 }],
        },
      ],
    })
    const d = await fetchTopTickers()
    expect(d?.days).toHaveLength(2)
    expect(d?.latest?.tickers[0]?.ticker).toBe('2330')
  })

  it('returns null when missing', async () => {
    download.mockResolvedValue(null)
    expect(await fetchTopTickers()).toBeNull()
  })
})
