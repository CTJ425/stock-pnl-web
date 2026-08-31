// @vitest-environment jsdom
/**
 * The fee rate and the minimum fee in the transaction form seed from the workspace default,
 * but an edit belongs to that one transaction. The form must not write the value back
 * into the workspace default — the workspace fee dialog owns that value.
 */
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
})
