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

    // 確認選項中沒有「未指定」（Task 141）。買入不列「當沖」：當沖要到賣出才知道，存當沖賣出時
    // 表單會把今天的買進一起標成當沖，所以買進時不用選。
    const labels = () => Array.from(natureSelect.options).map((o) => o.text)
    expect(labels()).not.toContain('未指定')
    expect(labels()).toEqual(['現股', '融資', '融券'])
    expect(form.getByText('當沖會在記賣出時自動判斷')).toBeTruthy()

    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    expect(labels()).toEqual(['現股', '當沖', '融資', '融券'])
    expect(form.queryByText('當沖會在記賣出時自動判斷')).toBeNull()

    // 賣出選了當沖再切回買入，不能留著一個清單裡已經沒有的值。
    await user.selectOptions(natureSelect, 'DAY_TRADE')
    await user.selectOptions(form.getByLabelText('交易類型'), 'BUY')
    expect(natureSelect.value).toBe('SPOT')
    expect(labels()).toEqual(['現股', '融資', '融券'])
  })

  it('1b. 編輯已存成當沖的買入，交易性質仍顯示當沖', async () => {
    window.localStorage.setItem(
      'stock-pnl-web/local-store-v1',
      JSON.stringify({
        workspaces: [{ id: 'ws-dt', name: '測試', created_at: '2026-01-01T00:00:00Z' }],
        transactions: [
          {
            id: 'tx-dt-buy',
            workspace_id: 'ws-dt',
            tx_date: '2026-10-02',
            market: 'TPE',
            ticker: '2330',
            name: '台積電',
            tx_type: 'BUY',
            tx_nature: 'DAY_TRADE',
            price: 500,
            qty: 1000,
            fee_tax: 712,
            created_at: '2026-10-02T01:00:00Z',
          },
        ],
      }),
    )
    window.localStorage.setItem('stock-pnl-web/current-workspace', 'ws-dt')
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    const form = within(await screen.findByRole('dialog', { name: '編輯交易紀錄' }))
    const natureSelect = form.getByLabelText('交易性質') as HTMLSelectElement
    expect(natureSelect.value).toBe('DAY_TRADE')
    expect(Array.from(natureSelect.options).map((o) => o.text)).toEqual(['現股', '當沖', '融資', '融券'])
  })

  it('2. 賣出時點選代號或名稱，可自動顯示現股庫存清單供選取；融券賣出不列庫存', async () => {
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

    // Task 187: 當沖 賣的就是今天買進的現股，所以庫存清單照常出現（這一行是刻意改過的行為）。
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    await user.click(nameInput)
    expect(await form.findByTestId('name-holdings-dropdown')).toBeTruthy()

    // 真正不該列庫存的是融券賣出：它開的是空單，不是處分手上的持股。
    await user.selectOptions(form.getByLabelText('交易性質'), 'SHORT')
    expect(form.queryByTestId('ticker-holdings-dropdown')).toBeNull()
    expect(form.queryByTestId('name-holdings-dropdown')).toBeNull()
  })
})
