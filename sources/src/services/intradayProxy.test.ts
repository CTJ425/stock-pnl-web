import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import { fetchIntraday } from './intradayProxy'

const item = { market: 'TPE' as const, ticker: '2330' }
let seq = 0
/** A fresh ticker per test, so the module-level cache never carries a result between cases. */
const fresh = () => ({ ...item, ticker: `T${++seq}` })

// Braces matter: a hook that returns a function is treated as its cleanup and called after the test.
beforeEach(() => {
  invoke.mockReset()
})

// Task 193 M9: every caller (QuoteTab, IndexDetail, TwIndexToday) shows its 「讀取走勢圖失敗」 state in a
// `.catch`, but this function used to swallow every failure into `null`, so those states never appeared and
// a failed fetch read as 「無走勢資料」. A failure now rejects; "no data" stays `null`.
describe('fetchIntraday — failure vs. no data', () => {
  it('rejects when the Edge call fails', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    await expect(fetchIntraday(fresh(), '1d')).rejects.toThrow('boom')
  })

  it('rejects when the call itself throws (network)', async () => {
    invoke.mockImplementation(async () => {
      throw new Error('network down')
    })
    await expect(fetchIntraday(fresh(), '1d')).rejects.toThrow('network down')
  })

  it('resolves null when the Edge answered but has no series (holiday, new listing)', async () => {
    invoke.mockResolvedValue({ data: { series: null }, error: null })
    await expect(fetchIntraday(fresh(), '1d')).resolves.toBeNull()
  })

  it('resolves the series, tagged with the ticker, when there is one', async () => {
    const series = { range: '1d', points: [], prevClose: 1 }
    invoke.mockResolvedValue({ data: { series }, error: null })
    const it1 = fresh()
    await expect(fetchIntraday(it1, '1d')).resolves.toMatchObject({ ticker: it1.ticker, range: '1d' })
  })

  it('does not cache a failure: the next call asks again', async () => {
    const it2 = fresh()
    invoke.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await expect(fetchIntraday(it2, '1d')).rejects.toThrow('boom')
    invoke.mockResolvedValueOnce({ data: { series: { range: '1d', points: [], prevClose: 1 } }, error: null })
    await expect(fetchIntraday(it2, '1d')).resolves.toMatchObject({ ticker: it2.ticker })
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
