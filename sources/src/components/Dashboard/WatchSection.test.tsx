// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { listWatchlist, removeWatch, fetchPrices } = vi.hoisted(() => ({
  listWatchlist: vi.fn(),
  removeWatch: vi.fn(),
  fetchPrices: vi.fn(),
}))
vi.mock('../../services/watchlistService', () => ({
  WATCHLIST_MAX: 30,
  listWatchlist,
  removeWatch,
  addWatch: vi.fn(),
}))
vi.mock('../../services/priceProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/priceProxy')>()),
  fetchPrices,
}))
vi.mock('../StockDetail/AddWatchModal', () => ({
  AddWatchModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="add-modal">
      <button type="button" onClick={onClose}>
        關閉
      </button>
    </div>
  ),
}))

import { WatchSection } from './WatchSection'

const quote = (price: number, prevClose: number | null) => ({
  price,
  prevClose,
  open: null,
  high: null,
  low: null,
  volume: null,
  tradeDate: null,
  tradeTime: null,
  trial: false,
  asOf: '2026-08-19T03:00:00.000Z',
  source: 'twse' as const,
  stale: false,
})

const TWO = [
  { ticker: '2330', name: '台積電', sortOrder: 0 },
  { ticker: '2327', name: '國巨', sortOrder: 1 },
]

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  listWatchlist.mockResolvedValue([])
  removeWatch.mockResolvedValue(undefined)
  fetchPrices.mockResolvedValue({})
})

describe('WatchSection (Dashboard)', () => {
  it('清單為空時仍然渲染，並提供加入入口', async () => {
    render(<WatchSection onSelectTicker={() => {}} />)

    expect(await screen.findByText(/還沒有觀察標的/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /加入觀察/ })).toBeTruthy()
  })

  it('標題顯示目前數量與上限', async () => {
    listWatchlist.mockResolvedValue(TWO)
    render(<WatchSection onSelectTicker={() => {}} />)

    expect(await screen.findByText('2/30')).toBeTruthy()
  })

  it('一次批次取得所有觀察代號的報價', async () => {
    listWatchlist.mockResolvedValue(TWO)
    render(<WatchSection onSelectTicker={() => {}} />)
    await screen.findByText('台積電')

    expect(fetchPrices).toHaveBeenCalledTimes(1)
    expect(fetchPrices).toHaveBeenCalledWith([
      { market: 'TPE', ticker: '2330' },
      { market: 'TPE', ticker: '2327' },
    ])
  })

  it('預設以圖卡模式顯示現價與漲跌幅', async () => {
    listWatchlist.mockResolvedValue(TWO)
    fetchPrices.mockResolvedValue({
      'TPE:2330': quote(1100, 1000),
      'TPE:2327': quote(95, 100),
    })
    render(<WatchSection onSelectTicker={() => {}} />)

    const card = await screen.findByTestId('watch-card-2330')
    expect(within(card).getByText('台積電')).toBeTruthy()
    expect(within(card).getByText('半導體')).toBeTruthy()
    expect(within(card).getByText(/1,100/)).toBeTruthy()
    expect(within(card).getByText(/\+10\.00%/)).toBeTruthy()

    const card2 = screen.getByTestId('watch-card-2327')
    expect(within(card2).getByText('國巨')).toBeTruthy()
    expect(within(card2).getByText('電子零組件')).toBeTruthy()
    expect(within(card2).getByText(/95/)).toBeTruthy()
    expect(within(card2).getByText(/-5\.00%/)).toBeTruthy()
  })

  it('可切換為條列模式並記憶在 localStorage，且顯示分類徽章', async () => {
    const user = userEvent.setup()
    listWatchlist.mockResolvedValue(TWO)
    fetchPrices.mockResolvedValue({
      'TPE:2330': quote(1100, 1000),
    })
    render(<WatchSection onSelectTicker={() => {}} />)
    await screen.findByText('台積電')

    // Click table mode button
    const tableBtn = screen.getByRole('button', { name: '條列模式' })
    await user.click(tableBtn)

    expect(screen.getByTestId('watchlist-table')).toBeTruthy()
    const row = screen.getByTestId('watch-row-2330')
    expect(row).toBeTruthy()
    expect(within(row).getByText('半導體')).toBeTruthy()
    expect(localStorage.getItem('stock_watchlist_view_mode')).toBe('table')
  })

  it('點擊圖卡觸發 onSelectTicker', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    listWatchlist.mockResolvedValue(TWO)
    render(<WatchSection onSelectTicker={onSelect} />)

    const card = await screen.findByTestId('watch-card-2330')
    await user.click(card)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('2330', '台積電')
  })

  it('點擊條列列觸發 onSelectTicker', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    listWatchlist.mockResolvedValue(TWO)
    localStorage.setItem('stock_watchlist_view_mode', 'table')
    render(<WatchSection onSelectTicker={onSelect} />)

    const row = await screen.findByTestId('watch-row-2330')
    await user.click(row)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('2330', '台積電')
  })

  it('點擊刪除呼叫 removeWatch 並重新載入', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    listWatchlist.mockResolvedValueOnce(TWO).mockResolvedValueOnce([TWO[1]])
    render(<WatchSection onSelectTicker={() => {}} onChanged={onChanged} />)
    await screen.findByText('台積電')

    const delBtn = screen.getByRole('button', { name: '移除 2330 台積電' })
    await user.click(delBtn)

    expect(removeWatch).toHaveBeenCalledWith('2330')
    expect(listWatchlist).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('滿 30 檔時停用加入按鈕並提示說明', async () => {
    const full = Array.from({ length: 30 }, (_, i) => ({
      ticker: String(1000 + i),
      name: `股${i}`,
      sortOrder: i,
    }))
    listWatchlist.mockResolvedValue(full)
    render(<WatchSection onSelectTicker={() => {}} />)
    await screen.findByText('30/30')

    const addBtn = screen.getByRole('button', { name: /加入觀察/ })
    expect(addBtn.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/已達上限/)).toBeTruthy()
  })

  it('點擊加入觀察打開 AddWatchModal', async () => {
    const user = userEvent.setup()
    render(<WatchSection onSelectTicker={() => {}} />)

    const addBtn = await screen.findByRole('button', { name: /加入觀察/ })
    await user.click(addBtn)

    expect(screen.getByTestId('add-modal')).toBeTruthy()
  })

  it('正確在卡片顯示 ETF 分類徽章（債券 ETF、股票型 ETF）', async () => {
    const etfList = [
      { ticker: '00679B', name: '元大美債20年', sortOrder: 0 },
      { ticker: '0050', name: '元大台灣50', sortOrder: 1 },
    ]
    listWatchlist.mockResolvedValue(etfList)
    fetchPrices.mockResolvedValue({
      'TPE:00679B': quote(29.5, 30.0),
      'TPE:0050': quote(180, 175),
    })
    render(<WatchSection onSelectTicker={() => {}} />)

    const bondCard = await screen.findByTestId('watch-card-00679B')
    expect(within(bondCard).getByText('債券 ETF')).toBeTruthy()

    const equityCard = screen.getByTestId('watch-card-0050')
    expect(within(equityCard).getByText('股票型 ETF')).toBeTruthy()
  })

  it('正確處理超長股票名稱與 TPEx 分類標籤，且保留 title 與階層', async () => {
    const longNameItem = [
      { ticker: '00679B', name: '元大美債20年正2長期特別', sortOrder: 0 },
      { ticker: '3293', name: '鈊象電子遊戲旗艦', sortOrder: 1 },
    ]
    listWatchlist.mockResolvedValue(longNameItem)
    fetchPrices.mockResolvedValue({
      'TPE:00679B': quote(29.5, 30.0),
      'TPE:3293': quote(1050, 1000),
    })
    render(<WatchSection onSelectTicker={() => {}} />)

    const card = await screen.findByTestId('watch-card-00679B')
    const nameEl = within(card).getByText('元大美債20年正2長期特別')
    expect(nameEl.getAttribute('title')).toBe('元大美債20年正2長期特別')
    expect(within(card).getByText('債券 ETF')).toBeTruthy()

    const card2 = screen.getByTestId('watch-card-3293')
    expect(within(card2).getByText('鈊象電子遊戲旗艦')).toBeTruthy()
    expect(within(card2).getByText('文化創意')).toBeTruthy()
  })
})

