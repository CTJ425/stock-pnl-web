// @vitest-environment jsdom
/**
 * UI 煙霧測試（本機模式）：
 * 走過「啟動 → 新增交易 → Dashboard / 年度收益 / 交易紀錄呈現」的完整使用流程，
 * 驗證 Context、資料層（LocalProvider）與各頁面的實際接線。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { APP_AUTHOR, APP_VERSION } from './version'

describe('App（本機模式煙霧測試）', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('啟動後自動建立預設工作區並顯示空狀態', async () => {
    render(<App />)
    // 本機模式免登入，直接進入主畫面
    expect(await screen.findByText('本機模式')).toBeTruthy()
    expect(await screen.findByText(/目前沒有持股/)).toBeTruthy()
    // 預設工作區
    const wsSelect = screen.getByLabelText('切換工作區') as HTMLSelectElement
    await waitFor(() => expect(wsSelect.options.length).toBe(1))
    expect(wsSelect.options[0].text).toBe('我的投資組合')
  })

  it('版本標記固定於左下角徽章，不再出現在服務狀態頁', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await screen.findByText('本機模式')

    const badge = container.querySelector('.version-badge')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toContain(APP_VERSION)
    expect(badge!.textContent).toContain(APP_AUTHOR)

    await user.click(screen.getByRole('button', { name: /服務狀態/ }))
    expect(await screen.findByText('關於本專案')).toBeTruthy()
    expect(screen.queryByText('版本戳記')).toBeNull()
  })

  it('未實現損益一律以「淨」命名，台股卡片不重複列出預扣說明', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    await user.click(screen.getByRole('button', { name: /庫存總覽/ }))
    expect(await screen.findByText('台股未實現淨損益')).toBeTruthy()
    expect(screen.getByText('美股未實現淨損益')).toBeTruthy()
    // 說明改為卡片標題的 tooltip，不再佔一行
    expect(screen.queryByText('主數字已預扣賣出手續費與證交稅')).toBeNull()
    expect(screen.getByText('台股未實現淨損益').getAttribute('title')).toContain(
      '已預扣賣出手續費與證交稅',
    )
  })

  it('新增台股買入交易 → 三個頁面同步呈現', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    // 切到「交易紀錄」開啟表單
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))

    const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    const form = within(dialog)

    await user.type(form.getByLabelText(/股票代號/), '2330')
    await user.type(form.getByLabelText('股票名稱'), '台積電')
    await user.type(form.getByLabelText('交易單價'), '500')
    await user.type(form.getByLabelText('交易股數'), '1') // 1 張 = 1000 股

    // 手續費自動估算：floor(500 * 1000 * 0.001425) = 712
    await waitFor(() => {
      expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('712')
    })

    await user.click(form.getByRole('button', { name: '確認送出' }))
    expect(await form.findByText(/成功新增交易紀錄/)).toBeTruthy()
    await user.click(form.getByRole('button', { name: '關閉' }))

    // 交易紀錄表格
    expect(await screen.findByText('台積電')).toBeTruthy()
    expect(screen.getByText('買入')).toBeTruthy()
    expect(screen.getByText('1,000')).toBeTruthy()

    // Dashboard：持股與均價 (500712 / 1000 = 500.712 → NT$500.71)
    await user.click(screen.getByRole('button', { name: /庫存總覽/ }))
    expect(await screen.findByText('NT$500.71')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /未實現淨損益/ })).toBeTruthy()

    // 年度收益：KPI 與年度列
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    expect(await screen.findByText('歷史累計交易筆數 (台美股合計)')).toBeTruthy()
    expect(screen.getByText(String(new Date().getFullYear()))).toBeTruthy()

    // 服務狀態：本機模式下後端元件應為「未啟用」而非故障，且整體仍為正常
    await user.click(screen.getByRole('button', { name: /服務狀態/ }))
    expect(await screen.findByText('所有系統運作正常')).toBeTruthy()
    expect(screen.getByText('Edge Function (stock-price)')).toBeTruthy()
    expect(screen.getAllByText('未啟用').length).toBeGreaterThan(0)
  })

  it('編輯交易 → 修改單價後自動重算手續費並更新列表', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    // 以全域浮動按鈕新增一筆交易
    await user.click(screen.getByRole('button', { name: /新增交易/ }))
    const addDialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    const addForm = within(addDialog)
    await user.type(addForm.getByLabelText(/股票代號/), '2330')
    await user.type(addForm.getByLabelText('股票名稱'), '台積電')
    await user.type(addForm.getByLabelText('交易單價'), '500')
    await user.type(addForm.getByLabelText('交易股數'), '1')
    await user.click(addForm.getByRole('button', { name: '確認送出' }))
    await addForm.findByText(/成功新增交易紀錄/)
    await user.click(addForm.getByRole('button', { name: '關閉' }))

    // 開啟編輯：帶入原內容（股數以零股 1000 呈現、手續費保留原記錄 712 不被重算）
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    const editDialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    const editForm = within(editDialog)
    expect((editForm.getByLabelText('交易單價') as HTMLInputElement).value).toBe('500')
    expect((editForm.getByLabelText('交易股數') as HTMLInputElement).value).toBe('1000')
    expect((editForm.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('712')

    // 改單價 → 手續費自動重算：floor(600 * 1000 * 0.001425) = 855
    const priceInput = editForm.getByLabelText('交易單價')
    await user.clear(priceInput)
    await user.type(priceInput, '600')
    await waitFor(() => {
      expect((editForm.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('855')
    })

    await user.click(editForm.getByRole('button', { name: '儲存變更' }))
    // 儲存後視窗關閉，列表呈現新單價
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '編輯交易紀錄' })).toBeNull()
    })
    expect(await screen.findByText('NT$600.00')).toBeTruthy()
  })

  it('CSV 匯入舊試算表格式 → 正確拆解 TPE: 前綴並重算損益', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')

    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /匯入 CSV/ }))

    const dialog = await screen.findByRole('dialog', { name: /匯入 CSV/ })
    const form = within(dialog)
    const csv = [
      '交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金,損益/收支',
      '2024/01/10,TPE:2330,台積電,買入,500,1000,712,-500712',
      '2025/02/01,TPE:2330,台積電,賣出,700,500,1548,348452',
    ].join('\n')

    const textarea = form.getByPlaceholderText(/交易日期,股票代號/)
    await user.click(textarea)
    await user.paste(csv)

    expect(await form.findByText(/共 2 筆有效交易/)).toBeTruthy()
    await user.click(form.getByRole('button', { name: /確認匯入 2 筆/ }))

    expect(await screen.findByText(/已匯入 2 筆交易/)).toBeTruthy()

    // 年度收益：2025 已實現 = (700*500-1548) - 500.712*500 = +NT$98,096（+號、紅漲）
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    const hits = await screen.findAllByText('+NT$98,096')
    expect(hits.length).toBeGreaterThan(0)
  })
})
