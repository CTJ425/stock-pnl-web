import { describe, it, expect } from 'vitest'
import {
  FRED_SERIES,
  MACRO_UA,
  MACRO_POINTS,
  deriveIndicator,
  fredCsvUrl,
  fredSinceDate,
  macroFingerprint,
  parseFredCsv,
  type MacroIndicator,
  type MacroSeriesSpec,
} from './usMacro.ts'

/**
 * fixture 逐字取自 2026-07-28 對 fredgraph.csv 的實際回應（節錄）。
 * 刻意保留空值列（`1952-12,`）與三位小數 —— 那些正是解析器要扛住的東西。
 */
const UMCSENT_HEAD = `observation_date,UMCSENT
1952-11-01,86.2
1952-12-01,
1953-01-01,
1953-02-01,90.7`

/** 25 個月的等比序列，方便手算驗證年增與月增 */
function synth(id: string, start: number, step: number, months = 25): string {
  const rows = ['observation_date,' + id]
  for (let i = 0; i < months; i++) {
    const total = 2024 * 12 + i
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    rows.push(`${y}-${String(m).padStart(2, '0')}-01,${(start + step * i).toFixed(3)}`)
  }
  return rows.join('\n')
}

const spec = (kind: MacroSeriesSpec['kind']): MacroSeriesSpec => ({
  id: 'X',
  label: 'X',
  kind,
  note: '',
})

describe('fredCsvUrl / fredSinceDate', () => {
  it('組出帶起始日的 CSV 網址', () => {
    expect(fredCsvUrl('CPILFESL', '2024-06-01')).toBe(
      'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPILFESL&cosd=2024-06-01',
    )
  })

  it('往回推月份，跨年不出錯', () => {
    expect(fredSinceDate(new Date('2026-07-28T00:00:00Z'), 26)).toBe('2024-05-01')
    expect(fredSinceDate(new Date('2026-01-15T00:00:00Z'), 1)).toBe('2025-12-01')
    expect(fredSinceDate(new Date('2026-01-15T00:00:00Z'), 13)).toBe('2024-12-01')
  })
})

describe('parseFredCsv', () => {
  it('表頭被跳過，日期轉成 YYYY-MM', () => {
    const pts = parseFredCsv(UMCSENT_HEAD)
    expect(pts[0]).toEqual({ period: '1952-11', value: 86.2 })
    expect(pts[3]).toEqual({ period: '1953-02', value: 90.7 })
  })

  it('空值列保留為 null——跳過會讓「前一期」錯位，補 0 會讓年增率變天文數字', () => {
    const pts = parseFredCsv(UMCSENT_HEAD)
    expect(pts).toHaveLength(4)
    expect(pts[1]).toEqual({ period: '1952-12', value: null })
    expect(pts[2].value).toBeNull()
  })

  it('空字串與壞掉的內容回空陣列，不拋例外', () => {
    expect(parseFredCsv('')).toEqual([])
    expect(parseFredCsv('<html>404</html>')).toEqual([])
  })
})

describe('deriveIndicator', () => {
  it('yoy：與 12 個月前相比的百分比', () => {
    // 2024-01 起 100、每月 +1，共 25 個月。前 12 個月算不出年增，
    // 可用的是 2025-01…2026-01 共 13 期，取最後 12 期 → 2025-02…2026-01
    const ind = deriveIndicator(spec('yoy'), parseFredCsv(synth('X', 100, 1)))
    expect(ind.unit).toBe('%')
    // 2025-02 = 113，基期 2024-02 = 101 → 11.88%
    expect(ind.points[0]).toEqual({ period: '2025-02', value: 11.88 })
    // 2026-01 = 124，基期 2025-01 = 112 → 10.71%
    expect(ind.latest).toEqual({ period: '2026-01', value: 10.71 })
  })

  it('momThousands：與上一期的差', () => {
    const ind = deriveIndicator(spec('momThousands'), parseFredCsv(synth('X', 158000, 57)))
    expect(ind.unit).toBe('千人')
    expect(ind.latest?.value).toBe(57)
    expect(ind.previous?.value).toBe(57)
  })

  it('index：原值照抄', () => {
    const ind = deriveIndicator(spec('index'), parseFredCsv(synth('X', 50, -0.5)))
    expect(ind.unit).toBe('指數')
    expect(ind.latest?.value).toBe(38)
  })

  it('最多取 12 期，由舊到新', () => {
    const ind = deriveIndicator(spec('index'), parseFredCsv(synth('X', 1, 1)))
    expect(ind.points).toHaveLength(MACRO_POINTS)
    expect(ind.points[0].period < ind.points[11].period).toBe(true)
    expect(ind.latest).toEqual(ind.points[11])
    expect(ind.previous).toEqual(ind.points[10])
  })

  it('基期缺值或為 0 時該期不硬算，回 null', () => {
    const csv = ['observation_date,X', '2025-01-01,0', ...Array.from({ length: 12 }, (_, i) => {
      const m = i + 2
      return m <= 12 ? `2025-${String(m).padStart(2, '0')}-01,100` : `2026-01-01,100`
    })].join('\n')
    const ind = deriveIndicator(spec('yoy'), parseFredCsv(csv))
    // 2026-01 的基期是 2025-01 的 0 → 不得產生 Infinity
    expect(ind.points.every((p) => p.value === null || Number.isFinite(p.value))).toBe(true)
  })

  it('完全沒有可用資料時 latest / previous 為 null 而非崩潰', () => {
    const ind = deriveIndicator(spec('yoy'), parseFredCsv('observation_date,X\n2026-01-01,'))
    expect(ind.latest).toBeNull()
    expect(ind.previous).toBeNull()
    expect(ind.points).toEqual([])
  })
})

describe('FRED_SERIES', () => {
  it('五個指標，代號與口徑固定（改動等於改變畫面語意）', () => {
    expect(FRED_SERIES.map((s) => `${s.id}:${s.kind}`)).toEqual([
      'CPILFESL:yoy',
      'PPIFES:yoy',
      'PCEPILFE:yoy',
      'PAYEMS:momThousands',
      'UMCSENT:index',
    ])
  })
})

describe('macroFingerprint', () => {
  /** 造一個指標，只有 points 是重點 */
  const ind = (id: string, points: [string, number | null][]): MacroIndicator => ({
    id,
    label: id,
    kind: 'yoy',
    unit: '%',
    note: '',
    latest: points.length ? { period: points[points.length - 1][0], value: points[points.length - 1][1] } : null,
    previous: null,
    points: points.map(([period, value]) => ({ period, value })),
  })

  const base = [
    ind('CPILFESL', [['2026-05', 2.82], ['2026-06', 2.57]]),
    ind('PCEPILFE', [['2026-04', 3.32], ['2026-05', 3.41]]),
  ]

  it('同一份資料算出同一個指紋', () => {
    expect(macroFingerprint(base)).toBe(macroFingerprint(base.map((i) => ({ ...i }))))
  })

  it('指標順序對調不影響指紋——來源的順序不保證穩定', () => {
    expect(macroFingerprint([...base].reverse())).toBe(macroFingerprint(base))
  })

  it('多出一期就是不同指紋（這正是慢一天要偵測的變化）', () => {
    const next = [base[0], ind('PCEPILFE', [['2026-04', 3.32], ['2026-05', 3.41], ['2026-06', 3.5]])]
    expect(macroFingerprint(next)).not.toBe(macroFingerprint(base))
  })

  it('歷史值被修正也算變動——只比最新一期會漏掉 FRED 的回頭修正', () => {
    // 2026-07-30 的 vintage 就同時把 2026-04 與 2026-05 改掉了，
    // 最新一期的期別沒變。指紋只涵蓋 latest 的話，這種修正永遠追不上。
    const revised = [base[0], ind('PCEPILFE', [['2026-04', 3.33], ['2026-05', 3.41]])]
    expect(macroFingerprint(revised)).not.toBe(macroFingerprint(base))
  })

  it('少一個指標算不同指紋（某序列抓不到時不該被當成沒變動）', () => {
    expect(macroFingerprint([base[0]])).not.toBe(macroFingerprint(base))
  })

  it('null 與 0 不得算成同一件事', () => {
    const withNull = [ind('X', [['2026-06', null]])]
    const withZero = [ind('X', [['2026-06', 0]])]
    expect(macroFingerprint(withNull)).not.toBe(macroFingerprint(withZero))
  })

  it('空陣列不拋例外', () => {
    expect(typeof macroFingerprint([])).toBe('string')
  })
})

describe('MACRO_UA', () => {
  it('不得宣稱自己是瀏覽器——FRED 會直接重置連線', () => {
    // 0.6.5-dev.1 第一次部署就是沿用 twChips 的瀏覽器 UA，整批抓不到，
    // 而錯誤被 catch 吃掉，只剩 macroSynced: false 一個線索。
    expect(MACRO_UA).not.toContain('Mozilla')
    expect(MACRO_UA).not.toContain('Chrome')
    expect(MACRO_UA).not.toContain('Safari')
  })

  it('誠實表明身分並附聯絡處（對公開資料源該有的禮貌）', () => {
    expect(MACRO_UA).toContain('stock-pnl-web')
    expect(MACRO_UA).toContain('https://')
  })
})
