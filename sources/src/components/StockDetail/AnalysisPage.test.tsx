// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./StockDetailPage', () => ({
  StockDetailPage: ({
    ticker,
    name,
    holding,
    quote,
    selector,
  }: {
    ticker: string
    name: string
    holding: { qty: number; price: number | null } | null
    quote?: { price: number | null } | null
    selector?: React.ReactNode
  }) => (
    <div>
      {selector}
      <div data-testid="detail-ticker">{ticker}</div>
      <div data-testid="detail-name">{name}</div>
      <div data-testid="detail-qty">{holding?.qty ?? '—'}</div>
      <div data-testid="detail-price">{holding?.price ?? '—'}</div>
      <div data-testid="detail-quote">{quote?.price ?? '—'}</div>
    </div>
  ),
}))

const { useWorkspace, useStockPrices, listWatchlist, fetchPrices } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
  // Annotated so `mockResolvedValue` accepts items — a bare `async () => []` infers never[].
  listWatchlist: vi.fn(
    async (): Promise<Array<{ ticker: string; name: string; sortOrder: number }>> => [],
  ),
  fetchPrices: vi.fn(async (): Promise<Record<string, { price: number }>> => ({})),
}))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))
// Partial: other modules still need priceProxy's real helpers (tradeDateLabel, isClosed…).
vi.mock('../../services/priceProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/priceProxy')>()),
  fetchPrices,
}))
vi.mock('../../services/watchlistService', () => ({
  WATCHLIST_MAX: 30,
  listWatchlist,
  addWatch: vi.fn(),
  removeWatch: vi.fn(),
}))
vi.mock('./WatchlistPanel', () => ({
  WatchlistPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="watchlist-panel">
      <button type="button" onClick={onClose}>
        關閉
      </button>
    </div>
  ),
}))

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
    listWatchlist.mockReset()
    listWatchlist.mockResolvedValue([])
    fetchPrices.mockReset()
    fetchPrices.mockResolvedValue({})
  })

  it('不顯示搜尋個股／TOP20 分頁（0.7.0）', () => {
    setup(TW_AND_US)
    render(<AnalysisPage />)
    expect(screen.queryByRole('tab', { name: '搜尋個股' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'TOP20' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '我的持股' })).toBeNull()
  })

  it('個股選單只列台股持股，美股不入選單', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    render(<AnalysisPage />)
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    const items = within(screen.getByRole('menu', { name: '個股清單' })).getAllByRole(
      'menuitemradio',
    )
    expect(items.map((o) => o.textContent)).toEqual(['1802 台玻', '2330 台積電'])
    expect(items.some((o) => o.textContent?.includes('AAPL'))).toBe(false)
  })

  it('觸發鈕顯示目前這一檔，選單以 menuitemradio 標示選中項', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    render(<AnalysisPage />)
    const trigger = screen.getByRole('button', { name: /切換個股/ })
    expect(trigger.textContent).toContain('1802 台玻')
    await user.click(trigger)
    const checked = within(screen.getByRole('menu', { name: '個股清單' }))
      .getAllByRole('menuitemradio')
      .filter((b) => b.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toBe('1802 台玻')
  })

  it('選完自己關閉選單', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    render(<AnalysisPage />)
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    expect(screen.queryByRole('menu', { name: '個股清單' })).toBeTruthy()
    await user.click(screen.getByRole('menuitemradio', { name: '2330 台積電' }))
    expect(screen.queryByRole('menu', { name: '個股清單' })).toBeNull()
  })

  it('預設選第一檔（ledger 已排序：台股在前、代號升序）', () => {
    setup(TW_AND_US)
    render(<AnalysisPage />)
    expect(screen.getByTestId('detail-ticker').textContent).toBe('1802')
  })

  it('切換個股會換掉分析內容與帶入的持股', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US, {
      'TPE:1802': { price: 51, stale: false },
      'TPE:2330': { price: 2350, stale: false },
    })
    render(<AnalysisPage />)
    expect(screen.getByTestId('detail-price').textContent).toBe('51')

    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    await user.click(screen.getByRole('menuitemradio', { name: '2330 台積電' }))
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
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    await user.click(screen.getByRole('menuitemradio', { name: '2330 台積電' }))
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2330')

    setup([...TW_AND_US, tx({ ticker: '2330', tx_type: 'SELL', qty: 1000, price: 120 })])
    rerender(<AnalysisPage />)
    expect(screen.getByTestId('detail-ticker').textContent).toBe('1802')
  })

  it('沒有台股持股時顯示空狀態', () => {
    setup([tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.' })])
    render(<AnalysisPage />)
    expect(screen.getByText(/目前沒有台股持股/)).toBeTruthy()
    expect(screen.queryByTestId('detail-ticker')).toBeNull()
  })

  it('下拉分成持股與觀察兩組，觀察組排在持股之後', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([
      { ticker: '2059', name: '川湖', sortOrder: 0 },
      { ticker: '6770', name: '力積電', sortOrder: 1 },
    ])
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))

    const menu = within(screen.getByRole('menu', { name: '個股清單' }))
    expect(menu.getByText('持股')).toBeTruthy()
    expect(menu.getByText('觀察')).toBeTruthy()
    expect(menu.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([
      '1802 台玻',
      '2330 台積電',
      '2059 川湖',
      '6770 力積電',
    ])
  })

  it('觀察清單為空時不顯示觀察組標題', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    render(<AnalysisPage />)
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    expect(within(screen.getByRole('menu', { name: '個股清單' })).queryByText('觀察')).toBeNull()
  })

  it('選觀察股時帶 ticker 但不帶持股', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '2059 川湖' }))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('2059')
    expect(screen.getByTestId('detail-name').textContent).toBe('川湖')
    // 非持股：沒有股數、沒有成本
    expect(screen.getByTestId('detail-qty').textContent).toBe('—')
  })

  it('選觀察股會自己抓報價（持股是由 useStockPrices 帶進來的，觀察股沒有）', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    fetchPrices.mockResolvedValue({ 'TPE:2059': { price: 987 } })
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '2059 川湖' }))

    expect(fetchPrices).toHaveBeenCalledWith([{ market: 'TPE', ticker: '2059' }])
    expect(await screen.findByText('987')).toBeTruthy()
    expect(screen.getByTestId('detail-quote').textContent).toBe('987')
  })

  it('觀察股抓不到報價時不炸，也不會卡住畫面', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    fetchPrices.mockRejectedValue(new Error('offline'))
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '2059 川湖' }))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('2059')
    expect(screen.getByTestId('detail-quote').textContent).toBe('—')
  })

  it('沒有台股持股但有觀察股時，直接分析第一檔觀察股而不是顯示空狀態', async () => {
    setup([tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.' })])
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    render(<AnalysisPage />)

    expect(await screen.findByTestId('detail-ticker')).toBeTruthy()
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2059')
    expect(screen.queryByText(/目前沒有台股持股/)).toBeNull()
  })

  it('持股與觀察都沒有時才顯示空狀態，且就地提供加入觀察的入口', async () => {
    setup([tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.' })])
    render(<AnalysisPage />)

    const empty = await screen.findByText(/目前沒有台股持股/)
    expect(empty.closest('.empty-state')?.textContent).toMatch(/觀察標的/)
    expect(screen.getByRole('button', { name: '管理觀察' })).toBeTruthy()
    expect(screen.queryByTestId('detail-ticker')).toBeNull()
  })

  it('管理觀察按鈕開關面板', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    render(<AnalysisPage />)

    expect(screen.queryByTestId('watchlist-panel')).toBeNull()
    await user.click(screen.getByRole('button', { name: '管理觀察' }))
    expect(screen.getByTestId('watchlist-panel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '關閉' }))
    expect(screen.queryByTestId('watchlist-panel')).toBeNull()
  })

  it('同時持有又在觀察的代號只出現一次，且留在持股組', async () => {
    // The holding entry carries qty / cost / quote; the watch entry carries none of it.
    // Showing both would offer the user two rows for one stock, one of them strictly worse.
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([
      { ticker: '2330', name: '台積電', sortOrder: 0 },
      { ticker: '2059', name: '川湖', sortOrder: 1 },
    ])
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))

    const menu = within(screen.getByRole('menu', { name: '個股清單' }))
    expect(menu.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([
      '1802 台玻',
      '2330 台積電',
      '2059 川湖',
    ])
  })
})
