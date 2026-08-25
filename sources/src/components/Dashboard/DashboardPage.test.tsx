// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'
import { computeLedger } from '../../utils/pnlEngine'
import { DashboardPage } from './DashboardPage'

const { useWorkspace, useStockPrices } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
}))

vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))
vi.mock('./WatchSection', () => ({
  WatchSection: () => <div data-testid="watch-section" />,
}))

const TXS: Transaction[] = [
  {
    id: 'tx1',
    workspace_id: 'ws-1',
    tx_date: '2026-08-01',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 950,
    qty: 1000,
    fee_tax: 1425,
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'tx2',
    workspace_id: 'ws-1',
    tx_date: '2026-08-01',
    market: 'US',
    ticker: 'AAPL',
    name: 'Apple Inc',
    tx_type: 'BUY',
    price: 200,
    qty: 10,
    fee_tax: 0,
    created_at: '2026-08-01T00:00:00Z',
  },
]

function mockWorkspace(txs: Transaction[] = TXS) {
  useWorkspace.mockReturnValue({
    ledger: computeLedger(txs),
    current: { id: 'ws-1', name: '主要工作區' },
    loading: false,
    error: null,
  })
  useStockPrices.mockReturnValue({
    prices: {
      'TPE:2330': { price: 1000, prevClose: 980, asOf: '', source: 'twse', stale: false, trial: false },
      'US:AAPL': { price: 220, prevClose: 215, asOf: '', source: 'finnhub', stale: false, trial: false },
    },
    loading: false,
    refreshedAt: new Date('2026-08-25T10:00:00Z'),
    refresh: vi.fn(),
  })
}

describe('DashboardPage', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockWorkspace()
  })

  it('點擊台股持股列會觸發 onSelectTicker 並帶入代號與名稱', async () => {
    const user = userEvent.setup()
    const onSelectTicker = vi.fn()

    render(<DashboardPage onSelectTicker={onSelectTicker} />)

    const twRow = screen.getByTestId('holding-row-2330')
    expect(twRow).toBeTruthy()
    expect(twRow.getAttribute('style')).toContain('cursor: pointer')
    expect(twRow.getAttribute('title')).toBe('點擊查看個股分析')

    await user.click(twRow)
    expect(onSelectTicker).toHaveBeenCalledTimes(1)
    expect(onSelectTicker).toHaveBeenCalledWith('2330', '台積電')
  })

  it('美股持股列不提供點擊跳轉個股分析', async () => {
    const user = userEvent.setup()
    const onSelectTicker = vi.fn()

    render(<DashboardPage onSelectTicker={onSelectTicker} />)

    const usRow = screen.getByTestId('holding-row-AAPL')
    expect(usRow).toBeTruthy()
    expect(usRow.getAttribute('style') ?? '').not.toContain('cursor: pointer')
    expect(usRow.getAttribute('title')).toBeNull()

    await user.click(usRow)
    expect(onSelectTicker).not.toHaveBeenCalled()
  })

  it('未提供 onSelectTicker 時（例如本機離線模式），台股列維持不可點擊狀態', async () => {
    const user = userEvent.setup()

    render(<DashboardPage />)

    const twRow = screen.getByTestId('holding-row-2330')
    expect(twRow.getAttribute('style') ?? '').not.toContain('cursor: pointer')
    expect(twRow.getAttribute('title')).toBeNull()

    // Clicking won't throw errors
    await user.click(twRow)
  })

  it('無持股時顯示空狀態提示', () => {
    mockWorkspace([])
    render(<DashboardPage />)
    expect(screen.getByText(/目前沒有持股/)).toBeTruthy()
  })
})
