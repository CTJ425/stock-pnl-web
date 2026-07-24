import { describe, it, expect } from 'vitest'
import { buildReport, tradingDateCandidates, dashDate } from './report.ts'
import { reportBodyHtml, reportDocument } from './reportHtml.ts'

describe('tradingDateCandidates', () => {
  it('回推含當日的候選 YYYYMMDD（台北時區）', () => {
    // 2026-07-24 12:00 UTC → 台北 20:00 同日
    const c = tradingDateCandidates(new Date('2026-07-24T12:00:00Z'), 3)
    expect(c[0]).toBe('20260724')
    expect(c[1]).toBe('20260723')
    expect(c.length).toBe(4)
  })

  it('跨 UTC 午夜時仍以台北日期為準', () => {
    // 2026-07-24 20:00 UTC → 台北已是 07-25 04:00
    const c = tradingDateCandidates(new Date('2026-07-24T20:00:00Z'), 1)
    expect(c[0]).toBe('20260725')
  })
})

describe('dashDate', () => {
  it('YYYYMMDD → YYYY-MM-DD', () => {
    expect(dashDate('20260723')).toBe('2026-07-23')
  })
})

const baseData = buildReport({
  ticker: '2303',
  name: '聯電',
  dataDateYmd: '20260723',
  holding: { qty: 5000, avgCost: 45.2, price: 44.0, unrealized: -6000, roi: -0.026 },
  institutional: { foreign: -95114000, foreignDealer: 0, trust: -2000000, dealer: 500000, total: -96614000 },
  margin: {
    marginToday: 220752, marginPrev: 213376, marginChange: 7376, marginLimit: 3144246,
    shortToday: 1408, shortPrev: 2265, shortChange: -857, shortLimit: 3144246, offset: 144,
  },
  borrow: { availableVolume: 100267 },
  notes: [],
  now: new Date('2026-07-24T00:00:00Z'),
})

describe('buildReport', () => {
  it('組出資料日期與市場', () => {
    expect(baseData.dataDate).toBe('2026-07-23')
    expect(baseData.market).toBe('TPE')
    expect(baseData.holding?.qty).toBe(5000)
  })
})

describe('reportBodyHtml / reportDocument', () => {
  it('包含代號、法人與融資融券數據，且轉義動態字串', () => {
    const html = reportBodyHtml(baseData)
    expect(html).toContain('2303 聯電')
    expect(html).toContain('三大法人買賣超')
    expect(html).toContain('融資融券餘額')
    expect(html).toContain('非投資建議')
    // 千分位與正負
    expect(html).toContain('+7,376')
  })

  it('缺漏來源時顯示 notes 與「查無」', () => {
    const d = buildReport({
      ticker: '6488', name: '環球晶', dataDateYmd: '20260723',
      holding: null, institutional: null, margin: null, borrow: null,
      notes: ['此代號查無上市籌碼資料（可能為上櫃 / 興櫃，v1 暫不支援上櫃）。'],
    })
    const html = reportBodyHtml(d)
    expect(html).toContain('查無此股當日資料')
    expect(html).toContain('暫不支援上櫃')
  })

  it('reportDocument 是完整 HTML 文件', () => {
    const doc = reportDocument(baseData)
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<title>2303 聯電')
  })

  it('轉義 < > & 防注入', () => {
    const d = buildReport({
      ticker: '2303', name: '<script>x</script>&', dataDateYmd: '20260723',
      holding: null, institutional: null, margin: null, borrow: null, notes: [],
    })
    const html = reportBodyHtml(d)
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
