import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getPublicUrl } = vi.hoisted(() => ({
  getPublicUrl: vi.fn((p: string) => ({ data: { publicUrl: `https://stub/${p}` } })),
}))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { storage: { from: () => ({ getPublicUrl }) } },
}))

import { downloadReportsJson } from './reportsBucket'

describe('downloadReportsJson', () => {
  beforeEach(() => vi.clearAllMocks())

  it('讀取必須帶 cache: no-store', async () => {
    // 這是 0.6.4-dev.5 線上事故的防線：Storage 回 max-age=3600，
    // 少了 no-store 使用者會看到舊一小時的資料，而且 Ctrl+Shift+R 救不了
    // （硬重整不涵蓋 JS 之後才發出的 fetch）。
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

  it('網路錯誤與壞 JSON 都回 null', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    expect(await downloadReportsJson('x.json')).toBeNull()

    vi.stubGlobal('fetch', async () => new Response('不是 JSON', { status: 200 }))
    expect(await downloadReportsJson('x.json')).toBeNull()
  })
})
