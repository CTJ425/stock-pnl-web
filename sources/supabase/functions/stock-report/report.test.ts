import { describe, it, expect } from 'vitest'
import {
  buildReport,
  computeStreak,
  computeStreaks,
  dashDate,
  isWeekendYmd,
  tradingDateCandidates,
  type ChipDay,
} from './report.ts'
import type { ChipLeg, InstitutionalChip, MarginChip } from './twChips.ts'

describe('tradingDateCandidates', () => {
  it('回推含當日的候選 YYYYMMDD（台北時區）', () => {
    // 2026-07-24 12:00 UTC → Taipei 20:00 Same day
    const c = tradingDateCandidates(new Date('2026-07-24T12:00:00Z'), 3)
    expect(c[0]).toBe('20260724')
    expect(c[1]).toBe('20260723')
    expect(c.length).toBe(4)
  })

  it('跨 UTC 午夜時仍以台北日期為準', () => {
    // 2026-07-24 20:00 UTC → Taipei is 07-25 04:00
    const c = tradingDateCandidates(new Date('2026-07-24T20:00:00Z'), 1)
    expect(c[0]).toBe('20260725')
  })
})

describe('dashDate', () => {
  it('YYYYMMDD → YYYY-MM-DD', () => {
    expect(dashDate('20260723')).toBe('2026-07-23')
  })
})

describe('isWeekendYmd', () => {
  it('週六 / 週日為 true，平日為 false', () => {
    expect(isWeekendYmd('20260725')).toBe(true) // 2026-07-25 週六
    expect(isWeekendYmd('20260726')).toBe(true) // 週日
    expect(isWeekendYmd('20260724')).toBe(false) // 週五
    expect(isWeekendYmd('20260727')).toBe(false) // 週一
  })
})

describe('computeStreak', () => {
  it('由最新一筆往回數同號連續筆數，正數＝連買、負數＝連賣', () => {
    expect(computeStreak([-1, 2, 3, 4])).toBe(3)
    expect(computeStreak([5, -1, -2])).toBe(-2)
    expect(computeStreak([1, 2, 3])).toBe(3)
  })

  it('最新一筆為 0 或 null 時視為中斷（0）', () => {
    expect(computeStreak([1, 2, 0])).toBe(0)
    expect(computeStreak([1, 2, null])).toBe(0)
    expect(computeStreak([])).toBe(0)
  })

  it('中途遇 0 或 null 即停止累計', () => {
    expect(computeStreak([3, 0, 1, 2])).toBe(2)
    expect(computeStreak([3, null, 1])).toBe(1)
  })

  it('全 0 序列回 0', () => {
    expect(computeStreak([0, 0, 0])).toBe(0)
  })
})

const leg = (net: number | null): ChipLeg => ({ buy: null, sell: null, net })

function inst(net: number | null): InstitutionalChip {
  return {
    foreign: leg(net),
    foreignDealer: leg(0),
    trust: leg(net === null ? null : -net),
    dealer: leg(net),
    total: leg(net),
  }
}

function margin(marginChange: number | null, shortChange: number | null): MarginChip {
  return {
    marginBuy: null, marginSell: null, marginRedeem: null,
    marginPrev: null, marginToday: null, marginChange, marginLimit: null,
    shortBuy: null, shortSell: null, shortRedeem: null,
    shortPrev: null, shortToday: null, shortChange, shortLimit: null,
    offset: null, source: 'rwd',
  }
}

const history: ChipDay[] = [
  { date: '2026-07-20', institutional: inst(-500), margin: margin(-10, 5) },
  { date: '2026-07-21', institutional: inst(300), margin: margin(20, 5) },
  { date: '2026-07-22', institutional: inst(400), margin: margin(30, 0) },
]

describe('computeStreaks', () => {
  it('依 history（由舊到新）算各法人與融資融券的連續天數', () => {
    const s = computeStreaks(history)
    expect(s.foreign).toBe(2) // 300、400 連 2 買
    expect(s.trust).toBe(-2) // 反向：-300、-400 連 2 賣
    expect(s.foreignDealer).toBe(0) // 全 0
    expect(s.margin).toBe(2) // +20、+30 連 2 增
    expect(s.short).toBe(0) // 最新一筆為 0，中斷
  })

  it('缺該日資料（institutional 為 null）時中斷', () => {
    const withGap: ChipDay[] = [
      ...history,
      { date: '2026-07-23', institutional: null, margin: null },
    ]
    expect(computeStreaks(withGap).foreign).toBe(0)
  })

  it('空 history 不炸，全為 0', () => {
    expect(computeStreaks([]).total).toBe(0)
  })
})

describe('buildReport 的 sources（各資料源新鮮度）', () => {
  const base = {
    ticker: '2330', name: '台積電', dataDateYmd: '20260724',
    holding: null, history: [], borrow: null, notes: [],
  }

  it('未帶 sources 時三項皆為 null（而非缺欄位）', () => {
    expect(buildReport(base).sources).toEqual({
      institutional: null, margin: null, borrow: null,
    })
  })

  it('各資料源可以有各自的日期與抓取時間 —— 借券本來就會比籌碼晚一天', () => {
    const r = buildReport({
      ...base,
      sources: {
        institutional: { date: '2026-07-24', fetchedAt: '2026-07-24T09:40:00.000Z' },
        margin: { date: '2026-07-24', fetchedAt: '2026-07-24T14:10:00.000Z' },
        borrow: { date: '2026-07-27', fetchedAt: '2026-07-24T15:30:00.000Z' },
      },
    })
    expect(r.sources.institutional?.date).toBe('2026-07-24')
    expect(r.sources.borrow?.date).toBe('2026-07-27') // 下一個交易日，不是錯誤
    expect(r.sources.margin?.fetchedAt).not.toBe(r.sources.institutional?.fetchedAt)
  })

  it('某一項尚未取得時只有那一項為 null，不影響其他項', () => {
    const r = buildReport({
      ...base,
      sources: {
        institutional: { date: '2026-07-24', fetchedAt: '2026-07-24T09:40:00.000Z' },
        margin: null,
        borrow: null,
      },
    })
    expect(r.sources.institutional).not.toBeNull()
    expect(r.sources.margin).toBeNull()
  })
})

describe('buildReport', () => {
  const data = buildReport({
    ticker: '2303',
    name: '聯電',
    dataDateYmd: '20260722',
    holding: { qty: 5000, avgCost: 45.2, price: 44.0, unrealized: -6000, roi: -0.026 },
    history,
    borrow: { availableVolume: 100267 },
    notes: [],
    now: new Date('2026-07-22T12:00:00Z'),
  })

  it('標記 schema 3 並帶入 history', () => {
    expect(data.schema).toBe(3)
    expect(data.history).toHaveLength(3)
    expect(data.dataDate).toBe('2026-07-22')
    expect(data.market).toBe('TPE')
  })

  it('institutional / margin 取 history 最後一筆（最新交易日）', () => {
    expect(data.institutional?.foreign.net).toBe(400)
    expect(data.margin?.marginChange).toBe(30)
  })

  it('streaks 隨 history 一併算好', () => {
    expect(data.streaks.foreign).toBe(2)
  })

  it('history 為空時 institutional / margin 為 null', () => {
    const empty = buildReport({
      ticker: '6488', name: '環球晶', dataDateYmd: '20260722',
      holding: null, history: [], borrow: null,
      notes: ['此代號查無上市籌碼資料（可能為上櫃 / 興櫃，暫不支援上櫃）。'],
    })
    expect(empty.institutional).toBeNull()
    expect(empty.margin).toBeNull()
    expect(empty.history).toEqual([])
    expect(empty.notes[0]).toContain('暫不支援上櫃')
  })
})
