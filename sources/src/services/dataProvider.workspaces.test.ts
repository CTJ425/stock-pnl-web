/**
 * SupabaseProvider workspace reads must survive a database that has not yet run the
 * `fee_rate` part of schema.sql. PostgREST rejects the whole query for an unknown column,
 * so without a fallback a deploy that lands before the migration breaks every login.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { from, selects, setResults } = vi.hoisted(() => {
  let queue: unknown[] = [{ data: [], error: null }]
  const seen: string[] = []
  const take = () => (queue.length > 1 ? queue.shift() : queue[0])
  const make = (): unknown => {
    const q: Record<string, unknown> = {}
    for (const k of ['insert', 'update', 'delete', 'order', 'eq', 'single', 'in']) {
      q[k] = vi.fn(() => q)
    }
    q.select = vi.fn((cols: string) => {
      seen.push(cols)
      return q
    })
    q.then = (onOk: (v: unknown) => unknown) => Promise.resolve(take()).then(onOk)
    return q
  }
  return {
    from: vi.fn(() => make()),
    selects: seen,
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

const rows = [{ id: 'w1', name: '我的投資組合', created_at: '2026-01-01T00:00:00Z', fee_rate: 0.0004275 }]

beforeEach(() => {
  vi.clearAllMocks()
  selects.length = 0
  setResults([{ data: [], error: null }])
})

describe('SupabaseProvider.listWorkspaces', () => {
  it('D1 asks for every fee column and returns the rows in one query', async () => {
    setResults([{ data: rows, error: null }])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual(['id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis'])
    expect(got).toEqual(rows)
  })

  it('D2 steps down to the legacy columns when neither new column exists yet', async () => {
    const legacy = [{ id: 'w1', name: '我的投資組合', created_at: '2026-01-01T00:00:00Z' }]
    setResults([
      { data: null, error: { code: '42703', message: 'column workspaces.sell_fee_basis does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.day_trade_tax_estimate does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rate_history does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rounding does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rebate does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rate does not exist' } },
      { data: legacy, error: null },
    ])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual([
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate',
      'id, name, created_at, fee_rate',
      'id, name, created_at',
    ])
    expect(got).toEqual(legacy)
  })

  it('D5 keeps fee_rate when only fee_rebate is missing (frontend deployed before the migration)', async () => {
    setResults([
      { data: null, error: { code: '42703', message: 'column workspaces.sell_fee_basis does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.day_trade_tax_estimate does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rate_history does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rounding does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rebate does not exist' } },
      { data: rows, error: null },
    ])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual([
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate',
      'id, name, created_at, fee_rate',
    ])
    expect(got).toEqual(rows)
  })

  it('D7 keeps fee_rebate when only fee_rounding is missing (BUG-088, frontend before the migration)', async () => {
    setResults([
      { data: null, error: { code: '42703', message: 'column workspaces.sell_fee_basis does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.day_trade_tax_estimate does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rate_history does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rounding does not exist' } },
      { data: rows, error: null },
    ])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual([
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate',
    ])
    expect(got).toEqual(rows)
  })

  it('D8 keeps fee_rounding when only fee_rate_history is missing (Task 182, frontend before the migration)', async () => {
    setResults([
      { data: null, error: { code: '42703', message: 'column workspaces.sell_fee_basis does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.day_trade_tax_estimate does not exist' } },
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rate_history does not exist' } },
      { data: rows, error: null },
    ])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual([
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding',
      'id, name, created_at, fee_rate, fee_rebate, fee_rounding',
    ])
    expect(got).toEqual(rows)
  })

  it('D9 keeps day_trade_tax_estimate when only sell_fee_basis is missing (Task 189, frontend before the migration)', async () => {
    setResults([
      { data: null, error: { code: '42703', message: 'column workspaces.sell_fee_basis does not exist' } },
      { data: rows, error: null },
    ])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual([
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis',
      'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate',
    ])
    expect(got).toEqual(rows)
  })

  it('D3 throws when every column set fails', async () => {
    setResults([
      { data: null, error: { code: '42703', message: 'nope' } },
      { data: null, error: { code: '42703', message: 'nope' } },
      { data: null, error: { code: '42703', message: 'nope' } },
      { data: null, error: { code: '42703', message: 'nope' } },
      { data: null, error: { code: '42703', message: 'nope' } },
      { data: null, error: { code: '42501', message: '權限不足' } },
    ])
    await expect(new SupabaseProvider().listWorkspaces()).rejects.toThrow('載入工作區失敗：權限不足')
  })
})

describe('SupabaseProvider.setWorkspaceFeeRate', () => {
  it('D4 throws a named error when the update fails', async () => {
    setResults([{ data: null, error: { code: '42703', message: 'column does not exist' } }])
    await expect(new SupabaseProvider().setWorkspaceFeeRate('w1', 0.0004275)).rejects.toThrow(
      '儲存手續費率失敗',
    )
  })
})

describe('SupabaseProvider.setWorkspaceFeeRebate', () => {
  it('D6 throws a named error when the update fails', async () => {
    setResults([{ data: null, error: { code: '42703', message: 'column workspaces.fee_rebate does not exist' } }])
    await expect(new SupabaseProvider().setWorkspaceFeeRebate('w1', 'monthly')).rejects.toThrow(
      '儲存折扣退還方式失敗',
    )
  })
})

describe('SupabaseProvider.setWorkspaceFeeRounding', () => {
  it('D8 throws a named error when the update fails', async () => {
    setResults([{ data: null, error: { code: '42703', message: 'column workspaces.fee_rounding does not exist' } }])
    await expect(new SupabaseProvider().setWorkspaceFeeRounding('w1', 'position')).rejects.toThrow(
      '儲存手續費計算方式失敗',
    )
  })
})

// A4: PostgREST reports an UPDATE that matched no row as success. Every workspace write asks for
// the ids back and fails on an empty answer, so a workspace deleted elsewhere is not "saved".
describe('SupabaseProvider workspace writes that match no row', () => {
  const none = [{ data: [], error: null }]
  const one = [{ data: [{ id: 'w1' }], error: null }]

  it('D9 renameWorkspace', async () => {
    setResults(one)
    await new SupabaseProvider().renameWorkspace('w1', '新名稱')
    setResults(none)
    await expect(new SupabaseProvider().renameWorkspace('gone', '新名稱')).rejects.toThrow(
      '重新命名工作區失敗：找不到這個工作區',
    )
  })

  it('D10 setWorkspaceFeeRate', async () => {
    setResults(one)
    await new SupabaseProvider().setWorkspaceFeeRate('w1', 0.0004275)
    setResults(none)
    await expect(new SupabaseProvider().setWorkspaceFeeRate('gone', 0.0004275)).rejects.toThrow(
      '儲存手續費率失敗：找不到這個工作區',
    )
  })

  it('D11 setWorkspaceFeeRateHistory', async () => {
    setResults(one)
    await new SupabaseProvider().setWorkspaceFeeRateHistory('w1', [{ from: '2026-10-01', rate: 0.0005415 }])
    setResults(none)
    await expect(
      new SupabaseProvider().setWorkspaceFeeRateHistory('gone', [{ from: '2026-10-01', rate: 0.0005415 }]),
    ).rejects.toThrow('儲存費率生效日失敗：找不到這個工作區')
  })

  it('D12 setWorkspaceFeeRebate', async () => {
    setResults(one)
    await new SupabaseProvider().setWorkspaceFeeRebate('w1', 'monthly')
    setResults(none)
    await expect(new SupabaseProvider().setWorkspaceFeeRebate('gone', 'monthly')).rejects.toThrow(
      '儲存折扣退還方式失敗：找不到這個工作區',
    )
  })

  it('D13 setWorkspaceFeeRounding', async () => {
    setResults(one)
    await new SupabaseProvider().setWorkspaceFeeRounding('w1', 'position')
    setResults(none)
    await expect(new SupabaseProvider().setWorkspaceFeeRounding('gone', 'position')).rejects.toThrow(
      '儲存手續費計算方式失敗：找不到這個工作區',
    )
  })
})
