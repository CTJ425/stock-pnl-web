// @vitest-environment jsdom
/**
 * Task 183: 代扣費用 for a TW cash dividend behaves exactly like 手續費 — filled automatically and
 * kept in step with 每股股利 / 配發股數 while the form is open. What these tests protect is that
 * parity, plus the two places it stops: an existing row is not rewritten the moment it is opened,
 * and whatever stands in the field at submit is what gets stored.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

async function openDividendForm(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
  await user.click(await screen.findByRole('button', { name: /新增交易/ }))
  const dialog = await screen.findByRole('dialog', { name: '新增交易紀錄' })
  const form = within(dialog)
  await user.selectOptions(form.getByLabelText('交易類型'), 'DIVIDEND')
  return form
}

/** 每股股利 × 配發股數, entered the way the form asks for them. */
async function enterPayment(
  user: ReturnType<typeof userEvent.setup>,
  form: ReturnType<typeof within>,
  perShare: string,
  shares: string,
) {
  await user.type(form.getByLabelText('每股股利'), perShare)
  // 股數單位 defaults to 張 and switching it *converts* whatever is already typed, so the unit is
  // chosen first and `shares` is then a plain share count.
  await user.selectOptions(form.getByLabelText('股數單位'), '零股')
  const qty = form.getByLabelText('配發股數')
  await user.clear(qty)
  await user.type(qty, shares)
}

describe('TransactionForm 二代健保試算提示', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('D1: 達起扣點時自動填入 601（二代健保 591 + 匯費 10），和券商實扣相同', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '2', '14000')

    expect((form.getByLabelText(/代扣費用/) as HTMLInputElement).value).toBe('601')
    expect(await form.findByText(/上面是估二代健保 591/)).toBeTruthy()
  })

  it('D2: 未達 20,000 起扣點時只填匯費，並說明原因', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '0.6', '2000')

    expect((form.getByLabelText(/代扣費用/) as HTMLInputElement).value).toBe('10')
    expect(await form.findByText(/未達 20,000 元起扣點/)).toBeTruthy()
  })

  it('D3: 改股數會重新估算並覆蓋欄位 —— 和手續費同一個行為', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '2', '14000')
    const fee = form.getByLabelText(/代扣費用/) as HTMLInputElement
    expect(fee.value).toBe('601')

    // 使用者先改成自己的數字，再動股數 —— 新的估算值會蓋掉它，就像手續費一樣。
    await user.clear(fee)
    await user.type(fee, '661')
    expect(fee.value).toBe('661')

    const qty = form.getByLabelText('配發股數')
    await user.clear(qty)
    await user.type(qty, '15000')
    // 15,000 × 2 = 30,000 → 633 + 10
    await waitFor(() => expect(fee.value).toBe('643'))
  })

  it('D4: 改每股股利也會重新估算', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '2', '14000')
    const fee = form.getByLabelText(/代扣費用/) as HTMLInputElement

    const perShare = form.getByLabelText('每股股利')
    await user.clear(perShare)
    await user.type(perShare, '1')
    // 14,000 × 1 = 14,000，未達起扣點 → 只剩匯費
    await waitFor(() => expect(fee.value).toBe('10'))
  })

  it('D5: 送出時存的是欄位當下的值，不是估算值', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await user.type(form.getByLabelText('股票代號（台股 2330 / 美股 AAPL）'), '2609')
    await user.type(form.getByLabelText('股票名稱'), '陽明')
    await enterPayment(user, form, '2', '14000')

    const fee = form.getByLabelText(/代扣費用/) as HTMLInputElement
    await user.clear(fee)
    await user.type(fee, '661')
    await user.click(form.getByRole('button', { name: /確認送出/ }))

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('stock-pnl-web/local-store-v1') ?? '{}')
      expect(stored.transactions?.[0]?.fee_tax).toBe(661)
    })
  })

  it('D6: 美股股利不自動填也不給說明 —— 預扣稅是另一套規則', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await user.selectOptions(form.getByLabelText('交易市場'), 'US')
    await enterPayment(user, form, '2', '14000')

    expect((form.getByLabelText(/代扣費用/) as HTMLInputElement).value).toBe('0')
    expect(form.queryByText(/估二代健保/)).toBeNull()
    expect(form.queryByText(/未達/)).toBeNull()
  })

  it('D7: 股票股利不估算 —— 它沒有現金進來', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    const form = within(await screen.findByRole('dialog', { name: '新增交易紀錄' }))
    await user.selectOptions(form.getByLabelText('交易類型'), 'STOCK_DIVIDEND')
    await user.selectOptions(form.getByLabelText('股數單位'), '零股')
    const qty = form.getByLabelText('配發股數')
    await user.clear(qty)
    await user.type(qty, '14000')

    expect((form.getByLabelText(/相關費用/) as HTMLInputElement).value).toBe('0')
    expect(form.queryByText(/估二代健保/)).toBeNull()
  })
  it('D8: 編輯既有股利時不會一打開就把存好的代扣費用改掉，動了股數才重估', async () => {
    window.localStorage.setItem('stock-pnl-web/local-store-v1', JSON.stringify({
      workspaces: [{ id: 'ws', name: '本機', created_at: '2026-01-01T00:00:00Z' }],
      transactions: [{
        id: 'd1', workspace_id: 'ws', tx_date: '2026-08-05', market: 'TPE',
        ticker: '2609', name: '陽明', tx_type: 'DIVIDEND', price: 2, qty: 14000,
        // 券商實扣 661，和估算的 601 不同 —— 打開編輯時必須原封不動。
        fee_tax: 661, created_at: '2026-08-05T00:00:00Z',
      }],
    }))
    window.localStorage.setItem('stock-pnl-web/current-workspace', 'ws')

    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /編輯/ }))
    const form = within(await screen.findByRole('dialog', { name: '編輯交易紀錄' }))

    const fee = form.getByLabelText(/代扣費用/) as HTMLInputElement
    expect(fee.value).toBe('661')

    const qty = form.getByLabelText('配發股數')
    await user.clear(qty)
    await user.type(qty, '15000')
    await waitFor(() => expect(fee.value).toBe('643'))
  })
})
