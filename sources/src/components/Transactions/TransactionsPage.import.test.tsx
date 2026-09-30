// @vitest-environment jsdom
/**
 * 取代匯入 end to end through the real local-mode provider. The property being pinned is
 * idempotence: importing the same broker CSV twice must land on the same ledger. That is the whole
 * reason the mode exists — the 合併 path can only skip a row when every field matches exactly, so a
 * broker figure that differs by NT$1 used to be written a second time and doubled the position.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'

const CSV = [
  '交易日期,市場,股票代號,股票名稱,交易類型,交易性質,交易單價,交易股數,手續費,證交稅,借券費',
  '2024-01-10,TPE,2330,台積電,買入,現股,500,1000,712,0,0',
  '2024-02-10,TPE,2454,聯發科,買入,現股,900,1000,1282,0,0',
  '2024-03-10,TPE,2330,台積電,賣出,現股,600,1000,855,1800,0',
].join('\r\n')

/** Same trades, but with the fee the broker actually charged — one NT$ off on the first row. */
const CSV_REFETCHED = CSV.replace('712,0,0', '713,0,0')

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '匯入 CSV' }))
  return screen.findByRole('dialog', { name: '匯入 CSV（舊資料搬遷）' })
}

/** `expectConfirm` is false for the very first import: with nothing to delete there is no prompt. */
async function replaceImport(
  user: ReturnType<typeof userEvent.setup>,
  csv: string,
  expectConfirm: boolean,
) {
  const modal = await openImport(user)
  await user.click(within(modal).getByLabelText('貼上 CSV 內容'))
  await user.paste(csv)
  await user.click(await within(modal).findByLabelText(/以這個檔案取代這段期間/))
  await user.click(await within(modal).findByRole('button', { name: /取代匯入/ }))
  if (!expectConfirm) return
  const confirmDialog = await screen.findByRole('dialog', { name: '取代匯入' })
  await user.click(within(confirmDialog).getByRole('button', { name: '取代匯入' }))
}

/**
 * Data rows in the transactions table (the header row does not count). Scoped to `.tx-table`
 * because the import modal renders a preview table of its own while it is open.
 */
function txRowCount() {
  const table = document.querySelector('.tx-table')
  if (!table) throw new Error('交易表格不存在')
  return within(table as HTMLElement).getAllByRole('row').length - 1
}

describe('取代匯入（本機模式，走真正的 provider）', () => {
  beforeEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('同一份檔案匯兩次，筆數不變', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await replaceImport(user, CSV, false)
    await waitFor(() => expect(txRowCount()).toBe(3))

    // Second pass with the broker's own figures: the differing fee must not add a fourth row.
    await replaceImport(user, CSV_REFETCHED, true)
    await waitFor(() => expect(document.querySelector('.tx-table')?.textContent).toContain('713'))
    expect(txRowCount()).toBe(3)
  })

  it('合併模式：費用差 1 元仍認得出是同一筆，不會重複匯入', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('本機模式')
    await user.click(screen.getByRole('button', { name: /交易紀錄/ }))

    await replaceImport(user, CSV, false)
    await waitFor(() => expect(txRowCount()).toBe(3))

    const modal = await openImport(user)
    await user.click(within(modal).getByLabelText('貼上 CSV 內容'))
    await user.paste(CSV_REFETCHED)
    expect(await within(modal).findByText(/1 筆帳上已有但費用或性質不同/)).toBeTruthy()
    // Nothing is left to import, so the confirm button is disabled at 0 筆.
    const btn = await within(modal).findByRole('button', { name: /確認匯入 0 筆/ })
    expect(btn.hasAttribute('disabled')).toBe(true)
    expect(txRowCount()).toBe(3)
  })
})
