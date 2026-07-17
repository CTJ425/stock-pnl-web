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

    // 年度收益：KPI 與年度列
    await user.click(screen.getByRole('button', { name: /年度收益/ }))
    expect(await screen.findByText('歷史累計交易筆數')).toBeTruthy()
    expect(screen.getByText(String(new Date().getFullYear()))).toBeTruthy()
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
