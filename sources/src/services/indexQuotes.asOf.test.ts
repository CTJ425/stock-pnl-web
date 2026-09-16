import { describe, it, expect, beforeEach, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import { fetchIndexQuotes } from './indexQuotes'

beforeEach(() => {
  invoke.mockReset()
})

/**
 * Task 164 §4.4. The `prices` action already returns `asOf` (index.ts handlePrices);
 * indexQuotes.ts dropped it. That field is what puts a time on every index card.
 */
describe('fetchIndexQuotes — asOf', () => {
  it('保留 Edge 回傳的 asOf', async () => {
    invoke.mockResolvedValue({
      data: {
        prices: {
          'IDX:^N225': { price: 63484.1, prevClose: 63492.99, asOf: '2026-09-15T05:25:03.000Z' },
        },
      },
      error: null,
    })
    const out = await fetchIndexQuotes(['^N225'])
    expect(out['^N225'].asOf).toBe('2026-09-15T05:25:03.000Z')
  })

  it('asOf 缺漏或型別不對時為 null，報價本身仍要回傳', async () => {
    invoke.mockResolvedValue({
      data: {
        prices: {
          'IDX:^DJI': { price: 52573.3, prevClose: 52400 },
          'IDX:^SOX': { price: 11285.3, prevClose: null, asOf: 12345 },
        },
      },
      error: null,
    })
    const out = await fetchIndexQuotes(['^DJI', '^SOX'])
    expect(out['^DJI'].price).toBe(52573.3)
    expect(out['^DJI'].asOf).toBeNull()
    expect(out['^SOX'].asOf).toBeNull()
  })

  it('asOf 為不可解析的字串或空字串時為 null，不拋出錯誤', async () => {
    invoke.mockResolvedValue({
      data: {
        prices: {
          'IDX:^DJI': { price: 52573.3, prevClose: 52400, asOf: 'not-a-valid-date' },
          'IDX:^SOX': { price: 11285.3, prevClose: null, asOf: '   ' },
        },
      },
      error: null,
    })
    const out = await fetchIndexQuotes(['^DJI', '^SOX'])
    expect(out['^DJI'].price).toBe(52573.3)
    expect(out['^DJI'].asOf).toBeNull()
    expect(out['^SOX'].asOf).toBeNull()
  })
})
