// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../types/models'
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
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    useWorkspace.mockReturnValue({
      transactions: MOCK_TRANSACTIONS,
      updateTransaction,
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

  it('正向分割 (1 拆 N)：以 1:10 換算 NVDA 買入紀錄，單價變 1/10，股數變 10 倍，成本不變', async () => {
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
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算（更新 2 筆紀錄）/ })
    await user.click(confirmBtn)

    expect(updateTransaction).toHaveBeenCalledTimes(2)
    // tx1 update: qty 10 -> 100, price 1200 -> 120, fee_tax 5 unchanged
    expect(updateTransaction).toHaveBeenNthCalledWith(
      1,
      'tx1',
      expect.objectContaining({
        ticker: 'NVDA',
        qty: 100,
        price: 120,
        fee_tax: 5,
        tx_type: 'BUY',
      }),
    )
    // tx2 update: qty 5 -> 50, price 1300 -> 130, fee_tax 3 unchanged
    expect(updateTransaction).toHaveBeenNthCalledWith(
      2,
      'tx2',
      expect.objectContaining({
        ticker: 'NVDA',
        qty: 50,
        price: 130,
        fee_tax: 3,
        tx_type: 'BUY',
      }),
    )

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

    expect(updateTransaction).toHaveBeenCalledTimes(1)
    expect(updateTransaction).toHaveBeenCalledWith(
      'tx4',
      expect.objectContaining({
        ticker: '2330',
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

    expect(updateTransaction).toHaveBeenCalledTimes(1)
    expect(updateTransaction).toHaveBeenCalledWith(
      'tx1',
      expect.objectContaining({
        ticker: 'NVDA',
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
      current: { id: 'ws-1', name: '預設工作區', fee_rate: 0.0004275 }, // 3.0 折
    })

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

    expect(updateTransaction).toHaveBeenCalledTimes(1)
    // 24,000 shares @ 13.44 with fee_tax = 137 (3.0 折 of 322,560)
    expect(updateTransaction).toHaveBeenCalledWith(
      'tx-00685L',
      expect.objectContaining({
        ticker: '00685L',
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

    expect(updateTransaction).toHaveBeenCalledWith(
      'tx-00685L',
      expect.objectContaining({
        ticker: '00685L',
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
      current: { id: 'ws-1', name: '預設工作區', fee_rate: 0.0004275 }, // Workspace 預設為 3 折
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    // Ratio 24
    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '24' } })

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ })
    await user.click(confirmBtn)

    expect(updateTransaction).toHaveBeenCalledWith(
      'tx-00685L-orig',
      expect.objectContaining({
        ticker: '00685L',
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
    expect(updateTransaction).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  /**
   * AUDIT-11: the loop awaits one `updateTransaction` per row inside a single `try`. A failure part
   * way through leaves the earlier rows converted and the rest untouched, so one ticker holds two
   * share bases at once. The message said only 「更新失敗」. There is no transaction API to roll back
   * with, so the requirement is that the message states exactly how far the batch got.
   */
  it('中途失敗時回報已完成筆數與未變更筆數 (AUDIT-11)', async () => {
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

    updateTransaction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'))

    useWorkspace.mockReturnValue({
      transactions: txs,
      updateTransaction,
      current: { id: 'ws-1', name: '預設工作區' },
    })

    render(<StockSplitModal onClose={onClose} onSuccess={onSuccess} />)

    const ratioInput = screen.getByRole('spinbutton', { name: '分割比例' })
    fireEvent.change(ratioInput, { target: { value: '2' } })

    const confirmBtn = screen.getByRole('button', { name: /確認套用分割換算/ })
    await user.click(confirmBtn)

    expect(updateTransaction).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/已完成 1 筆，第 2 筆更新失敗/)).toBeTruthy()
    expect(screen.getByText(/其餘 1 筆未變更/)).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

})
