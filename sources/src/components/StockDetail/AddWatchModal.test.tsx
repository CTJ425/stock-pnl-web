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
  // Source order is by code, so the 03xxx warrants come first — that is the bug this fixture pins.
  { symbol: '03003T', name: '聯發科群益5A售09', close: 1.2 },
  { symbol: '00878', name: '國泰永續高股息', close: 22 },
  { symbol: '2330', name: '台積電', close: 1000 },
  { symbol: '2059', name: '川湖', close: 900 },
  { symbol: '2454', name: '聯發科', close: 3000 },
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

  it('名稱內含命中，同級別依代號排序', async () => {
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

  it('一般股票排在權證之前，權證仍搜得到', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '聯發科')
    const hits = await screen.findAllByRole('button', { name: /加入 / })
    expect(hits.map((b) => b.textContent)).toEqual(['2454 聯發科', '03003T 聯發科群益5A售09'])
  })

  it('代號完全命中排在名稱命中之前', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '2330')
    const hits = await screen.findAllByRole('button', { name: /加入 / })
    expect(hits[0]?.textContent).toBe('2330 台積電')
  })

  it('結果超過上限時只列 50 筆，並提示還有幾筆', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      symbol: `0${3100 + i}T`,
      name: `聯發科群益購${i}`,
      close: 1,
    }))
    getTwStockList.mockResolvedValue([...many, { symbol: '2454', name: '聯發科', close: 3000 }])
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText('搜尋股票'), '聯發科')
    const hits = await screen.findAllByRole('button', { name: /加入 / })
    expect(hits).toHaveLength(50)
    expect(hits[0]?.textContent).toBe('2454 聯發科')
    expect(screen.getByText(/還有 11 筆/)).toBeTruthy()
  })
})
