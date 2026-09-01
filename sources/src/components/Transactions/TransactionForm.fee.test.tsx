// @vitest-environment jsdom
/**
 * The fee rate and the minimum fee in the transaction form seed from the workspace default,
 * but an edit belongs to that one transaction. The form must not write the value back
 * into the workspace default — the workspace fee dialog owns that value.
 */
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

/** Every localStorage key the workspace fee defaults live under. */
function storedFeeKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)
    if (key && (key.startsWith('stock-pnl-web/fee-rate') || key.startsWith('stock-pnl-web/min-fee')))
      keys.push(key)
  }
  return keys
}

async function openNewTransactionForm(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
  await user.click(await screen.findByRole('button', { name: /新增交易/ }))
  const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
  return within(dialog)
}

describe('TransactionForm 手續費欄位不連動全域預設', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('F1: 修改手續費率不會寫回工作區預設值', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const rate = form.getByLabelText('手續費率')
    await user.clear(rate)
    await user.type(rate, '0.0004275')

    expect((rate as HTMLInputElement).value).toBe('0.0004275')
    expect(storedFeeKeys()).toEqual([])
  })

  it('F2: 修改最低手續費不會寫回工作區預設值', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const minFee = form.getByLabelText('最低手續費')
    await user.clear(minFee)
    await user.type(minFee, '5')

    expect((minFee as HTMLInputElement).value).toBe('5')
    expect(storedFeeKeys()).toEqual([])
  })

  it('F3: 手續費率提示列出原價與常見折扣的費率數字', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    // The numbers must be present verbatim so the user can copy one into the field.
    const hint = form.getByTestId('fee-rate-hint').textContent ?? ''
    expect(hint).toContain('0.001425')
    expect(hint).toContain('0.00092625')
    expect(hint).toContain('0.0004275')
    expect(hint).toContain('6.5')
    expect(hint).toContain('3')
  })
  it('F4: 切換張/零股不會洗掉手動輸入的最低手續費', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    const minFee = form.getByLabelText('最低手續費')
    await user.clear(minFee)
    await user.type(minFee, '7')

    // 單位切走再切回：手動輸入的值沒有其他副本，被覆蓋就永久遺失
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    await user.selectOptions(form.getByLabelText('股數單位'), '張')

    expect((form.getByLabelText('最低手續費') as HTMLInputElement).value).toBe('7')
  })

  it('F5: 未手動輸入時，切到零股仍帶入零股的預設最低手續費', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    expect((form.getByLabelText('最低手續費') as HTMLInputElement).value).toBe('20')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    expect((form.getByLabelText('最低手續費') as HTMLInputElement).value).toBe('1')
  })

  /**
   * 建一筆現股當沖賣出後重開編輯，回傳編輯視窗。
   * `strict` 為 true 時整個 App 包在 StrictMode 下 —— 正式進入點 main.tsx 就是這樣掛的，
   * 而 StrictMode 會把 effect 的 setup 跑兩次，用「跳過第一次」的旗標擋不住第二次。
   */
  async function editSavedDayTradeFee(strict: boolean) {
    const user = userEvent.setup()
    render(<App />, strict ? { wrapper: StrictMode } : undefined)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '2344')
    await user.type(form.getByLabelText('股票名稱'), '華邦電')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    await user.type(form.getByLabelText('交易單價'), '188.5')
    await user.type(form.getByLabelText('交易股數'), '1000')
    const rate = form.getByLabelText('手續費率')
    await user.clear(rate)
    await user.type(rate, '0.0004275')
    const tax = form.getByLabelText('證交稅率')
    await user.clear(tax)
    await user.type(tax, '0.0015')
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('362')
    await user.click(form.getByRole('button', { name: '確認送出' }))
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    return within(dialog)
  }

  it('F6: 編輯既有交易時，載入當下不得依現行費率覆蓋原本的手續費 / 稅金', async () => {
    const form = await editSavedDayTradeFee(false)
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('362')
    expect(form.queryByText(/已依目前費率重算/)).toBeNull()
  })

  it('F6b: StrictMode 下 effect 跑兩次，原紀錄同樣不得被覆蓋', async () => {
    const form = await editSavedDayTradeFee(true)
    expect((form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement).value).toBe('362')
    expect(form.queryByText(/已依目前費率重算/)).toBeNull()
  })

  it('F7: 編輯模式下使用者改動單價後，手續費才重新計算', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

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

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    // 買進 500 × 1000 股，原價費率 → floor(500000*0.001425) = 712
    const fee = form.getByLabelText(/手續費 \/ 稅金/) as HTMLInputElement
    expect(fee.value).toBe('712')

    const price = form.getByLabelText('交易單價')
    await user.clear(price)
    await user.type(price, '600')
    // floor(600000*0.001425) = 855
    expect(fee.value).toBe('855')
  })

  it('F8: 選「當沖」會帶入減半證交稅率，存檔後重開編輯仍記得', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    let dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
    let form = within(dialog)
    await user.selectOptions(form.getByLabelText('交易類型'), 'SELL')
    await user.type(form.getByLabelText(/股票代號/), '2344')
    await user.type(form.getByLabelText('股票名稱'), '華邦電')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    await user.type(form.getByLabelText('交易單價'), '188.5')
    await user.type(form.getByLabelText('交易股數'), '1000')

    // 選了當沖，證交稅率就該是減半的 0.0015 —— 這是使用者本來要手動改的那一步
    await user.selectOptions(form.getByLabelText('交易性質'), 'DAY_TRADE')
    expect((form.getByLabelText('證交稅率') as HTMLInputElement).value).toBe('0.0015')

    await user.click(form.getByRole('button', { name: '確認送出' }))
    await form.findByText(/成功新增交易紀錄/)
    await user.click(form.getByRole('button', { name: '關閉' }))

    await user.click(await screen.findByRole('button', { name: '編輯這筆交易' }))
    dialog = await screen.findByRole('dialog', { name: '編輯交易紀錄' })
    form = within(dialog)
    expect((form.getByLabelText('交易性質') as HTMLSelectElement).value).toBe('DAY_TRADE')
  })

  it('F9: 美股沒有交易性質欄位', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)
    expect(form.getByLabelText('交易性質')).toBeTruthy()
    await user.selectOptions(form.getByLabelText('交易市場'), 'US')
    expect(form.queryByLabelText('交易性質')).toBeNull()
  })
})
