/**
 * SupabaseProvider transaction paths must survive a database that has not yet run the
 * `tx_nature` part of schema.sql. PostgREST rejects the whole query for an unknown column,
 * so a deploy that lands before the migration would otherwise break reading, adding and
 * editing every transaction. Same treatment as `fee_rate` in dataProvider.workspaces.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NewTransaction } from '../types/models'

const { from, selects, payloads, setResults } = vi.hoisted(() => {
  let queue: unknown[] = [{ data: [], error: null }]
  const seen: string[] = []
  const sent: unknown[] = []
  const take = () => (queue.length > 1 ? queue.shift() : queue[0])
  const make = (): unknown => {
    const q: Record<string, unknown> = {}
    for (const k of ['delete', 'order', 'eq', 'single', 'in']) {
      q[k] = vi.fn(() => q)
    }
    q.select = vi.fn((cols: string) => {
      seen.push(cols)
      return q
    })
    for (const k of ['insert', 'update']) {
      q[k] = vi.fn((payload: unknown) => {
        sent.push(payload)
        return q
      })
    }
    q.then = (onOk: (v: unknown) => unknown) => Promise.resolve(take()).then(onOk)
    return q
  }
  return {
    from: vi.fn(() => make()),
    selects: seen,
    payloads: sent,
    setResults: (rs: unknown[]) => {
      queue = rs
    },
  }
})

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from, auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) } },
}))

import { SupabaseProvider } from './dataProvider'

const FULL =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, created_at'
const LEGACY =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at'

const missingColumn = { code: '42703', message: 'column transactions.tx_nature does not exist' }

const newTx: NewTransaction = {
  tx_date: '2026-08-18',
  market: 'TPE',
  ticker: '2344',
  name: '華邦電',
  tx_type: 'SELL',
  price: 188.5,
  qty: 1000,
  fee_tax: 362,
  tx_nature: 'DAY_TRADE',
}

beforeEach(() => {
  vi.clearAllMocks()
  selects.length = 0
  payloads.length = 0
  setResults([{ data: [], error: null }])
})

describe('SupabaseProvider.listTransactions', () => {
  it('T1 asks for tx_nature and returns the rows in one query', async () => {
    setResults([{ data: [], error: null }])
    await new SupabaseProvider().listTransactions('w1')
    expect(selects).toEqual([FULL])
  })

  it('T2 retries without tx_nature when the column does not exist yet', async () => {
    const legacyRows = [{ id: 't1', fee_tax: 362 }]
    setResults([{ data: null, error: missingColumn }, { data: legacyRows, error: null }])
    const got = await new SupabaseProvider().listTransactions('w1')
    expect(selects).toEqual([FULL, LEGACY])
    expect(got).toEqual(legacyRows)
  })

  it('T3 throws when the retry also fails', async () => {
    setResults([
      { data: null, error: missingColumn },
      { data: null, error: { code: '42501', message: '權限不足' } },
    ])
    await expect(new SupabaseProvider().listTransactions('w1')).rejects.toThrow('載入交易紀錄失敗')
  })
})

describe('SupabaseProvider.addTransactions', () => {
  it('T4 sends tx_nature, then retries with it stripped when the column is missing', async () => {
    setResults([{ data: null, error: missingColumn }, { data: [], error: null }])
    await new SupabaseProvider().addTransactions('w1', [newTx])

    expect(payloads).toHaveLength(2)
    const first = (payloads[0] as Record<string, unknown>[])[0]
    const second = (payloads[1] as Record<string, unknown>[])[0]
    expect(first.tx_nature).toBe('DAY_TRADE')
    expect('tx_nature' in second).toBe(false)
    // The retry must keep every other field, and must not lose the workspace/user keys
    expect(second.fee_tax).toBe(362)
    expect(second.workspace_id).toBe('w1')
    expect(second.user_id).toBe('u1')
    expect(selects).toEqual([FULL, LEGACY])
  })

  it('T5 does not retry when the first insert succeeds', async () => {
    setResults([{ data: [], error: null }])
    await new SupabaseProvider().addTransactions('w1', [newTx])
    expect(payloads).toHaveLength(1)
    expect(selects).toEqual([FULL])
  })
})

describe('退回重試只能由「欄位不存在」觸發', () => {
  it('T8 寫入遇到其他錯誤時不得重試：INSERT 不具冪等性，重試會寫出重複交易', () => {
    // 若第一次其實已寫入、只是回應失敗，盲目重試就會多出一筆一模一樣的交易，
    // 而且沒有任何地方會發現 —— 部位成本直接被汙染
    setResults([
      { data: null, error: { code: '23514', message: 'new row violates check constraint' } },
      { data: [], error: null },
    ])
    return expect(new SupabaseProvider().addTransactions('w1', [newTx]))
      .rejects.toThrow('寫入交易失敗')
      .then(() => {
        expect(payloads).toHaveLength(1)
      })
  })

  it('T9 更新遇到其他錯誤時同樣不重試', async () => {
    setResults([
      { data: null, error: { code: '42501', message: '權限不足' } },
      { data: null, error: null },
    ])
    await expect(new SupabaseProvider().updateTransaction('t1', newTx)).rejects.toThrow('更新交易失敗')
    expect(payloads).toHaveLength(1)
  })

  it('T10 PostgREST 寫入路徑回報的是 PGRST204，也必須觸發退回', async () => {
    setResults([
      {
        data: null,
        error: { code: 'PGRST204', message: "Could not find the 'tx_nature' column of 'transactions' in the schema cache" },
      },
      { data: [], error: null },
    ])
    await new SupabaseProvider().addTransactions('w1', [newTx])
    expect(payloads).toHaveLength(2)
    expect('tx_nature' in (payloads[1] as Record<string, unknown>[])[0]).toBe(false)
  })
})

describe('SupabaseProvider.updateTransaction', () => {
  it('T6 retries with tx_nature stripped when the column is missing', async () => {
    setResults([{ data: null, error: missingColumn }, { data: null, error: null }])
    await new SupabaseProvider().updateTransaction('t1', newTx)

    expect(payloads).toHaveLength(2)
    expect((payloads[0] as Record<string, unknown>).tx_nature).toBe('DAY_TRADE')
    expect('tx_nature' in (payloads[1] as Record<string, unknown>)).toBe(false)
    expect((payloads[1] as Record<string, unknown>).fee_tax).toBe(362)
  })

  it('T7 throws when the retry also fails', async () => {
    setResults([
      { data: null, error: missingColumn },
      { data: null, error: { code: '42501', message: '權限不足' } },
    ])
    await expect(new SupabaseProvider().updateTransaction('t1', newTx)).rejects.toThrow('更新交易失敗')
  })
})
