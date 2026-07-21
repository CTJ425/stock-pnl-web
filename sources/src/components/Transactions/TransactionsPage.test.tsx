// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

async function setupAppWithTwoTransactions(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')

  // 前往交易紀錄頁面
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

  // 新增第 1 筆：2330 台積電
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

  // 新增第 2 筆：AAPL (Apple Inc. -> 顯示名稱為 蘋果)
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

    // 清除搜尋
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

    // 勾選全部 2 筆
    const selectAllCheckbox = screen.getByRole('checkbox', { name: '全選 / 取消全選' })
    await user.click(selectAllCheckbox)

    // 搜尋「台積」過濾到只剩 1 筆
    const searchInput = screen.getByRole('textbox', { name: '搜尋交易' })
    await user.type(searchInput, '台積')

    // 刪除選取（1）
    const deleteBtn = screen.getByRole('button', { name: /刪除選取（1）/ })
    window.confirm = () => true
    await user.click(deleteBtn)

    // 刪除後「台積」無命中，點第一個清除搜尋按鈕
    const clearBtns = screen.getAllByRole('button', { name: '清除搜尋' })
    await user.click(clearBtns[0])

    // 台積電已被刪除，AAPL (蘋果) 仍然存在
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

    // 新增並切換至新工作區
    await user.click(screen.getByRole('button', { name: '新增工作區' }))
    const dialog = await screen.findByRole('dialog', { name: '新增工作區' })
    const form = within(dialog)
    await user.type(form.getByLabelText('工作區名稱'), '美股長線')
    await user.click(form.getByRole('button', { name: '建立' }))

    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: '搜尋交易' }) as HTMLInputElement).value).toBe('')
    })
  })
})
