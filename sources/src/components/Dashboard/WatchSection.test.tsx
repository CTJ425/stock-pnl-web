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
  listWatchlist.mockResolvedValue([])
  removeWatch.mockResolvedValue(undefined)
  fetchPrices.mockResolvedValue({})
})

describe('WatchSection', () => {
  it('清單為空時仍然渲染，並提供加入入口', async () => {
    render(<WatchSection onOpenAnalysis={() => {}} />)

    expect(await screen.findByText(/還沒有觀察標的/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /加入觀察/ })).toBeTruthy()
  })

  it('標題顯示目前數量與上限', async () => {
    listWatchlist.mockResolvedValue(TWO)
    render(<WatchSection onOpenAnalysis={() => {}} />)

    expect(await screen.findByText('2/30')).toBeTruthy()
  })

  it('一次批次取得所有觀察代號的報價', async () => {
    listWatchlist.mockResolvedValue(TWO)
    render(<WatchSection onOpenAnalysis={() => {}} />)
    await screen.findByText('台積電')

    expect(fetchPrices).toHaveBeenCalledTimes(1)
    expect(fetchPrices).toHaveBeenCalledWith([
      { market: 'TPE', ticker: '2330' },
      { market: 'TPE', ticker: '2327' },
    ])
  })

  it('顯示現價與漲跌幅', async () => {
    listWatchlist.mockResolvedValue(TWO)
    fetchPrices.mockResolvedValue({
      'TPE:2330': quote(1100, 1000),
      'TPE:2327': quote(95, 100),
    })
    render(<WatchSection onOpenAnalysis={() => {}} />)

    const row = (await screen.findByText('台積電')).closest('tr')!
    expect(within(row).getByText(/1,100/)).toBeTruthy()
    expect(within(row).getByText(/\+10\.00%/)).toBeTruthy()

    const row2 = screen.getByText('國巨').closest('tr')!
    expect(within(row2).getByText(/-5\.00%/)).toBeTruthy()
  })

  it('抓不到報價時顯示破折號，不出現 NaN', async () => {
    listWatchlist.mockResolvedValue(TWO)
    fetchPrices.mockResolvedValue({})
    render(<WatchSection onOpenAnalysis={() => {}} />)

    const row = (await screen.findByText('台積電')).closest('tr')!
    expect(row.textContent).toContain('—')
    expect(row.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('沒有昨收時不硬算漲跌', async () => {
    listWatchlist.mockResolvedValue([TWO[0]])
    fetchPrices.mockResolvedValue({ 'TPE:2330': quote(1100, null) })
    render(<WatchSection onOpenAnalysis={() => {}} />)

    const row = (await screen.findByText('台積電')).closest('tr')!
    expect(within(row).getByText(/1,100/)).toBeTruthy()
    expect(row.textContent).not.toMatch(/NaN|%/)
  })

  it('移除後就地更新，不必重整頁面', async () => {
    listWatchlist.mockResolvedValueOnce(TWO).mockResolvedValue([TWO[0]])
    const user = userEvent.setup()
    render(<WatchSection onOpenAnalysis={() => {}} />)
    await screen.findByText('國巨')

    await user.click(screen.getByRole('button', { name: '移除 2327 國巨' }))

    expect(removeWatch).toHaveBeenCalledWith('2327')
    expect(await screen.findByText('1/30')).toBeTruthy()
    expect(screen.queryByText('國巨')).toBeNull()
  })

  it('點一列會開啟該檔的個股分析', async () => {
    const onOpenAnalysis = vi.fn()
    listWatchlist.mockResolvedValue(TWO)
    const user = userEvent.setup()
    render(<WatchSection onOpenAnalysis={onOpenAnalysis} />)

    await user.click(await screen.findByText('台積電'))

    expect(onOpenAnalysis).toHaveBeenCalledWith('2330')
  })

  it('已滿 30 檔時停用加入鈕並說明原因', async () => {
    listWatchlist.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ ticker: String(1000 + i), name: `N${i}`, sortOrder: i })),
    )
    render(<WatchSection onOpenAnalysis={() => {}} />)

    const add = await screen.findByRole('button', { name: /加入觀察/ })
    expect(add).toHaveProperty('disabled', true)
    expect(screen.getByText('30/30')).toBeTruthy()
  })

  it('按加入會開啟加入對話框，關閉後消失', async () => {
    const user = userEvent.setup()
    render(<WatchSection onOpenAnalysis={() => {}} />)
    await screen.findByText(/還沒有觀察標的/)

    expect(screen.queryByTestId('add-modal')).toBeNull()
    await user.click(screen.getByRole('button', { name: /加入觀察/ }))
    expect(screen.getByTestId('add-modal')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '關閉' }))
    expect(screen.queryByTestId('add-modal')).toBeNull()
  })

  it('讀取觀察清單失敗時不炸掉整個庫存總覽', async () => {
    listWatchlist.mockRejectedValue(new Error('boom'))
    render(<WatchSection onOpenAnalysis={() => {}} />)

    expect(await screen.findByText('觀察中')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/NaN/)
  })

  it('報價失敗只讓價格欄退成破折號，不清空整份清單', async () => {
    // The spec says a quote failure degrades the price cells. Swallowing it together with the
    // list fetch would make a pure pricing hiccup look like an empty watchlist.
    listWatchlist.mockResolvedValue(TWO)
    fetchPrices.mockRejectedValue(new Error('quote source down'))
    render(<WatchSection onOpenAnalysis={() => {}} />)

    expect(await screen.findByText('台積電')).toBeTruthy()
    expect(screen.getByText('國巨')).toBeTruthy()
    expect(screen.getByText('2/30')).toBeTruthy()
    const row = screen.getByText('台積電').closest('tr')!
    expect(row.textContent).toContain('—')
  })

  it('移除進行中時停用該列的移除鈕，連點不會送出兩次', async () => {
    listWatchlist.mockResolvedValue(TWO)
    let release: () => void = () => {}
    removeWatch.mockImplementation(() => new Promise<void>((res) => { release = res }))
    const user = userEvent.setup()
    render(<WatchSection onOpenAnalysis={() => {}} />)
    await screen.findByText('國巨')

    const btn = screen.getByRole('button', { name: '移除 2327 國巨' })
    await user.click(btn)
    expect(btn).toHaveProperty('disabled', true)

    await user.click(btn).catch(() => {})
    expect(removeWatch).toHaveBeenCalledTimes(1)

    release()
  })
})
