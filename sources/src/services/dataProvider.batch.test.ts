/**
 * Task 185 / A3 — `updateTransactionsBatch` goes through one RPC. The database now rolls the whole
 * batch back when an id matches no row; the client keeps its own count check for a database that
 * has not applied that schema.sql yet, and its message must not claim nothing was changed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpc, logClient } = vi.hoisted(() => ({ rpc: vi.fn(), logClient: vi.fn() }))

vi.mock('./supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc } }))
vi.mock('./appLog', () => ({ logClient }))

import { SupabaseProvider } from './dataProvider'

const updates = [
  { id: 't1', price: 50, qty: 2000, fee_tax: 0, fee_rate: null },
  { id: 't2', price: 55, qty: 800, fee_tax: 10, fee_rate: 0.001425 },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SupabaseProvider.updateTransactionsBatch', () => {
  it('B1 sends the rows to apply_transaction_updates and accepts a full apply', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    await new SupabaseProvider().updateTransactionsBatch(updates)
    expect(rpc).toHaveBeenCalledWith('apply_transaction_updates', { p_updates: updates })
  })

  it('B2 an empty batch makes no call', async () => {
    await new SupabaseProvider().updateTransactionsBatch([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('B3 the database rolling the batch back surfaces its message and is logged', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: '批次更新已回復：預期更新 2 筆，實際只找到 1 筆' },
    })
    await expect(new SupabaseProvider().updateTransactionsBatch(updates)).rejects.toThrow(
      '批次更新交易失敗：批次更新已回復：預期更新 2 筆，實際只找到 1 筆',
    )
    expect(logClient).toHaveBeenCalledWith('error', 'updateTransactionsBatch', expect.any(String), { code: 'P0002' })
  })

  it('B4 an old database that returns a short count is still reported, without claiming nothing changed', async () => {
    rpc.mockResolvedValue({ data: 1, error: null })
    const failure = new SupabaseProvider().updateTransactionsBatch(updates)
    await expect(failure).rejects.toThrow('預期更新 2 筆，實際更新 1 筆')
    await expect(failure).rejects.toThrow('已更新的列不會自動回復')
  })
})
