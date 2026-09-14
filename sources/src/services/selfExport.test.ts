import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `supabase` is `null` in local mode, so the export must survive that. A getter in the mock
 * factory lets one test file cover both a configured and an unconfigured client.
 */
const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('./supabase', () => ({
  get supabase() {
    return state.client
  },
  supabaseUrl: 'https://supabase.example',
}))

import { buildSelfExport } from './selfExport'

const rangeCalls: Array<[number, number]> = []

function plain(data: unknown[], error: unknown = null) {
  return { select: () => Promise.resolve({ data, error }) }
}

function paged(pages: unknown[][], error: unknown = null) {
  let call = 0
  return {
    select: () => ({
      order: () => ({
        range: (from: number, to: number) => {
          rangeCalls.push([from, to])
          const page = pages[call] ?? []
          call += 1
          return Promise.resolve({ data: page, error })
        },
      }),
    }),
  }
}

function rows(n: number, offset = 0): Array<{ id: number }> {
  return Array.from({ length: n }, (_, i) => ({ id: offset + i + 1 }))
}

function clientWith(tables: Record<string, unknown>) {
  return { from: (t: string) => tables[t] }
}

beforeEach(() => {
  rangeCalls.length = 0
  state.client = null
})

describe('buildSelfExport', () => {
  it('reports a clear error in local mode instead of throwing', async () => {
    expect(await buildSelfExport()).toEqual({ error: 'Supabase 未設定' })
  })

  it('returns the three tables the nightly backup also writes', async () => {
    state.client = clientWith({
      workspaces: plain([{ id: 'w1' }]),
      transactions: paged([rows(3)]),
      user_settings: plain([{ theme: 'dark' }]),
    })

    const result = await buildSelfExport()
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    expect(result.workspaces).toEqual([{ id: 'w1' }])
    expect(result.transactions).toHaveLength(3)
    expect(result.user_settings).toEqual([{ theme: 'dark' }])
    expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt)
  })

  it('pages transactions past the PostgREST 1000-row cap, which truncates without an error', async () => {
    state.client = clientWith({
      workspaces: plain([]),
      transactions: paged([rows(1000), rows(5, 1000)]),
      user_settings: plain([]),
    })

    const result = await buildSelfExport()
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    expect(result.transactions).toHaveLength(1005)
    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('stops paging when a full page is the last page', async () => {
    state.client = clientWith({
      workspaces: plain([]),
      transactions: paged([rows(1000), []]),
      user_settings: plain([]),
    })

    const result = await buildSelfExport()
    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)

    expect(result.transactions).toHaveLength(1000)
    expect(rangeCalls).toHaveLength(2)
  })

  it('surfaces a query error as a message, and never throws', async () => {
    state.client = clientWith({
      workspaces: plain([], { message: 'permission denied for table workspaces' }),
      transactions: paged([[]]),
      user_settings: plain([]),
    })

    expect(await buildSelfExport()).toEqual({
      error: 'permission denied for table workspaces',
    })
  })

  it('surfaces a transactions paging error too', async () => {
    state.client = clientWith({
      workspaces: plain([]),
      transactions: paged([[]], { message: 'JWT expired' }),
      user_settings: plain([]),
    })

    expect(await buildSelfExport()).toEqual({ error: 'JWT expired' })
  })
})
