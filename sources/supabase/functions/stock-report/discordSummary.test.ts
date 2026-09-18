import { describe, expect, it } from 'vitest'
import {
  buildSummaryPayload,
  buildTestPayload,
  findMarketDay,
  type IndexLine,
  type SummaryInput,
} from './discordSummary.ts'
import type { DiscordEmbed, DiscordPayload } from './discordWebhook.ts'
import { SUMMARY_INDICES } from './globalIndexClose.ts'
import type { MarketMarginTotals } from './marketMargin.ts'
import type { MarketDay } from './twMarket.ts'
import { MACRO_LINES, MARKET_ASOF_0916, MARKET_DAY_0916, USD_TWD } from './discordTestFixtures.ts'

const SOURCE_LINE = '-# 資料來源：證交所、Yahoo Finance、FRED｜僅供參考，非投資建議'
const RED = 0xe5484d
const GREEN = 0x30a46c
const GREY = 0x8b8d98

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

const INDEX_DESC = fence([
  '日經225   63,923 ▲0.69%',
  'KOSPI    暫無資料',
  'KOSDAQ   暫無資料',
  '道瓊     暫無資料',
  'S&P 500    7,552 ▼0.45%',
  '那斯達克 暫無資料',
  '費半     暫無資料',
  '羅素2000 暫無資料',
])

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    edition: 'brief',
    ymd: '2026-09-16',
    today: '2026-09-16',
    generatedAt: '2026-09-16T09:05:00.000Z',
    market: MARKET_DAY_0916,
    marketAsOf: MARKET_ASOF_0916,
    indices: indices(),
    usdTwd: USD_TWD,
    margin: MARGIN,
    macro: MACRO_LINES,
    ...over,
  }
}

/** A fenced monospace table, spec §2.9. */
function fence(lines: string[]): string {
  return '```\n' + lines.join('\n') + '\n```'
}

function day(over: Partial<MarketDay>): MarketDay {
  return { ...MARKET_DAY_0916, ...over }
}

/** The card whose title contains `name`. */
function card(p: DiscordPayload, name: string): DiscordEmbed | undefined {
  return p.embeds.find((e) => e.title.includes(name))
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

describe('buildSummaryPayload — brief cards (real 2026-09-16 data)', () => {
  const p = buildSummaryPayload(input())

  it('puts the heading and source line in the message text', () => {
    expect(p.content).toBe(`## 📊 台股盤後快報 09/16(三)\n${SOURCE_LINE}`)
    expect(p.username).toBe('盤後總結')
    expect(p.allowed_mentions).toEqual({ parse: [] })
  })

  it('has one card per brief block, in order', () => {
    expect(p.embeds.map((e) => e.title)).toEqual([
      '🇹🇼 台股大盤',
      '🏦 三大法人・盤後初步（億元）',
      '🌏 國際指數・最近收盤',
      '💱 匯率',
    ])
  })

  it('formats the TAIEX card, red on an up day, stamped with the update time', () => {
    const c = card(p, '台股大盤')!
    expect(c.description).toBe(
    fence([
      '加權指數  45,848.90',
      '漲跌點數    +337.41 🔴',
      '漲跌幅度     +0.74% 🔴',
      '成交金額  6,759.7億',
    ]),
    )
    expect(c.color).toBe(RED)
    expect(c.footer).toEqual({ text: '09/16 15:05 更新' })
  })

  it('formats the institutional card, green on a net sell', () => {
    const c = card(p, '三大法人')!
    expect(c.description).toBe(
    fence([
      '外資  -179.8 🟢',
      '投信   +95.7 🔴',
      '自營  -129.7 🟢',
      '合計  -213.8 🟢',
    ]),
    )
    expect(c.color).toBe(GREEN)
    expect(c.footer).toEqual({ text: '09/16 15:05 更新' })
  })

  it('lists every index with its own date', () => {
    const c = card(p, '國際指數')!
    expect(c.description).toBe(INDEX_DESC)
    expect(c.color).toBe(GREY)
    expect(c.footer).toEqual({ text: '各市場最近一個已收盤交易日' })
  })

  it('formats the fx card with the quote date and file update time', () => {
    const c = card(p, '匯率')!
    expect(c.description).toBe(fence([ 'USD/TWD  31.773 +0.056']))
    expect(c.color).toBe(GREY)
    expect(c.footer).toEqual({ text: '09/16 17:00 更新' })
  })

  it('does not render margin or macro even when given', () => {
    const text = JSON.stringify(p)
    expect(text).not.toContain('融資')
    expect(text).not.toContain('核心 CPI')
  })
})

describe('buildSummaryPayload — full cards (real 2026-09-16 data)', () => {
  const p = buildSummaryPayload(
    input({ edition: 'full', generatedAt: '2026-09-16T13:30:00.000Z', marketAsOf: '2026-09-16T11:40:00.000Z' }),
  )

  it('uses the full heading', () => {
    expect(p.content).toBe(`## 📋 台股盤後完整版 09/16(三)\n${SOURCE_LINE}`)
  })

  it('has one card per full block, in order, and labels complete institutional data', () => {
    expect(p.embeds.map((e) => e.title)).toEqual([
      '🇹🇼 台股大盤',
      '🏦 三大法人・盤後完整（億元）',
      '🧾 融資融券',
      '🌏 國際指數・最近收盤',
      '🇺🇸 美國總經',
      '💱 匯率',
    ])
    expect(card(p, '三大法人')!.footer).toEqual({ text: '09/16 19:40 更新' })
  })

  it('formats the margin card', () => {
    const c = card(p, '融資融券')!
    expect(c.description).toBe(
    fence([
      '融資張 9,248,877 +58,366',
      '融資億   5,861.7   +39.3',
      '融券張   197,048  -1,004',
    ]),
    )
    expect(c.color).toBe(GREY)
    expect(c.footer).toEqual({ text: '09/16 資料' })
  })

  it('formats the macro card', () => {
    const c = card(p, '美國總經')!
    expect(c.description).toBe(
    fence([
      '核心CPI 08月',
      '         2.47% → 2.45%',
      '核心PPI 08月',
      '         4.26% → 4.62%',
      '核心PCE 07月',
      '                 3.34%',
      '聯邦利率 09/16',
      '             3.5-3.75%',
      '非農就業 08月',
      '      21千人 → 162千人',
      '消費信心 07月',
      '   49.5指數 → 55.2指數',
    ]),
    )
    expect(c.footer).toEqual({ text: '括號內為資料期別' })
  })

  it('stays inside Discord limits', () => {
    expect(p.content!.length).toBeLessThanOrEqual(2000)
    expect(p.embeds.length).toBeLessThanOrEqual(10)
    let total = 0
    for (const e of p.embeds) {
      expect((e.description ?? '').length).toBeLessThanOrEqual(4096)
      expect(e.title.length).toBeLessThanOrEqual(256)
      total += e.title.length + (e.description ?? '').length + (e.footer?.text ?? '').length
    }
    expect(total).toBeLessThanOrEqual(6000)
  })
})

describe('buildSummaryPayload — data dates and staleness', () => {
  it('flags every TW-dated card that is not from today', () => {
    const p = buildSummaryPayload(input({ edition: 'full', today: '2026-09-17' }))
    for (const name of ['台股大盤', '三大法人', '融資融券', '匯率']) {
      expect(card(p, name)!.footer).toEqual({ text: '⚠️ 09/16 資料・非今日' })
    }
    expect(card(p, '國際指數')!.footer).toEqual({ text: '各市場最近一個已收盤交易日' })
    expect(card(p, '美國總經')!.footer).toEqual({ text: '括號內為資料期別' })
  })

  it('shows both dates when the update happened on a later day', () => {
    const p = buildSummaryPayload(input({ marketAsOf: '2026-09-17T01:00:00.000Z' }))
    expect(card(p, '台股大盤')!.footer).toEqual({ text: '09/16 資料・09/17 09:00 更新' })
    expect(card(p, '三大法人')!.title).toBe('🏦 三大法人・盤後完整（億元）')
  })

  it('falls back to the data date when the update time is unknown', () => {
    const p = buildSummaryPayload(input({ marketAsOf: null, usdTwd: { ...USD_TWD, asOf: null } }))
    expect(card(p, '台股大盤')!.footer).toEqual({ text: '09/16 資料' })
    expect(card(p, '三大法人')!.title).toBe('🏦 三大法人（億元）')
    expect(card(p, '三大法人')!.footer).toEqual({ text: '09/16 資料' })
    expect(card(p, '匯率')!.footer).toEqual({ text: '09/16 資料' })
  })

  it('splits 盤後初步／完整 exactly at 19:30 Taipei', () => {
    const title = (asOf: string) => card(buildSummaryPayload(input({ marketAsOf: asOf })), '三大法人')!.title
    expect(title('2026-09-16T11:29:59.000Z')).toBe('🏦 三大法人・盤後初步（億元）')
    expect(title('2026-09-16T11:30:00.000Z')).toBe('🏦 三大法人・盤後完整（億元）')
  })

  it('treats an unparseable update time as unknown, never printing NaN', () => {
    for (const bad of ['garbage', '']) {
      const p = buildSummaryPayload(input({ marketAsOf: bad, usdTwd: { ...USD_TWD, asOf: bad } }))
      expect(card(p, '台股大盤')!.footer).toEqual({ text: '09/16 資料' })
      expect(card(p, '三大法人')!.title).toBe('🏦 三大法人（億元）')
      expect(card(p, '匯率')!.footer).toEqual({ text: '09/16 資料' })
      expect(JSON.stringify(p)).not.toContain('NaN')
    }
  })

  it('omits the fx stamp when the quote date is unknown', () => {
    const p = buildSummaryPayload(input({ usdTwd: { ...USD_TWD, date: null } }))
    expect(card(p, '匯率')!.footer).toBeUndefined()
  })
})

describe('buildSummaryPayload — missing and edge values', () => {
  it('marks unpublished TW data without a stamp', () => {
    const p = buildSummaryPayload(input({ edition: 'full', margin: null, market: day({ institutional: null }) }))
    const inst = card(p, '三大法人')!
    expect(inst.title).toBe('🏦 三大法人')
    expect(inst.description).toBe('尚未公布')
    expect(inst.footer).toBeUndefined()
    expect(inst.color).toBe(GREY)
    expect(card(p, '融資融券')!.description).toBe('尚未公布')
    expect(card(p, '融資融券')!.footer).toBeUndefined()
  })

  it('marks a missing TAIEX close', () => {
    const c = card(buildSummaryPayload(input({ market: day({ taiex: null }) })), '台股大盤')!
    expect(c.description).toBe('尚未公布')
    expect(c.footer).toBeUndefined()
    expect(c.color).toBe(GREY)
  })

  it('shows an unknown change', () => {
    const c = card(buildSummaryPayload(input({ market: day({ changePoints: null }) })), '台股大盤')!
    expect(c.description).toBe(
    fence([
      '加權指數  45,848.90',
      '漲跌點數         --',
      '漲跌幅度         --',
      '成交金額  6,759.7億',
    ]),
    )
    expect(c.color).toBe(GREY)
  })

  it('shows a flat day', () => {
    const c = card(buildSummaryPayload(input({ market: day({ changePoints: 0, tradeValueTwd: null }) })), '台股大盤')!
    expect(c.description).toBe(
    fence([
      '加權指數  45,848.90',
      '漲跌點數       0.00 ⚪',
      '漲跌幅度      0.00% ⚪',
      '成交金額         --',
    ]),
    )
    expect(c.color).toBe(GREY)
  })

  it('shows a down day in green', () => {
    const c = card(buildSummaryPayload(input({ market: day({ taiex: 45511.49, changePoints: -337.41 }) })), '台股大盤')!
    expect(c.description).toBe(
    fence([
      '加權指數  45,511.49',
      '漲跌點數    -337.41 🟢',
      '漲跌幅度     -0.74% 🟢',
      '成交金額  6,759.7億',
    ]),
    )
    expect(c.color).toBe(GREEN)
  })

  it('sums dealers treating a single null as zero, and prints — for unknown amounts', () => {
    const inst = MARKET_DAY_0916.institutional!
    const p = buildSummaryPayload(
      input({ market: day({ institutional: { ...inst, dealerHedgeTwd: null, trustTwd: null, foreignTwd: -1_000_000 } }) }),
    )
    expect(card(p, '三大法人')!.description).toBe(
    fence([
      '外資     0.0 ⚪',
      '投信      --',
      '自營   -36.3 🟢',
      '合計  -213.8 🟢',
    ]),
    )
  })

  it('prints — when both dealer amounts are unknown, and turns red on a net buy', () => {
    const inst = MARKET_DAY_0916.institutional!
    const c = card(
      buildSummaryPayload(
        input({ market: day({ institutional: { ...inst, dealerSelfTwd: null, dealerHedgeTwd: null, totalTwd: 4_000_000_000 } }) }),
      ),
      '三大法人',
    )!
    expect(c.description).toBe(
    fence([
      '外資  -179.8 🟢',
      '投信   +95.7 🔴',
      '自營      --',
      '合計   +40.0 🔴',
    ]),
    )
    expect(c.color).toBe(RED)
  })

  it('handles missing fx pieces', () => {
    const fx = (over: Partial<SummaryInput>) => card(buildSummaryPayload(input(over)), '匯率')!
    expect(fx({ usdTwd: null }).description).toBe('暫無資料')
    expect(fx({ usdTwd: null }).footer).toBeUndefined()
    expect(fx({ usdTwd: { ...USD_TWD, latest: null } }).description).toBe('暫無資料')
    expect(fx({ usdTwd: { ...USD_TWD, prevClose: null } }).description).toBe(fence(['USD/TWD  31.773']))
  })

  it('handles missing macro pieces, including a null value', () => {
    const macro = (m: SummaryInput['macro']) => card(buildSummaryPayload(input({ edition: 'full', macro: m })), '美國總經')!
    expect(macro(null).description).toBe('暫無資料')
    expect(macro(null).footer).toBeUndefined()
    expect(macro([]).description).toBe('暫無資料')
    expect(
      macro([
        { ...MACRO_LINES[0], previous: null },
        { ...MACRO_LINES[1], latest: null },
        { ...MACRO_LINES[0], previous: { period: '2026-07', value: null } },
        { ...MACRO_LINES[3], latest: { period: '2026-09-16', value: null, valueLow: 3.5 } },
      ]).description,
    ).toBe(
    fence([
      '核心CPI 08月',
      '            -- → 2.45%',
      '核心PPI  暫無資料',
      '核心CPI 08月',
      '            -- → 2.45%',
      '聯邦利率 暫無資料',
    ]),
    )
  })

  it('handles index edge cases', () => {
    const list = indices()
    list[0] = { ...list[0], quote: { date: '09/16', close: 63923, changePct: null } }
    list[4] = { ...list[4], quote: { date: '09/16', close: 7551.81, changePct: 0.001 } }
    expect(card(buildSummaryPayload(input({ indices: list })), '國際指數')!.description).toBe(
    fence([
      '日經225   63,923      --',
      'KOSPI    暫無資料',
      'KOSDAQ   暫無資料',
      '道瓊     暫無資料',
      'S&P 500    7,552 ─0.00%',
      '那斯達克 暫無資料',
      '費半     暫無資料',
      '羅素2000 暫無資料',
    ]),
    )
    const empty = card(buildSummaryPayload(input({ indices: [] })), '國際指數')!
    expect(empty.description).toBe('暫無資料')
    expect(empty.footer).toBeUndefined()
  })

  it('prints a null margin change as （—）', () => {
    const c = card(
      buildSummaryPayload(input({ edition: 'full', margin: { ...MARGIN, shortLots: { prev: null, today: 197048, change: null } } })),
      '融資融券',
    )!
    expect(c.description).toBe(
    fence([
      '融資張 9,248,877 +58,366',
      '融資億   5,861.7   +39.3',
      '融券張   197,048      --',
    ]),
    )
  })

  it('keeps every card line within 24 display columns (spec Revision 6)', () => {
    const p = buildSummaryPayload(input({ edition: 'full' }))
    const width = (str: string) =>
      [...str].reduce((n, ch) => {
        const cp = ch.codePointAt(0)!
        if (cp === 0xfe0f || cp === 0x200d) return n
        return n + (/[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿＀-｠]/.test(ch) ? 2 : 1)
      }, 0)
    const lines = p.embeds.flatMap((e) => (e.description ?? '').split('\n')).filter((l) => l !== '```')
    expect(lines.length).toBeGreaterThan(10)
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(24)
  })

  it('never allows mentions, whatever the content', () => {
    const p = buildSummaryPayload(input({ indices: [{ symbol: '^X', label: '@everyone', quote: null }] }))
    expect(p.allowed_mentions).toEqual({ parse: [] })
  })
})

describe('buildTestPayload', () => {
  it('builds the connection test message', () => {
    const at = '2026-09-16T09:05:00.000Z'
    expect(buildTestPayload(at)).toEqual({
      username: '盤後總結',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: '🔔 Discord 連線測試',
          fields: [{ name: '狀態', value: '連線正常，每日總結會發送到這個頻道。', inline: false }],
          footer: { text: '資料來源：證交所、Yahoo Finance、FRED｜僅供參考，非投資建議' },
          timestamp: at,
        },
      ],
    })
  })
})
