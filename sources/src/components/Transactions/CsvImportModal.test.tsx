// @vitest-environment jsdom
/**
 * Task 166 (TX-01). The unit tests in `src/utils/csv.test.ts` pin `markDuplicateRows`; these pin the
 * wiring that decides which rows actually reach `onImport` — the part that doubles a ledger when it breaks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CsvImportModal } from './CsvImportModal'
import type { NewTransaction, Transaction } from '../../types/models'

const CSV = [
  '交易日期,市場,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
  '2024-01-10,TPE,2330,台積電,買入,500,1000,712',
  '2024-02-10,TPE,2454,聯發科,買入,900,1000,1282',
].join('\r\n')

const existingTsmc: Transaction = {
  id: 'x1',
  workspace_id: 'w',
  tx_date: '2024-01-10',
  market: 'TPE',
  ticker: '2330',
  name: '台積電',
  tx_type: 'BUY',
  price: 500,
  qty: 1000,
  fee_tax: 712,
  created_at: '2026-01-01T00:00:00Z',
}

async function paste(text: string) {
  const area = screen.getByLabelText('貼上 CSV 內容')
  await userEvent.click(area)
  await userEvent.paste(text)
}

describe('CsvImportModal 重複列處理', () => {
  afterEach(() => {
    cleanup()
  })

  it('沒有重複時兩筆都匯入', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[]} />)
    await paste(CSV)
    const btn = await screen.findByRole('button', { name: /確認匯入 2 筆/ })
    await userEvent.click(btn)
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0][0]).toHaveLength(2)
  })

  it('與現有交易相同的列預設不匯入', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc]} />)
    await paste(CSV)
    expect(await screen.findByText(/其中 1 筆與現有交易相同/)).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /確認匯入 1 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    const rows = onImport.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].ticker).toBe('2454')
  })

  it('勾選後才會連同重複列一起匯入', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc]} />)
    await paste(CSV)
    await userEvent.click(await screen.findByLabelText(/仍要匯入與現有交易相同的 1 筆/))
    await userEvent.click(await screen.findByRole('button', { name: /確認匯入 2 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0][0]).toHaveLength(2)
  })
})
