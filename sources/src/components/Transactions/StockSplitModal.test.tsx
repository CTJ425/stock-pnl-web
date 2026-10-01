// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'
import { computeLedger } from '../../utils/pnlEngine'
import { StockSplitModal } from './StockSplitModal'

const { useWorkspace } = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
}))

vi.mock('../../context/WorkspaceContext', () => ({ useWorkspace }))

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx1',
    workspace_id: 'ws-1',
    tx_date: '2026-01-10',
    market: 'US',
    ticker: 'NVDA',
    name: 'NVIDIA Corp',
    tx_type: 'BUY',
    price: 1200,
    qty: 10,
    fee_tax: 5,
    created_at: '2026-01-10T00:00:00Z',
  },
  {
    id: 'tx2',
    workspace_id: 'ws-1',
    tx_date: '2026-06-15',
    market: 'US',
    ticker: 'NVDA',
    name: 'NVIDIA Corp',
    tx_type: 'BUY',
    price: 1300,
    qty: 5,
    fee_tax: 3,
    created_at: '2026-06-15T00:00:00Z',
  },
  {
    id: 'tx3',
    workspace_id: 'ws-1',
    tx_date: '2026-07-01',
    market: 'US',
    ticker: 'NVDA',
    name: 'NVIDIA Corp',
    tx_type: 'SELL',
    price: 1350,
    qty: 2,
    fee_tax: 2,
    created_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'tx4',
    workspace_id: 'ws-1',
    tx_date: '2026-03-01',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 1000,
    qty: 2000,
    fee_tax: 2850,
    created_at: '2026-03-01T00:00:00Z',
  },
]

describe('StockSplitModal (股票分割換算精靈)', () => {
  const updateTransaction = vi.fn()
  // Task 166 (TX-03/TX-04): atomic batch apply plus the split audit trail.
  const updateTransactionsBatch = vi.fn(async (_updates: Array<Record<string, unknown>>) => {})
  const listSplitLog = vi.fn(async () => [])
  const recordSplit = vi.fn(async () => {})
  /** Task 166 (TX-04): one atomic batch call replaced the per-row updates. */
  const batchUpdates = () =>
    (updateTransactionsBatch.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    useWorkspace.mockReturnValue({
      transactions: MOCK_TRANSACTIONS,
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區' },
    })
  })

  it('正確列出具備買入紀錄的標的清單', () => {
    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    expect(screen.getByRole('dialog', { name: '股票分割換算精靈' })).toBeTruthy()
    const select = screen.getByRole('combobox', { name: '選擇換算標的' }) as HTMLSelectElement
    // Contains TPE:2330 and US:NVDA
    expect(select.options.length).toBe(2)
  })

  it('正向分割 (1 拆 N)：以 1:10 換算 NVDA 買入與賣出紀錄，單價變 1/10，股數變 10 倍，成本不變', async () => {
    const user = userEvent.setup()
    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Select NVDA
    const select = screen.getByRole('combobox', { name: '選擇換算標的' })
    await user.selectOptions(select, 'US:NVDA')

    // Ratio input
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '10' } })

    // Check preview card stats
    // NVDA buy tx1: 10 * 1200 = 12000; tx2: 5 * 1300 = 6500 => Total qty = 15 -> 150
    expect(screen.getAllByText(/15 →/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/150/).length).toBeGreaterThan(0)

    // Confirm button
    // tx1, tx2 (buys) and tx3 (the 2026-07-01 sell, which is in pre-split units too — Task 185 / A1)
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算（更新 3 筆紀錄）/ })
    await user.click(confirmBtn)

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(batchUpdates()).toHaveLength(3)
    // tx1 update: qty 10 -> 100, price 1200 -> 120, fee_tax 5 unchanged
    expect(batchUpdates()[0]).toMatchObject({
      id: 'tx1',
        qty: 100,
        price: 120,
        fee_tax: 5,
    })
    // tx2 update: qty 5 -> 50, price 1300 -> 130, fee_tax 3 unchanged
    expect(batchUpdates()[1]).toMatchObject({
      id: 'tx2',
        qty: 50,
        price: 130,
        fee_tax: 3,
    })
    // tx3 (SELL): shares and price scale, the fee / tax and the missing rate stay as recorded
    expect(batchUpdates()[2]).toMatchObject({
      id: 'tx3',
      qty: 20,
      price: 135,
      fee_tax: 2,
      fee_rate: null,
    })

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining('NVDA'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('反向分割 (N 併 1)：以 2:1 併股台積電 (2330)，單價變 2 倍，股數變 1/2', async () => {
    const user = userEvent.setup()
    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Select 2330
    const select = screen.getByRole('combobox', { name: '選擇換算標的' })
    await user.selectOptions(select, 'TPE:2330')

    // Switch to reverse split
    const splitTypeSelect = screen.getByRole('combobox', { name: '分割類型' })
    await user.selectOptions(splitTypeSelect, 'reverse')

    // Ratio input: 2
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '2' } })

    // 2000 -> 1000
    expect(screen.getAllByText(/2,000 →/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1,000/).length).toBeGreaterThan(0)

    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算（更新 1 筆紀錄）/ })
    await user.click(confirmBtn)

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(batchUpdates()).toHaveLength(1)
    expect(batchUpdates()).toContainEqual(
      expect.objectContaining({
        id: 'tx4',
        qty: 1000,
        price: 2000,
        fee_tax: 2850,
      }),
    )
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('指定基準截止日 (Cutoff Date)：僅換算截止日（含）前的買入紀錄', async () => {
    const user = userEvent.setup()
    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Select NVDA
    const select = screen.getByRole('combobox', { name: '選擇換算標的' })
    await user.selectOptions(select, 'US:NVDA')

    // Set cutoff date to 2026-05-01 (should only match tx1 on 2026-01-10, tx2 is 2026-06-15)
    const cutoffInput = screen.getByLabelText('基準截止日')
    fireEvent.change(cutoffInput, { target: { value: '2026-05-01' } })

    // Ratio 10
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '10' } })

    // Preview shows only 1 record
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算（更新 1 筆紀錄）/ })
    await user.click(confirmBtn)

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(batchUpdates()).toHaveLength(1)
    expect(batchUpdates()).toContainEqual(
      expect.objectContaining({
        id: 'tx1',
        qty: 100,
        price: 120,
      }),
    )
  })

  it('當原買入紀錄手續費為 0 時，智慧補算手續費依費率自動帶入（3.0 折手續費 137 元）', async () => {
    const user = userEvent.setup()
    const txZeroFee: Transaction = {
      id: 'tx-00685L',
      workspace_id: 'ws-1',
      tx_date: '2026-01-10',
      market: 'TPE',
      ticker: '00685L',
      name: '群益臺灣加權正2',
      tx_type: 'BUY',
      price: 322.56,
      qty: 1000,
      fee_tax: 0, // 原手續費為 0
      created_at: '2026-01-10T00:00:00Z',
    }

    useWorkspace.mockReturnValue({
      transactions: [txZeroFee],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區', fee_rate: 0.0004275 }, // 3.0 折
    })
    // Task 182: the rate is read per transaction date through the settings cache (the same cache
    // `syncWorkspaceFees` fills from the workspace row at bootstrap), not off `current.fee_rate`.
    localStorage.setItem('stock-pnl-web/fee-rate/ws-1', '0.0004275')

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Ratio 24
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '24' } })

    // Check that smart fee checkbox appears and is checked
    const autoFeeCheckbox = screen.getByRole('checkbox', { name: '智慧補算手續費' })
    expect(autoFeeCheckbox).toBeTruthy()
    expect((autoFeeCheckbox as HTMLInputElement).checked).toBe(true)

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ })
    await user.click(confirmBtn)

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(batchUpdates()).toHaveLength(1)
    // 24,000 shares @ 13.44 with fee_tax = 137 (3.0 折 of 322,560)
    expect(batchUpdates()).toContainEqual(
      expect.objectContaining({
        id: 'tx-00685L',
        qty: 24000,
        price: 13.44,
        fee_tax: 137,
      }),
    )
  })

  it('取消勾選智慧補算手續費時，維持手續費為 0', async () => {
    const user = userEvent.setup()
    const txZeroFee: Transaction = {
      id: 'tx-00685L',
      workspace_id: 'ws-1',
      tx_date: '2026-01-10',
      market: 'TPE',
      ticker: '00685L',
      name: '群益臺灣加權正2',
      tx_type: 'BUY',
      price: 322.56,
      qty: 1000,
      fee_tax: 0,
      created_at: '2026-01-10T00:00:00Z',
    }

    useWorkspace.mockReturnValue({
      transactions: [txZeroFee],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區', fee_rate: 0.0004275 },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Ratio 24
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '24' } })

    // Uncheck auto fee
    const autoFeeCheckbox = screen.getByRole('checkbox', { name: '智慧補算手續費' })
    await user.click(autoFeeCheckbox)
    expect((autoFeeCheckbox as HTMLInputElement).checked).toBe(false)

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ })
    await user.click(confirmBtn)

    expect(batchUpdates()).toContainEqual(
      expect.objectContaining({
        id: 'tx-00685L',
        qty: 24000,
        price: 13.44,
        fee_tax: 0,
      }),
    )
  })

  it('當原買入紀錄手續費為 0.1425%（459 元）時，分割後維持 459 元與 0.001425 費率，不被工作區 3 折覆蓋', async () => {
    const user = userEvent.setup()
    const txOriginalFee: Transaction = {
      id: 'tx-00685L-orig',
      workspace_id: 'ws-1',
      tx_date: '2026-01-10',
      market: 'TPE',
      ticker: '00685L',
      name: '群益臺灣加權正2',
      tx_type: 'BUY',
      price: 322.56,
      qty: 1000,
      fee_tax: 459, // 原手續費為 459 (0.1425%)
      fee_rate: 0.001425,
      created_at: '2026-01-10T00:00:00Z',
    }

    useWorkspace.mockReturnValue({
      transactions: [txOriginalFee],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區', fee_rate: 0.0004275 }, // Workspace 預設為 3 折
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Ratio 24
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '24' } })

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ })
    await user.click(confirmBtn)

    expect(batchUpdates()).toContainEqual(
      expect.objectContaining({
        id: 'tx-00685L-orig',
        qty: 24000,
        price: 13.44,
        fee_tax: 459, // 保留 459 元
        fee_rate: 0.001425, // 保留 0.001425 費率
      }),
    )
  })

  it('無任何買入紀錄時顯示空狀態提示', () => {
    useWorkspace.mockReturnValue({
      transactions: [],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區' },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
    expect(screen.getByText('目前沒有任何買入交易紀錄，無法進行分割換算。')).toBeTruthy()
  })

  it('無效分割比例時提示警告並禁用確認按鈕', async () => {
    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '0' } })

    expect(screen.getByText('請輸入大於 0 的有效分割比例數字。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /確認套用分割換算/ })).toBeNull()
  })

  /**
   * AUDIT-09: `Math.round(tx.qty / ratio)` has no floor, and the confirm gate only checks the ratio
   * and the preview length. A 3-share odd lot under a 10-to-1 reverse split becomes 0 shares while
   * its non-zero fee is carried over untouched. `pnlEngine` then adds that fee to `pos.cost` with no
   * matching `pos.qty`, so the average cost and the break-even price stay inflated until the whole
   * position is sold. Nothing throws and no number on screen is marked wrong.
   */
  it('反向分割算出 0 股時擋下確認，不寫入任何一筆 (AUDIT-09)', async () => {
    const user = userEvent.setup()
    const oddLot: Transaction = {
      id: 'tx-odd',
      workspace_id: 'ws-1',
      tx_date: '2026-02-10',
      market: 'TPE',
      ticker: '2454',
      name: '聯發科',
      tx_type: 'BUY',
      price: 1200,
      qty: 3,
      fee_tax: 20,
      created_at: '2026-02-10T00:00:00Z',
    }

    useWorkspace.mockReturnValue({
      transactions: [oddLot],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區' },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    const splitTypeSelect = screen.getByRole('combobox', { name: '分割類型' })
    await user.selectOptions(splitTypeSelect, 'reverse')

    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '10' } })

    expect(screen.getByText(/股數會變成 0 股/)).toBeTruthy()

    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ }) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    await user.click(confirmBtn)
    expect(updateTransactionsBatch).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  /**
   * AUDIT-11 asked the failure message to say how far the per-row loop got. Task 166 (TX-04)
   * removed the partial state instead: one RPC applies every row inside a single statement, so a
   * failure leaves the ledger exactly as it was. The requirement is now that nothing is recorded
   * as applied and the window stays open with an error.
   */
  it('批次失敗時整批不生效、不記錄分割、不關閉視窗 (AUDIT-11 / TX-04)', async () => {
    const user = userEvent.setup()
    const txs: Transaction[] = [
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
        fee_tax: 1425,
        created_at: '2026-01-10T00:00:00Z',
      },
      {
        id: 'tx-b',
        workspace_id: 'ws-1',
        tx_date: '2026-01-11',
        market: 'TPE',
        ticker: '2330',
        name: '台積電',
        tx_type: 'BUY',
        price: 1100,
        qty: 2000,
        fee_tax: 3135,
        created_at: '2026-01-11T00:00:00Z',
      },
    ]

    updateTransactionsBatch.mockRejectedValueOnce(new Error('network down'))

    useWorkspace.mockReturnValue({
      transactions: txs,
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區' },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '2' } })

    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ })
    await user.click(confirmBtn)

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(batchUpdates()).toHaveLength(2)
    expect(await screen.findByText(/未變更|失敗/)).toBeTruthy()
    expect(recordSplit).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })


  /**
   * BUG-065: the wizard selects rows by `tx_type === 'BUY'` alone. A 融券回補 (short cover) is
   * stored as a BUY with `tx_nature: 'SHORT'`, so it was converted as though it were a spot buy,
   * while the open 融券賣出 leg it belongs to — a SELL — was never in scope at all. The position
   * ends up with one leg on the post-split share basis and the other on the pre-split one.
   *
   * Excluding the short rows is only half the fix: a split changes the share count of the short
   * position too, and this wizard cannot convert it. So the user has to be told, not just spared.
   */
  it('融券交易不納入換算，且明確警告需自行處理 (BUG-065)', async () => {
    const user = userEvent.setup()
    const spotBuy: Transaction = {
      id: 'tx-spot',
      workspace_id: 'ws-1',
      tx_date: '2026-01-10',
      market: 'TPE',
      ticker: '2330',
      name: '台積電',
      tx_type: 'BUY',
      price: 1000,
      qty: 1000,
      fee_tax: 1425,
      tx_nature: 'SPOT',
      created_at: '2026-01-10T00:00:00Z',
    }
    const shortCover: Transaction = {
      ...spotBuy,
      id: 'tx-cover',
      tx_date: '2026-02-10',
      qty: 500,
      fee_tax: 712,
      tx_nature: 'SHORT',
    }
    const shortSell: Transaction = {
      ...spotBuy,
      id: 'tx-short-sell',
      tx_date: '2026-02-01',
      tx_type: 'SELL',
      qty: 500,
      fee_tax: 2925,
      tx_nature: 'SHORT',
    }

    useWorkspace.mockReturnValue({
      transactions: [spotBuy, shortCover, shortSell],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區' },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '2' } })

    expect(screen.getByText(/融券交易無法自動換算/)).toBeTruthy()

    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算（更新 1 筆紀錄）/ })
    await user.click(confirmBtn)

    expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    expect(batchUpdates()).toHaveLength(1)
    expect(batchUpdates()).toContainEqual(expect.objectContaining({ id: 'tx-spot', qty: 2000, price: 500 }))
  })

  it('只有融券交易的標的完全不出現在換算清單中 (BUG-065)', () => {
    const shortOnly: Transaction = {
      id: 'tx-only-cover',
      workspace_id: 'ws-1',
      tx_date: '2026-02-10',
      market: 'TPE',
      ticker: '2454',
      name: '聯發科',
      tx_type: 'BUY',
      price: 1200,
      qty: 1000,
      fee_tax: 1710,
      tx_nature: 'SHORT',
      created_at: '2026-02-10T00:00:00Z',
    }
    useWorkspace.mockReturnValue({
      transactions: [shortOnly],
      updateTransaction,
      updateTransactionsBatch,
      listSplitLog,
      recordSplit,
      current: { id: 'ws-1', name: '預設工作區' },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
    expect(screen.queryByRole('combobox', { name: '選擇換算標的' })).toBeNull()
  })

  /**
   * Task 166 (TX-03). The duplicate warning is the only thing standing between a second run of the
   * same split and a share count converted twice, so it needs its own test.
   */
  describe('重複套用同一次分割的防護（Task 166 TX-03）', () => {
    beforeEach(() => {
      cleanup()
      vi.clearAllMocks()
      listSplitLog.mockResolvedValue([
        {
          id: 'log-1',
          workspace_id: 'ws-1',
          market: 'TPE',
          ticker: '2330',
          cutoff_date: null,
          ratio_from: 1,
          ratio_to: 2,
          applied_at: '2026-09-20T10:00:00Z',
        },
      ] as never)
      useWorkspace.mockReturnValue({
        transactions: MOCK_TRANSACTIONS,
        updateTransaction,
        updateTransactionsBatch,
        listSplitLog,
        recordSplit,
        current: { id: 'ws-1', name: '預設工作區' },
      })
    })

    it('偵測到相同分割時先警告，且未勾選確認前不能送出', async () => {
      const user = userEvent.setup()
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

      const select = screen.getByRole('combobox', { name: '選擇換算標的' })
      await user.selectOptions(select, 'TPE:2330')
      const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
      fireEvent.change(ratioInput, { target: { value: '2' } })

      expect(await screen.findByText(/套用過相同的分割換算/)).toBeTruthy()
      const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ }) as HTMLButtonElement
      expect(confirmBtn.disabled).toBe(true)

      await user.click(screen.getByRole('checkbox', { name: '確認要再次套用相同的分割換算' }))
      expect((screen.getByRole('button', { name: /確認套用分割換算/ }) as HTMLButtonElement).disabled).toBe(false)
      await user.click(screen.getByRole('button', { name: /確認套用分割換算/ }))
      expect(updateTransactionsBatch).toHaveBeenCalledTimes(1)
    })

    it('比例不同時不跳警告', async () => {
      const user = userEvent.setup()
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

      const select = screen.getByRole('combobox', { name: '選擇換算標的' })
      await user.selectOptions(select, 'TPE:2330')
      const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
      fireEvent.change(ratioInput, { target: { value: '3' } })

      await screen.findByRole('button', { name: /確認套用分割換算/ })
      expect(screen.queryByText(/套用過相同的分割換算/)).toBeNull()
    })
  })

  /**
   * Task 185 / A1. The engine nets shares across every row of a ticker, so a split that converted
   * only the buys left an earlier partial sell in pre-split units: 1,000 bought, 400 sold, 1 拆 2
   * held 1,600 shares (should be 1,200) and booked a phantom +20,000 of realized profit.
   */
  describe('賣出與股票股利一併換算（Task 185 / A1）', () => {
    const row = (o: Partial<Transaction>): Transaction => ({
      id: 'x',
      workspace_id: 'ws-1',
      tx_date: '2026-01-05',
      market: 'TPE',
      ticker: '2330',
      name: '台積電',
      tx_type: 'BUY',
      price: 100,
      qty: 1000,
      fee_tax: 10,
      created_at: '2026-01-05T00:00:00Z',
      ...o,
    })
    const LEDGER_ROWS: Transaction[] = [
      row({ id: 'b1' }),
      row({ id: 's1', tx_type: 'SELL', tx_date: '2026-02-10', price: 110, qty: 400, fee_tax: 70, created_at: '2026-02-10T00:00:00Z' }),
      row({ id: 'd1', tx_type: 'STOCK_DIVIDEND', tx_date: '2026-03-20', price: 0, qty: 100, fee_tax: 0, created_at: '2026-03-20T00:00:00Z' }),
    ]

    // `vi.clearAllMocks()` keeps implementations, so the duplicate-split tests above leave a logged
    // 2330 1:2 split behind that would block these confirmations.
    beforeEach(() => {
      listSplitLog.mockReset()
      listSplitLog.mockResolvedValue([])
    })

    const useRows = (transactions: Transaction[]) =>
      useWorkspace.mockReturnValue({
        transactions,
        updateTransaction,
        updateTransactionsBatch,
        listSplitLog,
        recordSplit,
        current: { id: 'ws-1', name: '預設工作區' },
      })

    const setRatio = (value: string) =>
      fireEvent.change(screen.getByRole('spinbutton', { name: '分割比例' }), { target: { value } })

    it('1 拆 2 之後，帳上持股翻倍、已實現損益與持有成本不變', async () => {
      const user = userEvent.setup()
      useRows(LEDGER_ROWS)
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
      setRatio('2')
      await user.click(screen.getByRole('button', { name: /確認套用分割換算（更新 3 筆紀錄）/ }))

      const updates = batchUpdates() as unknown as Array<{ id: string; price: number; qty: number; fee_tax: number; fee_rate: number | null }>
      expect(updates.map((u) => u.id)).toEqual(['b1', 's1', 'd1'])
      const byId = new Map(updates.map((u) => [u.id, u]))
      const converted = LEDGER_ROWS.map((t) => ({ ...t, ...byId.get(t.id) }))

      const before = computeLedger(LEDGER_ROWS)
      const after = computeLedger(converted)
      expect(before.positions['TPE:2330'].qty).toBe(700)
      expect(after.positions['TPE:2330'].qty).toBe(1400)
      expect(after.summary.realizedTw).toBeCloseTo(before.summary.realizedTw, 6)
      expect(after.positions['TPE:2330'].cost).toBeCloseTo(before.positions['TPE:2330'].cost, 6)
      expect(after.warnings).toEqual([])
    })

    it('賣出與股票股利的手續費 / 稅金與已記錄的費率原樣寫回，股票股利單價維持 0', async () => {
      const user = userEvent.setup()
      useRows([
        row({ id: 'b1', fee_rate: 0.0004275 }),
        row({ id: 's1', tx_type: 'SELL', tx_date: '2026-02-10', price: 110, qty: 400, fee_tax: 70, fee_rate: 0.0004275 }),
        row({ id: 'd1', tx_type: 'STOCK_DIVIDEND', tx_date: '2026-03-20', price: 0, qty: 100, fee_tax: 0 }),
      ])
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
      setRatio('2')
      await user.click(screen.getByRole('button', { name: /確認套用分割換算/ }))

      expect(batchUpdates()[1]).toMatchObject({ id: 's1', qty: 800, price: 55, fee_tax: 70, fee_rate: 0.0004275 })
      expect(batchUpdates()[2]).toMatchObject({ id: 'd1', qty: 200, price: 0, fee_tax: 0, fee_rate: null })
    })

    it('基準截止日（含）之後的賣出不換算，當天的賣出要換算', async () => {
      const user = userEvent.setup()
      useRows(LEDGER_ROWS)
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
      setRatio('2')

      fireEvent.change(screen.getByLabelText('基準截止日'), { target: { value: '2026-02-09' } })
      expect(screen.getByRole('button', { name: /確認套用分割換算（更新 1 筆紀錄）/ })).toBeTruthy()

      fireEvent.change(screen.getByLabelText('基準截止日'), { target: { value: '2026-02-10' } })
      await user.click(screen.getByRole('button', { name: /確認套用分割換算（更新 2 筆紀錄）/ }))
      expect(batchUpdates().map((u) => u.id)).toEqual(['b1', 's1'])
    })

    it('反向分割時，賣出股數換算後變成 0 股也要擋下，不寫入任何一筆', async () => {
      const user = userEvent.setup()
      useRows([
        row({ id: 'b1' }),
        row({ id: 's1', tx_type: 'SELL', tx_date: '2026-02-10', price: 110, qty: 4, fee_tax: 20 }),
      ])
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
      await user.selectOptions(screen.getByRole('combobox', { name: '分割類型' }), 'reverse')
      setRatio('10')

      expect(screen.getByText(/股數會變成 0 股/)).toBeTruthy()
      const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ }) as HTMLButtonElement
      expect(confirmBtn.disabled).toBe(true)
      await user.click(confirmBtn)
      expect(updateTransactionsBatch).not.toHaveBeenCalled()
    })

    it('現金股利不換算，統計卡仍只計買入，並提示賣出與股票股利只換算股數與單價', async () => {
      useRows([
        ...LEDGER_ROWS,
        row({ id: 'cash', tx_type: 'DIVIDEND', tx_date: '2026-04-01', price: 3, qty: 700, fee_tax: 0 }),
      ])
      render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)
      setRatio('2')

      expect(screen.getByRole('button', { name: /確認套用分割換算（更新 3 筆紀錄）/ })).toBeTruthy()
      expect(screen.getByText(/賣出與股票股利紀錄只換算股數與單價/)).toBeTruthy()
      // 總買入股數 is the buy side only: 1,000 → 2,000, not 1,500 → 3,000
      expect(screen.getAllByText(/1,000 →/).length).toBeGreaterThan(0)
    })
  })
})
