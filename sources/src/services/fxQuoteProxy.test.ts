// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import {
  fetchFxQuotes,
  isQuoteFresh,
  readFxQuoteCache,
  FX_QUOTE_TTL_MS,
  type FxQuote,
} from './fxQuoteProxy'

const CACHE_KEY = 'stock-pnl-web/fx-quotes-v1'
const now = () => new Date().toISOString()
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const ok = (quotes: Record<string, FxQuote>) => ({ data: { quotes }, error: null })

describe('isQuoteFresh', () => {
  it('TTL 內算新鮮，超過就不算', () => {
    const t = Date.now()
    expect(isQuoteFresh({ price: 32, asOf: ago(1000) }, t)).toBe(true)
    expect(isQuoteFresh({ price: 32, asOf: ago(FX_QUOTE_TTL_MS + 1000) }, t)).toBe(false)
  })

  it('缺值或 asOf 壞掉一律不新鮮（寧可重抓也不要用壞資料）', () => {
    expect(isQuoteFresh(undefined, Date.now())).toBe(false)
    expect(isQuoteFresh({ price: 32, asOf: 'x' }, Date.now())).toBe(false)
  })
})

describe('readFxQuoteCache', () => {
  beforeEach(() => localStorage.clear())

  it('壞掉的 JSON 回空物件，不拋錯', () => {
    localStorage.setItem(CACHE_KEY, '{{{')
    expect(readFxQuoteCache()).toEqual({})
  })

  it('丟掉價格不合法的項目（0、負數、非數字）', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        USD: { price: 32.4, asOf: now() },
        JPY: { price: 0, asOf: now() },
        EUR: { price: -1, asOf: now() },
        GBP: { price: 'x', asOf: now() },
        AUD: { price: 22.5 },
      }),
    )
    expect(Object.keys(readFxQuoteCache())).toEqual(['USD'])
  })
})

describe('fetchFxQuotes', () => {
  beforeEach(() => {
    invoke.mockReset()
    localStorage.clear()
  })

  it('命中：呼叫 stock-price 的 fx action 並帶幣別代號', async () => {
    invoke.mockResolvedValue(ok({ USD: { price: 32.478, asOf: now() } }))
    const q = await fetchFxQuotes(['USD'])
    expect(invoke).toHaveBeenCalledWith('stock-price', {
      body: { action: 'fx', codes: ['USD'] },
    })
    expect(q.USD.price).toBe(32.478)
  })

  it('結果寫進 localStorage，TTL 內第二次不再打 API', async () => {
    invoke.mockResolvedValue(ok({ USD: { price: 32.478, asOf: now() } }))
    await fetchFxQuotes(['USD'])
    invoke.mockClear()

    const q = await fetchFxQuotes(['USD'])
    expect(invoke).not.toHaveBeenCalled()
    expect(q.USD.price).toBe(32.478)
  })

  it('只重抓過期的幣別，新鮮的不入請求', async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        USD: { price: 32.4, asOf: now() },
        JPY: { price: 0.197, asOf: ago(FX_QUOTE_TTL_MS + 1000) },
      }),
    )
    invoke.mockResolvedValue(ok({ JPY: { price: 0.1961, asOf: now() } }))

    const q = await fetchFxQuotes(['USD', 'JPY'])
    expect(invoke).toHaveBeenCalledWith('stock-price', {
      body: { action: 'fx', codes: ['JPY'] },
    })
    expect(q.USD.price).toBe(32.4) // 沿用快取
    expect(q.JPY.price).toBe(0.1961) // 已更新
  })

  it('force 忽略 TTL，全部重抓', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ USD: { price: 32.4, asOf: now() } }))
    invoke.mockResolvedValue(ok({ USD: { price: 32.5, asOf: now() } }))

    const q = await fetchFxQuotes(['USD'], true)
    expect(invoke).toHaveBeenCalledWith('stock-price', {
      body: { action: 'fx', codes: ['USD'] },
    })
    expect(q.USD.price).toBe(32.5)
  })

  it('Edge Function 回錯時退回快取值，不拋錯', async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ USD: { price: 32.4, asOf: ago(FX_QUOTE_TTL_MS + 1000) } }),
    )
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const q = await fetchFxQuotes(['USD'])
    expect(q.USD.price).toBe(32.4)
  })

  it('invoke 直接拋例外時也退回快取值', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ USD: { price: 32.4, asOf: ago(9e8) } }))
    invoke.mockRejectedValue(new Error('network'))
    await expect(fetchFxQuotes(['USD'])).resolves.toEqual({
      USD: expect.objectContaining({ price: 32.4 }),
    })
  })

  it('回應結構不符時不汙染快取', async () => {
    invoke.mockResolvedValue({ data: { quotes: 'nope' }, error: null })
    await expect(fetchFxQuotes(['USD'])).resolves.toEqual({})

    invoke.mockResolvedValue(ok({ USD: { price: 0 } as unknown as FxQuote }))
    await expect(fetchFxQuotes(['USD'])).resolves.toEqual({})
  })

  it('空的幣別清單不打 API', async () => {
    await fetchFxQuotes([])
    expect(invoke).not.toHaveBeenCalled()
  })
})
