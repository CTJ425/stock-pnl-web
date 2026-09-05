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
    for (const k of ['delete', 'order', 'eq', 'single', 'in', 'range']) {
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
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, fee_rate, created_at'
const WITHOUT_FEE_RATE =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, created_at'
const WITHOUT_TX_NATURE =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, fee_rate, created_at'
const LEGACY =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at'

const missingColumn = { code: '42703', message: 'column transactions.fee_rate does not exist' }
const missingTxNatureColumn = { code: '42703', message: 'column transactions.tx_nature does not exist' }
const missingUnnamedColumn = { code: '42703', message: 'column transactions.unknown_thing does not exist' }

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
  fee_rate: 0.0004275,
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

  /**
   * BUG-066: PostgREST caps a response at `max_rows` (1000 by default, and that is the value this
   * project runs with), and `listTransactions` had no paging loop. A workspace past that many
   * transactions silently lost every row after the first page, so the ledger — holdings, average
   * cost, realised P&L — was computed from a truncated history with no error anywhere.
   *
   * The threshold is per workspace, not per user, so one active trader reaches it on their own.
   */
  it('T1b 超過一頁時分頁抓完，不靜默截斷 (BUG-066)', async () => {
    const row = (i: number) => ({ id: `t${i}`, fee_tax: 0 })
    const page1 = Array.from({ length: 1000 }, (_, i) => row(i))
    const page2 = Array.from({ length: 200 }, (_, i) => row(1000 + i))
    setResults([
      { data: page1, error: null },
      { data: page2, error: null },
    ])
    const got = await new SupabaseProvider().listTransactions('w1')
    expect(got).toHaveLength(1200)
    expect(got[0].id).toBe('t0')
    expect(got[1199].id).toBe('t1199')
  })

  it('T1c 未滿一頁就停止，不多送一次請求 (BUG-066)', async () => {
    setResults([{ data: [{ id: 't1', fee_tax: 0 }], error: null }])
    const got = await new SupabaseProvider().listTransactions('w1')
    expect(got).toHaveLength(1)
    expect(selects).toEqual([FULL])
  })

  it('T2 retries keeping tx_nature when only fee_rate is missing', async () => {
    const rows = [{ id: 't1', fee_tax: 362 }]
    setResults([{ data: null, error: missingColumn }, { data: rows, error: null }])
    const got = await new SupabaseProvider().listTransactions('w1')
    expect(selects).toEqual([FULL, WITHOUT_FEE_RATE])
    expect(got).toEqual(rows)
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
  it('T4 error names fee_rate only: retry payload keeps tx_nature, drops fee_rate', async () => {
    setResults([{ data: null, error: missingColumn }, { data: [], error: null }])
    await new SupabaseProvider().addTransactions('w1', [newTx])

    expect(payloads).toHaveLength(2)
    const first = (payloads[0] as Record<string, unknown>[])[0]
    const second = (payloads[1] as Record<string, unknown>[])[0]
    expect(first.tx_nature).toBe('DAY_TRADE')
    expect(first.fee_rate).toBe(0.0004275)
    expect(second.tx_nature).toBe('DAY_TRADE')
    expect('fee_rate' in second).toBe(false)
    // The retry must keep every other field, and must not lose the workspace/user keys
    expect(second.fee_tax).toBe(362)
    expect(second.workspace_id).toBe('w1')
    expect(second.user_id).toBe('u1')
    expect(selects).toEqual([FULL, WITHOUT_FEE_RATE])
  })

  it('T4b error names tx_nature only: retry payload keeps fee_rate, drops tx_nature', async () => {
    setResults([{ data: null, error: missingTxNatureColumn }, { data: [], error: null }])
    await new SupabaseProvider().addTransactions('w1', [newTx])

    expect(payloads).toHaveLength(2)
    const second = (payloads[1] as Record<string, unknown>[])[0]
    expect('tx_nature' in second).toBe(false)
    expect(second.fee_rate).toBe(0.0004275)
    expect(selects).toEqual([FULL, WITHOUT_TX_NATURE])
  })

  it('T4c error names neither column: retry drops both (fallback unchanged)', async () => {
    setResults([{ data: null, error: missingUnnamedColumn }, { data: [], error: null }])
    await new SupabaseProvider().addTransactions('w1', [newTx])

    expect(payloads).toHaveLength(2)
    const second = (payloads[1] as Record<string, unknown>[])[0]
    expect('tx_nature' in second).toBe(false)
    expect('fee_rate' in second).toBe(false)
    expect(selects).toEqual([FULL, LEGACY])
  })

  it('T4d first retry also 42703: exactly one further retry dropping both, no third attempt', async () => {
    setResults([
      { data: null, error: missingColumn },
      { data: null, error: missingTxNatureColumn },
      { data: [], error: null },
    ])
    await new SupabaseProvider().addTransactions('w1', [newTx])

    expect(payloads).toHaveLength(3)
    const third = (payloads[2] as Record<string, unknown>[])[0]
    expect('tx_nature' in third).toBe(false)
    expect('fee_rate' in third).toBe(false)
    expect(selects).toEqual([FULL, WITHOUT_FEE_RATE, LEGACY])
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
        error: { code: 'PGRST204', message: "Could not find the 'fee_rate' column of 'transactions' in the schema cache" },
      },
      { data: [], error: null },
    ])
    await new SupabaseProvider().addTransactions('w1', [newTx])
    expect(payloads).toHaveLength(2)
    expect('fee_rate' in (payloads[1] as Record<string, unknown>[])[0]).toBe(false)
  })
})

describe('SupabaseProvider.updateTransaction', () => {
  it('T6 error names fee_rate only: patch keeps tx_nature', async () => {
    setResults([{ data: null, error: missingColumn }, { data: null, error: null }])
    await new SupabaseProvider().updateTransaction('t1', newTx)

    expect(payloads).toHaveLength(2)
    expect((payloads[0] as Record<string, unknown>).tx_nature).toBe('DAY_TRADE')
    expect((payloads[0] as Record<string, unknown>).fee_rate).toBe(0.0004275)
    expect((payloads[1] as Record<string, unknown>).tx_nature).toBe('DAY_TRADE')
    expect('fee_rate' in (payloads[1] as Record<string, unknown>)).toBe(false)
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
