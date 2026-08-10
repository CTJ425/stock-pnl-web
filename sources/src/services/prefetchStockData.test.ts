import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fundamentalProxy', () => ({
  fetchFundamental: vi.fn(),
}))
vi.mock('./warmStock', () => ({
  warmStock: vi.fn(),
}))

import { fetchFundamental } from './fundamentalProxy'
import { warmStock } from './warmStock'
import { prefetchStockData } from './prefetchStockData'

const fetchMock = vi.mocked(fetchFundamental)
const warmMock = vi.mocked(warmStock)

describe('prefetchStockData', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    warmMock.mockReset()
    warmMock.mockResolvedValue({
      ok: true,
      dailySynced: 1,
      fundamentalSynced: 1,
      fundamentalComplete: true,
      backfilled: 0,
    })
  })

  it('warms when Storage has no fundamental file', async () => {
    fetchMock.mockResolvedValue(null)
    await prefetchStockData('2059', '川湖')
    expect(warmMock).toHaveBeenCalledWith('2059', '川湖')
  })

  it('skips warm when file is already thick enough', async () => {
    fetchMock.mockResolvedValue({
      ticker: '2330',
      asOf: 'x',
      dataDate: '2026-08-01',
      industry: null,
      valuation: null,
      revenueUnit: '千元',
      notes: [],
      revenueMonths: Array.from({ length: 8 }, (_, i) => ({
        yearMonth: `2026-${String(i + 1).padStart(2, '0')}`,
        revenueThousandTwd: 1,
        momPercent: null,
        yoyPercent: null,
        cumulativeYoyPercent: null,
      })),
      profitQuarters: [
        {
          yearQuarter: '2026-Q1',
          revenueMillionTwd: 1,
          grossMarginPercent: 1,
          operatingMarginPercent: 1,
          pretaxMarginPercent: 1,
          netMarginPercent: 1,
          epsTwd: null,
        },
      ],
    })
    await prefetchStockData('2330', '台積電')
    expect(warmMock).not.toHaveBeenCalled()
  })

  it('ignores empty ticker', async () => {
    await prefetchStockData('  ')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warmMock).not.toHaveBeenCalled()
  })
})
