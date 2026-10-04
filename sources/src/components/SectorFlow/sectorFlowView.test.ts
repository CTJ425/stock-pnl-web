import { describe, expect, it } from 'vitest'
import type { SectorFlowDay, SectorFlowRow } from '../../services/sectorFlowProxy'
import {
  RANGES,
  RANGE_DAYS,
  rangeHint,
  buildView,
  leadClause,
  reconciliationGap,
  signedBillion,
  toneOf,
  windowLabel,
  windowOf,
} from './sectorFlowView'

const E8 = 1e8

function row(code: string, name: string, totalE8: number, over: Partial<SectorFlowRow> = {}): SectorFlowRow {
  return {
    code,
    name,
    parent: null,
    foreignTwd: totalE8 * E8,
    trustTwd: 0,
    dealerTwd: 0,
    totalTwd: totalE8 * E8,
    turnoverTwd: 100 * E8,
    stocks: 3,
    topBuy: [],
    topSell: [],
    ...over,
  }
}

function day(date: string, rows: SectorFlowRow[], over: Partial<SectorFlowDay> = {}): SectorFlowDay {
  return {
    date,
    coverage: { listed: true, otc: true },
    rows,
    marketTurnoverTwd: 1000 * E8,
    estimateListedTotalTwd: 100 * E8,
    officialListedTotalTwd: 101 * E8,
    unpriced: 0,
    ...over,
  }
}

const semiChildren = (design: number, foundry: number, osat: number, other: number) => [
  row('24:design', 'IC 設計', design, { parent: '24' }),
  row('24:foundry', '晶圓製造', foundry, { parent: '24' }),
  row('24:osat', '封裝測試', osat, { parent: '24' }),
  row('24:other', '設備、材料與其他', other, { parent: '24' }),
]

const D1 = day('2026-10-01', [
  row('28', '電子零組件', 50),
  row('25', '電腦及週邊', -20),
  row('24', '半導體', -30),
  ...semiChildren(-40, 10, 5, -5),
])
const D2 = day(
  '2026-10-02',
  [
    row('28', '電子零組件', 234, { topBuy: [{ ticker: '3037', name: '欣興', netTwd: 90 * E8 }], topSell: [] }),
    row('25', '電腦及週邊', -114, { topSell: [{ ticker: '2376', name: '技嘉', netTwd: -30 * E8 }] }),
    row('24', '半導體', -70),
    row('ETF', 'ETF 與受益證券', -80),
    ...semiChildren(-70, 32, 10, -42),
  ],
  { estimateListedTotalTwd: 103.2 * E8, officialListedTotalTwd: 104.17 * E8 },
)

describe('windowOf', () => {
  it('takes the last 1, 3 or 5 days, oldest first', () => {
    const many = Array.from({ length: 9 }, (_, i) => day(`2026-09-${String(10 + i)}`, [row('28', 'x', 1)]))
    expect(windowOf(many, 'day').map((d) => d.date)).toEqual(['2026-09-18'])
    expect(windowOf(many, 'three').map((d) => d.date)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18'])
    expect(windowOf(many, 'week')).toHaveLength(RANGE_DAYS.week)
    expect(windowOf([D1, D2], 'week').map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02'])
  })

  it('has windows of 1, 3 and 5 trading days, shortest first', () => {
    expect(RANGES.map((r) => RANGE_DAYS[r])).toEqual([1, 3, 5])
  })
})

describe('rangeHint', () => {
  it('says which windows are still waiting for days, and how many days there are', () => {
    expect(rangeHint(1)).toBe('資料累積中，目前有 1 個交易日（每個交易日盤後多一天）；滿 3 天可看近 3 日，滿 5 天可看近 5 日。')
    expect(rangeHint(2)).toContain('目前有 2 個交易日')
    expect(rangeHint(3)).toBe('資料累積中，目前有 3 個交易日（每個交易日盤後多一天）；滿 5 天可看近 5 日。')
  })
  it('is silent once every window can be filled', () => {
    expect(rangeHint(5)).toBeNull()
    expect(rangeHint(7)).toBeNull()
  })
})

describe('buildView', () => {
  it('ranks sectors by the chosen metric, biggest buy first, and nests the semiconductor children', () => {
    const v = buildView([D1, D2], 'day', 'total')!
    // 電子零組件 +234, 半導體 −70, ETF −80, 電腦及週邊 −114.
    expect(v.sectors.map((s) => s.code)).toEqual(['28', '24', 'ETF', '25'])
    expect(v.sectors[0].code).toBe('28')
    const semi = v.sectors.find((s) => s.code === '24')!
    expect(semi.children.map((c) => c.code)).toEqual(['24:foundry', '24:osat', '24:other', '24:design'])
    expect(v.sectors.some((s) => s.code.includes(':'))).toBe(false)
  })

  it('sums a week by code, and drops the movers (they exist for the newest day only)', () => {
    const v = buildView([D1, D2], 'week', 'total')!
    const elec = v.sectors.find((s) => s.code === '28')!
    expect(elec.netTwd).toBe((50 + 234) * E8)
    expect(elec.movers).toBeNull()
    expect(v.dates).toEqual(['2026-10-01', '2026-10-02'])
    // A sector that only the newest day has still appears, with its one day.
    expect(v.sectors.find((s) => s.code === 'ETF')!.netTwd).toBe(-80 * E8)
  })

  it('carries both lists of buyers and sellers for the day, ranked by the three groups together', () => {
    const v = buildView([D1, D2], 'day', 'total')!
    expect(v.sectors.find((s) => s.code === '28')!.movers).toEqual({
      buy: [{ ticker: '3037', name: '欣興', netTwd: 90 * E8 }],
      sell: [],
    })
    expect(v.sectors.find((s) => s.code === '25')!.movers).toEqual({
      buy: [],
      sell: [{ ticker: '2376', name: '技嘉', netTwd: -30 * E8 }],
    })
  })

  it('ranks the stocks by the chosen investor group when the file has per-group lists', () => {
    const groupTops = {
      foreign: { buy: [{ ticker: 'A', name: '外資買', netTwd: 5 * E8 }], sell: [] },
      trust: { buy: [], sell: [{ ticker: 'B', name: '投信賣', netTwd: -2 * E8 }] },
      dealer: { buy: [], sell: [] },
    }
    const d = day('2026-10-02', [
      row('28', 'x', 3, { topBuy: [{ ticker: 'T', name: '合計買', netTwd: 4 * E8 }], groupTops }),
    ])
    expect(buildView([d], 'day', 'total')!.sectors[0].movers?.buy[0].name).toBe('合計買')
    expect(buildView([d], 'day', 'foreign')!.sectors[0].movers).toEqual(groupTops.foreign)
    expect(buildView([d], 'day', 'trust')!.sectors[0].movers).toEqual(groupTops.trust)
    // A group with nothing on either side has no list to show.
    expect(buildView([d], 'day', 'dealer')!.sectors[0].movers).toBeNull()
  })

  it('has no per-group lists to offer for a file written before they existed', () => {
    const d = day('2026-10-02', [row('28', 'x', 3, { topBuy: [{ ticker: 'T', name: 't', netTwd: 4 * E8 }] })])
    expect(buildView([d], 'day', 'total')!.sectors[0].movers).not.toBeNull()
    expect(buildView([d], 'day', 'foreign')!.sectors[0].movers).toBeNull()
  })

  it('switches the figure with the investor group', () => {
    const d = day('2026-10-02', [row('28', '電子零組件', 10, { foreignTwd: 7 * E8, trustTwd: 2 * E8, dealerTwd: 1 * E8 })])
    expect(buildView([d], 'day', 'foreign')!.sectors[0].netTwd).toBe(7 * E8)
    expect(buildView([d], 'day', 'trust')!.sectors[0].netTwd).toBe(2 * E8)
    expect(buildView([d], 'day', 'dealer')!.sectors[0].netTwd).toBe(1 * E8)
  })

  it('computes the share of the market turnover over the window', () => {
    const v = buildView([D1, D2], 'week', 'total')!
    // 電子零組件: 100億 on each of two days over 1000億 + 1000億.
    expect(v.sectors.find((s) => s.code === '28')!.turnoverShare).toBeCloseTo(0.1, 6)
  })

  it('sizes the bars by the biggest |net| anywhere, children included', () => {
    expect(buildView([D2], 'day', 'total')!.scale).toBe(234 * E8)
  })

  it('reports the official comparison only for one day of the combined figure', () => {
    expect(buildView([D1, D2], 'day', 'total')!.reconciliation).toEqual({
      estimateTwd: 103.2 * E8,
      officialTwd: 104.17 * E8,
    })
    expect(buildView([D1, D2], 'week', 'total')!.reconciliation).toBeNull()
    expect(buildView([D1, D2], 'day', 'foreign')!.reconciliation).toBeNull()
  })

  it('says whether every day in the window includes TPEx', () => {
    const noOtc = day('2026-10-02', [row('28', 'x', 1)], { coverage: { listed: true, otc: false } })
    expect(buildView([D1, noOtc], 'week', 'total')!.allOtc).toBe(false)
    expect(buildView([D1, D2], 'week', 'total')!.allOtc).toBe(true)
  })

  it('has nothing to show for an empty file', () => {
    expect(buildView([], 'day', 'total')).toBeNull()
  })
})

describe('windowLabel', () => {
  it('writes one day as MM/DD and a window as a range with its length', () => {
    expect(windowLabel(['2026-10-02'])).toBe('10/02')
    expect(windowLabel(['2026-09-26', '2026-09-29', '2026-10-02'])).toBe('09/26–10/02（3 個交易日）')
  })
})

describe('reconciliationGap', () => {
  it('shows the signed percent difference from the official figure', () => {
    expect(reconciliationGap({ estimateTwd: 103.2 * E8, officialTwd: 104.17 * E8 })).toBe('差 -0.9%')
    expect(reconciliationGap({ estimateTwd: 110 * E8, officialTwd: 100 * E8 })).toBe('差 +10.0%')
  })
  it('gives no percentage against a near-zero official figure', () => {
    expect(reconciliationGap({ estimateTwd: 5 * E8, officialTwd: 0 })).toBeNull()
  })
})

describe('signedBillion / toneOf', () => {
  it('signs a real figure', () => {
    expect(signedBillion(2.5 * E8)).toBe('+2.5 億')
    expect(signedBillion(-2.5 * E8)).toBe('-2.5 億')
  })
  it('never prints a negative zero, and treats it as flat', () => {
    expect(signedBillion(-0.02 * E8)).toBe('0.0 億')
    expect(signedBillion(0.02 * E8)).toBe('0.0 億')
    expect(toneOf(-0.02 * E8)).toBe(0)
    expect(toneOf(-0.2 * E8)).toBe(-0.2 * E8)
  })
})

describe('groups', () => {
  it('carries all four investor figures on every row, summed over the window, whichever group is shown', () => {
    const a = day('2026-10-01', [row('28', 'x', 10, { foreignTwd: 7 * E8, trustTwd: 2 * E8, dealerTwd: 1 * E8 })])
    const b = day('2026-10-02', [row('28', 'x', 4, { foreignTwd: 1 * E8, trustTwd: 1 * E8, dealerTwd: 2 * E8 })])
    for (const metric of ['total', 'foreign', 'trust', 'dealer'] as const) {
      const r = buildView([a, b], 'week', metric)!.sectors[0]
      expect(r.groups).toEqual({ foreignTwd: 8 * E8, trustTwd: 3 * E8, dealerTwd: 3 * E8, totalTwd: 14 * E8 })
    }
  })
})

describe('leadClause', () => {
  const g = (foreign: number, trust: number, dealer: number) => ({
    foreignTwd: foreign * E8,
    trustTwd: trust * E8,
    dealerTwd: dealer * E8,
    totalTwd: (foreign + trust + dealer) * E8,
  })
  it('names the group that moved most in the direction of the total', () => {
    expect(leadClause(g(-77.3, 1, 6.4))).toBe('外資賣超 77.3 億')
    expect(leadClause(g(5, 20, -3))).toBe('投信買超 20.0 億')
  })
  it('does not credit a group that went the other way', () => {
    // 外資 sold the most, but the total is a buy led by 自營商.
    expect(leadClause(g(-5, 1, 30))).toBe('自營商買超 30.0 億')
  })
  it('says nothing when the total is flat or the leader rounds to zero', () => {
    expect(leadClause(g(0, 0, 0))).toBeNull()
    expect(leadClause({ foreignTwd: 1e6, trustTwd: 0, dealerTwd: 0, totalTwd: 1e6 })).toBeNull()
  })
})
