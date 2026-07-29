import { describe, it, expect } from 'vitest'
import {
  FX_CURRENCIES,
  FX_MIN_POINTS,
  buildCurrency,
  extractFxPoints,
  fxUrl,
  type FxSpec,
} from './fxRates.ts'
import { type ChartResponse } from './twDaily.ts'

/**
 * fixture 取自 2026-07-29 對 query1.finance.yahoo.com 的實際回應（JPYTWD=X，range=1y）。
 *
 * 三格是原樣照抄的真實情況，不是假想的邊界：
 * - 索引 0–2：序列開頭，注意 timestamp 是 23:00Z 而 gmtoffset 是 3600（倫敦）
 * - 索引 3：2025-12-25 耶誕節，close 為 null
 * - 索引 4–5：同為 2026-07-29 —— 前者是「今天的日線還沒收」（null），
 *   後者是 Yahoo 附加的即時報價列（epoch 不是整點，且等於 meta.regularMarketTime）
 */
const REAL: ChartResponse = {
  chart: {
    result: [
      {
        meta: { gmtoffset: 3600, symbol: 'JPYTWD=X', regularMarketTime: 1785288323 },
        timestamp: [1753743600, 1753830000, 1753916400, 1766620800, 1785279600, 1785288323],
        indicators: {
          quote: [
            {
              close: [
                0.19965200126171112,
                0.19998799264431,
                0.19969700276851654,
                null,
                null,
                0.1956000030040741,
              ],
            },
          ],
        },
      },
    ],
  },
}

describe('extractFxPoints', () => {
  it('以 gmtoffset 換算日期 —— 不加位移會整條倒退一天', () => {
    const pts = extractFxPoints(REAL, false)
    // 1753743600 = 2025-07-28T23:00Z；加 1 小時才進到 07-29
    expect(pts[0][0]).toBe('2025-07-29')
    expect(new Date(1753743600 * 1000).toISOString().slice(0, 10)).toBe('2025-07-28')
  })

  it('丟掉收盤為 null 的格（假日與尚未收盤的當日）', () => {
    const pts = extractFxPoints(REAL, false)
    expect(pts.map((p) => p[0])).not.toContain('2025-12-25')
  })

  it('剔除 Yahoo 附加的即時報價列（ts === meta.regularMarketTime）', () => {
    const pts = extractFxPoints(REAL, false)
    // 2026-07-29 那天只剩一格 null 日線與一格即時價，兩者都該被排除
    expect(pts.map((p) => p[0])).not.toContain('2026-07-29')
    expect(pts.map((p) => p[1])).not.toContain(0.1956)
  })

  it('沒有 regularMarketTime 時不誤刪任何日線', () => {
    const resp: ChartResponse = {
      chart: {
        result: [
          {
            meta: { gmtoffset: 3600, symbol: 'JPYTWD=X' },
            timestamp: [1753743600, 1753830000],
            indicators: { quote: [{ close: [0.199652, 0.199988] }] },
          },
        ],
      },
    }
    expect(extractFxPoints(resp, false)).toHaveLength(2)
  })

  it('反向幣對的即時報價被剔除 —— 實測人民幣會多算 4.47% 的日變動', () => {
    // TWDCNY=X 實際回應：日線 0.20936(→4.7766)，附加的即時列 0.2004(→4.9900)
    const resp: ChartResponse = {
      chart: {
        result: [
          {
            meta: { gmtoffset: 3600, symbol: 'TWDCNY=X', regularMarketTime: 1785289523 },
            timestamp: [1785193200, 1785279600, 1785289523],
            indicators: { quote: [{ close: [0.209353, 0.20936, 0.2004] }] },
          },
        ],
      },
    }
    const pts = extractFxPoints(resp, true)
    expect(pts).toHaveLength(2)
    // 留下的兩筆彼此相差不到 0.1%，不會出現 4.47% 的假跳動
    const jump = Math.abs(pts[1][1] / pts[0][1] - 1) * 100
    expect(jump).toBeLessThan(0.1)
  })

  it('由舊到新排序', () => {
    const dates = extractFxPoints(REAL, false).map((p) => p[0])
    expect(dates).toEqual([...dates].sort())
  })

  it('存進去的精度是六位小數，不是 Yahoo 的浮點尾巴', () => {
    expect(extractFxPoints(REAL, false)[0][1]).toBe(0.199652)
  })

  it('invert 取倒數，換算出「1 外幣 = N 台幣」', () => {
    // TWDCNY=X 報的是 1 台幣換多少人民幣，要倒過來才是我們存的方向
    const resp: ChartResponse = {
      chart: {
        result: [
          {
            meta: { gmtoffset: 3600, symbol: 'TWDCNY=X' },
            timestamp: [1785193200],
            indicators: { quote: [{ close: [0.2085] }] },
          },
        ],
      },
    }
    expect(extractFxPoints(resp, true)[0][1]).toBe(4.796163)
  })

  it('invert 時排除收盤為 0，不讓 Infinity 流進序列', () => {
    const resp: ChartResponse = {
      chart: {
        result: [
          {
            meta: { gmtoffset: 3600, symbol: 'TWDCNY=X' },
            timestamp: [1785193200, 1785279600],
            indicators: { quote: [{ close: [0, 0.2085] }] },
          },
        ],
      },
    }
    const pts = extractFxPoints(resp, true)
    expect(pts).toHaveLength(1)
    expect(pts.every((p) => Number.isFinite(p[1]))).toBe(true)
  })

  it('結構不符回空陣列，呼叫端據此改試下一個候選幣對', () => {
    expect(extractFxPoints({} as ChartResponse, false)).toEqual([])
    expect(extractFxPoints({ chart: { result: null } }, false)).toEqual([])
    expect(
      extractFxPoints(
        { chart: { result: [{ meta: {}, timestamp: [1], indicators: {} }] } },
        false,
      ),
    ).toEqual([])
  })
})

describe('FX_CURRENCIES', () => {
  it('八個幣別，代號不重覆', () => {
    expect(FX_CURRENCIES).toHaveLength(8)
    expect(new Set(FX_CURRENCIES.map((c) => c.code)).size).toBe(8)
  })

  it('每個幣別都有兩個方向的候選幣對，且 invert 與幣對方向一致', () => {
    for (const c of FX_CURRENCIES) {
      expect(c.symbols).toHaveLength(2)
      for (const s of c.symbols) {
        // TWD 在前 ⇒ 報的是 1 台幣換多少外幣 ⇒ 必須 invert
        expect(s.invert).toBe(s.symbol.startsWith('TWD'))
      }
      expect(new Set(c.symbols.map((s) => s.symbol)).size).toBe(2)
    }
  })

  it('人民幣把台幣在前的那側排第一 —— 實測 CNYTWD=X 只回一格', () => {
    const cny = FX_CURRENCIES.find((c) => c.code === 'CNY')!
    expect(cny.symbols[0].symbol).toBe('TWDCNY=X')
    // 其餘幣別都是外幣在前
    for (const c of FX_CURRENCIES.filter((x) => x.code !== 'CNY')) {
      expect(c.symbols[0].symbol).toBe(`${c.code}TWD=X`)
    }
  })

  it('小數位數足以看出變化 —— 韓元用 3 位會全部變成 0.022', () => {
    const krw = FX_CURRENCIES.find((c) => c.code === 'KRW')!
    expect(krw.decimals).toBeGreaterThanOrEqual(5)
  })

  it('門檻低於一年的交易日數、但高於「只回一格」的死幣對', () => {
    expect(FX_MIN_POINTS).toBeGreaterThan(1)
    expect(FX_MIN_POINTS).toBeLessThan(260)
  })
})

describe('fxUrl', () => {
  it('與 twDaily 同一組參數，且 = 有做 encode', () => {
    expect(fxUrl('JPYTWD=X')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/JPYTWD%3DX?interval=1d&range=1y',
    )
  })
})

describe('buildCurrency', () => {
  const spec: FxSpec = {
    code: 'JPY',
    name: '日圓',
    decimals: 4,
    symbols: [{ symbol: 'JPYTWD=X', invert: false }],
  }

  it('latest / prevClose 取序列末兩筆', () => {
    const c = buildCurrency(spec, 'JPYTWD=X', [
      ['2026-07-27', 0.197462],
      ['2026-07-28', 0.197229],
      ['2026-07-29', 0.1956],
    ])
    expect(c.latest).toBe(0.1956)
    expect(c.prevClose).toBe(0.197229)
    expect(c.symbol).toBe('JPYTWD=X')
  })

  it('空序列不炸，latest / prevClose 為 null', () => {
    const c = buildCurrency(spec, 'JPYTWD=X', [])
    expect(c.latest).toBeNull()
    expect(c.prevClose).toBeNull()
  })

  it('只有一筆時 prevClose 為 null，不拿自己當基期', () => {
    const c = buildCurrency(spec, 'JPYTWD=X', [['2026-07-29', 0.1956]])
    expect(c.latest).toBe(0.1956)
    expect(c.prevClose).toBeNull()
  })
})
