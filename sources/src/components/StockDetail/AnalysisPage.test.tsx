// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
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

const {
  useWorkspace,
  useStockPrices,
  searchStocks,
  fetchPrices,
  loadWatchlist,
  saveWatchlist,
  prefetchStockData,
} = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
  useStockPrices: vi.fn(),
  searchStocks: vi.fn(),
  fetchPrices: vi.fn(),
  loadWatchlist: vi.fn(),
  saveWatchlist: vi.fn(),
  prefetchStockData: vi.fn(),
}))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../hooks/useStockPrices', () => ({ useStockPrices }))
vi.mock('../../services/stockSearch', () => ({ searchStocks }))
vi.mock('../../services/prefetchStockData', () => ({ prefetchStockData }))
vi.mock('../../services/twWatchlist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/twWatchlist')>()
  return { ...actual, loadWatchlist, saveWatchlist }
})
vi.mock('../../services/priceProxy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/priceProxy')>()
  return { ...actual, fetchPrices }
})

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
    searchStocks.mockReset()
    fetchPrices.mockReset()
    loadWatchlist.mockReset()
    saveWatchlist.mockReset()
    prefetchStockData.mockReset()
    searchStocks.mockResolvedValue([])
    fetchPrices.mockResolvedValue({})
    loadWatchlist.mockResolvedValue([])
    saveWatchlist.mockResolvedValue({ ok: true })
    prefetchStockData.mockResolvedValue(undefined)
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('有二次分頁：我的持股 / 其他台股', () => {
    setup(TW_AND_US)
    render(<AnalysisPage />)
    expect(screen.getByRole('tab', { name: '我的持股' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '其他台股' })).toBeTruthy()
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

  it('沒有台股持股時持股分頁顯示空狀態，可切到其他台股', async () => {
    const user = userEvent.setup()
    setup([tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.' })])
    render(<AnalysisPage />)
    expect(screen.getByText(/目前沒有台股持股/)).toBeTruthy()
    expect(screen.queryByTestId('detail-ticker')).toBeNull()
    await user.click(screen.getByRole('button', { name: '前往其他台股' }))
    expect(screen.getByLabelText('查詢其他台股')).toBeTruthy()
  })

  it('其他台股：搜尋加入觀察後進入分析且不帶持股', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(TW_AND_US)
    searchStocks.mockResolvedValue([
      { symbol: '2303', name: '聯電', market: 'TPE' },
      { symbol: 'AAPL', name: 'Apple', market: 'US' },
    ])
    fetchPrices.mockResolvedValue({ 'TPE:2303': { price: 55, stale: false } })

    render(<AnalysisPage />)
    await user.click(screen.getByRole('tab', { name: '其他台股' }))
    await user.type(screen.getByLabelText('查詢其他台股'), '2303')
    await vi.advanceTimersByTimeAsync(350)

    expect(await screen.findByRole('option', { name: /2303 聯電/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /AAPL/ })).toBeNull()

    await user.click(screen.getByRole('option', { name: /2303 聯電/ }))
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2303')
    expect(screen.getByTestId('detail-name').textContent).toBe('聯電')
    expect(screen.getByTestId('detail-qty').textContent).toBe('—')
    expect(saveWatchlist).toHaveBeenCalled()
    expect(prefetchStockData).toHaveBeenCalledWith('2303', '聯電')

    await waitFor(() => expect(screen.getByTestId('detail-quote').textContent).toBe('55'))
    expect(fetchPrices).toHaveBeenCalledWith([{ market: 'TPE', ticker: '2303' }])
  })

  it('其他台股：搜尋自己已持有的代號改走持股分頁', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    setup(TW_AND_US, {
      'TPE:1802': { price: 51, stale: false },
      'TPE:2330': { price: 2350, stale: false },
    })
    searchStocks.mockResolvedValue([{ symbol: '2330', name: '台積電', market: 'TPE' }])

    render(<AnalysisPage />)
    await user.click(screen.getByRole('tab', { name: '其他台股' }))
    await user.type(screen.getByLabelText('查詢其他台股'), '2330')
    await vi.advanceTimersByTimeAsync(350)
    await user.click(await screen.findByRole('option', { name: /2330 台積電/ }))

    expect(screen.getByRole('tab', { name: '我的持股' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2330')
    expect(screen.getByTestId('detail-qty').textContent).toBe('1000')
    expect(fetchPrices).not.toHaveBeenCalled()
  })

  it('賣光後觀察清單會剔除該代號（不佔 5 格）', async () => {
    loadWatchlist.mockResolvedValue([{ ticker: '1802', name: '台玻' }])
    // Start with only US so 1802 is not held → watchlist keeps 1802; then add holding? 
    // Actually rule is: if held, prune. Start with 1802 held and on watchlist → should prune.
    setup(TW_AND_US)
    render(<AnalysisPage />)
    await waitFor(() => expect(saveWatchlist).toHaveBeenCalled())
    const saved = saveWatchlist.mock.calls.at(-1)?.[0] as { ticker: string }[]
    expect(saved.every((i) => i.ticker !== '1802')).toBe(true)
  })
})
