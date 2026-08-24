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
    onSelectTicker,
    onWatchlistChanged,
  }: {
    ticker: string
    name: string
    holding: { qty: number; price: number | null } | null
    quote?: { price: number | null } | null
    selector?: React.ReactNode
    onSelectTicker?: (ticker: string, name: string) => void
    onWatchlistChanged?: () => void
  }) => (
    <div>
      {selector}
      <button type="button" data-testid="pick-watch" onClick={() => onSelectTicker?.('2059', '川湖')}>
        從觀察頁籤選 2059
      </button>
      <button type="button" data-testid="pick-new-watch" onClick={() => onSelectTicker?.('1101', '台泥')}>
        從觀察頁籤選一檔剛加入的
      </button>
      <button type="button" data-testid="pick-held-watch" onClick={() => onSelectTicker?.('2330', '台積電')}>
        從觀察頁籤選一檔同時也持有的
      </button>
      <button type="button" data-testid="fire-watch-changed" onClick={() => onWatchlistChanged?.()}>
        通知觀察清單有變動
      </button>
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

  it('下拉分組列出持股與觀察，持股在前', async () => {
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

  it('同一檔同時在持股與觀察名單時，選單只出現一次且算持股', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US, { 'TPE:2330': { price: 2350, stale: false } })
    listWatchlist.mockResolvedValue([{ ticker: '2330', name: '台積電', sortOrder: 0 }])
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))

    const menu = within(screen.getByRole('menu', { name: '個股清單' }))
    // 觀察分組整組消失：唯一的觀察標的已經是持股了
    expect(menu.queryByText('觀察')).toBeNull()
    expect(menu.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([
      '1802 台玻',
      '2330 台積電',
    ])

    await user.click(menu.getByRole('menuitemradio', { name: '2330 台積電' }))
    // 走持股那條路徑才有股數與 useStockPrices 的報價
    expect(screen.getByTestId('detail-qty').textContent).toBe('1000')
    expect(screen.getByTestId('detail-price').textContent).toBe('2350')
  })

  it('從選單點觀察股，頁面換成那一檔且不帶持股', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    fetchPrices.mockResolvedValue({ 'TPE:2059': { price: 987 } })
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })
    await user.click(screen.getByRole('button', { name: /切換個股/ }))
    await user.click(screen.getByRole('menuitemradio', { name: '2059 川湖' }))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('2059')
    expect(screen.getByTestId('detail-name').textContent).toBe('川湖')
    expect(screen.getByTestId('detail-qty').textContent).toBe('—')
    expect(await screen.findByTestId('detail-quote')).toBeTruthy()
    expect(screen.getByTestId('detail-quote').textContent).toBe('987')
    expect(fetchPrices).toHaveBeenCalledWith([{ market: 'TPE', ticker: '2059' }])
  })

  it('觀察股票頁籤選一檔後，頁面換成那一檔且不帶持股', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    fetchPrices.mockResolvedValue({ 'TPE:2059': { price: 987 } })
    render(<AnalysisPage />)
    await screen.findByTestId('detail-ticker')

    await user.click(screen.getByTestId('pick-watch'))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('2059')
    expect(screen.getByTestId('detail-name').textContent).toBe('川湖')
    expect(screen.getByTestId('detail-qty').textContent).toBe('—')
    expect(await screen.findByTestId('detail-quote')).toBeTruthy()
    expect(screen.getByTestId('detail-quote').textContent).toBe('987')
    expect(fetchPrices).toHaveBeenCalledWith([{ market: 'TPE', ticker: '2059' }])
  })

  it('觀察股抓不到報價時不炸，也不會卡住畫面', async () => {
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    fetchPrices.mockRejectedValue(new Error('offline'))
    render(<AnalysisPage />)
    await screen.findByTestId('detail-ticker')

    await user.click(screen.getByTestId('pick-watch'))

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

  it('持股與觀察都沒有時，空狀態自帶加入觀察入口（否則新使用者無路可走）', async () => {
    setup([tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.' })])
    render(<AnalysisPage />)

    await screen.findByText(/目前沒有台股持股/)
    expect(screen.getByRole('button', { name: /加入觀察/ })).toBeTruthy()
    expect(screen.queryByTestId('detail-ticker')).toBeNull()
  })

  it('不再有管理觀察按鈕', async () => {
    setup(TW_AND_US)
    render(<AnalysisPage />)
    await screen.findByRole('button', { name: /切換個股/ })

    expect(screen.queryByRole('button', { name: '管理觀察' })).toBeNull()
  })

  it('剛在頁籤裡加入的股票，點下去就要能切換（掛載時的清單沒有它）', async () => {
    // Regression: AnalysisPage resolved the clicked ticker against a watchlist it read once on
    // mount, so anything added afterwards silently fell back to the first holding.
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([])
    fetchPrices.mockResolvedValue({ 'TPE:1101': { price: 24.05 } })
    render(<AnalysisPage />)
    await screen.findByTestId('detail-ticker')

    await user.click(screen.getByTestId('pick-new-watch'))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('1101')
    expect(screen.getByTestId('detail-name').textContent).toBe('台泥')
    expect(screen.getByTestId('detail-qty').textContent).toBe('—')
  })

  it('同時被持有的觀察股，要以持股身分渲染（帶股數成本）', async () => {
    // Buying a stock you were watching must not strip its position data: the watch: key path
    // used to skip the holdings lookup entirely.
    const user = userEvent.setup()
    setup(TW_AND_US, { 'TPE:2330': { price: 2350, stale: false } })
    listWatchlist.mockResolvedValue([{ ticker: '2330', name: '台積電', sortOrder: 0 }])
    render(<AnalysisPage />)
    await screen.findByTestId('detail-ticker')

    await user.click(screen.getByTestId('pick-held-watch'))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('2330')
    expect(screen.getByTestId('detail-qty').textContent).not.toBe('—')
  })

  it('在頁籤裡移除正在看的觀察股後，不再顯示那一檔', async () => {
    // Two independent copies of the watchlist let a removed stock linger on screen forever.
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    render(<AnalysisPage />)
    await screen.findByTestId('detail-ticker')

    await user.click(screen.getByTestId('pick-watch'))
    expect(screen.getByTestId('detail-ticker').textContent).toBe('2059')

    listWatchlist.mockResolvedValue([])
    await user.click(screen.getByTestId('fire-watch-changed'))

    expect(await screen.findByTestId('detail-ticker')).toBeTruthy()
    expect(screen.getByTestId('detail-ticker').textContent).not.toBe('2059')
  })

  it('重讀還沒回來時，不能先把剛點的那一檔弄丟', async () => {
    // pickedWatch is the bridge for a stock added in the tab but not yet in this page's copy.
    // Clearing it when the reload is DISPATCHED (rather than when it LANDS) lets an unrelated
    // second watchlist change strip the bridge while the copy is still stale, remounting the
    // user away from the stock they just picked.
    const user = userEvent.setup()
    setup(TW_AND_US)
    listWatchlist.mockResolvedValue([])
    render(<AnalysisPage />)
    await screen.findByTestId('detail-ticker')

    await user.click(screen.getByTestId('pick-new-watch'))
    expect(screen.getByTestId('detail-ticker').textContent).toBe('1101')

    // an unrelated change fires; its reload never resolves during this test
    listWatchlist.mockReturnValue(new Promise(() => {}))
    await user.click(screen.getByTestId('fire-watch-changed'))

    expect(screen.getByTestId('detail-ticker').textContent).toBe('1101')
  })
})
