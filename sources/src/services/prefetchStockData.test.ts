import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fundamentalProxy', () => ({
  fetchFundamental: vi.fn(),
}))
vi.mock('./warmStock', () => ({
  warmStock: vi.fn(),
  warmStockHistory: vi.fn(),
}))

import { fetchFundamental } from './fundamentalProxy'
import { warmStock, warmStockHistory } from './warmStock'
import { prefetchStockData } from './prefetchStockData'

const fetchMock = vi.mocked(fetchFundamental)
const warmMock = vi.mocked(warmStock)
const histMock = vi.mocked(warmStockHistory)

const thickEnough = {
  ticker: '2330',
  asOf: 'x',
  dataDate: '2026-08-01',
  industry: null as string | null,
  valuation: null,
  revenueUnit: '千元' as const,
  notes: [] as string[],
  revenueMonths: Array.from({ length: 8 }, (_, i) => ({
    yearMonth: `2026-${String(i + 1).padStart(2, '0')}`,
    revenueThousandTwd: 1,
    momPercent: null,
    yoyPercent: null,
    cumulativeYoyPercent: null,
  })),
  profitQuarters: Array.from({ length: 6 }, (_, i) => ({
    yearQuarter: `2024-Q${(i % 4) + 1}`,
    revenueMillionTwd: 1,
    grossMarginPercent: 1,
    operatingMarginPercent: 1,
    pretaxMarginPercent: 1,
    netMarginPercent: 1,
    epsTwd: null,
  })),
}

describe('prefetchStockData', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    warmMock.mockReset()
    histMock.mockReset()
    warmMock.mockResolvedValue({
      ok: true,
      dailySynced: 1,
      fundamentalSynced: 1,
      fundamentalComplete: true,
      backfilled: 0,
    })
    histMock.mockResolvedValue({
      ok: true,
      dailySynced: 0,
      fundamentalSynced: 0,
      fundamentalComplete: true,
      backfilled: 4,
      phase: 'history',
    })
  })

  it('warms full progressive when Storage has no fundamental file', async () => {
    fetchMock.mockResolvedValue(null)
    await prefetchStockData('2059', '川湖')
    expect(warmMock).toHaveBeenCalledWith('2059', '川湖')
    expect(histMock).not.toHaveBeenCalled()
  })

  it('history-only when months full but quarters under soft min (no core quota)', async () => {
    fetchMock.mockResolvedValue({
      ...thickEnough,
      revenueMonths: Array.from({ length: 12 }, (_, i) => ({
        yearMonth: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
        revenueThousandTwd: 1,
        momPercent: null,
        yoyPercent: null,
        cumulativeYoyPercent: null,
      })),
      profitQuarters: thickEnough.profitQuarters.slice(0, 2),
    })
    await prefetchStockData('2330', '台積電')
    expect(warmMock).not.toHaveBeenCalled()
    expect(histMock).toHaveBeenCalledWith('2330', '台積電')
  })

  it('skips warm when file is already thick enough', async () => {
    fetchMock.mockResolvedValue(thickEnough)
    await prefetchStockData('2330', '台積電')
    expect(warmMock).not.toHaveBeenCalled()
    expect(histMock).not.toHaveBeenCalled()
  })

  it('ignores empty ticker', async () => {
    await prefetchStockData('  ')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warmMock).not.toHaveBeenCalled()
  })
})
