// @vitest-environment jsdom
// BUG-120 (review finding): getTwStockList may now return an outdated list as a last resort. The
// price fallback stamps each list close `asOf: now, stale: false`, so an outdated close would pass
// as today's price. It must fall through to the stale cache downgrade instead.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('./appLog', () => ({ logClient: vi.fn() }))

import { fetchPrices } from './priceProxy'

beforeEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('fetchPrices with only an outdated TW list', () => {
  it('does not report an outdated list close as a fresh price', async () => {
    window.localStorage.setItem(
      'stock-pnl-web/tw-list-v2',
      JSON.stringify({ at: 0, rows: [{ symbol: '2330', name: '台積電', close: 2540 }] }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const prices = await fetchPrices([{ market: 'TPE', ticker: '2330' }])

    expect(prices['TPE:2330']).toBeUndefined()
  })
})
