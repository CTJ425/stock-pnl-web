// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

async function openNewTransactionForm(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
  await user.click(await screen.findByRole('button', { name: /新增交易/ }))
  const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
  return within(dialog)
}

describe('TransactionForm 新增交易表單改善測試', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('1. 交易性質預設為現股 (SPOT)，且選項中無「未指定」', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const natureSelect = form.getByLabelText('交易性質') as HTMLSelectElement
    expect(natureSelect.value).toBe('SPOT')

    // 確認選項中沒有「未指定」，且包含現股、當沖、融資、融券（Task 141）
    const options = Array.from(natureSelect.options).map((o) => o.text)
    expect(options).not.toContain('未指定')
    expect(options).toEqual(['現股', '當沖', '融資', '融券'])
  })

  it('2. 賣出時點選代號或名稱，可自動顯示現股庫存清單供選取；非現股（如當沖）不強制顯示庫存', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    // 先買入 2330 台積電 1000 股
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

    // 再開新增交易，切換為「賣出」
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    form = within(dialog)

    // 切換交易類型為 SELL (現股預設為 SPOT)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')

    // 點擊股票代號欄位，應出現庫存持股選單
    const tickerInput = form.getByLabelText(/股票代號/)
    await user.click(tickerInput)

    const tickerDropdown = await form.findByTestId('ticker-holdings-dropdown')
    expect(tickerDropdown.textContent).toContain('2330')
    expect(tickerDropdown.textContent).toContain('台積電')
    expect(tickerDropdown.textContent).toContain('庫存 1,000 股')

    // 點選持股項目，自動填入代號與名稱
    await user.click(within(tickerDropdown).getByText('台積電'))
    expect((tickerInput as HTMLInputElement).value).toBe('2330')
    expect((form.getByLabelText('股票名稱') as HTMLInputElement).value).toBe('台積電')

    // 點擊股票名稱欄位，同樣可觸發持股選單
    const nameInput = form.getByLabelText('股票名稱')
    await user.click(nameInput)
    const nameDropdown = await form.findByTestId('name-holdings-dropdown')
    expect(nameDropdown.textContent).toContain('2330')
    expect(nameDropdown.textContent).toContain('台積電')

    // 切換交易性質為「當沖」(DAY_TRADE)，持股選單不應顯示
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    expect(form.queryByTestId('ticker-holdings-dropdown')).toBeNull()
    expect(form.queryByTestId('name-holdings-dropdown')).toBeNull()
  })
})
