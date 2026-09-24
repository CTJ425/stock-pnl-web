// @vitest-environment jsdom
/**
 * Contract: an async effect must never strand its loading flag when the work it awaits rejects.
 *
 * The effect under test is an async IIFE inside `useEffect` with no `catch`. Today it only
 * survive because every service they call swallows its own failures and returns a sentinel
 * (`fetchFundamental` -> `downloadReportsJson`, `warmStockCore` -> `invokeWarm` both do). That safety is implicit and one refactor away from gone:
 * the moment any of them propagates, the IIFE rejects, the trailing `setXLoading(false)` never
 * runs, and the panel spins forever with nothing on screen saying why. On StockDetailPage it also
 * leaves the 「重新整理」button permanently disabled, because that button is disabled on `fundLoading`.
 *
 * These tests force that rejection so the guard is real rather than accidental.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const {
  fetchStoredReport, generateReport, fetchDailySeries, fetchFundamental,
  warmStockCore, warmStockHistory,
} = vi.hoisted(() => ({
  fetchStoredReport: vi.fn(),
  generateReport: vi.fn(),
  fetchDailySeries: vi.fn(),
  fetchFundamental: vi.fn(),
  warmStockCore: vi.fn(),
  warmStockHistory: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true, fetchStoredReport, generateReport,
}))
vi.mock('../../services/dailyProxy', () => ({
  fetchDailySeries,
  // useDailySeries 的第三層後援（0.9.43）；這些測試不走遠端路徑，回 null 即可。
  fetchRemoteDaily: async () => null,
}))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))
vi.mock('../../services/warmStock', () => ({ warmStockCore, warmStockHistory }))
vi.mock('../../services/downloadBlob', () => ({ downloadBlob: vi.fn() }))

import { StockDetailPage } from './StockDetailPage'

const WARM_OK = {
  ok: true, dailySynced: 0, fundamentalSynced: 0, fundamentalComplete: true, backfilled: 0,
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  fetchStoredReport.mockResolvedValue(null)
  generateReport.mockResolvedValue(null)
  fetchDailySeries.mockResolvedValue(null)
  warmStockCore.mockResolvedValue({ ...WARM_OK, phase: 'core' })
  warmStockHistory.mockResolvedValue({ ...WARM_OK, phase: 'history' })
})

describe('async effects must not strand their loading flag', () => {
  it('StockDetailPage: fetchFundamental rejecting still ends the fundamental load', async () => {
    fetchFundamental.mockRejectedValue(new Error('network down'))

    render(<StockDetailPage ticker="2330" name="台積電" holding={null} quote={null} />)

    // The refresh button is disabled while fundLoading is true. If the effect dies without
    // clearing the flag, this button never comes back and the panel spins forever.
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /重新整理/ }) as HTMLButtonElement
      expect(btn.disabled).toBe(false)
    })
    expect(screen.queryByText('正在讀取基本面…')).toBeNull()
  })

})
