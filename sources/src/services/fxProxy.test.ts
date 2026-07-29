import { describe, it, expect, vi, beforeEach } from 'vitest'

const { storageDownload } = vi.hoisted(() => ({ storageDownload: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://stub/${p}` } }),
      }),
    },
  },
}))

vi.stubGlobal('fetch', async (url: string) => {
  const path = String(url).replace('https://stub/', '')
  const { data, error } = await storageDownload(path)
  if (error || !data) return new Response(null, { status: 404 })
  return new Response(await data.text(), { status: 200 })
})

import { fetchFx, MIN_FX_SCHEMA } from './fxProxy'

const blobOf = (obj: unknown) => ({ data: new Blob([JSON.stringify(obj)]), error: null })
const notFound = { data: null, error: { message: 'Not found' } }

const file = {
  schema: 1,
  asOf: '2026-07-29T03:02:00.000Z',
  base: 'TWD',
  currencies: [
    {
      code: 'USD',
      name: '美元',
      decimals: 3,
      symbol: 'USDTWD=X',
      latest: 32.387001,
      prevClose: 32.301998,
      points: [
        ['2026-07-28', 32.301998],
        ['2026-07-29', 32.387001],
      ],
    },
    {
      code: 'JPY',
      name: '日圓',
      decimals: 4,
      symbol: 'JPYTWD=X',
      latest: 0.1956,
      prevClose: 0.197229,
      points: [
        ['2026-07-28', 0.197229],
        ['2026-07-29', 0.1956],
      ],
    },
  ],
}

const serve = (obj: unknown) =>
  storageDownload.mockImplementation((path: string) =>
    Promise.resolve(path === 'fx/twd.json' ? blobOf(obj) : notFound),
  )

describe('fetchFx', () => {
  beforeEach(() => storageDownload.mockReset())

  it('命中：讀 fx/twd.json（全域單檔，不帶 ticker）', async () => {
    serve(file)
    const d = await fetchFx()
    expect(storageDownload).toHaveBeenCalledWith('fx/twd.json')
    expect(d?.base).toBe('TWD')
    expect(d?.currencies).toHaveLength(2)
    expect(d?.currencies[0].latest).toBe(32.387001)
    expect(d?.currencies[1].points[1]).toEqual(['2026-07-29', 0.1956])
  })

  it('查無檔案回 null，不拋錯', async () => {
    storageDownload.mockResolvedValue(notFound)
    await expect(fetchFx()).resolves.toBeNull()
  })

  it('schema 較新仍可讀 —— 守門是 >= 不是 ==', async () => {
    serve({ ...file, schema: MIN_FX_SCHEMA + 5 })
    const d = await fetchFx()
    expect(d?.currencies).toHaveLength(2)
  })

  it('schema 過舊或缺漏回 null', async () => {
    serve({ ...file, schema: 0 })
    await expect(fetchFx()).resolves.toBeNull()
    serve({ ...file, schema: undefined })
    await expect(fetchFx()).resolves.toBeNull()
  })

  it('丟掉壞掉的走勢點：非法日期、非數字、0 與負數', async () => {
    serve({
      ...file,
      currencies: [
        {
          ...file.currencies[0],
          points: [
            ['2026-07-27', 32.1],
            ['七月二十八', 32.2],
            ['2026-07-28', 'abc'],
            ['2026-07-28', 0],
            ['2026-07-28', -1],
            ['2026-07-29', 32.4],
          ],
        },
      ],
    })
    const d = await fetchFx()
    expect(d?.currencies[0].points).toEqual([
      ['2026-07-27', 32.1],
      ['2026-07-29', 32.4],
    ])
  })

  it('沒有任何走勢點的幣別整筆丟掉（卡片有價、圖是空的比不出現更糟）', async () => {
    serve({ ...file, currencies: [{ ...file.currencies[0], points: [] }, file.currencies[1]] })
    const d = await fetchFx()
    expect(d?.currencies.map((c) => c.code)).toEqual(['JPY'])
  })

  it('所有幣別都不合格時回 null', async () => {
    serve({ ...file, currencies: [{ code: 'USD', name: '美元', points: [] }] })
    await expect(fetchFx()).resolves.toBeNull()
  })

  it('decimals 缺漏或離譜時退回 4，不讓 toFixed 拋 RangeError', async () => {
    serve({
      ...file,
      currencies: [
        { ...file.currencies[0], decimals: undefined },
        { ...file.currencies[1], code: 'EUR', name: '歐元', decimals: 99 },
      ],
    })
    const d = await fetchFx()
    expect(d?.currencies[0].decimals).toBe(4)
    expect(d?.currencies[1].decimals).toBe(4)
    // 退回值必須是 toFixed 接受的範圍
    expect(() => d?.currencies[0].latest?.toFixed(d.currencies[0].decimals)).not.toThrow()
  })

  it('latest / prevClose 缺漏時為 null，不以 0 冒充', async () => {
    serve({
      ...file,
      currencies: [{ ...file.currencies[0], latest: null, prevClose: 'x' }],
    })
    const d = await fetchFx()
    expect(d?.currencies[0].latest).toBeNull()
    expect(d?.currencies[0].prevClose).toBeNull()
  })

  it('整份不是物件 / currencies 不是陣列時回 null', async () => {
    serve('not an object')
    await expect(fetchFx()).resolves.toBeNull()
    serve({ schema: 1, currencies: 'nope' })
    await expect(fetchFx()).resolves.toBeNull()
  })
})
