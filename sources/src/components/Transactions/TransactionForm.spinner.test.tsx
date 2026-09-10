// @vitest-environment jsdom
/**
 * The name field runs a debounced remote search. Without a visible indicator the user
 * cannot tell a slow search from a dead one, so the spinner must appear on the first
 * keystroke — before the 300ms debounce elapses — and it must stop on every path that
 * hides the drop-down. A spinner that never stops is worse than no spinner at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StockSearchResult } from '../../services/stockSearch'

const { searchStocks, lookupTicker } = vi.hoisted(() => ({
  searchStocks: vi.fn(),
  lookupTicker: vi.fn(),
}))
vi.mock('../../services/stockSearch', () => ({ searchStocks, lookupTicker }))
vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ current: { id: 'w1' }, ledger: { holdings: [] } }),
}))

import { TransactionForm } from './TransactionForm'

const TSMC: StockSearchResult = { symbol: '2330', name: '台積電', market: 'TPE' }

/** A promise the test resolves by hand, so "still searching" is an observable state. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mount() {
  const view = render(<TransactionForm onSubmit={vi.fn().mockResolvedValue(undefined)} />)
  return { nameInput: screen.getByLabelText('股票名稱'), unmount: view.unmount }
}

/** Longer than the 300ms debounce, so an uncancelled timer would have fired by now. */
function afterDebounce() {
  return new Promise((res) => setTimeout(res, 400))
}

const spinnerRow = () => screen.queryByTestId('name-search-loading')

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.localStorage.clear()
  lookupTicker.mockResolvedValue(null)
  searchStocks.mockResolvedValue([])
})

describe('TransactionForm 名稱搜尋載入指示', () => {
  it('S1: 第一個按鍵就顯示轉圈，不必等 300ms 去抖動', async () => {
    const user = userEvent.setup()
    const { nameInput } = mount()

    await user.type(nameInput, '台')

    const row = spinnerRow()
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('搜尋中')
    expect(row!.getAttribute('role')).toBe('status')
    expect(row!.querySelector('svg.cds-spinner')).not.toBeNull()
    // The debounce has not fired yet, so no search has started.
    expect(searchStocks).not.toHaveBeenCalled()
  })

  it('S2: 結果回來後轉圈消失，改列出建議', async () => {
    const user = userEvent.setup()
    const d = deferred<StockSearchResult[]>()
    searchStocks.mockReturnValue(d.promise)
    const { nameInput } = mount()

    await user.type(nameInput, '台積')
    await waitFor(() => expect(searchStocks).toHaveBeenCalled())
    expect(spinnerRow()).not.toBeNull()

    d.resolve([TSMC])
    await waitFor(() => expect(spinnerRow()).toBeNull())
    expect(screen.getByText(/台積電（2330）/)).toBeTruthy()
  })

  it('S3: 重新輸入時只顯示轉圈，不留過期結果', async () => {
    const user = userEvent.setup()
    searchStocks.mockResolvedValue([TSMC])
    const { nameInput } = mount()

    await user.type(nameInput, '台積')
    await screen.findByText(/台積電（2330）/)

    searchStocks.mockReturnValue(deferred<StockSearchResult[]>().promise)
    await user.type(nameInput, '電')

    expect(spinnerRow()).not.toBeNull()
    expect(screen.queryByText(/台積電（2330）/)).toBeNull()
  })

  it('S4: 清空輸入立刻停止轉圈', async () => {
    const user = userEvent.setup()
    searchStocks.mockReturnValue(deferred<StockSearchResult[]>().promise)
    const { nameInput } = mount()

    await user.type(nameInput, '台積')
    expect(spinnerRow()).not.toBeNull()

    await user.clear(nameInput)
    expect(spinnerRow()).toBeNull()
  })

  it('S5: 點擊表單其他處會收合下拉並停止轉圈', async () => {
    const user = userEvent.setup()
    searchStocks.mockReturnValue(deferred<StockSearchResult[]>().promise)
    const { nameInput } = mount()

    await user.type(nameInput, '台積')
    expect(spinnerRow()).not.toBeNull()

    await user.click(screen.getByLabelText('交易單價'))
    await waitFor(() => expect(spinnerRow()).toBeNull())
  })

  it('S6: 選定建議後停止轉圈', async () => {
    const user = userEvent.setup()
    searchStocks.mockResolvedValue([TSMC])
    const { nameInput } = mount()

    await user.type(nameInput, '台積')
    const item = await screen.findByText(/台積電（2330）/)

    await user.click(item)
    await waitFor(() => expect(spinnerRow()).toBeNull())
    expect((screen.getByLabelText(/股票代號/) as HTMLInputElement).value).toBe('2330')
  })

  it('S7: 搜尋丟出例外時轉圈仍然停止', async () => {
    const user = userEvent.setup()
    const d = deferred<StockSearchResult[]>()
    searchStocks.mockReturnValue(d.promise)
    const { nameInput } = mount()

    await user.type(nameInput, '台積')
    await waitFor(() => expect(searchStocks).toHaveBeenCalled())

    d.reject(new Error('network down'))
    await waitFor(() => expect(spinnerRow()).toBeNull())
  })
  it('S8: 切換交易性質會收合搜尋下拉，不留轉圈也不留過期結果', async () => {
    const user = userEvent.setup()
    searchStocks.mockResolvedValue([TSMC])
    const { nameInput } = mount()

    // 賣出 + 融資 才會走搜尋下拉；賣出 + 現股 改走庫存下拉，搜尋區塊被隱藏。
    // 用 fireEvent.change 而非 selectOptions：後者會產生 document click，
    // 表單外點擊的 effect 會先收合下拉，蓋掉這裡要驗的缺陷。鍵盤操作 select
    // 只發出 change，沒有 click，正是使用者能踩到這個 bug 的路徑。
    const natureSelect = screen.getByLabelText('交易性質')
    fireEvent.change(screen.getByLabelText('交易類型'), { target: { value: 'SELL' } })
    fireEvent.change(natureSelect, { target: { value: 'MARGIN' } })
    await user.type(nameInput, '台積')
    expect(spinnerRow()).not.toBeNull()

    fireEvent.change(natureSelect, { target: { value: 'SPOT' } })
    await afterDebounce()
    fireEvent.change(natureSelect, { target: { value: 'MARGIN' } })

    expect(searchStocks).not.toHaveBeenCalled()
    expect(spinnerRow()).toBeNull()
    expect(screen.queryByText(/台積電（2330）/)).toBeNull()
  })

  it('S9: 表單卸載後不再觸發搜尋', async () => {
    const user = userEvent.setup()
    searchStocks.mockResolvedValue([TSMC])
    const { nameInput, unmount } = mount()

    await user.type(nameInput, '台積')
    expect(spinnerRow()).not.toBeNull()

    unmount()
    await afterDebounce()

    expect(searchStocks).not.toHaveBeenCalled()
  })
})
