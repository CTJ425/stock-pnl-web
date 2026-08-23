// @vitest-environment jsdom
/**
 * End-to-end (jsdom) cover for the holding → 損益試算 prop chain.
 *
 * `AnalysisPage.test.tsx` mocks `StockDetailPage` away, so nothing verified that a held
 * ticker's cost basis actually reaches `WhatIfTab`. This file renders the real chain
 * against the reference position (0050, snapshot of the live data) and asserts the tab
 * seeds from the holding, not from the quote.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'

const {
  useWorkspace, useStockPrices, listWatchlist, fetchPrices,
  fetchStoredReport, generateReport, fetchDailySeries, fetchFundamental,
  warmStockCore, warmStockHistory, getFeeRate, getMinFee,
} = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
  listWatchlist: vi.fn(async (): Promise<Array<{ ticker: string; name: string; sortOrder: number }>> => []),
  fetchPrices: vi.fn(async (): Promise<Record<string, { price: number }>> => ({})),
  fetchStoredReport: vi.fn(async () => null),
  generateReport: vi.fn(async () => null),
  fetchDailySeries: vi.fn(async () => null),
  fetchFundamental: vi.fn(async () => null),
  // Must be a full WarmResult, not undefined: StockDetailPage's warm effect reads
  // `core.ok` / `core.fundamentalComplete` straight off the result, and the effect body is an
  // async IIFE with no catch — so `undefined` here throws and leaks an unhandled rejection
  // that fails the whole vitest run while every test still reports as passing.
  // `ok + fundamentalComplete` is the quiet no-op: core is done, history is never reached.
  warmStockCore: vi.fn(async () => ({
    ok: true, dailySynced: 0, fundamentalSynced: 0, fundamentalComplete: true, backfilled: 0, phase: 'core',
  })),
  warmStockHistory: vi.fn(async () => ({
    ok: true, dailySynced: 0, fundamentalSynced: 0, fundamentalComplete: true, backfilled: 0, phase: 'history',
  })),
  getFeeRate: vi.fn(() => 0.001425),
  getMinFee: vi.fn(() => 20),
}))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))
vi.mock('../../services/priceProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/priceProxy')>()),
  fetchPrices,
}))
vi.mock('../../services/watchlistService', () => ({
  WATCHLIST_MAX: 30, listWatchlist, addWatch: vi.fn(), removeWatch: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({ isReportConfigured: true, fetchStoredReport, generateReport }))
vi.mock('../../services/dailyProxy', () => ({ fetchDailySeries }))
vi.mock('../../services/fundamentalProxy', () => ({ fetchFundamental }))
vi.mock('../../services/warmStock', () => ({ warmStockCore, warmStockHistory }))
vi.mock('../../services/reportPdf', () => ({ generatePdfBlob: vi.fn(), downloadBlob: vi.fn() }))
vi.mock('../../utils/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/settings')>()),
  getFeeRate, getMinFee,
}))

import { AnalysisPage } from './AnalysisPage'
import { computeLedger } from '../../utils/pnlEngine'
import type { Transaction } from '../../types/models'

/** The live 0050 position: 9 transactions, ending at 4,000 shares. */
const RAW: Array<[string, 'BUY' | 'SELL', number, number, number]> = [
  ['2026-06-10', 'BUY', 102, 1000, 145],
  ['2026-06-10', 'BUY', 102.7, 1000, 146],
  ['2026-07-17', 'SELL', 102.9, 2000, 498],
  ['2026-07-20', 'BUY', 100.2, 2000, 285],
  ['2026-07-28', 'BUY', 98, 1000, 139],
  ['2026-07-31', 'SELL', 102.2, 3000, 742],
  ['2026-08-18', 'BUY', 105.1, 2000, 299],
  ['2026-08-19', 'BUY', 103.7, 1000, 147],
  ['2026-08-20', 'BUY', 103, 1000, 146],
]
const txs: Transaction[] = RAW.map(([tx_date, tx_type, price, qty, fee_tax], i) => ({
  id: `t${i}`, workspace_id: 'ws', tx_date, market: 'TPE', ticker: '0050',
  name: '元大台灣50', tx_type, price, qty, fee_tax,
  created_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
}))

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useWorkspace.mockReturnValue({
    ledger: computeLedger(txs),
    current: { id: 'ws', name: 'SNAP正式區' },
  })
  useStockPrices.mockReturnValue({
    prices: { 'TPE:0050': { price: 103.8, stale: false } },
    loading: false, refreshedAt: null, refresh: () => {},
  })
})

describe('個股分析 → 損益試算：持股成本要真的走到試算頁', () => {
  it('買進價帶持股均價 104.23，不是現價 103.80', async () => {
    render(<AnalysisPage />)
    fireEvent.click(await screen.findByRole('button', { name: '損益試算' }))

    await waitFor(() =>
      expect((screen.getByLabelText('買進價格') as HTMLInputElement).value).toBe('104.23'),
    )
    expect((screen.getByLabelText('賣出價格') as HTMLInputElement).value).toBe('103.8')
  })

  it('投入成本與損益與庫存總覽同一口徑', async () => {
    render(<AnalysisPage />)
    fireEvent.click(await screen.findByRole('button', { name: '損益試算' }))

    const num = (t: string) => Number((screen.getByTestId(t).textContent || '').replace(/[^\d.-]/g, ''))
    await waitFor(() => expect(num('whatif-cost')).toBe(417492))
    // 415,200 − 賣出手續費 591 − 證交稅 415 − 417,492
    expect(num('whatif-pnl')).toBe(-3298)
  })
})
