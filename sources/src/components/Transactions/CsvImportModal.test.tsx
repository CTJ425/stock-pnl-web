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
    expect(await screen.findByText(/其中 1 筆完全相同/)).toBeTruthy()
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
    await userEvent.click(await screen.findByLabelText(/仍要匯入帳上已經有的 1 筆/))
    await userEvent.click(await screen.findByRole('button', { name: /確認匯入 2 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0][0]).toHaveLength(2)
  })

  it('只有手續費不同也認得出是同一筆，預設跳過', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc]} />)
    await paste(CSV.replace('500,1000,712', '500,1000,713'))
    expect(await screen.findByText(/1 筆帳上已有但費用或性質不同/)).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /確認匯入 1 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    const rows = onImport.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].ticker).toBe('2454')
  })

  it('合併模式不會要求呼叫端刪除任何東西', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc]} />)
    await paste(CSV)
    await userEvent.click(await screen.findByRole('button', { name: /確認匯入 1 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0][1]).toEqual([])
  })
})

/**
 * The mode that actually fixes the double-counting: the CSV owns its date range, so the rows it
 * would have skipped are deleted instead of being guessed at.
 */
describe('CsvImportModal 取代模式', () => {
  afterEach(() => {
    cleanup()
  })

  const pickReplace = async () => {
    await userEvent.click(await screen.findByLabelText(/以這個檔案取代這段期間/))
  }

  it('整份寫入，並把區間內的既有買賣交給呼叫端刪除', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
    const dividend: Transaction = { ...existingTsmc, id: 'd1', tx_date: '2024-01-15', tx_type: 'DIVIDEND' }
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc, dividend]} />)
    await paste(CSV)
    await pickReplace()
    expect(await screen.findByText(/將先刪除 2024-01-10 ～ 2024-02-10 之間現有的 1 筆/)).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /取代匯入 2 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0][0]).toHaveLength(2)
    expect(onImport.mock.calls[0][1]).toEqual(['x1'])
  })

  it('不顯示重複提示，重複列也照樣寫入', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc]} />)
    await paste(CSV)
    await pickReplace()
    expect(screen.queryByText(/完全相同/)).toBeNull()
    expect(screen.queryByLabelText(/仍要匯入帳上已經有的/)).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: /取代匯入 2 筆/ }))
    await waitFor(() => expect(onImport.mock.calls[0][0]).toHaveLength(2))
  })

  it('區間內沒有舊買賣時說明會直接寫入', async () => {
    const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
    render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[]} />)
    await paste(CSV)
    await pickReplace()
    expect(await screen.findByText(/目前沒有買賣紀錄，會直接寫入 2 筆/)).toBeTruthy()
  })

  it('呼叫端取消時不關閉視窗', async () => {
    const onClose = vi.fn()
    const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => false)
    render(<CsvImportModal onClose={onClose} onImport={onImport} existing={[existingTsmc]} />)
    await paste(CSV)
    await pickReplace()
    await userEvent.click(await screen.findByRole('button', { name: /取代匯入 2 筆/ }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
  })

  // Task 193 H1: 取代 deletes BUY / SELL only, so a dividend row in the file used to be written next to
  // the dividend already on the ledger — once more on every re-import.
  describe('取代 does not write dividend rows', () => {
    const WITH_DIVIDENDS = [
      '交易日期,市場,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金',
      '2024-01-10,TPE,2330,台積電,買入,500,1000,712',
      '2024-07-15,TPE,2330,台積電,現金股利,2.2,1000,10',
      '2024-08-01,TPE,2330,台積電,股票股利,0,50,0',
    ].join('\r\n')

    it('sends only the BUY / SELL rows and says how many dividends were left out', async () => {
      const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
      render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[]} />)
      await paste(WITH_DIVIDENDS)
      await userEvent.click(await screen.findByLabelText(/以這個檔案取代這段期間/))
      expect(await screen.findByText(/檔案裡的 2 筆股利不會寫入/)).toBeTruthy()
      await userEvent.click(await screen.findByRole('button', { name: /取代匯入 1 筆/ }))
      await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
      expect(onImport.mock.calls[0][0].map((r) => r.tx_type)).toEqual(['BUY'])
    })

    it('takes the deleted range from the written trades, not from the dividend dates', async () => {
      const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
      const lateTrade: Transaction = { ...existingTsmc, id: 'x2', tx_date: '2024-09-01' }
      render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc, lateTrade]} />)
      await paste(WITH_DIVIDENDS)
      await userEvent.click(await screen.findByLabelText(/以這個檔案取代這段期間/))
      await userEvent.click(await screen.findByRole('button', { name: /取代匯入 1 筆/ }))
      await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
      // The file's only trade is on 2024-01-10, so the 2024-09-01 trade must survive.
      expect(onImport.mock.calls[0][1]).toEqual(['x1'])
    })

    it('writes nothing when the file holds only dividends', async () => {
      const onImport = vi.fn(async (_rows: NewTransaction[], _ids: string[]) => {})
      render(<CsvImportModal onClose={() => {}} onImport={onImport} existing={[existingTsmc]} />)
      await paste(WITH_DIVIDENDS.split('\r\n').filter((_, i) => i !== 1).join('\r\n'))
      await userEvent.click(await screen.findByLabelText(/以這個檔案取代這段期間/))
      expect(await screen.findByText(/只有股利列/)).toBeTruthy()
      expect(screen.getByRole('button', { name: /取代匯入 0 筆/ })).toHaveProperty('disabled', true)
      expect(onImport).not.toHaveBeenCalled()
    })
  })
})
