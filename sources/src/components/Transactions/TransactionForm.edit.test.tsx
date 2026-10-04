// @vitest-environment jsdom
/**
 * Task 193 M1 / M2: the form's fee inputs after an edit and after an add.
 *
 * M1 — edit mode shows the saved quantity in 零股 whatever its size, so the 最低手續費 followed the
 *      unit (odd-lot 1) instead of the row: editing a 1,000-share trade re-priced it below the
 *      whole-lot minimum, and 重算手續費 (which tests `qty >= 1000`) then disagreed.
 * M2 — a 手續費率 typed for one trade (the hint says "只套用在這筆交易") stayed in the field for the next one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'

const { lookupTicker, searchStocks } = vi.hoisted(() => ({ lookupTicker: vi.fn(), searchStocks: vi.fn() }))
vi.mock('../../services/stockSearch', () => ({ searchStocks, lookupTicker }))
vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    current: { id: 'w1' },
    ledger: { holdings: [] },
    transactions: [],
    updateTransactionsBatch: vi.fn(),
  }),
}))

import { TransactionForm } from './TransactionForm'

const saved: Transaction = {
  id: 't1',
  workspace_id: 'w1',
  tx_date: '2026-09-01',
  market: 'TPE',
  ticker: '2330',
  name: '台積電',
  tx_type: 'BUY',
  price: 30,
  qty: 1000,
  fee_tax: 20, // floor(30,000 × 0.0004275) = 12, lifted to the whole-lot minimum of 20
  fee_rate: 0.0004275,
  created_at: '2026-09-01T00:00:00Z',
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.localStorage.clear()
  lookupTicker.mockResolvedValue(null)
  searchStocks.mockResolvedValue([])
})

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

async function retype(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement, value: string) {
  await user.clear(input)
  await user.type(input, value)
}

describe('M1 編輯整股交易時最低手續費照股數', () => {
  it('a 1,000-share row keeps the whole-lot minimum (20), not the odd-lot one (1)', async () => {
    const user = userEvent.setup()
    render(<TransactionForm initial={saved} onSubmit={vi.fn()} />)
    await retype(user, field('交易單價'), '30.5')
    // 30,500 × 0.0004275 = 13.04 → 13; the minimum lifts it to 20.
    await waitFor(() => expect(field('手續費 / 稅金').value).toBe('20'))
    expect(field('最低手續費').value).toBe('20')
  })

  it('a 500-share row still uses the odd-lot minimum', async () => {
    const user = userEvent.setup()
    render(<TransactionForm initial={{ ...saved, qty: 500, fee_tax: 6 }} onSubmit={vi.fn()} />)
    await retype(user, field('交易單價'), '30.5')
    await waitFor(() => expect(field('手續費 / 稅金').value).toBe('6'))
    expect(field('最低手續費').value).toBe('1')
  })

  it('crossing 1,000 shares while editing switches the minimum', async () => {
    const user = userEvent.setup()
    render(<TransactionForm initial={{ ...saved, qty: 500, fee_tax: 6 }} onSubmit={vi.fn()} />)
    await retype(user, field('交易股數'), '1000')
    await waitFor(() => expect(field('最低手續費').value).toBe('20'))
  })
})

describe('M2 單筆輸入的手續費率不帶到下一筆', () => {
  it('goes back to the workspace rate after a successful add', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('stock-pnl-web/fee-rate/w1', '0.0004275')
    render(<TransactionForm onSubmit={vi.fn().mockResolvedValue(undefined)} />)
    expect(field('手續費率').value).toBe('0.0004275')

    await retype(user, field('手續費率'), '0.001425')
    await user.type(field('股票代號（台股 2330 / 美股 AAPL）'), '2330')
    await retype(user, field('交易單價'), '100')
    await retype(user, field('交易股數'), '1')
    await user.click(screen.getByRole('button', { name: '確認送出' }))

    await waitFor(() => expect(field('手續費率').value).toBe('0.0004275'))
  })
})
