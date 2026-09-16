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

describe('fetchIndexQuotes', () => {
  it('空清單不打 API', async () => {
    expect(await fetchIndexQuotes([])).toEqual({})
    expect(invoke).not.toHaveBeenCalled()
  })

  it('以 market IDX 送出 prices action', async () => {
    invoke.mockResolvedValue({ data: { prices: {} }, error: null })
    await fetchIndexQuotes(['^N225', '^KS11'])
    expect(invoke).toHaveBeenCalledWith('stock-price', {
      body: {
        action: 'prices',
        symbols: [
          { market: 'IDX', ticker: '^N225' },
          { market: 'IDX', ticker: '^KS11' },
        ],
      },
      timeout: 15_000,
    })
  })

  it('回傳以 ticker 為 key，去掉 IDX: 前綴', async () => {
    invoke.mockResolvedValue({
      data: {
        prices: {
          'IDX:^N225': { price: 63992.25, prevClose: 63500, open: 1, high: 2, low: 3 },
          'IDX:^DJI': { price: 52421.2, prevClose: null },
        },
      },
      error: null,
    })
    const out = await fetchIndexQuotes(['^N225', '^DJI'])
    expect(out['^N225']).toEqual({ ticker: '^N225', price: 63992.25, prevClose: 63500, asOf: null })
    expect(out['^DJI']).toEqual({ ticker: '^DJI', price: 52421.2, prevClose: null, asOf: null })
  })

  it('Edge 回錯誤時回空物件，讓呼叫端保留上一輪數值', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    expect(await fetchIndexQuotes(['^N225'])).toEqual({})
  })

  it('invoke 丟出例外時回空物件，不往外拋', async () => {
    invoke.mockRejectedValue(new Error('network down'))
    expect(await fetchIndexQuotes(['^N225'])).toEqual({})
  })

  it('濾掉價格為 0、負數或非數字的檔', async () => {
    invoke.mockResolvedValue({
      data: {
        prices: {
          'IDX:^N225': { price: 0, prevClose: 1 },
          'IDX:^KS11': { price: -5, prevClose: 1 },
          'IDX:^KQ11': { price: 'x', prevClose: 1 },
          'IDX:^SOX': { price: 11131.28, prevClose: 11000 },
        },
      },
      error: null,
    })
    const out = await fetchIndexQuotes(['^N225', '^KS11', '^KQ11', '^SOX'])
    expect(Object.keys(out)).toEqual(['^SOX'])
  })

  it('prevClose 不是有效數字時以 null 表示（前端顯示平盤色）', async () => {
    invoke.mockResolvedValue({
      data: { prices: { 'IDX:^RUT': { price: 2892.24, prevClose: 0 } } },
      error: null,
    })
    expect((await fetchIndexQuotes(['^RUT']))['^RUT'].prevClose).toBeNull()
  })
})
