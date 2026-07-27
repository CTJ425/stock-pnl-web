import { describe, it, expect, vi, beforeEach } from 'vitest'

const { storageDownload } = vi.hoisted(() => ({ storageDownload: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { storage: { from: () => ({ download: storageDownload }) } },
}))

import { fetchNews } from './newsProxy'

const blobOf = (obj: unknown) => ({ data: new Blob([JSON.stringify(obj)]), error: null })
const notFound = { data: null, error: { message: 'Not found' } }

const file = {
  schema: 1,
  ticker: '2330',
  name: '台積電',
  asOf: '2026-07-27T09:35:00.000Z',
  query: '台積電',
  items: [
    {
      title: '台積電先進製程需求強勁 - 自由財經',
      source: '自由財經',
      publishedAt: '2026-07-27T02:08:08.000Z',
    },
    { title: '外資調節台積電持股', source: null, publishedAt: null },
  ],
}

describe('fetchNews', () => {
  beforeEach(() => storageDownload.mockReset())

  it('命中：讀 news/{ticker}.json', async () => {
    storageDownload.mockImplementation((path: string) =>
      Promise.resolve(path === 'news/2330.json' ? blobOf(file) : notFound),
    )
    const n = await fetchNews('2330')
    expect(n?.items).toHaveLength(2)
    expect(n?.items[0].source).toBe('自由財經')
    expect(n?.items[1].publishedAt).toBeNull()
  })

  it('查無檔案 → null（批次尚未跑過；AI 解讀不阻斷）', async () => {
    storageDownload.mockResolvedValue(notFound)
    expect(await fetchNews('2330')).toBeNull()
  })

  it('接受比前端已知版本更新的 schema（>= 而非 ===，0.4.0 事故防線）', async () => {
    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 3 }))
    expect((await fetchNews('2330'))?.items).toHaveLength(2)
  })

  it('拒絕過舊或缺 schema 的檔案', async () => {
    storageDownload.mockResolvedValue(blobOf({ ...file, schema: 0 }))
    expect(await fetchNews('2330')).toBeNull()
  })

  it('無標題或空標題的項目被過濾；全數無效時回 null', async () => {
    storageDownload.mockResolvedValue(
      blobOf({ ...file, items: [{ title: '  ' }, { source: 'x' }, null] }),
    )
    expect(await fetchNews('2330')).toBeNull()
  })
})
