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
  // Task 166 (TX-04): the apply path is one atomic RPC, not a per-row loop.
  const updateTransactionsBatch = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    useWorkspace.mockReturnValue({
      transactions: MOCK_TRANSACTIONS,
      updateTransaction,
      updateTransactionsBatch,
      current: { id: 'ws-1', name: '預設工作區' },
    })
  })

  it('全部成功時以單一批次更新並關閉視窗', async () => {
    const user = userEvent.setup()
    updateTransactionsBatch.mockResolvedValue(undefined)

    render(<RecalcFeesModal onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /更新勾選的 2 筆手續費/ }))

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(updateTransactionsBatch.mock.calls[0][0]).toHaveLength(2)
    expect(updateTransaction).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  /**
   * AUDIT-11 was「中途失敗時回報已完成幾筆」. Task 166 (TX-04) removed the partial-apply state
   * itself: the batch is one statement, so a failure changes nothing. The requirement is now that
   * the user is told the update did not happen and the window stays open.
   */
  it('批次失敗時不關閉視窗，並說明沒有任何一筆被更新', async () => {
    const user = userEvent.setup()
    updateTransactionsBatch.mockRejectedValue(new Error('network down'))

    render(<RecalcFeesModal onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /更新勾選的 2 筆手續費/ }))

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/未變更|失敗/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
