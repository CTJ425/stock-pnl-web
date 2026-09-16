import { describe, it, expect, beforeEach, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import { fetchRemoteDaily } from './dailyProxy'

const ROWS = [['2026-09-15', 1, 2, 0.5, 1.5, 100]]

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { rows: ROWS, granularity: '1d' }, error: null })
  vi.resetModules()
})

/**
 * Task 164 §4.1. `fetchRemoteDaily` hardcoded `market: 'TPE'`, which is what blocked
 * every foreign-index range. The default must stay 'TPE' so the two stock callers
 * (QuoteTab, TechnicalTab) do not change.
 */
describe('fetchRemoteDaily — market 參數', () => {
  it('明確指定 IDX 時，invoke body 帶 IDX', async () => {
    await fetchRemoteDaily('^N225', '5y', 'IDX')
    expect(invoke).toHaveBeenCalledWith(
      'stock-price',
      expect.objectContaining({
        body: expect.objectContaining({
          action: 'daily',
          symbol: { market: 'IDX', ticker: '^N225' },
          range: '5y',
        }),
      }),
    )
  })

  it('不指定 market 時沿用 TPE', async () => {
    await fetchRemoteDaily('2330', '5y')
    expect(invoke).toHaveBeenCalledWith(
      'stock-price',
      expect.objectContaining({
        body: expect.objectContaining({ symbol: { market: 'TPE', ticker: '2330' } }),
      }),
    )
  })

  it('同 ticker 同 range 但不同 market 不可共用快取', async () => {
    await fetchRemoteDaily('^TWII', '5y', 'TPE')
    await fetchRemoteDaily('^TWII', '5y', 'IDX')
    expect(invoke).toHaveBeenCalledTimes(2)
    const markets = invoke.mock.calls.map((c) => c[1].body.symbol.market)
    expect(markets).toEqual(['TPE', 'IDX'])
  })
})
