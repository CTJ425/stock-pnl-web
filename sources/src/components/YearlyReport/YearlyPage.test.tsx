// @vitest-environment jsdom
/**
 * Task 166: the yearly report gained a 股利 column (EN-01) and its ROI now skips oversold sell
 * legs (DA-07). Both are money figures the page had no test for at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { computeLedger } from '../../utils/pnlEngine'
import type { Transaction, TxType } from '../../types/models'
import { YearlyPage } from './YearlyPage'

const { useWorkspace } = vi.hoisted(() => ({ useWorkspace: vi.fn() }))
vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))

let seq = 0
function tx(date: string, type: TxType, price: number, qty: number, fee = 0): Transaction {
  seq++
  return {
    id: `tx-${seq}`,
    workspace_id: 'ws',
    tx_date: date,
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: type,
    price,
    qty,
    fee_tax: fee,
    created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

function renderWith(transactions: Transaction[]) {
  useWorkspace.mockReturnValue({ ledger: computeLedger(transactions) })
  render(<YearlyPage />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('YearlyPage 股利與 ROI', () => {
  it('現金股利顯示在年度列，且總報酬 = 已實現 + 股利', async () => {
    renderWith([
      tx('2024-01-10', 'BUY', 500, 1000, 712),
      tx('2024-06-01', 'SELL', 600, 1000, 2655),
      tx('2024-07-15', 'DIVIDEND', 3.5, 1000, 100),
    ])
    // 已實現 600*1000-2655-500712 = 96,633；股利 3,400；總報酬 100,033
    const row = (await screen.findByText('2024')).closest('tr')!
    expect(within(row).getByText(/3,400/)).toBeTruthy()
    expect(within(row).getByText(/100,033/)).toBeTruthy()
  })

  it('沒有股利時不影響既有數字', async () => {
    renderWith([
      tx('2024-01-10', 'BUY', 500, 1000, 712),
      tx('2024-06-01', 'SELL', 600, 1000, 2655),
    ])
    const row = (await screen.findByText('2024')).closest('tr')!
    expect(within(row).getAllByText(/96,633/).length).toBeGreaterThan(0)
  })

  it('超賣的賣出腿不計入 ROI（DA-07）', async () => {
    // 只買 600 股卻賣出 1000 股：超出的 400 股成本以 0 計，ROI 不得被灌大
    renderWith([
      tx('2024-01-10', 'BUY', 500, 600, 427),
      tx('2024-06-01', 'SELL', 600, 1000, 2655),
    ])
    const row = (await screen.findByText('2024')).closest('tr')!
    // 全部賣出腿都是超賣 → 報酬率顯示 —
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('YearlyPage 搜尋', () => {
  it('輸入搜尋後自動展開年度與逐筆賣出，清除後收回', async () => {
    renderWith([
      tx('2026-01-10', 'BUY', 500, 1000, 712),
      tx('2026-06-01', 'SELL', 600, 1000, 2655),
    ])
    // 預設收合：看不到個股列與賣出腿
    expect(screen.queryByText(/2330（/)).toBeNull()
    expect(screen.queryByText(/賣出 1,000 股/)).toBeNull()

    const input = screen.getByLabelText('搜尋年度收益的股票')
    fireEvent.change(input, { target: { value: '2330' } })
    expect(screen.getByText(/2330（/)).toBeTruthy()
    expect(screen.getByText(/賣出 1,000 股/)).toBeTruthy()

    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByText(/2330（/)).toBeNull()
  })
})
