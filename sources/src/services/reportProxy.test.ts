import { describe, it, expect, vi, beforeEach } from 'vitest'

// 以可控 mock 取代 Supabase 客戶端：storageDownload 決定每個 path 的回應
const { storageDownload, functionsInvoke } = vi.hoisted(() => ({
  storageDownload: vi.fn(),
  functionsInvoke: vi.fn(),
}))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    storage: { from: () => ({ download: storageDownload }) },
    functions: { invoke: functionsInvoke },
  },
}))

import { fetchStoredReport, generateReport, type ReportData } from './reportProxy'

const blobOf = (obj: unknown) => ({ data: new Blob([JSON.stringify(obj)]), error: null })
const notFound = { data: null, error: { message: 'Not found' } }

const reportData = {
  schema: 2,
  ticker: '2330',
  name: '台積電',
  market: 'TPE',
  dataDate: '2026-07-24',
  generatedAt: '2026-07-24T12:30:00.000Z',
  holding: null,
  institutional: null,
  margin: null,
  borrow: null,
  history: [{ date: '2026-07-24', institutional: null, margin: null }],
  streaks: { foreign: 0, foreignDealer: 0, trust: 0, dealer: 0, total: 0, margin: 0, short: 0 },
  notes: [],
} as unknown as ReportData

describe('fetchStoredReport（Storage-first）', () => {
  beforeEach(() => storageDownload.mockReset())

  it('命中：先讀 manifest 取 ymd，再讀 {ymd}/{ticker}.json', async () => {
    storageDownload.mockImplementation((path: string) => {
      if (path === 'manifest.json') return Promise.resolve(blobOf({ ymd: '20260724' }))
      if (path === '20260724/2330.json')
        return Promise.resolve(blobOf({ ticker: '2330', dataDate: '2026-07-24', data: reportData }))
      return Promise.resolve(notFound)
    })
    const r = await fetchStoredReport('2330')
    expect(r?.dataDate).toBe('2026-07-24')
    expect(r?.history).toHaveLength(1)
  })

  it('無 manifest → null（呼叫端會 fallback 即點即產）', async () => {
    storageDownload.mockResolvedValue(notFound)
    expect(await fetchStoredReport('2330')).toBeNull()
  })

  it('manifest 有但個股檔缺 → null', async () => {
    storageDownload.mockImplementation((path: string) =>
      Promise.resolve(path === 'manifest.json' ? blobOf({ ymd: '20260724' }) : notFound),
    )
    expect(await fetchStoredReport('9999')).toBeNull()
  })

  it('接受比前端已知版本更新的 schema（後端加欄位不該讓整份報告失效）', async () => {
    // 這是 0.4.0 真實發生過的線上事故：後端升到 schema 3、前端還鎖 === 2，
    // 導致 Storage-first 全數回 null、即點即產丟「格式不符」，籌碼分頁整個掛掉。
    storageDownload.mockImplementation((path: string) => {
      if (path === 'manifest.json') return Promise.resolve(blobOf({ ymd: '20260724' }))
      return Promise.resolve(
        blobOf({ data: { ...reportData, schema: 3, sources: { institutional: null } } }),
      )
    })
    const r = await fetchStoredReport('2330')
    expect(r).not.toBeNull()
    expect(r!.schema).toBe(3)

    // 未來再升版也一樣要收
    storageDownload.mockImplementation((path: string) =>
      Promise.resolve(
        path === 'manifest.json'
          ? blobOf({ ymd: '20260724' })
          : blobOf({ data: { ...reportData, schema: 99 } }),
      ),
    )
    expect((await fetchStoredReport('2330'))?.schema).toBe(99)
  })

  it('舊格式（schema 1 / 只有 html）視為未命中 → null', async () => {
    storageDownload.mockImplementation((path: string) => {
      if (path === 'manifest.json') return Promise.resolve(blobOf({ ymd: '20260724' }))
      return Promise.resolve(
        blobOf({ ticker: '2330', html: '<div class="rpt">舊格式</div>', data: { ticker: '2330' } }),
      )
    })
    expect(await fetchStoredReport('2330')).toBeNull()
  })
})

describe('generateReport（即點即產 fallback）', () => {
  beforeEach(() => functionsInvoke.mockReset())

  it('回傳結構化 data', async () => {
    functionsInvoke.mockResolvedValue({
      data: { reportId: 'r1', generatedAt: 't', dataDate: '2026-07-24', data: reportData },
      error: null,
    })
    const d = await generateReport({ market: 'TPE', ticker: '2330', name: '台積電' })
    expect(d.ticker).toBe('2330')
    expect(d.schema).toBe(2)
  })

  it('Edge Function 回錯誤時丟出訊息', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: '爆了' } })
    await expect(generateReport({ market: 'TPE', ticker: '2330', name: '台積電' })).rejects.toThrow('爆了')
  })

  it('格式不符（舊版 Edge Function 尚未部署）時丟出可讀訊息', async () => {
    functionsInvoke.mockResolvedValue({
      data: { reportId: 'r1', generatedAt: 't', dataDate: '2026-07-24', data: { ticker: '2330' }, html: '<div/>' },
      error: null,
    })
    await expect(generateReport({ market: 'TPE', ticker: '2330', name: '台積電' })).rejects.toThrow('格式不符')
  })
})
