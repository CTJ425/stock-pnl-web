// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { addWatch, getTwStockList } = vi.hoisted(() => ({
  addWatch: vi.fn(),
  getTwStockList: vi.fn(),
}))
vi.mock('../../services/watchlistService', () => ({
  WATCHLIST_MAX: 30,
  addWatch,
  listWatchlist: vi.fn(),
  removeWatch: vi.fn(),
}))
vi.mock('../../services/twMarketData', () => ({ getTwStockList }))

import { AddWatchModal } from './AddWatchModal'

const LIST = [
  { symbol: '2330', name: '台積電', close: 1000 },
  { symbol: '2059', name: '川湖', close: 900 },
  { symbol: '6770', name: '力積電', close: 20 },
  { symbol: '2891A', name: '中信金乙特', close: 60 },
]

function mount(props: Partial<Parameters<typeof AddWatchModal>[0]> = {}) {
  const onClose = vi.fn()
  const onAdded = vi.fn()
  render(<AddWatchModal watched={[]} onClose={onClose} onAdded={onAdded} {...props} />)
  return { onClose, onAdded }
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  getTwStockList.mockResolvedValue(LIST)
  addWatch.mockResolvedValue(undefined)
})

describe('AddWatchModal', () => {
  it('是浮層對話框，掛在 document.body 之下', async () => {
    const { container } = render(<AddWatchModal watched={[]} onClose={() => {}} onAdded={() => {}} />)

    const dialog = await screen.findByRole('dialog', { name: /加入觀察/ })
    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('標題帶目前數量與上限', async () => {
    mount({ watched: ['2330', '2059'] })
    expect(await screen.findByText('2/30')).toBeTruthy()
  })

  it('搜尋框套用專案的輸入樣式，不是裸 input', async () => {
    mount()
    const box = await screen.findByLabelText('搜尋股票')
    // 0.8.0 shipped a bare <input> with no class at all — that was the "half-finished" tell.
    expect(box.className.trim().length).toBeGreaterThan(0)
  })

  it('空查詢不列出任何結果', async () => {
    mount()
    await screen.findByLabelText('搜尋股票')
    expect(screen.queryByRole('button', { name: /加入 / })).toBeNull()
  })

  it('代號前綴命中，且不分大小寫', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '2891a')
    expect(await screen.findByRole('button', { name: '加入 2891A 中信金乙特' })).toBeTruthy()
  })

  it('名稱內含命中，維持來源順序', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '積電')
    const hits = await screen.findAllByRole('button', { name: /加入 / })
    expect(hits.map((b) => b.textContent)).toEqual(['2330 台積電', '6770 力積電'])
  })

  it('已在觀察清單中的不再出現於結果', async () => {
    const user = userEvent.setup()
    mount({ watched: ['2059'] })
    await user.type(await screen.findByLabelText('搜尋股票'), '川湖')
    expect(screen.queryByRole('button', { name: /加入 2059/ })).toBeNull()
  })

  it('點結果會加入並關閉對話框', async () => {
    const user = userEvent.setup()
    const { onClose, onAdded } = mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '川湖')
    await user.click(await screen.findByRole('button', { name: '加入 2059 川湖' }))

    expect(addWatch).toHaveBeenCalledWith('2059', '川湖')
    expect(onAdded).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('加入失敗時留在對話框並顯示訊息', async () => {
    addWatch.mockRejectedValue(new Error('加入觀察清單失敗：boom'))
    const user = userEvent.setup()
    const { onClose } = mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '川湖')
    await user.click(await screen.findByRole('button', { name: '加入 2059 川湖' }))

    expect(await screen.findByText(/加入觀察清單失敗/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('台股清單載不到時顯示提示，輸入不會丟例外', async () => {
    getTwStockList.mockRejectedValue(new Error('台股清單載入失敗'))
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '2330')
    expect(await screen.findByText(/載入失敗/)).toBeTruthy()
  })
})
