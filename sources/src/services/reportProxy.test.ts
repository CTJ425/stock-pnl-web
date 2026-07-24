import { describe, it, expect, vi, beforeEach } from 'vitest'

// 以可控 mock 取代 Supabase 客戶端：storageDownload 決定每個 path 的回應
const { storageDownload } = vi.hoisted(() => ({ storageDownload: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { storage: { from: () => ({ download: storageDownload }) } },
}))

import {
  applyHoldingOverlay,
  fetchStoredReport,
  renderHoldingSection,
  type ReportHolding,
} from './reportProxy'

const blobOf = (obj: unknown) => ({ data: new Blob([JSON.stringify(obj)]), error: null })
const notFound = { data: null, error: { message: 'Not found' } }

const holding: ReportHolding = {
  qty: 3000,
  avgCost: 100.5,
  price: 120,
  unrealized: 58500,
  roi: 0.194,
}

describe('renderHoldingSection / applyHoldingOverlay', () => {
  it('渲染持股概況：數字格式與紅漲色 class', () => {
    const s = renderHoldingSection(holding)
    expect(s).toContain('持股概況')
    expect(s).toContain('3,000') // 持有股數
    expect(s).toContain('100.50') // 平均成本 2 位小數
    expect(s).toContain('+NT$58,500') // 未實現損益（正值帶 +）
    expect(s).toContain('+19.40%') // 未實現報酬率
    expect(s).toContain('class="v up"') // 正值套用紅漲 class
  })

  it('負值套用綠跌 class、null 顯示 —', () => {
    const s = renderHoldingSection({ qty: 1000, avgCost: 50, price: null, unrealized: -1234, roi: -0.05 })
    expect(s).toContain('class="v down"')
    expect(s).toContain('-NT$1,234')
    expect(s).toMatch(/現價<\/div><div class="v">—/)
  })

  it('疊加到第一個 <h2>（三大法人）之前；holding=null 時不變', () => {
    const html =
      '<style>.x{}</style><div class="rpt"><h1>t</h1><div class="sub">d</div><h2>三大法人買賣超（當日）</h2></div>'
    const out = applyHoldingOverlay(html, holding)
    expect(out.indexOf('持股概況')).toBeGreaterThan(-1)
    expect(out.indexOf('持股概況')).toBeLessThan(out.indexOf('三大法人'))
    expect(applyHoldingOverlay(html, null)).toBe(html)
  })
})

describe('fetchStoredReport（Storage-first）', () => {
  beforeEach(() => storageDownload.mockReset())

  it('命中：先讀 manifest 取 ymd，再讀 {ymd}/{ticker}.json', async () => {
    storageDownload.mockImplementation((path: string) => {
      if (path === 'manifest.json') return Promise.resolve(blobOf({ ymd: '20260724' }))
      if (path === '20260724/2330.json')
        return Promise.resolve(
          blobOf({ dataDate: '2026-07-24', generatedAt: 't', data: {}, html: '<div class="rpt"><h2>三大法人</h2></div>' }),
        )
      return Promise.resolve(notFound)
    })
    const r = await fetchStoredReport('2330')
    expect(r?.dataDate).toBe('2026-07-24')
    expect(r?.html).toContain('三大法人')
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
})
