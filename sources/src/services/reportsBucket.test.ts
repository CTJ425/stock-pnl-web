import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getPublicUrl } = vi.hoisted(() => ({
  getPublicUrl: vi.fn((p: string) => ({ data: { publicUrl: `https://stub/${p}` } })),
}))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { storage: { from: () => ({ getPublicUrl }) } },
}))

const { logClient } = vi.hoisted(() => ({ logClient: vi.fn() }))
vi.mock('./appLog', () => ({ logClient }))

import { downloadReportsJson } from './reportsBucket'

describe('downloadReportsJson', () => {
  beforeEach(() => vi.clearAllMocks())

  it('讀取必須帶 cache: no-store', async () => {
    // This is the line of defense for 0.6.4-dev.5 online incidents: Storage returns max-age=3600,
    // Without no-store users will see one hour older data, and Ctrl+Shift+R cannot save it.
    // (Hard refactoring does not cover fetch issued after JS).
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await downloadReportsJson('fundamental/2330.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://stub/fundamental/2330.json')
    expect(init?.cache).toBe('no-store')
  })

  it('回傳解析後的 JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    expect(await downloadReportsJson('x.json')).toEqual({ a: 1 })
  })

  it('查無（404）回 null 而非拋錯', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    expect(await downloadReportsJson('x.json')).toBeNull()
  })

  // Audit finding B2 — this function used to answer `null` for BOTH "the report does not exist
  // yet" and "the network is down", so every screen above it rendered a network outage as
  // "今天沒有資料". `null` now means absent, and only absent; everything else throws.
  it('網路錯誤要拋出，不能和「沒有資料」共用回傳值', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    await expect(downloadReportsJson('x.json')).rejects.toThrow(/x\.json/)
  })

  it('壞 JSON 要拋出，不能和「沒有資料」共用回傳值', async () => {
    vi.stubGlobal('fetch', async () => new Response('不是 JSON', { status: 200 }))
    await expect(downloadReportsJson('x.json')).rejects.toThrow(/x\.json/)
  })

  it('404 仍回 null：報告還沒產生不是失敗', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    expect(await downloadReportsJson('x.json')).toBeNull()
  })

  /*
   * 2026-09-10 實測 PROD：Storage 對**不存在的物件回 HTTP 400**，不是 404，
   * 真正的狀態寫在 body 裡。只認 404 的話，一個「還沒產生」的檔案會變成拋錯，
   * 而每一個呼叫端的 warmStockCore 都排在讀檔之後、同一個 try 裡面——
   * 拋錯直接跳過即時產生，檔案於是永遠不會被建立（BUG-078）。
   */
  const NO_SUCH_KEY =
    '{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}'

  it('Storage 用 400 表示查無物件時要回 null，不能拋錯', async () => {
    vi.stubGlobal('fetch', async () => new Response(NO_SUCH_KEY, { status: 400 }))
    expect(await downloadReportsJson('daily/2382.json')).toBeNull()
  })

  it('查無物件不可寫進 app_log —— 那是正常狀態，不是錯誤', async () => {
    vi.stubGlobal('fetch', async () => new Response(NO_SUCH_KEY, { status: 400 }))
    await downloadReportsJson('fundamental/2382.json')
    expect(logClient).not.toHaveBeenCalled()
  })

  it('body 不是查無物件的 400 仍要拋錯，真錯誤不能被吞掉', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"InvalidRequest"}', { status: 400 }))
    await expect(downloadReportsJson('x.json')).rejects.toThrow(/x\.json/)
  })

  it('500 仍要拋錯', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }))
    await expect(downloadReportsJson('x.json')).rejects.toThrow(/x\.json/)
  })
})
