// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { listWatchlist, addWatch, removeWatch, getTwStockList } = vi.hoisted(() => ({
  listWatchlist: vi.fn(),
  addWatch: vi.fn(),
  removeWatch: vi.fn(),
  getTwStockList: vi.fn(),
}))
vi.mock('../../services/watchlistService', () => ({
  WATCHLIST_MAX: 30,
  listWatchlist,
  addWatch,
  removeWatch,
}))
vi.mock('../../services/twMarketData', () => ({ getTwStockList }))

import { WatchlistPanel } from './WatchlistPanel'

const LIST = [
  { symbol: '2330', name: '台積電', close: 1000 },
  { symbol: '2059', name: '川湖', close: 900 },
  { symbol: '6770', name: '力積電', close: 20 },
  { symbol: '2891A', name: '中信金乙特', close: 60 },
]

function full() {
  return Array.from({ length: 30 }, (_, i) => ({
    ticker: String(1000 + i),
    name: `N${i}`,
    sortOrder: i,
  }))
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  listWatchlist.mockResolvedValue([])
  getTwStockList.mockResolvedValue(LIST)
  addWatch.mockResolvedValue(undefined)
  removeWatch.mockResolvedValue(undefined)
})

describe('WatchlistPanel', () => {
  it('列出目前的觀察標的', async () => {
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    expect(await screen.findByText('2059 川湖')).toBeTruthy()
  })

  it('清單為空時說明還沒有觀察標的', async () => {
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText(/還沒有觀察標的/)).toBeTruthy()
  })

  it('移除會呼叫 removeWatch 並通知外層重新載入', async () => {
    const onChanged = vi.fn()
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={onChanged} />)

    await user.click(await screen.findByRole('button', { name: '移除 2059 川湖' }))

    expect(removeWatch).toHaveBeenCalledWith('2059')
    expect(onChanged).toHaveBeenCalled()
  })

  it('搜尋可用代號前綴命中', async () => {
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '20')
    const hits = await screen.findAllByRole('button', { name: /加入/ })
    expect(hits.map((b) => b.textContent)).toEqual(['2059 川湖'])
  })

  it('搜尋可用名稱內含命中', async () => {
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '積電')
    const hits = await screen.findAllByRole('button', { name: /加入/ })
    expect(hits.map((b) => b.textContent)).toEqual(['2330 台積電', '6770 力積電'])
  })

  it('點搜尋結果會加入觀察並通知外層', async () => {
    const onChanged = vi.fn()
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={onChanged} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '川湖')
    await user.click(await screen.findByRole('button', { name: '加入 2059 川湖' }))

    expect(addWatch).toHaveBeenCalledWith('2059', '川湖')
    expect(onChanged).toHaveBeenCalled()
  })

  it('已加入的標的不再出現在搜尋結果', async () => {
    listWatchlist.mockResolvedValue([{ ticker: '2059', name: '川湖', sortOrder: 0 }])
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('2059 川湖')

    await user.type(screen.getByLabelText('搜尋股票'), '川湖')

    expect(screen.queryByRole('button', { name: /加入 2059/ })).toBeNull()
  })

  it('已滿 30 檔時停用搜尋並說明原因，不呼叫 addWatch', async () => {
    listWatchlist.mockResolvedValue(full())
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    const box = await screen.findByLabelText('搜尋股票')
    expect(box).toHaveProperty('disabled', true)
    expect(screen.getByText(/30/)).toBeTruthy()

    await user.type(box, '川湖')
    expect(addWatch).not.toHaveBeenCalled()
  })

  it('加入失敗時顯示錯誤訊息且不關閉面板', async () => {
    addWatch.mockRejectedValue(new Error('加入觀察清單失敗：boom'))
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={onClose} onChanged={() => {}} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '川湖')
    await user.click(await screen.findByRole('button', { name: '加入 2059 川湖' }))

    expect(await screen.findByText(/加入觀察清單失敗/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('關閉鈕呼叫 onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={onClose} onChanged={() => {}} />)

    await user.click(await screen.findByRole('button', { name: '關閉' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('台股清單載不到時不炸，顯示提示', async () => {
    getTwStockList.mockRejectedValue(new Error('台股清單載入失敗'))
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '2330')
    expect(await screen.findByText(/載入失敗/)).toBeTruthy()
  })

  it('代號比對不分大小寫', async () => {
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '2891a')
    expect(await screen.findByRole('button', { name: '加入 2891A 中信金乙特' })).toBeTruthy()
  })

  it('加到滿 30 檔後，先前列出的加入鈕不再可按', async () => {
    // The cap can be crossed while results from before the cap are still on screen.
    listWatchlist.mockResolvedValueOnce([]).mockResolvedValue(full())
    const user = userEvent.setup()
    render(<WatchlistPanel onClose={() => {}} onChanged={() => {}} />)

    await user.type(await screen.findByLabelText('搜尋股票'), '川湖')
    await user.click(await screen.findByRole('button', { name: '加入 2059 川湖' }))

    expect(await screen.findByText(/30/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /加入/ })).toBeNull()
  })
})
