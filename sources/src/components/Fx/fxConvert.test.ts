import { describe, it, expect } from 'vitest'
import {
  FX_RANGES,
  autoDecimals,
  changePct,
  fmtChartLabel,
  invertPoints,
  formatAmount,
  formatRate,
  foreignToTwd,
  isStale,
  labelIndicesFor,
  parseAmount,
  rangeStats,
  sliceByRange,
  twdToForeign,
} from './fxConvert'
import type { FxPoint } from '../../services/fxProxy'

describe('twdToForeign / foreignToTwd', () => {
  it('雙向換算互為逆運算', () => {
    const rate = 32.387 // 1 USD = 32.387 TWD
    const usd = twdToForeign(1000, rate)!
    expect(usd).toBeCloseTo(30.8766, 4)
    expect(foreignToTwd(usd, rate)).toBeCloseTo(1000, 6)
  })

  it('日圓這種小數匯率也對', () => {
    // 1 JPY = 0.1956 TWD ⇒ 1000 TWD 換得約 5112 日圓
    expect(twdToForeign(1000, 0.1956)).toBeCloseTo(5112.47, 2)
    expect(foreignToTwd(10000, 0.1956)).toBeCloseTo(1956, 6)
  })

  it('rate 為 0 回 null，不回 Infinity', () => {
    expect(twdToForeign(1000, 0)).toBeNull()
    expect(Number.isFinite(1000 / 0)).toBe(false) // 對照：沒擋的話會是 Infinity
  })

  it('rate 或金額為 null / NaN 時回 null', () => {
    expect(twdToForeign(1000, null)).toBeNull()
    expect(twdToForeign(null, 32)).toBeNull()
    expect(twdToForeign(NaN, 32)).toBeNull()
    expect(foreignToTwd(100, null)).toBeNull()
    expect(foreignToTwd(null, 32)).toBeNull()
  })

  it('0 元是合法輸入，換算結果是 0 而不是 null', () => {
    expect(twdToForeign(0, 32.387)).toBe(0)
    expect(foreignToTwd(0, 32.387)).toBe(0)
  })

  it('負數照算（使用者自己貼進來的，不特別攔）', () => {
    expect(twdToForeign(-1000, 32.387)).toBeCloseTo(-30.8766, 4)
  })
})

describe('parseAmount', () => {
  it('接受千分位逗號與前後空白', () => {
    expect(parseAmount('1,000')).toBe(1000)
    expect(parseAmount(' 1,234,567.89 ')).toBe(1234567.89)
  })

  it('空字串回 null —— 「沒有輸入」不是 0', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
  })

  it('非數字回 null', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1.2.3')).toBeNull()
    expect(parseAmount('1e5')).toBeNull()
  })

  it('輸入中的半成品不當成錯誤（打到一半的小數點）', () => {
    expect(parseAmount('12.')).toBe(12)
    expect(parseAmount('.5')).toBe(0.5)
  })
})

describe('formatAmount / formatRate', () => {
  it('金額帶千分位與兩位小數', () => {
    expect(formatAmount(1234567.891)).toBe('1,234,567.89')
    expect(formatAmount(0)).toBe('0.00')
  })

  it('null 回空字串，讓輸入框保持空的而不是填 0', () => {
    expect(formatAmount(null)).toBe('')
    expect(formatAmount(NaN)).toBe('')
  })

  it('匯率的小數位數由幣別決定 —— 韓元用 3 位會全變成 0.022', () => {
    expect(formatRate(0.022289, 5)).toBe('0.02229')
    expect(formatRate(0.022289, 3)).toBe('0.022')
    expect(formatRate(32.387001, 3)).toBe('32.387')
    expect(formatRate(null, 3)).toBe('—')
  })
})

describe('autoDecimals', () => {
  it('依量級給約 5 位有效數字', () => {
    expect(autoDecimals(0.030958)).toBe(6) // 1 TWD 換得的美元
    expect(autoDecimals(5.071)).toBe(4) // 1 TWD 換得的日圓
    expect(autoDecimals(45.366)).toBe(3) // 1 TWD 換得的韓元
    expect(autoDecimals(0.20936)).toBe(5) // 1 TWD 換得的人民幣
  })

  it('夾在 2～6 位之間，不讓 toFixed 拋 RangeError', () => {
    expect(autoDecimals(1e9)).toBe(2)
    expect(autoDecimals(1e-9)).toBe(6)
  })

  it('缺值或 0 回預設 2 位', () => {
    expect(autoDecimals(null)).toBe(2)
    expect(autoDecimals(0)).toBe(2)
    expect(autoDecimals(NaN)).toBe(2)
  })
})

describe('invertPoints', () => {
  const points: FxPoint[] = [
    ['2026-07-27', 0.197462],
    ['2026-07-28', 0.197229],
  ]

  it('把「1 外幣 = N 台幣」轉成「1 台幣 = N 外幣」', () => {
    const inv = invertPoints(points)
    expect(inv[0][0]).toBe('2026-07-27')
    expect(inv[0][1]).toBeCloseTo(5.064266, 5)
    expect(inv[1][1]).toBeCloseTo(5.070248, 5)
  })

  it('日期原封不動、順序不變', () => {
    expect(invertPoints(points).map((p) => p[0])).toEqual(points.map((p) => p[0]))
  })

  it('高低點日期會對調 —— 正向的最高就是反向的最低', () => {
    const src: FxPoint[] = [
      ['2026-05-01', 0.2],
      ['2026-06-01', 0.2137], // 正向最高
      ['2026-07-01', 0.1953], // 正向最低
    ]
    const fwd = rangeStats(src)!
    const inv = rangeStats(invertPoints(src))!
    expect(fwd.highDate).toBe('2026-06-01')
    expect(inv.lowDate).toBe('2026-06-01')
    expect(fwd.lowDate).toBe('2026-07-01')
    expect(inv.highDate).toBe('2026-07-01')
  })

  it('跳過 0 與非有限數，不讓 Infinity 進入序列', () => {
    const bad: FxPoint[] = [
      ['2026-07-27', 0],
      ['2026-07-28', 0.197229],
    ]
    const inv = invertPoints(bad)
    expect(inv).toHaveLength(1)
    expect(inv.every((p) => Number.isFinite(p[1]))).toBe(true)
  })

  it('倒兩次回到原值', () => {
    const twice = invertPoints(invertPoints(points))
    expect(twice[0][1]).toBeCloseTo(points[0][1], 10)
  })

  it('空序列回空陣列', () => {
    expect(invertPoints([])).toEqual([])
  })
})

describe('sliceByRange', () => {
  // 每月 1 日一筆，2025-01 ~ 2026-01 共 13 筆
  const points: FxPoint[] = Array.from({ length: 13 }, (_, i) => {
    const m = i % 12
    const y = 2025 + Math.floor(i / 12)
    return [`${y}-${String(m + 1).padStart(2, '0')}-01`, 30 + i]
  })

  it('三個區間都定義了月數', () => {
    expect(FX_RANGES.map((r) => r.id)).toEqual(['3m', '6m', '1y'])
    expect(FX_RANGES.map((r) => r.months)).toEqual([3, 6, 12])
  })

  it('以序列最後一天回推，不是以今天回推', () => {
    // 最後一天是 2026-01-01，三個月前 = 2025-10-01
    expect(sliceByRange(points, '3m').map((p) => p[0])).toEqual([
      '2025-10-01',
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
    ])
  })

  it('6 個月與 1 年各自取到對應長度', () => {
    expect(sliceByRange(points, '6m')).toHaveLength(7)
    expect(sliceByRange(points, '1y')).toHaveLength(13)
  })

  it('空序列回空陣列', () => {
    expect(sliceByRange([], '3m')).toEqual([])
  })

  it('資料比區間短時全部回傳，不補空', () => {
    const short: FxPoint[] = [['2026-07-28', 32.3], ['2026-07-29', 32.4]]
    expect(sliceByRange(short, '1y')).toHaveLength(2)
  })

  it('日期壞掉時原樣回傳，不回空（寧可圖畫錯也不要整頁空白）', () => {
    const bad: FxPoint[] = [['not-a-date', 32.3]]
    expect(sliceByRange(bad, '3m')).toHaveLength(1)
  })
})

describe('changePct', () => {
  it('算出百分比', () => {
    expect(changePct(110, 100)).toBeCloseTo(10, 10)
    expect(changePct(90, 100)).toBeCloseTo(-10, 10)
  })

  it('基期為 0 或缺值回 null', () => {
    expect(changePct(110, 0)).toBeNull()
    expect(changePct(110, null)).toBeNull()
    expect(changePct(null, 100)).toBeNull()
  })
})

describe('rangeStats', () => {
  const points: FxPoint[] = [
    ['2026-05-01', 0.2],
    ['2026-06-01', 0.2137],
    ['2026-07-01', 0.1953],
    ['2026-07-29', 0.1956],
  ]

  it('找出區間高低與其日期', () => {
    const s = rangeStats(points)!
    expect(s.high).toBe(0.2137)
    expect(s.highDate).toBe('2026-06-01')
    expect(s.low).toBe(0.1953)
    expect(s.lowDate).toBe('2026-07-01')
  })

  it('漲跌幅取首尾', () => {
    expect(rangeStats(points)!.changePct).toBeCloseTo(-2.2, 1)
  })

  it('只有一筆時漲跌幅為 null，不拿自己比自己', () => {
    const s = rangeStats([['2026-07-29', 0.1956]])!
    expect(s.high).toBe(0.1956)
    expect(s.changePct).toBeNull()
  })

  it('空序列回 null', () => {
    expect(rangeStats([])).toBeNull()
  })
})

describe('labelIndicesFor', () => {
  it('一年 260 點抽成 6 個標籤，含頭尾', () => {
    const idx = labelIndicesFor(260, 6)
    expect(idx).toHaveLength(6)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(259)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
  })

  it('點數比要的標籤數少時全部都標', () => {
    expect(labelIndicesFor(4, 6)).toEqual([0, 1, 2, 3])
  })

  it('空序列回空陣列', () => {
    expect(labelIndicesFor(0)).toEqual([])
  })

  it('索引都落在範圍內', () => {
    for (const n of [1, 2, 7, 67, 131, 260]) {
      for (const i of labelIndicesFor(n)) {
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(n)
      }
    }
  })
})

describe('isStale', () => {
  const now = new Date('2026-07-29T12:00:00Z')

  it('3 天內不算過期', () => {
    expect(isStale('2026-07-29T03:00:00Z', now)).toBe(false)
    expect(isStale('2026-07-26T13:00:00Z', now)).toBe(false)
  })

  it('超過 3 天算過期', () => {
    expect(isStale('2026-07-25T03:00:00Z', now)).toBe(true)
  })

  it('asOf 壞掉或空時不誤報過期', () => {
    expect(isStale('', now)).toBe(false)
    expect(isStale('not-a-date', now)).toBe(false)
  })
})

describe('fmtChartLabel', () => {
  it('短區間顯示月/日，一年區間顯示年/月', () => {
    expect(fmtChartLabel('2026-07-29', false)).toBe('07/29')
    expect(fmtChartLabel('2026-07-29', true)).toBe('2026/07')
  })

  it('格式不符時原樣回傳', () => {
    expect(fmtChartLabel('x', false)).toBe('x')
  })
})
