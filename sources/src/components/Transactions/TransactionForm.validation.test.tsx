// @vitest-environment jsdom
/**
 * Task 158 #6 and Task 159 D2 / D6: numeric keyboards on iOS, one error per field instead of a
 * combined sentence, and the fee rate read back as a discount (折) so that 0.6 typed for 6 折 is caught.
 */
import { beforeEach, describe, expect, it } from 'vitest'
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

describe('TransactionForm field feedback', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('asks every numeric field for the decimal keypad', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    for (const label of ['交易單價', '交易股數', '手續費率', '最低手續費']) {
      expect(form.getByLabelText(label).getAttribute('inputmode')).toBe('decimal')
    }
  })

  it('names each missing field, focuses the first one, and clears an error once the field is edited', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)

    await user.click(form.getByRole('button', { name: '確認送出' }))

    const ticker = form.getByLabelText(/股票代號/)
    const price = form.getByLabelText('交易單價')
    const qty = form.getByLabelText('交易股數')
    expect(ticker.getAttribute('aria-invalid')).toBe('true')
    expect(price.getAttribute('aria-invalid')).toBe('true')
    expect(qty.getAttribute('aria-invalid')).toBe('true')
    expect(form.getByText('請輸入股票代號')).toBeTruthy()
    expect(form.getByText('單價要大於 0')).toBeTruthy()
    expect(form.getByText('股數要大於 0')).toBeTruthy()
    expect(form.queryByText('請填寫代號、單價與股數（皆須為正數）')).toBeNull()
    expect(document.activeElement).toBe(ticker)

    const describedBy = (price.getAttribute('aria-describedby') ?? '').split(' ')
    expect(describedBy.some((id) => document.getElementById(id)?.textContent === '單價要大於 0')).toBe(true)

    await user.type(price, '500')
    expect(form.queryByText('單價要大於 0')).toBeNull()
    expect(price.getAttribute('aria-invalid')).not.toBe('true')
    expect(form.getByText('股數要大於 0')).toBeTruthy()
  })

  it('reads the fee rate back as a discount and warns when 6 折 is typed as 0.6', async () => {
    const user = userEvent.setup()
    const form = await openNewTransactionForm(user)
    const rate = form.getByLabelText('手續費率')

    await user.clear(rate)
    await user.type(rate, '0.000855')
    expect(form.getByText('＝ 6 折')).toBeTruthy()

    await user.clear(rate)
    await user.type(rate, '0.6')
    expect(form.getByText(/請確認是不是把折數填成小數/)).toBeTruthy()
    expect(form.queryByText('＝ 6 折')).toBeNull()
  })
})
