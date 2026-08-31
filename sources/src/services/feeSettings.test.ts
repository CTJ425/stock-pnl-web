// @vitest-environment jsdom
/**
 * syncWorkspaceFees reconciles the workspace rows with the localStorage cache at bootstrap.
 * A Supabase write failure must never reject here: this runs inside the login path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Workspace } from '../types/models'
import type { DataProvider } from './dataProvider'
import { syncWorkspaceFees, saveWorkspaceFeeRate } from './feeSettings'
import { getFeeRate, setFeeRate } from '../utils/settings'
import { DEFAULT_FEE_RATE } from '../utils/fees'

const ws = (id: string, fee_rate?: number | null): Workspace => ({
  id,
  name: id,
  created_at: '2026-01-01T00:00:00Z',
  ...(fee_rate === undefined ? {} : { fee_rate }),
})

function fakeProvider(fail = false) {
  const setWorkspaceFeeRate = vi.fn(async () => {
    if (fail) throw new Error('網路錯誤')
  })
  return { setWorkspaceFeeRate } as unknown as DataProvider & {
    setWorkspaceFeeRate: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('syncWorkspaceFees', () => {
  it('F1 adopts the row rate into the cache and writes nothing back', async () => {
    const p = fakeProvider()
    await syncWorkspaceFees([ws('w1', 0.0004275)], p)
    expect(getFeeRate('w1')).toBe(0.0004275)
    expect(p.setWorkspaceFeeRate).not.toHaveBeenCalled()
  })

  it('F2 pushes a cache-only rate up to the provider and leaves the cache alone', async () => {
    setFeeRate(0.00092625, 'w1')
    const p = fakeProvider()
    await syncWorkspaceFees([ws('w1', null)], p)
    expect(p.setWorkspaceFeeRate).toHaveBeenCalledWith('w1', 0.00092625)
    expect(getFeeRate('w1')).toBe(0.00092625)
  })

  it('F3 calls nothing when neither side has a rate, and reads fall back to the default', async () => {
    const p = fakeProvider()
    await syncWorkspaceFees([ws('w1', null)], p)
    expect(p.setWorkspaceFeeRate).not.toHaveBeenCalled()
    expect(getFeeRate('w1')).toBe(DEFAULT_FEE_RATE)
  })

  it('F4 reconciles two workspaces independently', async () => {
    setFeeRate(0.00092625, 'w2')
    const p = fakeProvider()
    await syncWorkspaceFees([ws('w1', 0.0004275), ws('w2', null)], p)
    expect(getFeeRate('w1')).toBe(0.0004275)
    expect(getFeeRate('w2')).toBe(0.00092625)
    expect(p.setWorkspaceFeeRate).toHaveBeenCalledTimes(1)
    expect(p.setWorkspaceFeeRate).toHaveBeenCalledWith('w2', 0.00092625)
  })

  it('F5 does not reject when the provider write fails', async () => {
    setFeeRate(0.00092625, 'w1')
    const p = fakeProvider(true)
    await expect(syncWorkspaceFees([ws('w1', null)], p)).resolves.toBeUndefined()
    expect(getFeeRate('w1')).toBe(0.00092625)
  })
})

describe('saveWorkspaceFeeRate', () => {
  it('F6 writes the cache and the provider, and keeps the cache when the provider fails', async () => {
    const ok = fakeProvider()
    await saveWorkspaceFeeRate(ok, 'w1', 0.0004275)
    expect(getFeeRate('w1')).toBe(0.0004275)
    expect(ok.setWorkspaceFeeRate).toHaveBeenCalledWith('w1', 0.0004275)

    const bad = fakeProvider(true)
    await expect(saveWorkspaceFeeRate(bad, 'w1', 0.00092625)).resolves.toBeUndefined()
    expect(getFeeRate('w1')).toBe(0.00092625)
  })
})
