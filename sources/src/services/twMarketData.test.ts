// @vitest-environment jsdom
/**
 * The list merges two independent sources: TWSE (listed) and TPEx (OTC). `Promise.allSettled`
 * used to let one source fail while the other succeeded, and the half-list was then cached for
 * 30 minutes as if it were complete. A user searching a listed stock got an empty result that
 * reads as "no such stock" — see BUG report for 3037 欣興. A partial list must fail, not cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('./appLog', () => ({ logClient: vi.fn() }))

const CACHE_KEY = 'stock-pnl-web/tw-list-v2'
const TWSE_ROWS = [{ Code: '3037', Name: '欣興', ClosingPrice: '993.00' }]
const TPEX_ROWS = [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500' }]

type Mode = 'ok' | 'fail' | 'empty'

function mockFetch(opts: { twse: Mode; tpex: Mode }) {
  return vi.fn(async (url: unknown) => {
    const isTwse = String(url).includes('twse')
    const mode = isTwse ? opts.twse : opts.tpex
    if (mode === 'fail') throw new Error('network down')
    return {
      ok: true,
      json: async () => (mode === 'empty' ? [] : isTwse ? TWSE_ROWS : TPEX_ROWS),
    } as unknown as Response
  })
}

/** A fresh module, so the module-level `inflight` guard does not leak between cases. */
async function freshModule() {
  vi.resetModules()
  return import('./twMarketData')
}

beforeEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('getTwStockList 部分來源失敗', () => {
  it('L1: 兩個來源都成功時回傳合併清單並寫入快取', async () => {
    vi.stubGlobal('fetch', mockFetch({ twse: 'ok', tpex: 'ok' }))
    const { getTwStockList } = await freshModule()

    const rows = await getTwStockList()

    expect(rows.map((r) => r.symbol).sort()).toEqual(['3037', '6488'])
    expect(window.localStorage.getItem(CACHE_KEY)).not.toBeNull()
  })

  it('L2: 上市來源失敗時不得回傳只有上櫃的殘缺清單，也不得寫入快取', async () => {
    vi.stubGlobal('fetch', mockFetch({ twse: 'fail', tpex: 'ok' }))
    const { getTwStockList } = await freshModule()

    await expect(getTwStockList()).rejects.toThrow()
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('L3: 上櫃來源失敗時同樣不得回傳殘缺清單', async () => {
    vi.stubGlobal('fetch', mockFetch({ twse: 'ok', tpex: 'fail' }))
    const { getTwStockList } = await freshModule()

    await expect(getTwStockList()).rejects.toThrow()
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('L4: 殘缺結果不留在快取，下一次來源恢復即可取得完整清單', async () => {
    vi.stubGlobal('fetch', mockFetch({ twse: 'fail', tpex: 'ok' }))
    const mod = await freshModule()
    await expect(mod.getTwStockList()).rejects.toThrow()

    vi.stubGlobal('fetch', mockFetch({ twse: 'ok', tpex: 'ok' }))
    const rows = await mod.getTwStockList()

    expect(rows.some((r) => r.symbol === '3037')).toBe(true)
  })
  it('L5: 來源回 HTTP 200 但內容為空陣列時，同樣視為失敗而非部分成功', async () => {
    // 掛掉的來源不一定會 reject：維護時段或假日可能回 200 加空陣列，
    // 那是穿著成功外衣的同一個缺陷。
    vi.stubGlobal('fetch', mockFetch({ twse: 'empty', tpex: 'ok' }))
    const { getTwStockList } = await freshModule()

    await expect(getTwStockList()).rejects.toThrow()
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('L6: 快取鍵已換版，修正前寫入的殘缺清單不會被沿用', async () => {
    window.localStorage.setItem(
      'stock-pnl-web/tw-list-v1',
      JSON.stringify({ at: Date.now(), rows: [{ symbol: '6488', name: '環球晶', close: 500 }] }),
    )
    vi.stubGlobal('fetch', mockFetch({ twse: 'ok', tpex: 'ok' }))
    const { getTwStockList } = await freshModule()

    const rows = await getTwStockList()

    expect(rows.some((r) => r.symbol === '3037')).toBe(true)
  })
})
