// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 只驗容器的選取邏輯，內容區以 stub 取代（籌碼本身另有 StockDetailPage.test.tsx）
vi.mock('./StockDetailPage', () => ({
  StockDetailPage: ({
    ticker,
    name,
    holding,
    selector,
  }: {
    ticker: string
    name: string
    holding: { qty: number; price: number | null } | null
    selector?: React.ReactNode
  }) => (
    <div>
      {selector}
      <div data-testid="detail-ticker">{ticker}</div>
      <div data-testid="detail-name">{name}</div>
      <div data-testid="detail-qty">{holding?.qty ?? '—'}</div>
      <div data-testid="detail-price">{holding?.price ?? '—'}</div>
    </div>
  ),
}))

const { useWorkspace, useStockPrices } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
}))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))

import { AnalysisPage } from './AnalysisPage'
import { computeLedger } from '../../utils/pnlEngine'
import type { Transaction } from '../../types/models'

let seq = 0
function tx(p: Partial<Transaction>): Transaction {
  seq += 1
  return {
    id: `t${seq}`,
    workspace_id: 'ws',
    tx_date: '2026-03-02',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 100,
    qty: 1000,
    fee_tax: 20,
    created_at: '2026-03-02T01:00:00.000Z',
    ...p,
  }
}

function setup(txs: Transaction[], prices: Record<string, { price: number; stale: boolean }> = {}) {
  useWorkspace.mockReturnValue({ ledger: computeLedger(txs), current: { id: 'ws', name: '主帳戶' } })
  useStockPrices.mockReturnValue({ prices, loading: false, refreshedAt: null, refresh: () => {} })
}

const TW_AND_US = [
  tx({ ticker: '2330', name: '台積電' }),
  tx({ ticker: '1802', name: '台玻' }),
  tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.', price: 200, qty: 10 }),
]

describe('AnalysisPage', () => {
  beforeEach(() => {
    cleanup()
    useWorkspace.mockReset()
    useStockPrices.mockReset()
  })

  it('下拉選單只列台股持股，美股不入選單', () => {
    setup(TW_AND_US)
    render(<AnalysisPage />)
    const options = within(screen.getByRole('combobox')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['1802 台玻', '2330 台積電'])
    expect(options.some((o) => o.textContent?.includes('AAPL'))).toBe(false)
  })

  it('預設選第一檔（ledger 已排序：台股在前、代號升序）', () => {
    setup(TW_AND_US)
    render(<AnalysisPage />)
    expect(screen.getByTestId('detail-ticker').textContent).toBe('1802')
  })

  it('切換下拉會換掉分析內容與帶入的持股', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US, {
      'TPE:1802': { price: 51, stale: false },
      'TPE:2330': { price: 2350, stale: false },
    })
    render(<AnalysisPage />)
    expect(screen.getByTestId('detail-price').textContent).toBe('51')

    await user.selectOptions(screen.getByRole('combobox'), 'TPE:2330')
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2330')
    expect(screen.getByTestId('detail-name').textContent).toBe('台積電')
    expect(screen.getByTestId('detail-price').textContent).toBe('2350')
  })

  it('帶入的持股股數來自 ledger（與庫存總覽同一份計算）', () => {
    setup([tx({ ticker: '2330', qty: 3000 })], { 'TPE:2330': { price: 100, stale: false } })
    render(<AnalysisPage />)
    expect(screen.getByTestId('detail-qty').textContent).toBe('3000')
  })

  it('選中的代號賣光後自動回退到第一檔，不會空白', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    const { rerender } = render(<AnalysisPage />)
    await user.selectOptions(screen.getByRole('combobox'), 'TPE:2330')
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2330')

    // 2330 全數賣出 → 不再是持股
    setup([...TW_AND_US, tx({ ticker: '2330', tx_type: 'SELL', qty: 1000, price: 120 })])
    rerender(<AnalysisPage />)
    expect(screen.getByTestId('detail-ticker').textContent).toBe('1802')
  })

  it('沒有台股持股時顯示空狀態，不渲染分析內容', () => {
    setup([tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.' })])
    render(<AnalysisPage />)
    expect(screen.getByText(/目前沒有台股持股/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByTestId('detail-ticker')).toBeNull()
  })

  it('完全沒有持股時同樣顯示空狀態', () => {
    setup([])
    render(<AnalysisPage />)
    expect(screen.getByText(/目前沒有台股持股/)).toBeTruthy()
  })
})
