// @vitest-environment jsdom
/**
 * Task 183: the 代扣費用 field offers an estimate of the 二代健保 premium, and never more than an
 * offer. What these tests protect is that distinction — the number is suggested, the user's own
 * value survives, and the field is still whatever the user last typed when the form is submitted.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

  it('D1: 達起扣點時估出 591 + 匯費 10，與券商實扣的 601 相同', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '2', '14000')

    expect(await form.findByText(/估二代健保 591/)).toBeTruthy()
    expect(form.getByText(/匯費 10/)).toBeTruthy()
    expect(form.getByText(/＝ 601/)).toBeTruthy()
  })

  it('D2: 未達 20,000 起扣點時說明只有匯費', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '0.6', '2000')

    expect(await form.findByText(/未達 20,000 元起扣點/)).toBeTruthy()
    expect(form.queryByText(/估二代健保/)).toBeNull()
  })

  it('D3: 估算值要按下「帶入」才會進欄位，不會自動覆寫', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '2', '14000')

    const fee = form.getByLabelText(/代扣費用/) as HTMLInputElement
    expect(fee.value).not.toBe('601')

    await user.click(await form.findByRole('button', { name: /帶入 601/ }))
    expect(fee.value).toBe('601')
  })

  it('D4: 使用者自己打的數字不會被後來的試算蓋掉', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await enterPayment(user, form, '2', '14000')

    const fee = form.getByLabelText(/代扣費用/) as HTMLInputElement
    await user.type(fee, '661')
    expect(fee.value).toBe('661')

    // Changing the payment re-estimates the hint, but the field is the user's.
    const qty = form.getByLabelText('配發股數')
    await user.clear(qty)
    await user.type(qty, '15000')
    expect(await form.findByText(/估二代健保 633/)).toBeTruthy()
    expect(fee.value).toBe('661')
  })

  it('D5: 美股股利不給提示 — 預扣稅是另一套規則', async () => {
    const user = userEvent.setup()
    const form = await openDividendForm(user)
    await user.selectOptions(form.getByLabelText('交易市場'), 'US')
    await enterPayment(user, form, '2', '14000')

    // 「二代健保」 also appears in the field's own label, so the hint is identified by its offer.
    expect(form.queryByRole('button', { name: /帶入/ })).toBeNull()
    expect(form.queryByText(/估二代健保/)).toBeNull()
    expect(form.queryByText(/未達/)).toBeNull()
  })

  it('D6: 買賣不出現這個提示', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
    await user.click(await screen.findByRole('button', { name: /新增交易/ }))
    const form = within(await screen.findByRole('dialog', { name: '新增交易紀錄' }))

    await user.type(form.getByLabelText('交易單價'), '500')
    const qty = form.getByLabelText('交易股數')
    await user.clear(qty)
    await user.type(qty, '14')

    expect(form.queryByRole('button', { name: /帶入/ })).toBeNull()
    expect(form.queryByText(/估二代健保/)).toBeNull()
  })
})
