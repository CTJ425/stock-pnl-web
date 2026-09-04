// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'
import { RecalcFeesModal } from './RecalcFeesModal'

const { useWorkspace } = vi.hoisted(() => ({ useWorkspace: vi.fn() }))

vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))
vi.mock('../../utils/settings', () => ({
  getFeeRate: () => 0.001425,
  getMinFee: (kind: 'whole' | 'odd') => (kind === 'whole' ? 20 : 1),
}))

/** Two TW buys whose recorded fee is 0, so both are proposed for correction. */
const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-a',
    workspace_id: 'ws-1',
    tx_date: '2026-01-10',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 1000,
    qty: 1000,
    fee_tax: 0,
    created_at: '2026-01-10T00:00:00Z',
  },
  {
    id: 'tx-b',
    workspace_id: 'ws-1',
    tx_date: '2026-01-11',
    market: 'TPE',
    ticker: '2454',
    name: '聯發科',
    tx_type: 'BUY',
    price: 1200,
    qty: 1000,
    fee_tax: 0,
    created_at: '2026-01-11T00:00:00Z',
  },
]

describe('RecalcFeesModal (批次重算手續費)', () => {
  const updateTransaction = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    useWorkspace.mockReturnValue({
      transactions: MOCK_TRANSACTIONS,
      updateTransaction,
      current: { id: 'ws-1', name: '預設工作區' },
    })
  })

  it('全部成功時逐筆更新並關閉視窗', async () => {
    const user = userEvent.setup()
    updateTransaction.mockResolvedValue(undefined)

    render(<RecalcFeesModal onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /更新勾選的 2 筆手續費/ }))

    expect(updateTransaction).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  /**
   * AUDIT-11: the loop awaits one `updateTransaction` per checked row inside a single `try`, so a
   * failure part way through leaves earlier rows already rewritten. The message said only
   * 「更新失敗」, which does not tell the user which rows to redo. There is no transaction API to
   * roll back with, so the requirement is that the message states exactly how far the batch got.
   */
  it('中途失敗時回報已完成筆數與未變更筆數，且不關閉視窗 (AUDIT-11)', async () => {
    const user = userEvent.setup()
    updateTransaction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'))

    render(<RecalcFeesModal onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /更新勾選的 2 筆手續費/ }))

    expect(updateTransaction).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/已完成 1 筆，第 2 筆更新失敗/)).toBeTruthy()
    expect(screen.getByText(/其餘 1 筆未變更/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
