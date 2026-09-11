// @vitest-environment jsdom
/**
 * Task 158 #12: on narrow screens the four low-use tools (分割換算 / 重算手續費 / 匯入 / 匯出) collapse
 * into one 「工具」 button that opens a 「交易工具」 sheet. CSS decides which of the two is visible,
 * so jsdom sees both; the sheet itself is JS and is asserted here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

async function openTransactions(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await screen.findByText('本機模式')
  await user.click(screen.getByRole('button', { name: /交易紀錄/ }))
}

describe('TransactionsPage 工具 sheet', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('lists the four tools in a 交易工具 sheet', async () => {
    const user = userEvent.setup()
    await openTransactions(user)

    await user.click(await screen.findByRole('button', { name: '工具' }))
    const sheet = await screen.findByRole('dialog', { name: '交易工具' })
    const labels = within(sheet)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['股票分割換算', '重算手續費', '匯入 CSV', '匯出 CSV']))
  })

  it('closes the sheet and opens the chosen tool', async () => {
    const user = userEvent.setup()
    await openTransactions(user)

    await user.click(await screen.findByRole('button', { name: '工具' }))
    const sheet = await screen.findByRole('dialog', { name: '交易工具' })
    await user.click(within(sheet).getByRole('button', { name: '匯入 CSV' }))

    expect(screen.queryByRole('dialog', { name: '交易工具' })).toBeNull()
    expect(await screen.findByRole('dialog', { name: '匯入 CSV（舊資料搬遷）' })).toBeTruthy()
  })
})
