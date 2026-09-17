import { describe, expect, it } from 'vitest'
import {
  buildSummaryPayload,
  buildTestPayload,
  findMarketDay,
  type IndexLine,
  type SummaryInput,
} from './discordSummary.ts'
import { SUMMARY_INDICES } from './globalIndexClose.ts'
import type { MarketMarginTotals } from './marketMargin.ts'
import type { MarketDay } from './twMarket.ts'
import { MACRO_LINES, MARKET_DAY_0916, USD_TWD } from './discordTestFixtures.ts'

const FOOTER = '資料來源：證交所、Yahoo Finance、FRED｜僅供參考，非投資建議'
const AT = '2026-09-16T09:05:00.000Z'

const MARGIN: MarketMarginTotals = {
  date: '2026-09-16',
  marginLots: { prev: 9190511, today: 9248877, change: 58366 },
  shortLots: { prev: 198052, today: 197048, change: -1004 },
  marginAmountThousandTwd: { prev: 582240465, today: 586166660, change: 3926195 },
}

function indices(): IndexLine[] {
  return SUMMARY_INDICES.map(({ symbol, label }) => ({
    symbol,
    label,
    quote:
      symbol === '^N225'
        ? { date: '09/16', close: 63923, changePct: 0.6913517348401083 }
        : symbol === '^GSPC'
          ? { date: '09/16', close: 7551.81005859375, changePct: -0.4471543537976548 }
          : null,
  }))
}

const INDEX_VALUE = [
  '日經225 63,923.00 +0.69% 09/16',
  'KOSPI 暫無資料',
  'KOSDAQ 暫無資料',
  '道瓊 暫無資料',
  'S&P 500 7,551.81 -0.45% 09/16',
  '那斯達克 暫無資料',
  '費半 暫無資料',
  '羅素2000 暫無資料',
].join('\n')

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    edition: 'brief',
    ymd: '2026-09-16',
    generatedAt: AT,
    market: MARKET_DAY_0916,
    indices: indices(),
    usdTwd: USD_TWD,
    margin: MARGIN,
    macro: MACRO_LINES,
    ...over,
  }
}

function day(over: Partial<MarketDay>): MarketDay {
  return { ...MARKET_DAY_0916, ...over }
}

function field(p: ReturnType<typeof buildSummaryPayload>, name: string): string | undefined {
  return p.embeds[0].fields.find((f) => f.name === name)?.value
}

describe('findMarketDay', () => {
  it('finds the day by date', () => {
    expect(findMarketDay({ days: [day({ date: '2026-09-15' }), MARKET_DAY_0916] }, '2026-09-16')).toBe(MARKET_DAY_0916)
  })

  it('returns null when the day is absent or the file is empty', () => {
    expect(findMarketDay({ days: [MARKET_DAY_0916] }, '2026-09-17')).toBeNull()
    expect(findMarketDay({}, '2026-09-16')).toBeNull()
    expect(findMarketDay(null, '2026-09-16')).toBeNull()
  })
})

describe('buildSummaryPayload — brief (real 2026-09-16 data)', () => {
  const p = buildSummaryPayload(input())
  const e = p.embeds[0]

  it('has the fixed envelope', () => {
    expect(p.username).toBe('盤後總結')
    expect(p.allowed_mentions).toEqual({ parse: [] })
    expect(p.content).toBeUndefined()
    expect(p.embeds).toHaveLength(1)
    expect(e.footer).toEqual({ text: FOOTER })
    expect(e.timestamp).toBe(AT)
  })

  it('titles the brief edition with the Taipei weekday', () => {
    expect(e.title).toBe('📊 台股盤後快報 09/16(三)')
  })

  it('is red on an up day', () => {
    expect(e.color).toBe(0xe5484d)
  })

  it('has exactly the brief fields in order', () => {
    expect(e.fields.map((f) => f.name)).toEqual(['台股大盤', '三大法人（初步）', '國際指數（最近收盤）', '匯率'])
    expect(e.fields.every((f) => f.inline === false)).toBe(true)
  })

  it('formats the TAIEX block', () => {
    expect(field(p, '台股大盤')).toBe('加權 45,848.90 ▲337.41 (+0.74%)\n成交 6,759.7 億')
  })

  it('formats the institutional block', () => {
    expect(field(p, '三大法人（初步）')).toBe('外資 -179.8億\n投信 +95.7億\n自營 -129.7億\n合計 -213.8億')
  })

  it('lists every index, marking the missing ones', () => {
    expect(field(p, '國際指數（最近收盤）')).toBe(INDEX_VALUE)
  })

  it('formats USD/TWD with the currency decimals', () => {
    expect(field(p, '匯率')).toBe('USD/TWD 31.773 (+0.056)')
  })

  it('does not render margin or macro even when given', () => {
    const text = JSON.stringify(p)
    expect(text).not.toContain('融資')
    expect(text).not.toContain('核心 CPI')
  })
})

describe('buildSummaryPayload — full (real 2026-09-16 data)', () => {
  const p = buildSummaryPayload(input({ edition: 'full', generatedAt: '2026-09-16T13:30:00.000Z' }))
  const e = p.embeds[0]

  it('titles the full edition', () => {
    expect(e.title).toBe('📋 台股盤後完整版 09/16(三)')
  })

  it('has exactly the full fields in order', () => {
    expect(e.fields.map((f) => f.name)).toEqual([
      '台股大盤', '三大法人', '融資融券', '國際指數（最近收盤）', '美國總經', '匯率',
    ])
  })

  it('formats the institutional block without the preliminary label', () => {
    expect(field(p, '三大法人')).toBe('外資 -179.8億\n投信 +95.7億\n自營 -129.7億\n合計 -213.8億')
  })

  it('formats the margin block', () => {
    expect(field(p, '融資融券')).toBe(
      '融資 9,248,877 張 (+58,366)\n融資金額 5,861.7 億 (+39.3億)\n融券 197,048 張 (-1,004)',
    )
  })

  it('formats the macro block', () => {
    expect(field(p, '美國總經')).toBe(
      [
        '核心 CPI 2.47% → 2.45%（2026-08）',
        '核心 PPI 4.26% → 4.62%（2026-08）',
        '核心 PCE 3.34% → 3.34%（2026-07）',
        'FOMC 目標利率 3.5–3.75% → 3.5–3.75%（2026-09-16）',
        '非農就業 NFP 21 千人 → 162 千人（2026-08）',
        '消費者信心 UMCSENT 49.5 指數 → 55.2 指數（2026-07）',
      ].join('\n'),
    )
  })

  it('stays inside Discord embed limits', () => {
    for (const f of e.fields) expect(f.value.length).toBeLessThanOrEqual(1024)
    const total =
      e.title.length +
      (e.description ?? '').length +
      (e.footer?.text ?? '').length +
      e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
    expect(total).toBeLessThanOrEqual(6000)
  })
})

describe('buildSummaryPayload — missing and edge values', () => {
  it('marks unpublished TW data', () => {
    const p = buildSummaryPayload(input({ edition: 'full', margin: null, market: day({ institutional: null }) }))
    expect(field(p, '三大法人')).toBe('尚未公布')
    expect(field(p, '融資融券')).toBe('尚未公布')
  })

  it('marks a missing TAIEX close', () => {
    const p = buildSummaryPayload(input({ market: day({ taiex: null }) }))
    expect(field(p, '台股大盤')).toBe('尚未公布')
  })

  it('omits the change when it is unknown', () => {
    const p = buildSummaryPayload(input({ market: day({ changePoints: null }) }))
    expect(field(p, '台股大盤')).toBe('加權 45,848.90\n成交 6,759.7 億')
    expect(p.embeds[0].color).toBe(0x8b8d98)
  })

  it('shows a flat day', () => {
    const p = buildSummaryPayload(input({ market: day({ changePoints: 0, tradeValueTwd: null }) }))
    expect(field(p, '台股大盤')).toBe('加權 45,848.90 平盤 (0.00%)\n成交 —')
    expect(p.embeds[0].color).toBe(0x8b8d98)
  })

  it('shows a down day in green', () => {
    const p = buildSummaryPayload(input({ market: day({ taiex: 45511.49, changePoints: -337.41 }) }))
    expect(field(p, '台股大盤')).toBe('加權 45,511.49 ▼337.41 (-0.74%)\n成交 6,759.7 億')
    expect(p.embeds[0].color).toBe(0x30a46c)
  })

  it('sums dealers treating a single null as zero, and prints — for unknown amounts', () => {
    const inst = MARKET_DAY_0916.institutional!
    const p = buildSummaryPayload(
      input({
        market: day({
          institutional: { ...inst, dealerHedgeTwd: null, trustTwd: null, foreignTwd: -1_000_000 },
        }),
      }),
    )
    expect(field(p, '三大法人（初步）')).toBe('外資 0.0億\n投信 —\n自營 -36.3億\n合計 -213.8億')
  })

  it('prints — when both dealer amounts are unknown', () => {
    const inst = MARKET_DAY_0916.institutional!
    const p = buildSummaryPayload(
      input({ market: day({ institutional: { ...inst, dealerSelfTwd: null, dealerHedgeTwd: null } }) }),
    )
    expect(field(p, '三大法人（初步）')).toContain('自營 —')
  })

  it('handles missing fx pieces', () => {
    expect(field(buildSummaryPayload(input({ usdTwd: null })), '匯率')).toBe('暫無資料')
    expect(field(buildSummaryPayload(input({ usdTwd: { ...USD_TWD, latest: null } })), '匯率')).toBe('暫無資料')
    expect(field(buildSummaryPayload(input({ usdTwd: { ...USD_TWD, prevClose: null } })), '匯率')).toBe('USD/TWD 31.773')
  })

  it('handles missing macro pieces', () => {
    expect(field(buildSummaryPayload(input({ edition: 'full', macro: null })), '美國總經')).toBe('暫無資料')
    expect(field(buildSummaryPayload(input({ edition: 'full', macro: [] })), '美國總經')).toBe('暫無資料')
    const p = buildSummaryPayload(
      input({
        edition: 'full',
        macro: [
          { ...MACRO_LINES[0], previous: null },
          { ...MACRO_LINES[1], latest: null },
        ],
      }),
    )
    expect(field(p, '美國總經')).toBe('核心 CPI — → 2.45%（2026-08）\n核心 PPI 暫無資料')
  })

  it('treats a null macro value like a missing point, never as 0', () => {
    const p = buildSummaryPayload(
      input({
        edition: 'full',
        macro: [
          { ...MACRO_LINES[0], latest: { period: '2026-08', value: null } },
          { ...MACRO_LINES[1], previous: { period: '2026-07', value: null } },
          { ...MACRO_LINES[3], latest: { period: '2026-09-16', value: null, valueLow: 3.5 } },
        ],
      }),
    )
    expect(field(p, '美國總經')).toBe('核心 CPI 暫無資料\n核心 PPI — → 4.62%（2026-08）\nFOMC 目標利率 暫無資料')
  })

  it('omits the pct token when an index change is unknown', () => {
    const list = indices()
    list[0] = { ...list[0], quote: { date: '09/16', close: 63923, changePct: null } }
    const p = buildSummaryPayload(input({ indices: list }))
    expect(field(p, '國際指數（最近收盤）')?.split('\n')[0]).toBe('日經225 63,923.00 09/16')
  })

  it('prints a null margin change as (—)', () => {
    const p = buildSummaryPayload(
      input({ edition: 'full', margin: { ...MARGIN, shortLots: { prev: null, today: 197048, change: null } } }),
    )
    expect(field(p, '融資融券')?.split('\n')[2]).toBe('融券 197,048 張 (—)')
  })

  it('never allows mentions, whatever the content', () => {
    const p = buildSummaryPayload(
      input({ indices: [{ symbol: '^X', label: '@everyone', quote: null }] }),
    )
    expect(p.allowed_mentions).toEqual({ parse: [] })
  })
})

describe('buildTestPayload', () => {
  it('builds the connection test message', () => {
    expect(buildTestPayload(AT)).toEqual({
      username: '盤後總結',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: '🔔 Discord 連線測試',
          fields: [{ name: '狀態', value: '連線正常，每日總結會發送到這個頻道。', inline: false }],
          footer: { text: FOOTER },
          timestamp: AT,
        },
      ],
    })
  })
})
