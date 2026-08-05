// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

async function setupAppWithTwoTransactions(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')

  // Go to transaction history page
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

  // The first new transaction: 2330 TSMC
  await user.click(await screen.findByRole('button', { name: /新增交易/ }))
  let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
  let form = within(dialog)
  await user.type(form.getByLabelText(/股票代號/), '2330')
  await user.type(form.getByLabelText('股票名稱'), '台積電')
  await user.type(form.getByLabelText('交易單價'), '500')
  await user.type(form.getByLabelText('交易股數'), '1')
  await user.click(form.getByRole('button', { name: '確認送出' }))
  await form.findByText(/成功新增交易紀錄/)
  await user.click(form.getByRole('button', { name: '關閉' }))

  // Added 2nd item: AAPL (Apple Inc. -> display name is Apple)
  await user.click(screen.getByRole('button', { name: /新增交易/ }))
  dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
  form = within(dialog)
  await user.selectOptions(form.getByLabelText('交易市場'), 'US')
  await user.type(form.getByLabelText(/股票代號/), 'AAPL')
  await user.type(form.getByLabelText('股票名稱'), 'Apple Inc.')
  await user.type(form.getByLabelText('交易單價'), '180')
  await user.type(form.getByLabelText('交易股數'), '10')
  await user.click(form.getByRole('button', { name: '確認送出' }))
  await form.findByText(/成功新增交易紀錄/)
  await user.click(form.getByRole('button', { name: '關閉' }))
}

describe('TransactionsPage 搜尋過濾 UI 整合測試 (I1-I7)', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('I1: 輸入「台積」即時過濾表格並顯示筆數提示', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '台積')

    expect(screen.getByText('台積電')).toBeTruthy()
    expect(screen.queryByText('蘋果')).toBeNull()
    expect(screen.getByText('顯示 1 / 2 筆')).toBeTruthy()
  })

  it('I2: 點擊清除搜尋按鈕恢復顯示全部交易', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '台積')
    expect(screen.getByText('顯示 1 / 2 筆')).toBeTruthy()

    const clearBtn = screen.getByRole('button', { name: '清除搜尋' })
    await user.click(clearBtn)

    expect(screen.getByText('台積電')).toBeTruthy()
    expect(screen.getByText('蘋果')).toBeTruthy()
    expect(screen.queryByText(/顯示 1 \/ 2 筆/)).toBeNull()
  })

  it('I3: 輸入無命中關鍵字顯示無結果狀態，而非全空狀態', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '9999')

    expect(screen.getByText('找不到符合「9999」的交易。')).toBeTruthy()
    expect(screen.queryByText(/尚無交易紀錄/)).toBeNull()
  })

  it('I4: 過濾中全選只勾選可見列，清除搜尋後未篩選的資料未被勾選', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '台積')

    const selectAllCheckbox = screen.getByRole('checkbox', { name: '全選 / 取消全選' })
    await user.click(selectAllCheckbox)

    // clear search
    const clearBtn = screen.getByRole('button', { name: '清除搜尋' })
    await user.click(clearBtn)

    const tsCheckbox = screen.getByRole('checkbox', { name: /選取 .* 2330/ }) as HTMLInputElement
    const aaplCheckbox = screen.getByRole('checkbox', { name: /選取 .* AAPL/ }) as HTMLInputElement

    expect(tsCheckbox.checked).toBe(true)
    expect(aaplCheckbox.checked).toBe(false)
  })

  it('I5: 勾選兩筆後過濾至剩 1 筆，點刪除選取只刪除可見的該筆交易', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    // Check all 2 items
    const selectAllCheckbox = screen.getByRole('checkbox', { name: '全選 / 取消全選' })
    await user.click(selectAllCheckbox)

    // Search "TSMC" and filter to only 1 item left
    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '台積')

    // Delete selection(1)
    const deleteBtn = screen.getByRole('button', { name: /刪除選取（1）/ })
    window.confirm = () => true
    await user.click(deleteBtn)

    // After deleting "TSMC", there is no hit, click the first clear search button
    const clearBtns = screen.getAllByRole('button', { name: '清除搜尋' })
    await user.click(clearBtns[0])

    // TSMC has been deleted, AAPL (Apple) remains
    expect(screen.queryByText('台積電')).toBeNull()
    expect(screen.getByText('蘋果')).toBeTruthy()
  })

  it('I6: 過濾中點擊欄位排序作用於過濾後結果', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '台積')

    await user.click(screen.getByRole('button', { name: /代號/ }))
    expect(screen.getByText('台積電')).toBeTruthy()
  })

  it('I7: 切換或新建工作區自動清空搜尋關鍵字', async () => {
    const user = userEvent.setup()
    await setupAppWithTwoTransactions(user)

    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' }) as HTMLInputElement
    await user.type(searchInput, '台積')
    expect(searchInput.value).toBe('台積')

    // Add and switch to a new workspace (from 0.6.5-dev.3, management actions are included in the workspace menu, you must open the menu first)
    await user.click(screen.getByRole('button', { name: /^工作區：/ }))
    await user.click(await screen.findByRole('menuitem', { name: '新增工作區' }))
    const dialog = await screen.findByRole('dialog', { name: '新增工作區' })
    const form = within(dialog)
    await user.type(form.getByLabelText('工作區名稱'), '美股長線')
    await user.click(form.getByRole('button', { name: '建立' }))

    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: '搜尋交易' }) as HTMLInputElement).value).toBe('')
    })
  })
})
