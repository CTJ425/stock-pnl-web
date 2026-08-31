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
  it('D1 asks for fee_rate and returns the rows in one query', async () => {
    setResults([{ data: rows, error: null }])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual(['id, name, created_at, fee_rate'])
    expect(got).toEqual(rows)
  })

  it('D2 retries without fee_rate when the column does not exist yet', async () => {
    const legacy = [{ id: 'w1', name: '我的投資組合', created_at: '2026-01-01T00:00:00Z' }]
    setResults([
      { data: null, error: { code: '42703', message: 'column workspaces.fee_rate does not exist' } },
      { data: legacy, error: null },
    ])
    const got = await new SupabaseProvider().listWorkspaces()
    expect(selects).toEqual(['id, name, created_at, fee_rate', 'id, name, created_at'])
    expect(got).toEqual(legacy)
  })

  it('D3 throws when the retry also fails', async () => {
    setResults([
      { data: null, error: { code: '42703', message: 'nope' } },
      { data: null, error: { code: '42501', message: '權限不足' } },
    ])
    await expect(new SupabaseProvider().listWorkspaces()).rejects.toThrow('載入工作區失敗')
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
