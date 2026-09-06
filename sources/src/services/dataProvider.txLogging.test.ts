/**
 * Spec 146 Phase 3 — the transaction write path throws on failure, and every caller turns that
 * throw into a toast the user reads once and then loses. The write must be recorded before the
 * throw travels, and the throw itself must be unchanged: callers depend on it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NewTransaction } from '../types/models'

const { from, setResults, logClient } = vi.hoisted(() => {
  let queue: unknown[] = [{ data: [], error: null }]
  const take = () => (queue.length > 1 ? queue.shift() : queue[0])
  const make = (): unknown => {
    const q: Record<string, unknown> = {}
    for (const k of ['delete', 'order', 'eq', 'single', 'in', 'range', 'select', 'insert', 'update']) {
      q[k] = vi.fn(() => q)
    }
    q.then = (onOk: (v: unknown) => unknown) => Promise.resolve(take()).then(onOk)
    return q
  }
  return {
    from: vi.fn(() => make()),
    logClient: vi.fn(),
    setResults: (rs: unknown[]) => {
      queue = rs
    },
  }
})

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) },
  },
}))
vi.mock('./appLog', () => ({ logClient }))

const { SupabaseProvider } = await import('./dataProvider')

const TX: NewTransaction = {
  tx_date: '2026-09-06',
  market: 'TPE',
  ticker: '2330',
  name: '台積電',
  tx_type: 'BUY',
  price: 900,
  qty: 1000,
  fee_tax: 100,
}

const FAIL = { data: null, error: { message: 'permission denied', code: '42501' } }

beforeEach(() => {
  vi.clearAllMocks()
  setResults([{ data: [], error: null }])
})

describe('transaction write failures are recorded', () => {
  it('addTransactions logs and still throws', async () => {
    setResults([FAIL])
    const p = new SupabaseProvider()
    await expect(p.addTransactions('w1', [TX])).rejects.toThrow(/寫入交易失敗/)
    expect(logClient).toHaveBeenCalledTimes(1)
    const [level, action, message] = logClient.mock.calls[0]
    expect(level).toBe('error')
    expect(action).toBe('addTransactions')
    expect(message).toContain('permission denied')
  })

  it('updateTransaction logs and still throws', async () => {
    setResults([FAIL])
    const p = new SupabaseProvider()
    await expect(p.updateTransaction('t1', TX)).rejects.toThrow(/更新交易失敗/)
    expect(logClient).toHaveBeenCalledTimes(1)
    expect(logClient.mock.calls[0][1]).toBe('updateTransaction')
  })

  it('deleteTransactions logs and still throws', async () => {
    setResults([{ data: null, error: { message: 'row not found', code: 'PGRST116' } }])
    const p = new SupabaseProvider()
    await expect(p.deleteTransactions(['t1'])).rejects.toThrow(/刪除交易失敗/)
    expect(logClient).toHaveBeenCalledTimes(1)
    expect(logClient.mock.calls[0][1]).toBe('deleteTransactions')
  })

  it('records the PostgREST code, never the row payload', async () => {
    setResults([FAIL])
    const p = new SupabaseProvider()
    await expect(p.addTransactions('w1', [TX])).rejects.toThrow()
    const detail = logClient.mock.calls[0][3] as Record<string, unknown>
    expect(detail.code).toBe('42501')
    expect(JSON.stringify(detail)).not.toContain('2330')
  })

  it('does not log when the write succeeds', async () => {
    setResults([{ data: [], error: null }])
    const p = new SupabaseProvider()
    await p.addTransactions('w1', [TX])
    expect(logClient).not.toHaveBeenCalled()
  })
})
