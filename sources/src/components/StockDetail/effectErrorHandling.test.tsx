// @vitest-environment jsdom
/**
 * Contract: an async effect must never strand its loading flag when the work it awaits rejects.
 *
 * Both effects under test are async IIFEs inside `useEffect` with no `catch`. Today they only
 * survive because every service they call swallows its own failures and returns a sentinel
 * (`fetchFundamental` -> `downloadReportsJson`, `warmStockCore` -> `invokeWarm`, `loadAiSettings`,
 * `isAiAdmin`, `loadAiPrompts` all do). That safety is implicit and one refactor away from gone:
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
  loadAiSettings, isAiAdmin, loadAiPrompts,
} = vi.hoisted(() => ({
  fetchStoredReport: vi.fn(),
  generateReport: vi.fn(),
  fetchDailySeries: vi.fn(),
  fetchFundamental: vi.fn(),
  warmStockCore: vi.fn(),
  warmStockHistory: vi.fn(),
  loadAiSettings: vi.fn(),
  isAiAdmin: vi.fn(),
  loadAiPrompts: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true, fetchStoredReport, generateReport,
}))
vi.mock('../../services/dailyProxy', () => ({ fetchDailySeries }))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))
vi.mock('../../services/warmStock', () => ({ warmStockCore, warmStockHistory }))
vi.mock('../../services/reportPdf', () => ({ generatePdfBlob: vi.fn(), downloadBlob: vi.fn() }))
vi.mock('../../services/aiSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/aiSettings')>()),
  loadAiSettings, isAiAdmin,
}))
vi.mock('../../services/aiPrompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/aiPrompts')>()),
  loadAiPrompts,
}))

import { StockDetailPage } from './StockDetailPage'
import { AiTab } from './AiTab'

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
  loadAiSettings.mockResolvedValue(null)
  isAiAdmin.mockResolvedValue(false)
  loadAiPrompts.mockResolvedValue({ analysis: '', chat: '' })
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

  it('AiTab: loadAiSettings rejecting still ends the settings load', async () => {
    loadAiSettings.mockRejectedValue(new Error('network down'))

    render(<AiTab ticker="2330" name="台積電" report={null} fundamental={null} />)

    await waitFor(() => {
      expect(screen.queryByText('正在載入 AI 設定…')).toBeNull()
    })
  })
})
