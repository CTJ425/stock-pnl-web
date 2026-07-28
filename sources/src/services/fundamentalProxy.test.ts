import { describe, it, expect, vi, beforeEach } from 'vitest'

const { storageDownload } = vi.hoisted(() => ({ storageDownload: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { storage: {
      from: () => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://stub/${p}` } }),
      }),
    } },
}))

// downloadReportsJson 改走 `fetch(publicUrl, { cache: 'no-store' })`（見 reportsBucket.ts
// 的說明：max-age=3600 讓使用者看到舊資料且硬重整救不了）。這裡把 fetch 轉接回
// storageDownload，既有案例的「以 path 決定回應」寫法不必改。
vi.stubGlobal('fetch', async (url: string) => {
  const path = String(url).replace('https://stub/', '')
  const { data, error } = await storageDownload(path)
  if (error || !data) return new Response(null, { status: 404 })
  return new Response(await data.text(), { status: 200 })
})

import { fetchFundamental } from './fundamentalProxy'

const blobOf = (obj: unknown) => ({ data: new Blob([JSON.stringify(obj)]), error: null })
const notFound = { data: null, error: { message: 'Not found' } }

const file = {
  schema: 1,
  ticker: '2330',
  name: '台積電',
  asOf: '2026-07-27T09:31:00.000Z',
  dataDate: '2026-07-25',
  industry: '半導體業',
  valuation: { peRatio: 31.59, dividendYieldPercent: 0.94, pbRatio: 10.34, dataDate: '2026-07-24' },
  revenueUnit: '千元',
  revenueMonths: [
    {
      yearMonth: '2026-06',
      revenueThousandTwd: 442679969,
      momPercent: 6.16,
      yoyPercent: 67.87,
      cumulativeYoyPercent: 35.61,
    },
  ],
  notes: [],
}

describe('fetchFundamental', () => {
  beforeEach(() => storageDownload.mockReset())

  it('命中：讀 fundamental/{ticker}.json', async () => {
    storageDownload.mockImplementation((path: string) =>
      Promise.resolve(path === 'fundamental/2330.json' ? blobOf(file) : notFound),
    )
    const f = await fetchFundamental('2330')
    expect(f?.industry).toBe('半導體業')
    expect(f?.valuation?.peRatio).toBe(31.59)
    expect(f?.revenueMonths).toHaveLength(1)
    expect(f?.revenueMonths[0].yearMonth).toBe('2026-06')
  })

  it('查無檔案 → null（批次尚未跑過）', async () => {
    storageDownload.mockResolvedValue(notFound)
    expect(await fetchFundamental('2330')).toBeNull()
  })

  it('接受比前端已知版本更新的 schema（>= 而非 ===，0.4.0 事故防線）', async () => {
    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 2, extra: 'new-field' }))
    const f = await fetchFundamental('2330')
    expect(f?.valuation?.pbRatio).toBe(10.34)
  })

  it('拒絕過舊或缺 schema 的檔案', async () => {
    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 0 }))
    expect(await fetchFundamental('2330')).toBeNull()
    storageDownload.mockResolvedValue(blobOf({ ticker: '2330' }))
    expect(await fetchFundamental('2330')).toBeNull()
  })

  it('上櫃缺料檔：valuation/industry 為 null 但 notes 保留', async () => {
    storageDownload.mockResolvedValue(
      blobOf({
        schema: 1,
        ticker: '5274',
        asOf: file.asOf,
        dataDate: '2026-07-25',
        industry: null,
        valuation: null,
        revenueUnit: '千元',
        revenueMonths: [],
        notes: ['此代號查無上市基本面資料（可能為上櫃股票，暫不支援）'],
      }),
    )
    const f = await fetchFundamental('5274')
    expect(f).not.toBeNull()
    expect(f?.valuation).toBeNull()
    expect(f?.industry).toBeNull()
    expect(f?.notes[0]).toContain('上櫃')
  })

  it('壞的 revenueMonths 項目被過濾、非數字欄位轉 null', async () => {
    storageDownload.mockResolvedValue(
      blobOf({
        ...file,
        revenueMonths: [
          { yearMonth: '2026-06', revenueThousandTwd: 'oops', yoyPercent: 1.5 },
          { notYearMonth: true },
          null,
        ],
      }),
    )
    const f = await fetchFundamental('2330')
    expect(f?.revenueMonths).toHaveLength(1)
    expect(f?.revenueMonths[0].revenueThousandTwd).toBeNull()
    expect(f?.revenueMonths[0].yoyPercent).toBe(1.5)
  })
})
