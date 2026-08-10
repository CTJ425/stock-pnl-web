import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./reportsBucket', () => ({
  downloadReportsJson: vi.fn(),
}))
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
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

  it('returns null when missing and ensure fails', async () => {
    download.mockResolvedValue(null)
    invoke.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await fetchTopTickers()).toBeNull()
  })

  it('falls back to ensure-top-tickers when Storage empty', async () => {
    download.mockResolvedValue(null)
    invoke.mockResolvedValue({
      data: {
        ok: true,
        refreshed: true,
        file: {
          schema: 2,
          days: [
            {
              ymd: '20260807',
              sourceDate: '1150804',
              asOf: 'z',
              tickers: [{ ticker: '2330', name: '台積電', rank: 1, tradeValue: 1 }],
            },
          ],
        },
      },
      error: null,
    })
    const d = await fetchTopTickers()
    expect(d?.latest?.tickers[0]?.ticker).toBe('2330')
    expect(d?.fromEnsure).toBe(true)
    expect(invoke).toHaveBeenCalledWith('stock-report', {
      body: { action: 'ensure-top-tickers' },
    })
  })
})
