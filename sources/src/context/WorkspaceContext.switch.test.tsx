// @vitest-environment jsdom
/**
 * Task 185 / A2 — after a workspace switch the context must never expose the previous workspace's
 * transactions under the new workspace's name, neither while the new rows load nor when that load
 * fails (the add-transaction form and every holdings view read from this context).
 */
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Transaction, Workspace } from '../types/models'

const { fake } = vi.hoisted(() => ({
  fake: {
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    listTransactions: vi.fn(),
  },
}))

vi.mock('../services/dataProvider', () => ({
  LocalProvider: class {
    constructor() {
      return fake
    }
  },
  SupabaseProvider: class {
    constructor() {
      return fake
    }
  },
}))
vi.mock('../services/supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('../services/prefetchStockData', () => ({ prefetchStockData: vi.fn() }))
vi.mock('../services/feeSettings', () => ({
  syncWorkspaceFees: vi.fn(async () => {}),
  saveWorkspaceFeeRate: vi.fn(async () => {}),
  saveWorkspaceFeeRateHistory: vi.fn(async () => {}),
}))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'

const WS_A: Workspace = { id: 'wsA', name: 'A', created_at: '2026-01-01T00:00:00Z' }
const WS_B: Workspace = { id: 'wsB', name: 'B', created_at: '2026-01-02T00:00:00Z' }

const buy = (id: string, workspace_id: string, ticker: string): Transaction => ({
  id,
  workspace_id,
  tx_date: '2026-03-01',
  market: 'TPE',
  ticker,
  name: ticker,
  tx_type: 'BUY',
  price: 100,
  qty: 1000,
  fee_tax: 0,
  created_at: '2026-03-01T00:00:00Z',
})

const ROWS_A = [buy('a1', 'wsA', '2330')]
const ROWS_B = [buy('b1', 'wsB', '0050')]

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider>{children}</WorkspaceProvider>

async function mountOnA() {
  fake.listWorkspaces.mockResolvedValue([WS_A, WS_B])
  fake.listTransactions.mockImplementation(async (id: string) => (id === 'wsA' ? ROWS_A : ROWS_B))
  const hook = renderHook(() => useWorkspace(), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(hook.result.current.current?.id).toBe('wsA')
  expect(hook.result.current.transactions).toEqual(ROWS_A)
  return hook
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

describe('WorkspaceProvider keeps transactions and workspace together', () => {
  it('S1 while the new workspace loads, the previous rows are hidden and the view is loading', async () => {
    const hook = await mountOnA()
    const pending = deferred<Transaction[]>()
    fake.listTransactions.mockImplementation((id: string) => (id === 'wsB' ? pending.promise : Promise.resolve(ROWS_A)))

    act(() => hook.result.current.selectWorkspace('wsB'))

    expect(hook.result.current.current?.id).toBe('wsB')
    expect(hook.result.current.loading).toBe(true)
    expect(hook.result.current.transactions).toEqual([])
    expect(hook.result.current.ledger.holdings).toEqual([])

    await act(async () => pending.resolve(ROWS_B))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.transactions).toEqual(ROWS_B)
    expect(hook.result.current.ledger.holdings.map((h) => h.ticker)).toEqual(['0050'])
  })

  it('S2 a failed load never falls back to the previous workspace\'s rows', async () => {
    const hook = await mountOnA()
    fake.listTransactions.mockImplementation(async (id: string) => {
      if (id === 'wsB') throw new Error('載入交易紀錄失敗：network down')
      return ROWS_A
    })

    act(() => hook.result.current.selectWorkspace('wsB'))

    await waitFor(() => expect(hook.result.current.error).toContain('network down'))
    expect(hook.result.current.current?.id).toBe('wsB')
    expect(hook.result.current.loading).toBe(true)
    expect(hook.result.current.transactions).toEqual([])
    expect(hook.result.current.ledger.holdings).toEqual([])
  })

  it('S3 switching back to a workspace whose rows are still in state shows them again', async () => {
    const hook = await mountOnA()
    const pending = deferred<Transaction[]>()
    fake.listTransactions.mockImplementation((id: string) => (id === 'wsB' ? pending.promise : Promise.resolve(ROWS_A)))

    act(() => hook.result.current.selectWorkspace('wsB'))
    expect(hook.result.current.transactions).toEqual([])

    act(() => hook.result.current.selectWorkspace('wsA'))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.current?.id).toBe('wsA')
    expect(hook.result.current.transactions).toEqual(ROWS_A)

    // The abandoned B request resolving late must not overwrite A.
    await act(async () => pending.resolve(ROWS_B))
    expect(hook.result.current.current?.id).toBe('wsA')
    expect(hook.result.current.transactions).toEqual(ROWS_A)
  })

  it('S4 deleting the current workspace moves to the next one without exposing the deleted rows (C6)', async () => {
    const hook = await mountOnA()
    const pending = deferred<Transaction[]>()
    fake.listTransactions.mockImplementation((id: string) => (id === 'wsB' ? pending.promise : Promise.resolve(ROWS_A)))
    fake.deleteWorkspace.mockResolvedValue(undefined)

    await act(async () => {
      await hook.result.current.deleteWorkspace('wsA')
    })

    expect(fake.deleteWorkspace).toHaveBeenCalledWith('wsA')
    expect(hook.result.current.workspaces.map((w) => w.id)).toEqual(['wsB'])
    expect(hook.result.current.current?.id).toBe('wsB')
    expect(hook.result.current.transactions).toEqual([])
    expect(hook.result.current.loading).toBe(true)

    await act(async () => pending.resolve(ROWS_B))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.transactions).toEqual(ROWS_B)
  })
})
