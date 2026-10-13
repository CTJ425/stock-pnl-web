// @vitest-environment jsdom
/**
 * The list merges two independent sources: TWSE (listed) and TPEx (OTC). `Promise.allSettled`
 * used to let one source fail while the other succeeded, and the half-list was then cached for
 * 30 minutes as if it were complete. A user searching a listed stock got an empty result that
 * reads as "no such stock" — see BUG report for 3037 欣興. A partial list must fail, not cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `vi.resetModules()` does not re-run a `vi.mock` factory in Vitest 4: the mocked module is
 * cached under a `mock:` id that the reset skips. The factory therefore runs once per file, so
 * the exported values must be getters that read `edgeState` at access time. `fetchViaEdge`
 * reads both bindings inside its body, so a getter is enough to switch the Edge on and off.
 */
const edgeState = vi.hoisted(() => ({
  configured: false,
  invoke: null as null | ((...args: unknown[]) => Promise<unknown>),
}))
const logClientSpy = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({
  get isSupabaseConfigured() {
    return edgeState.configured
  },
  get supabase() {
    return edgeState.configured ? { functions: { invoke: edgeState.invoke } } : null
  },
}))
vi.mock('./appLog', () => ({ logClient: logClientSpy }))

const CACHE_KEY = 'stock-pnl-web/tw-list-v2'
// TWSE STOCK_DAY_ALL open_data CSV (BUG-120); header as fetched 2026-10-13.
const TWSE_CSV = [
  '日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數',
  '"1151012","3037","欣興","1","1","1","1","1","993.00","0","1"',
].join('\n')
const TWSE_CSV_EMPTY = TWSE_CSV.split('\n')[0]
const TPEX_ROWS = [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500' }]

type Mode = 'ok' | 'fail' | 'empty'

function mockFetch(opts: { twse: Mode; tpex: Mode }) {
  return vi.fn(async (url: unknown) => {
    const isTwse = String(url).includes('twse')
    const mode = isTwse ? opts.twse : opts.tpex
    if (mode === 'fail') throw new Error('network down')
    return {
      ok: true,
      text: async () => (mode === 'empty' ? TWSE_CSV_EMPTY : TWSE_CSV),
      json: async () => (mode === 'empty' ? [] : TPEX_ROWS),
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
  vi.unstubAllEnvs()
  edgeState.configured = false
  edgeState.invoke = null
  logClientSpy.mockClear()
})

/** The one `logClient` call the Edge path made, or undefined when it made none. */
function edgeLogCall(): unknown[] | undefined {
  return logClientSpy.mock.calls.find((c) => c[1] === 'fetchViaEdge')
}

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

  it('L7: Edge 回 502 時，要把狀態碼與 Edge 的錯誤內容寫進 log', async () => {
    // 這是 BUG-081 的核心：舊碼在這裡直接 `return []`，什麼都不記，
    // 於是記錄上只剩下第二層 fetchDirect 的 CORS 錯誤，指向錯的地方。
    edgeState.configured = true
    edgeState.invoke = vi.fn(async () => ({
      data: null,
      error: new Error('Edge Function returned a non-2xx status code'),
      response: {
        status: 502,
        text: async () => '{"error":"台股清單來源不完整：TPEx HTTP 403"}',
      },
    }))
    vi.stubGlobal('fetch', mockFetch({ twse: 'fail', tpex: 'fail' }))
    const { getTwStockList } = await freshModule()

    await expect(getTwStockList()).rejects.toThrow()

    const call = edgeLogCall()
    expect(call).toBeTruthy()
    expect(call?.[0]).toBe('error')
    expect(String(call?.[2])).toContain('HTTP 502')
    expect(String(call?.[2])).toContain('TPEx HTTP 403')
  })

  it('L8: Edge 回 200 但 rows 不是陣列時，同樣要留下紀錄', async () => {
    edgeState.configured = true
    edgeState.invoke = vi.fn(async () => ({
      data: { error: 'Unknown action' },
      error: null,
      response: { status: 200, text: async () => '{"error":"Unknown action"}' },
    }))
    vi.stubGlobal('fetch', mockFetch({ twse: 'fail', tpex: 'fail' }))
    const { getTwStockList } = await freshModule()

    await expect(getTwStockList()).rejects.toThrow()

    const call = edgeLogCall()
    expect(call).toBeTruthy()
    expect(String(call?.[2])).toContain('HTTP 200')
  })
})

// BUG-120: the list failed most trading days (TWSE timed out at the Edge, the direct fetch hit
// CORS), and an expired list in localStorage was ignored even then.
describe('getTwStockList 來源全掛時（BUG-120）', () => {
  const STALE = [{ symbol: '2330', name: '台積電', close: 2540 }]

  it('S1: 所有來源都失敗、但有過期快取時，回傳過期快取而不是報錯', async () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: 0, rows: STALE }))
    vi.stubGlobal('fetch', mockFetch({ twse: 'fail', tpex: 'fail' }))
    const { getTwStockList } = await freshModule()

    expect(await getTwStockList()).toEqual(STALE)
    // Not re-stamped: the next call must still try the network.
    expect(JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '{}').at).toBe(0)
    expect(logClientSpy.mock.calls.some((c) => c[0] === 'warn' && c[1] === 'getTwStockList')).toBe(true)
  })

  it('S2: 過期快取在來源恢復後會被新清單取代', async () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: 0, rows: STALE }))
    vi.stubGlobal('fetch', mockFetch({ twse: 'ok', tpex: 'ok' }))
    const { getTwStockList } = await freshModule()

    expect((await getTwStockList()).map((r) => r.symbol).sort()).toEqual(['3037', '6488'])
  })

  it('S4: 現價用途（allowStale: false）拿到過期清單時要拒絕，不能把舊收盤價當現價', async () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: 0, rows: STALE }))
    vi.stubGlobal('fetch', mockFetch({ twse: 'fail', tpex: 'fail' }))
    const { getTwStockList } = await freshModule()

    await expect(getTwStockList({ allowStale: false })).rejects.toThrow()
    // The same outdated list still serves search and names.
    expect(await getTwStockList()).toEqual(STALE)
  })

  it('S5: Edge 回 stale 的伺服器快取時，可用於搜尋但不寫回本機快取、也不當現價', async () => {
    vi.stubEnv('DEV', false)
    edgeState.configured = true
    edgeState.invoke = vi.fn(async () => ({
      data: { rows: STALE, cachedAt: '2026-10-01T00:00:00.000Z', stale: true },
      error: null,
      response: { status: 200 },
    }))
    const { getTwStockList } = await freshModule()

    expect(await getTwStockList()).toEqual(STALE)
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
    await expect(getTwStockList({ allowStale: false })).rejects.toThrow()
  })

  it('S6: 拿到過期清單後 5 分鐘內不再重打網路（避免每次搜尋都等逾時）', async () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: 0, rows: STALE }))
    const fetchSpy = mockFetch({ twse: 'fail', tpex: 'fail' })
    vi.stubGlobal('fetch', fetchSpy)
    const { getTwStockList } = await freshModule()

    await getTwStockList()
    const calls = fetchSpy.mock.calls.length
    await getTwStockList()
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })

  it('S3: 正式環境只走 Edge，不再直連官方端點（必被 CORS 擋）', async () => {
    vi.stubEnv('DEV', false)
    edgeState.configured = true
    edgeState.invoke = vi.fn(async () => ({
      data: { rows: [{ symbol: '2330', name: '台積電', close: 2540 }] },
      error: null,
      response: { status: 200 },
    }))
    const fetchSpy = mockFetch({ twse: 'ok', tpex: 'ok' })
    vi.stubGlobal('fetch', fetchSpy)
    const { getTwStockList } = await freshModule()

    expect(await getTwStockList()).toEqual([{ symbol: '2330', name: '台積電', close: 2540 }])

    edgeState.invoke = vi.fn(async () => ({ data: null, error: new Error('down'), response: undefined }))
    window.localStorage.clear()
    const again = await freshModule()
    await expect(again.getTwStockList()).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// BUG-109: holdings are labelled with the exchange's name; the list is where it comes from.
describe('官方股名（BUG-109）', () => {
  it('N1: 抓到清單後就能用代號查到官方名稱，並通知訂閱者', async () => {
    vi.stubGlobal('fetch', mockFetch({ twse: 'ok', tpex: 'ok' }))
    const mod = await freshModule()
    const listener = vi.fn()
    mod.subscribeTwNames(listener)
    expect(mod.twOfficialName('3037')).toBeUndefined()
    await mod.getTwStockList()
    expect(mod.twOfficialName('3037')).toBe('欣興')
    expect(mod.twOfficialName('6488')).toBe('環球晶')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('N2: 過期的快取仍拿來當名稱（名稱不會半小時就變），不用等網路', async () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ at: 0, rows: [{ symbol: '0050', name: '元大台灣50', close: 100 }] }),
    )
    const mod = await freshModule()
    expect(mod.twOfficialName('0050')).toBe('元大台灣50')
    expect(mod.twOfficialName('9999')).toBeUndefined()
  })

  it('N3: 顯示名稱優先用官方名稱，清單沒有的代號才用交易上的名稱', async () => {
    const mod = await freshModule()
    mod.rememberTwNames([{ symbol: '0050', name: '元大台灣50', close: null }])
    const { displayStockName } = await import('./usStockNames')
    // Real case: PROD 玉山證卷 imported 0050 as 「台灣５０」 (full-width digits) on 2026-09-30.
    expect(displayStockName('TPE', '0050', '台灣５０')).toBe('元大台灣50')
    expect(displayStockName('TPE', '7777', '興櫃某某')).toBe('興櫃某某')
  })
})
