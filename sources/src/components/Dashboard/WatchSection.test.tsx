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

  it('優先採用 quote.industry 即時官方產業分類', async () => {
    const items = [
      { ticker: '2330', name: '台積電', sortOrder: 0 },
      { ticker: '2208', name: '台船', sortOrder: 1 },
      { ticker: '5701', name: '劍湖山', sortOrder: 2 },
    ]
    listWatchlist.mockResolvedValue(items)
    fetchPrices.mockResolvedValue({
      'TPE:2330': { ...quote(1100, 1000), industry: '半導體業' },
      'TPE:2208': { ...quote(25, 24), industry: '航運業' },
      'TPE:5701': { ...quote(4.3, 4.24), industry: '觀光餐旅' },
    })
    render(<WatchSection onSelectTicker={() => {}} />)

    const card2330 = await screen.findByTestId('watch-card-2330')
    expect(within(card2330).getByText('半導體業')).toBeTruthy()

    const card2208 = screen.getByTestId('watch-card-2208')
    expect(within(card2208).getByText('航運業')).toBeTruthy()

    const card5701 = screen.getByTestId('watch-card-5701')
    expect(within(card5701).getByText('觀光餐旅')).toBeTruthy()
  })

  describe('產業自動分組與膠囊篩選 (Auto-Grouping & Filter Chips)', () => {
    it('單一股票或各檔不同產業不觸發 >= 2 分組與膠囊', async () => {
      const items = [
        { ticker: '2603', name: '長榮', sortOrder: 0 },
        { ticker: '2330', name: '台積電', sortOrder: 1 },
      ]
      listWatchlist.mockResolvedValue(items)
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('長榮')

      expect(screen.queryByRole('group', { name: '產業快速篩選' })).toBeNull()
      expect(screen.queryByTestId('filter-chip-all')).toBeNull()
      expect(screen.getByTestId('watch-card-2603')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2330')).toBeTruthy()
    })

    it('2 檔同產業標的自動聚合群組，並渲染篩選膠囊與分組標題（圖卡模式）', async () => {
      const items = [
        { ticker: '2603', name: '長榮', sortOrder: 0 },
        { ticker: '2609', name: '陽明', sortOrder: 1 },
      ]
      listWatchlist.mockResolvedValue(items)
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('長榮')

      expect(screen.getByRole('group', { name: '產業快速篩選' })).toBeTruthy()
      expect(screen.getByTestId('filter-chip-all').textContent).toBe('全部 (2)')
      expect(screen.getByTestId('filter-chip-航運業').textContent).toBe('航運業 (2)')
      expect(screen.queryByTestId('filter-chip-other')).toBeNull()

      const groupSec = screen.getByTestId('watch-group-航運業')
      expect(within(groupSec).getByText('航運業')).toBeTruthy()
      expect(within(groupSec).getByText('2')).toBeTruthy()
      expect(within(groupSec).getByTestId('watch-card-2603')).toBeTruthy()
      expect(within(groupSec).getByTestId('watch-card-2609')).toBeTruthy()
    })

    it('多產業聚合（部分 >= 2，部分 < 2）支援篩選切換', async () => {
      const user = userEvent.setup()
      const items = [
        { ticker: '2603', name: '長榮', sortOrder: 0 },
        { ticker: '2609', name: '陽明', sortOrder: 1 },
        { ticker: '2330', name: '台積電', sortOrder: 2 },
        { ticker: '2454', name: '聯發科', sortOrder: 3 },
        { ticker: '1101', name: '台泥', sortOrder: 4 },
      ]
      listWatchlist.mockResolvedValue(items)
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('長榮')

      expect(screen.getByTestId('filter-chip-all').textContent).toBe('全部 (5)')
      expect(screen.getByTestId('filter-chip-航運業').textContent).toBe('航運業 (2)')
      expect(screen.getByTestId('filter-chip-半導體業').textContent).toBe('半導體業 (2)')
      expect(screen.getByTestId('filter-chip-other').textContent).toBe('其他 (1)')

      // 點選「航運業 (2)」
      await user.click(screen.getByTestId('filter-chip-航運業'))
      expect(screen.getByTestId('watch-card-2603')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2609')).toBeTruthy()
      expect(screen.queryByTestId('watch-card-2330')).toBeNull()
      expect(screen.queryByTestId('watch-card-2454')).toBeNull()
      expect(screen.queryByTestId('watch-card-1101')).toBeNull()

      // 點選「其他 (1)」
      await user.click(screen.getByTestId('filter-chip-other'))
      expect(screen.getByTestId('watch-card-1101')).toBeTruthy()
      expect(screen.queryByTestId('watch-card-2603')).toBeNull()
      expect(screen.queryByTestId('watch-card-2330')).toBeNull()

      // 點選「全部 (5)」
      await user.click(screen.getByTestId('filter-chip-all'))
      expect(screen.getByTestId('watch-card-2603')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2609')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2330')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2454')).toBeTruthy()
      expect(screen.getByTestId('watch-card-1101')).toBeTruthy()
    })

    it('條列模式支援分組標題列，且切換檢視模式時保留篩選狀態', async () => {
      const user = userEvent.setup()
      const items = [
        { ticker: '2603', name: '長榮', sortOrder: 0 },
        { ticker: '2609', name: '陽明', sortOrder: 1 },
        { ticker: '2330', name: '台積電', sortOrder: 2 },
      ]
      listWatchlist.mockResolvedValue(items)
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('長榮')

      // 在圖卡模式先篩選航運業
      await user.click(screen.getByTestId('filter-chip-航運業'))
      expect(screen.getByTestId('watch-card-2603')).toBeTruthy()
      expect(screen.queryByTestId('watch-card-2330')).toBeNull()

      // 切換為條列模式
      await user.click(screen.getByRole('button', { name: '條列模式' }))
      expect(screen.getByTestId('watchlist-table')).toBeTruthy()

      // 篩選狀態仍為航運業
      expect(screen.getByTestId('filter-chip-航運業').classList.contains('active')).toBe(true)
      expect(screen.getByTestId('watch-group-row-航運業')).toBeTruthy()
      expect(screen.getByTestId('watch-row-2603')).toBeTruthy()
      expect(screen.getByTestId('watch-row-2609')).toBeTruthy()
      expect(screen.queryByTestId('watch-row-2330')).toBeNull()
    })

    it('刪除一檔使同產業標的數由 2 降為 1 時，群組自動解構', async () => {
      const user = userEvent.setup()
      const items = [
        { ticker: '2603', name: '長榮', sortOrder: 0 },
        { ticker: '2609', name: '陽明', sortOrder: 1 },
      ]
      listWatchlist.mockResolvedValueOnce(items).mockResolvedValueOnce([items[0]])
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('長榮')

      expect(screen.getByTestId('filter-chip-航運業')).toBeTruthy()

      // 刪除陽明
      const delBtn = screen.getByRole('button', { name: '移除 2609 陽明' })
      await user.click(delBtn)

      // 陽明移除後，長榮只剩 1 檔，分組自動解構，篩選膠囊消失
      expect(await screen.findByTestId('watch-card-2603')).toBeTruthy()
      expect(screen.queryByTestId('filter-chip-航運業')).toBeNull()
      expect(screen.queryByTestId('filter-chip-all')).toBeNull()
    })

    it('在「其他」膠囊篩選狀態下刪除最後一檔其他標的，畫面安全退階至「全部」且不反白空白', async () => {
      const user = userEvent.setup()
      const items = [
        { ticker: '2603', name: '長榮', sortOrder: 0 },
        { ticker: '2609', name: '陽明', sortOrder: 1 },
        { ticker: '1101', name: '台泥', sortOrder: 2 },
      ]
      const remainingItems = [items[0], items[1]]
      listWatchlist.mockResolvedValueOnce(items).mockResolvedValueOnce(remainingItems)
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('長榮')

      expect(screen.getByTestId('filter-chip-other')).toBeTruthy()

      // 點選切換至「其他 (1)」
      await user.click(screen.getByTestId('filter-chip-other'))
      expect(screen.getByTestId('watch-card-1101')).toBeTruthy()
      expect(screen.queryByTestId('watch-card-2603')).toBeNull()

      // 點擊刪除 1101 台泥（此時其他標的歸零）
      const delBtn = screen.getByRole('button', { name: '移除 1101 台泥' })
      await user.click(delBtn)

      // 畫面必須安全退階回「全部 (2)」，顯示剩餘的 2603 與 2609，絕不可為空白
      expect(await screen.findByTestId('watch-card-2603')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2609')).toBeTruthy()
      expect(screen.getByTestId('filter-chip-all').classList.contains('active')).toBe(true)
      expect(screen.queryByTestId('filter-chip-other')).toBeNull()
    })

    it('電腦週邊（廣達 + 英業達）在報價與靜態字典異構情境下能聚合為電腦及週邊設備業', async () => {
      const items = [
        { ticker: '2382', name: '廣達', sortOrder: 0 },
        { ticker: '2356', name: '英業達', sortOrder: 1 },
      ]
      listWatchlist.mockResolvedValue(items)
      fetchPrices.mockResolvedValue({
        // 廣達帶有官方 MIS 產業名稱，英業達無即時報價產業別（fallback 靜態電腦週邊）
        'TPE:2382': { ...quote(290, 280), industry: '電腦及週邊設備業' },
        'TPE:2356': quote(45, 44),
      })
      render(<WatchSection onSelectTicker={() => {}} />)
      await screen.findByText('廣達')

      expect(screen.getByTestId('filter-chip-電腦及週邊設備業')).toBeTruthy()
      expect(screen.getByTestId('watch-group-電腦及週邊設備業')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2382')).toBeTruthy()
      expect(screen.getByTestId('watch-card-2356')).toBeTruthy()
    })
  })
})

