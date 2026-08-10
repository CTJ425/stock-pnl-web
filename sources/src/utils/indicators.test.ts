import { describe, it, expect } from 'vitest'
import { ema, kd, lastValue, macd, maAlignment, rsi, sma, type Bar } from './indicators'

/** The K rod is made from high and low, making the test intention readable at a glance*/
function bar(high: number, low: number, close: number): Bar {
  return { high, low, close }
}

describe('sma', () => {
  it('暖身期為 null、輸出與輸入等長', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('視窗內含 null 時該根為 null —— 不把缺漏當成 0', () => {
    // If null is regarded as 0, index 3 will be calculated as (2+0+4)/3 = 2. It seems "valuable" but the entire moving average is wrong.
    expect(sma([1, 2, null, 4, 5], 3)).toEqual([null, null, null, null, null])
    expect(sma([1, 2, null, 4, 5, 6, 7], 3)).toEqual([null, null, null, null, null, 5, 6])
  })

  it('資料少於週期時全為 null', () => {
    expect(sma([1, 2], 3)).toEqual([null, null])
  })
})

describe('ema', () => {
  it('以前 N 筆的簡單平均作種子', () => {
    // Seed = (1+2+3)/3 = 2; k = 0.5 → 4*0.5+2*0.5 = 3; 5*0.5+3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('遇 null 時該根為 null 且遞迴狀態不變', () => {
    // index 3 is null → do not update prev(=2); index 4 is continued with prev=2 5*0.5+2*0.5 = 3.5
    expect(ema([1, 2, 3, null, 5], 3)).toEqual([null, null, 2, null, 3.5])
  })
})

describe('kd (9,3,3 台股慣例)', () => {
  it('手算對帳：RSV → K → D 的遞迴', () => {
    const bars = [bar(10, 8, 9), bar(11, 9, 10), bar(12, 10, 12), bar(13, 11, 11)]
    const { k, d } = kd(bars, 3)

    // index 2: window high 12 low 8 close 12 → RSV 100
    //   K = 50×2/3 + 100/3 = 66.6667；D = 50×2/3 + 66.6667/3 = 55.5556
    expect(k[2]).toBeCloseTo(66.6667, 3)
    expect(d[2]).toBeCloseTo(55.5556, 3)

    // index 3: window high 13 low 9 close 11 → RSV 50
    //   K = 66.6667×2/3 + 50/3 = 61.1111；D = 55.5556×2/3 + 61.1111/3 = 57.4074
    expect(k[3]).toBeCloseTo(61.1111, 3)
    expect(d[3]).toBeCloseTo(57.4074, 3)

    expect(k.slice(0, 2)).toEqual([null, null])
  })

  it('最高等於最低時 RSV 取 50，不是 0 也不是 100', () => {
    // The extreme case of continuous locking: the denominator is zero. Taking 0 or 100 will generate oversold/overbought signals out of thin air.
    const flat = [bar(10, 10, 10), bar(10, 10, 10), bar(10, 10, 10)]
    const { k, d } = kd(flat, 3)
    expect(k[2]).toBeCloseTo(50, 6)
    expect(d[2]).toBeCloseTo(50, 6)
  })

  it('視窗內有缺漏 K 棒時該根為 null', () => {
    const bars = [bar(10, 8, 9), null, bar(12, 10, 12), bar(13, 11, 11)]
    const { k } = kd(bars, 3)
    expect(k[2]).toBeNull()
  })
})

describe('rsi (Wilder 平滑)', () => {
  it('手算對帳（period = 2）', () => {
    // Increase or decrease: +1, +1, -1, +2
    // i=2 seed: avgGain 1, avgLoss 0 → average drop is 0 → 100
    // i=3：avgGain (1+0)/2=0.5、avgLoss (0+1)/2=0.5 → RS 1 → 50
    // i=4：avgGain (0.5+2)/2=1.25、avgLoss (0.5+0)/2=0.25 → RS 5 → 100−100/6 = 83.3333
    const out = rsi([10, 11, 12, 11, 13], 2)
    expect(out[0]).toBeNull()
    expect(out[1]).toBeNull()
    expect(out[2]).toBe(100)
    expect(out[3]).toBeCloseTo(50, 6)
    expect(out[4]).toBeCloseTo(83.3333, 3)
  })

  it('全程無下跌時為 100，不除以零', () => {
    const out = rsi([1, 2, 3, 4, 5], 2)
    expect(out[4]).toBe(100)
  })
})

describe('macd', () => {
  it('DIF = 快線 EMA − 慢線 EMA、柱狀體 = DIF − DEA', () => {
    const closes = [10, 11, 12, 11, 13, 14, 15, 14, 16, 17]
    const { dif, dea, hist } = macd(closes, 2, 3, 2)
    const fast = ema(closes, 2)
    const slow = ema(closes, 3)

    expect(dif).toHaveLength(closes.length)
    for (let i = 0; i < closes.length; i++) {
      const f = fast[i]
      const s = slow[i]
      if (f === null || s === null) {
        expect(dif[i]).toBeNull()
      } else {
        expect(dif[i]).toBeCloseTo(f - s, 10)
      }
      const dv = dif[i]
      const ev = dea[i]
      if (dv === null || ev === null) {
        expect(hist[i]).toBeNull()
      } else {
        expect(hist[i]).toBeCloseTo(dv - ev, 10)
      }
    }
  })
})

describe('maAlignment', () => {
  it('依短中長關係判斷排列', () => {
    expect(maAlignment(30, 20, 10)).toBe('多頭排列')
    expect(maAlignment(10, 20, 30)).toBe('空頭排列')
    expect(maAlignment(20, 10, 30)).toBe('糾結')
  })

  it('任一條缺值時回 null（不猜）', () => {
    expect(maAlignment(null, 20, 10)).toBeNull()
    expect(maAlignment(30, 20, null)).toBeNull()
  })
})

describe('bollinger', () => {
  it('mid is SMA20; upper/lower symmetric around mid for flat series', async () => {
    const { bollinger, sma } = await import('./indicators')
    const flat = Array.from({ length: 30 }, () => 100 as number | null)
    const bb = bollinger(flat, 20, 2)
    const mid = sma(flat, 20)
    expect(bb.mid[29]).toBeCloseTo(100, 10)
    expect(bb.mid[29]).toBeCloseTo(mid[29]!, 10)
    expect(bb.upper[29]).toBeCloseTo(100, 10)
    expect(bb.lower[29]).toBeCloseTo(100, 10)
    expect(bb.upper[10]).toBeNull()
  })

  it('bands widen when closes move', async () => {
    const { bollinger } = await import('./indicators')
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i)
    const bb = bollinger(closes, 20, 2)
    expect(bb.mid[24]).not.toBeNull()
    expect(bb.upper[24]!).toBeGreaterThan(bb.mid[24]!)
    expect(bb.lower[24]!).toBeLessThan(bb.mid[24]!)
  })
})

describe('lastValue', () => {
  it('取最後一個非 null 值', () => {
    expect(lastValue([1, 2, null])).toBe(2)
    expect(lastValue([null, null])).toBeNull()
    expect(lastValue([])).toBeNull()
  })
})
