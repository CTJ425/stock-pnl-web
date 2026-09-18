// Task 165 Phase 2 step 2b — spec docs/agent/specs/discord-holdings.md §2.3 / §2.4.
import { describe, expect, it } from 'vitest'
import type { Holding } from '../_shared/engine/pnlEngine.ts'
import { estimateUnrealized, estimateUnrealizedShort } from '../_shared/engine/pnlEngine.ts'
import type { Market, Transaction, TxNature, TxType } from '../_shared/engine/models.ts'
import type { HoldingQuote } from './holdingQuotes.ts'
import {
  aggregateHoldings,
  buildHoldingsPayload,
  buildHoldingsTestPayload,
  buildLedgers,
  heldKeys,
  type CurrencySummary,
  type HoldingRowOut,
  type HoldingsSummary,
  type WorkspaceInput,
  type WorkspaceLedger,
} from './holdingsCard.ts'

const YMD = '2026-09-17'
const GEN = '2026-09-17T09:15:00.000Z'
const RED = 0xe5484d
const GREEN = 0x30a46c
const GREY = 0x8b8d98

let seq = 0
function tx(input: {
  ws: string
  date: string
  market: Market
  ticker: string
  name?: string
  type: TxType
  price: number
  qty: number
  fee?: number
  nature?: TxNature
}): Transaction {
  seq++
  return {
    id: `tx-${seq}`,
    workspace_id: input.ws,
    tx_date: input.date,
    market: input.market,
    ticker: input.ticker,
    name: input.name ?? input.ticker,
    tx_type: input.type,
    price: input.price,
    qty: input.qty,
    fee_tax: input.fee ?? 0,
    tx_nature: input.nature,
    created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

function holdingOf(l: WorkspaceLedger, key: string): Holding {
  const h = l.ledger.holdings.find((x) => x.key === key)
  if (!h) throw new Error(`no holding ${key} in ${l.id}`)
  return h
}

// ── fixture: two workspaces ───────────────────────────────────────────────────
// The 2330 buys carry fee 0 so their lots have no inferred rate (inferTxFeeRate → null) and the
// workspace fee rate is what estimateUnrealized uses — otherwise the per-workspace case is vacuous.
const WS_A: WorkspaceInput = {
  id: 'ws-a',
  fee_rate: 0.0004275,
  transactions: [
    tx({ ws: 'ws-a', date: '2025-01-02', market: 'TPE', ticker: '2317', name: '鴻海', type: 'BUY', price: 100, qty: 1000, fee: 43 }),
    tx({ ws: 'ws-a', date: '2025-12-01', market: 'TPE', ticker: '2317', name: '鴻海', type: 'SELL', price: 110, qty: 1000, fee: 377 }),
    tx({ ws: 'ws-a', date: '2025-05-01', market: 'TPE', ticker: '2330', name: '台積電', type: 'BUY', price: 500, qty: 600, fee: 0 }),
    tx({ ws: 'ws-a', date: '2025-05-02', market: 'TPE', ticker: '1101', name: '台泥', type: 'BUY', price: 30, qty: 1000, fee: 20 }),
    tx({ ws: 'ws-a', date: '2025-06-01', market: 'US', ticker: 'AAPL', name: 'Apple', type: 'BUY', price: 150, qty: 2, fee: 1 }),
  ],
}
const WS_B: WorkspaceInput = {
  id: 'ws-b',
  fee_rate: null,
  transactions: [
    tx({ ws: 'ws-b', date: '2025-06-01', market: 'TPE', ticker: '2330', name: 'TSMC', type: 'BUY', price: 550, qty: 600, fee: 0 }),
    tx({ ws: 'ws-b', date: '2026-02-01', market: 'TPE', ticker: '0050', type: 'BUY', price: 150, qty: 1000, fee: 213 }),
    tx({ ws: 'ws-b', date: '2026-04-01', market: 'TPE', ticker: '0050', type: 'SELL', price: 160, qty: 1000, fee: 388 }),
    tx({ ws: 'ws-b', date: '2026-03-01', market: 'TPE', ticker: '2603', name: '長榮', type: 'SELL', price: 100, qty: 1000, fee: 522, nature: 'SHORT' }),
  ],
}

const QUOTES = new Map<string, HoldingQuote | null>([
  ['TPE:2330', { ymd: '2026-09-17', close: 1000, prevClose: 990 }],
  ['TPE:2603', { ymd: '2026-09-17', close: 95, prevClose: 96 }],
  ['US:AAPL', { ymd: '2026-09-16', close: 200, prevClose: 198 }],
  ['TPE:1101', null],
])

describe('buildLedgers', () => {
  it('keeps workspace order and ids, one ledger per workspace', () => {
    const ledgers = buildLedgers([WS_A, WS_B])
    expect(ledgers.map((l) => l.id)).toEqual(['ws-a', 'ws-b'])
    expect(holdingOf(ledgers[0], 'TPE:2330').qty).toBe(600)
    expect(holdingOf(ledgers[1], 'TPE:2330').qty).toBe(600)
  })

  it('never matches a sell in one workspace against a buy in another', () => {
    const a: WorkspaceInput = {
      id: 'a',
      fee_rate: null,
      transactions: [tx({ ws: 'a', date: '2026-01-02', market: 'TPE', ticker: '2454', type: 'BUY', price: 1000, qty: 1000, fee: 1425 })],
    }
    const b: WorkspaceInput = {
      id: 'b',
      fee_rate: null,
      transactions: [tx({ ws: 'b', date: '2026-02-02', market: 'TPE', ticker: '2454', type: 'SELL', price: 1200, qty: 400, fee: 2124 })],
    }
    const [la, lb] = buildLedgers([a, b])
    expect(holdingOf(la, 'TPE:2454').qty).toBe(1000)
    expect(la.ledger.summary.realizedTw).toBe(0)
    expect(lb.ledger.warnings.length).toBeGreaterThan(0)
    expect(lb.ledger.holdings.some((h) => h.key === 'TPE:2454' && h.qty > 0)).toBe(false)
  })

  it.each([
    [0.0004275, 0.0004275],
    [0, 0],
    [null, 0.001425],
    [1, 0.001425],
    [-0.1, 0.001425],
    [Number.NaN, 0.001425],
    [Number.POSITIVE_INFINITY, 0.001425],
  ])('fee_rate %s → feeRate %s', (feeRate, expected) => {
    const [l] = buildLedgers([{ id: 'x', fee_rate: feeRate, transactions: [] }])
    expect(l.feeRate).toBe(expected)
  })
})

describe('heldKeys', () => {
  it('lists every long or short key once, and skips closed positions', () => {
    const keys = heldKeys(buildLedgers([WS_A, WS_B]))
    const flat = keys.map((k) => `${k.market}:${k.ticker}`).sort()
    expect(flat).toEqual(['TPE:1101', 'TPE:2330', 'TPE:2603', 'US:AAPL'])
  })
})

describe('aggregateHoldings', () => {
  const ledgers = buildLedgers([WS_A, WS_B])
  const [la, lb] = ledgers
  const summary = aggregateHoldings(ledgers, QUOTES, YMD)
  const find = (s: CurrencySummary, key: string, dir: 'LONG' | 'SHORT') => {
    const r = s.rows.find((x) => x.key === key && x.direction === dir)
    if (!r) throw new Error(`no row ${key} ${dir}`)
    return r
  }

  it('merges one ticker across workspaces with each workspace fee rate and min fee', () => {
    const r = find(summary.twd, 'TPE:2330', 'LONG')
    const hA = holdingOf(la, 'TPE:2330')
    const hB = holdingOf(lb, 'TPE:2330')
    // 600 + 600 shares: each leg is below 1,000, so each uses the odd-lot minimum fee 1
    const expected = estimateUnrealized(hA, 1000, 0.0004275, 1) + estimateUnrealized(hB, 1000, 0.001425, 1)
    expect(r.shares).toBe(1200)
    expect(r.basis).toBeCloseTo(hA.cost + hB.cost, 6)
    expect(r.unrealized).toBeCloseTo(expected, 6)
    expect(r.mktVal).toBeCloseTo(1_200_000, 6)
    expect(r.returnPct).toBeCloseTo((expected / (hA.cost + hB.cost)) * 100, 6)
    expect(r.dayPnl).toBeCloseTo(12_000, 6)
    expect(r.dayPct).toBeCloseTo((10 / 990) * 100, 6)
    expect(r).toMatchObject({ market: 'TPE', ticker: '2330', close: 1000, prevClose: 990, quoteYmd: '2026-09-17' })
  })

  it('takes the name from the first workspace holding the ticker', () => {
    expect(find(summary.twd, 'TPE:2330', 'LONG').name).toBe('台積電')
  })

  it('does not use a single workspace-wide rate for the merged row', () => {
    const r = find(summary.twd, 'TPE:2330', 'LONG')
    const hA = holdingOf(la, 'TPE:2330')
    const hB = holdingOf(lb, 'TPE:2330')
    const allDefault = estimateUnrealized(hA, 1000, 0.001425, 1) + estimateUnrealized(hB, 1000, 0.001425, 1)
    const allDiscount = estimateUnrealized(hA, 1000, 0.0004275, 1) + estimateUnrealized(hB, 1000, 0.0004275, 1)
    expect(allDefault).not.toBeCloseTo(allDiscount, 0)
    expect(r.unrealized).not.toBeCloseTo(allDefault, 0)
    expect(r.unrealized).not.toBeCloseTo(allDiscount, 0)
  })

  it('uses the whole-lot minimum fee when one workspace leg has 1,000 shares or more', () => {
    const w: WorkspaceInput = {
      id: 'w',
      fee_rate: 0.0004275,
      transactions: [tx({ ws: 'w', date: '2026-01-05', market: 'TPE', ticker: '2412', type: 'BUY', price: 10, qty: 1000, fee: 20 })],
    }
    const ls = buildLedgers([w])
    const s = aggregateHoldings(ls, new Map([['TPE:2412', { ymd: YMD, close: 10, prevClose: 10 }]]), YMD)
    const h = holdingOf(ls[0], 'TPE:2412')
    expect(estimateUnrealized(h, 10, 0.0004275, 20)).not.toBe(estimateUnrealized(h, 10, 0.0004275, 1))
    expect(s.twd.rows[0].unrealized).toBe(estimateUnrealized(h, 10, 0.0004275, 20))
  })

  it('handles a short leg: short estimator, proceeds as basis, inverted day P&L', () => {
    const r = find(summary.twd, 'TPE:2603', 'SHORT')
    const h = holdingOf(lb, 'TPE:2603')
    const expected = estimateUnrealizedShort(h, 95, 0.001425, 20)
    expect(r.shares).toBe(1000)
    expect(r.basis).toBeCloseTo(h.shortProceeds, 6)
    expect(r.unrealized).toBeCloseTo(expected, 6)
    expect(r.returnPct).toBeCloseTo((expected / h.shortProceeds) * 100, 6)
    expect(r.mktVal).toBeCloseTo(95_000, 6)
    // price fell 96 → 95: the short gains
    expect(r.dayPnl).toBeCloseTo(1000, 6)
    expect(r.dayPct).toBeCloseTo((-1 / 96) * 100, 6)
  })

  it('uses the USD holding with no minimum fee', () => {
    const r = find(summary.usd, 'US:AAPL', 'LONG')
    const h = holdingOf(la, 'US:AAPL')
    expect(r.unrealized).toBeCloseTo(estimateUnrealized(h, 200, 0.0004275, undefined), 6)
    expect(r.shares).toBe(2)
    expect(r.dayPnl).toBeCloseTo(4, 6)
  })

  it('lists a row without a quote but keeps it out of every total', () => {
    const r = find(summary.twd, 'TPE:1101', 'LONG')
    expect(r).toMatchObject({ close: null, prevClose: null, quoteYmd: null, mktVal: null, unrealized: null, returnPct: null, dayPnl: null, dayPct: null })
    expect(r.shares).toBe(1000)
    expect(summary.twd.missingCount).toBe(1)
    expect(summary.usd.missingCount).toBe(0)
  })

  it('computes TWD totals from quoted rows, market value and cost from LONG rows only', () => {
    const r2330 = find(summary.twd, 'TPE:2330', 'LONG')
    const r2603 = find(summary.twd, 'TPE:2603', 'SHORT')
    const t = summary.twd
    expect(t.currency).toBe('TWD')
    expect(t.marketValue).toBeCloseTo(1_200_000, 6)
    expect(t.cost).toBeCloseTo(r2330.basis, 6)
    expect(t.unrealized).toBeCloseTo((r2330.unrealized ?? 0) + (r2603.unrealized ?? 0), 6)
    expect(t.unrealizedPct).toBeCloseTo((t.unrealized! / t.cost) * 100, 6)
    expect(t.shortMarketValue).toBeCloseTo(95_000, 6)
    expect(t.dayPnl).toBeCloseTo(13_000, 6)
    expect(t.dayPct).toBeCloseTo((13_000 / (990 * 1200)) * 100, 6)
    expect(t.newestQuoteYmd).toBe('2026-09-17')
  })

  it('sums only this year realized P&L, across workspaces', () => {
    const expected = (la.ledger.yearly[2026]?.realizedTw ?? 0) + (lb.ledger.yearly[2026]?.realizedTw ?? 0)
    const allTime = la.ledger.summary.realizedTw + lb.ledger.summary.realizedTw
    expect(expected).not.toBe(0)
    expect(allTime).not.toBeCloseTo(expected, 0)
    expect(summary.twd.realizedYtd).toBeCloseTo(expected, 6)
    expect(summary.usd.realizedYtd).toBe(0)
  })

  it('keeps currencies apart without conversion', () => {
    expect(summary.ymd).toBe(YMD)
    expect(summary.usd.currency).toBe('USD')
    expect(summary.usd.rows.map((r) => r.key)).toEqual(['US:AAPL'])
    expect(summary.usd.marketValue).toBeCloseTo(400, 6)
    expect(summary.usd.shortMarketValue).toBeNull()
    expect(summary.usd.newestQuoteYmd).toBe('2026-09-16')
    expect(summary.twd.rows.every((r) => r.market === 'TPE')).toBe(true)
  })

  it('orders rows: quoted LONG by market value, unquoted LONG, then SHORT', () => {
    expect(summary.twd.rows.map((r) => `${r.key}:${r.direction}`)).toEqual([
      'TPE:2330:LONG',
      'TPE:1101:LONG',
      'TPE:2603:SHORT',
    ])
  })

  it('breaks market value ties by key', () => {
    const w: WorkspaceInput = {
      id: 'w',
      fee_rate: null,
      transactions: [
        tx({ ws: 'w', date: '2026-01-05', market: 'TPE', ticker: '2882', type: 'BUY', price: 50, qty: 100, fee: 7 }),
        tx({ ws: 'w', date: '2026-01-05', market: 'TPE', ticker: '2881', type: 'BUY', price: 50, qty: 100, fee: 7 }),
      ],
    }
    const q = { ymd: YMD, close: 60, prevClose: 59 }
    const s = aggregateHoldings(buildLedgers([w]), new Map([['TPE:2882', q], ['TPE:2881', q]]), YMD)
    expect(s.twd.rows.map((r) => r.ticker)).toEqual(['2881', '2882'])
  })

  it('reports market value 0 with no LONG rows, and null when no LONG row is quoted', () => {
    const shortOnly = aggregateHoldings([lb].map((l) => ({ ...l, ledger: { ...l.ledger, holdings: l.ledger.holdings.filter((h) => h.key === 'TPE:2603') } })), QUOTES, YMD)
    expect(shortOnly.twd.marketValue).toBe(0)
    expect(shortOnly.twd.cost).toBe(0)
    expect(shortOnly.twd.unrealizedPct).toBeNull()

    const unquoted = aggregateHoldings(ledgers, new Map(), YMD)
    expect(unquoted.twd.marketValue).toBeNull()
    expect(unquoted.twd.unrealized).toBeNull()
    expect(unquoted.twd.shortMarketValue).toBeNull()
    expect(unquoted.twd.dayPnl).toBeNull()
    expect(unquoted.twd.dayPct).toBeNull()
    expect(unquoted.twd.newestQuoteYmd).toBeNull()
    expect(unquoted.twd.missingCount).toBe(3)
  })

  it('leaves the day P&L of a row out when prevClose is unknown', () => {
    const q = new Map(QUOTES)
    q.set('TPE:2603', { ymd: YMD, close: 95, prevClose: null })
    const s = aggregateHoldings(ledgers, q, YMD)
    const r = s.twd.rows.find((x) => x.key === 'TPE:2603')!
    expect(r.dayPnl).toBeNull()
    expect(r.dayPct).toBeNull()
    expect(r.unrealized).not.toBeNull()
    expect(s.twd.dayPnl).toBeCloseTo(12_000, 6)
  })

  it('gives an empty summary for no workspaces', () => {
    const s = aggregateHoldings([], new Map(), YMD)
    expect(s.twd.rows).toEqual([])
    expect(s.usd.rows).toEqual([])
    expect(buildHoldingsPayload(s, { generatedAt: GEN, preview: false })).toBeNull()
  })
})

// ── payload layout (hand-built summaries, independent of the engine) ─────────
function row(p: Partial<HoldingRowOut> & Pick<HoldingRowOut, 'ticker' | 'name'>): HoldingRowOut {
  const market = p.market ?? 'TPE'
  return {
    key: `${market}:${p.ticker}`,
    market,
    direction: 'LONG',
    shares: 1000,
    basis: 0,
    close: null,
    prevClose: null,
    quoteYmd: null,
    mktVal: null,
    unrealized: null,
    returnPct: null,
    dayPnl: null,
    dayPct: null,
    avgCost: 0,
    breakEven: null,
    realized: 0,
    ...p,
  }
}

function cur(currency: 'TWD' | 'USD', p: Partial<CurrencySummary> = {}): CurrencySummary {
  return {
    currency,
    rows: [],
    marketValue: 0,
    cost: 0,
    unrealized: null,
    unrealizedPct: null,
    shortMarketValue: null,
    dayPnl: null,
    dayPct: null,
    realizedYtd: 0,
    realizedToday: 0,
    missingCount: 0,
    newestQuoteYmd: null,
    ...p,
  }
}

const TWD_ROWS: HoldingRowOut[] = [
  row({ ticker: '2330', name: '台積電', shares: 1200, basis: 624_510, close: 1085.5, prevClose: 1072.3, quoteYmd: YMD, mktVal: 1_302_600, unrealized: 676_123.4, returnPct: 108.2645, dayPnl: 15_840, dayPct: 1.2313, avgCost: 520.43, breakEven: 522.7, realized: 12_345 }),
  row({ ticker: '0050', name: '元大台灣50', shares: 37, basis: 5_564, close: 150.35, prevClose: 151.1, quoteYmd: YMD, mktVal: 5_562.95, unrealized: -18.6, returnPct: -0.3343, dayPnl: -27.75, dayPct: -0.4963, avgCost: 150.38, breakEven: 151.2 }),
  row({ ticker: '6488', name: '環球晶', shares: 1000, basis: 480_000, avgCost: 480, breakEven: 482.1 }),
  row({ ticker: '2603', name: '長榮', direction: 'SHORT', shares: 1000, basis: 99_478, close: 95, prevClose: 95, quoteYmd: YMD, mktVal: 95_000, unrealized: 4_343, returnPct: 4.3657, dayPnl: 0, dayPct: 0, avgCost: 99.478, realized: -1_500 }),
]

const TWD_FULL = cur('TWD', {
  rows: TWD_ROWS,
  marketValue: 1_308_162.95,
  cost: 630_074,
  unrealized: 680_447.8,
  unrealizedPct: 107.9948,
  shortMarketValue: 95_000,
  dayPnl: 15_812.25,
  dayPct: 1.2345,
  realizedYtd: 78_415.2,
  realizedToday: 3_210,
  missingCount: 1,
  newestQuoteYmd: YMD,
})

const USD_FULL = cur('USD', {
  rows: [
    row({ market: 'US', ticker: 'AAPL', name: 'Apple', shares: 2.25, basis: 300, close: 229.87, prevClose: 227.87, quoteYmd: '2026-09-16', mktVal: 517.2075, unrealized: 217.21, returnPct: 72.4, dayPnl: 4.5, dayPct: 0.8777, avgCost: 133.33, breakEven: 133.33 }),
  ],
  marketValue: 517.2075,
  cost: 300,
  unrealized: 217.21,
  unrealizedPct: 72.4,
  dayPnl: 4.5,
  dayPct: 0.8777,
  realizedYtd: 0,
  newestQuoteYmd: '2026-09-16',
})

const fence = (lines: string[]) => '```\n' + lines.join('\n') + '\n```'

const TWD_KPI = [
  '市值         1,308,163',
  '成本           630,074',
  '未實現        +680,448',
  '  報酬率      +107.99%',
  '今日           +15,812',
  '  漲跌幅        +1.23%',
  '今日已實現      +3,210',
  '今年已實現     +78,415',
  '空單市值        95,000',
]
const TWD_TABLE = [
  '2330 台積電      ▲1.23%',
  '  1,200股 @ 1,085.5',
  '  市值       1,302,600',
  '  成本         624,510',
  '  未實現      +676,123',
  '  報酬率      +108.26%',
  '  均價          520.43',
  '  保本           522.7',
  '  已實現       +12,345',
  '0050 元大台灣50  ▼0.50%',
  '  37股 @ 150.35',
  '  市值           5,563',
  '  成本           5,564',
  '  未實現           -19',
  '  報酬率        -0.33%',
  '  均價          150.38',
  '  保本           151.2',
  '6488 環球晶           --',
  '  1,000股 @ --',
  '  市值              --',
  '  成本         480,000',
  '  未實現            --',
  '  報酬率            --',
  '  均價             480',
  '  保本           482.1',
  '空 2603 長榮     ─0.00%',
  '  1,000股 @ 95',
  '  市值          95,000',
  '  價金          99,478',
  '  未實現        +4,343',
  '  報酬率        +4.37%',
  '  均價           99.48',
  '  已實現        -1,500',
]
const USD_KPI = [
  '市值            517.21',
  '成本            300.00',
  '未實現         +217.21',
  '  報酬率       +72.40%',
  '今日             +4.50',
  '  漲跌幅        +0.88%',
  '今日已實現        0.00',
  '今年已實現        0.00',
]
const USD_TABLE = [
  'AAPL Apple       ▲0.88%',
  '  2.25股 @ 229.87',
  '  市值          517.21',
  '  成本          300.00',
  '  未實現       +217.21',
  '  報酬率       +72.40%',
  '  均價          133.33',
  '  保本          133.33',
]

describe('buildHoldingsPayload', () => {
  const both: HoldingsSummary = { ymd: YMD, twd: TWD_FULL, usd: USD_FULL }

  it('builds the full two-card message exactly', () => {
    expect(buildHoldingsPayload(both, { generatedAt: GEN, preview: false })).toEqual({
      username: '持股日報',
      content: '📒 持股日報 09/17（四）',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: '台股持股・09/17 收盤',
          description: fence(TWD_KPI) + '\n' + fence(TWD_TABLE),
          color: RED,
          footer: { text: '資料來源：Yahoo Finance｜以各工作區手續費率估算賣出成本｜1 檔無報價，未計入合計' },
          timestamp: GEN,
        },
        {
          title: '美股持股・美東 09/16 收盤',
          description: fence(USD_KPI) + '\n' + fence(USD_TABLE),
          color: RED,
          footer: { text: '資料來源：Yahoo Finance｜以各工作區手續費率估算賣出成本' },
          timestamp: GEN,
        },
      ],
    })
  })

  it('keeps every generated line within 24 display columns for this fixture (spec Revision 6)', () => {
    const p = buildHoldingsPayload(both, { generatedAt: GEN, preview: false })!
    const lines = p.embeds.flatMap((e) => (e.description ?? '').split('\n')).filter((l) => l !== '```')
    const width = (s: string) =>
      [...s].reduce((n, ch) => {
        const cp = ch.codePointAt(0)!
        if (cp === 0xfe0f || cp === 0x200d) return n
        return n + (/[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿＀-｠]/.test(ch) ? 2 : 1)
      }, 0)
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(24)
  })

  it('prefixes a preview', () => {
    expect(buildHoldingsPayload(both, { generatedAt: GEN, preview: true })?.content).toBe('【預覽】📒 持股日報 09/17（四）')
  })

  it('sends only the currency that has rows', () => {
    const p = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD'), usd: USD_FULL }, { generatedAt: GEN, preview: false })!
    expect(p.embeds.map((e) => e.title)).toEqual(['美股持股・美東 09/16 收盤'])
  })

  it('returns null when neither currency has rows', () => {
    expect(buildHoldingsPayload({ ymd: YMD, twd: cur('TWD'), usd: cur('USD') }, { generatedAt: GEN, preview: false })).toBeNull()
  })

  it('warns in the title when the newest TWD quote is not today, and marks older rows', () => {
    const rows = [
      row({ ticker: '2330', name: '台積電', close: 1085.5, prevClose: 1072.3, quoteYmd: YMD, mktVal: 1, unrealized: 1, returnPct: 1, dayPct: 1.2313 }),
      row({ ticker: '1101', name: '台泥', close: 30, prevClose: 30, quoteYmd: '2026-09-16', mktVal: 1, unrealized: 1, returnPct: 1, dayPct: 0 }),
    ]
    const today = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows, unrealized: 2, newestQuoteYmd: YMD }), usd: cur('USD') }, { generatedAt: GEN, preview: false })!
    const table = today.embeds[0].description!.split('\n')
    expect(table).toContain('2330 台積電      ▲1.23%')
    expect(table).toContain('⚠️1101 台泥      ─0.00%')

    const stale = buildHoldingsPayload(
      { ymd: YMD, twd: cur('TWD', { rows: rows.slice(1), unrealized: 1, newestQuoteYmd: '2026-09-16' }), usd: cur('USD') },
      { generatedAt: GEN, preview: false },
    )!
    expect(stale.embeds[0].title).toBe('台股持股・⚠️ 09/16 收盤・非今日')
    expect(stale.embeds[0].description).toContain('\n1101 台泥')
  })

  it('titles a currency with no quote at all', () => {
    const p = buildHoldingsPayload(
      { ymd: YMD, twd: cur('TWD', { rows: [row({ ticker: '6488', name: '環球晶' })], marketValue: null, missingCount: 1 }), usd: cur('USD', { rows: [row({ market: 'US', ticker: 'TSLA', name: 'Tesla' })], marketValue: null, missingCount: 1 }) },
      { generatedAt: GEN, preview: false },
    )!
    expect(p.embeds.map((e) => e.title)).toEqual(['台股持股・無報價', '美股持股・無報價'])
    expect(p.embeds.map((e) => e.color)).toEqual([GREY, GREY])
    expect(p.embeds[0].description).toContain('市值                --')
  })

  it.each([
    ['TWD', 680_447.8, RED],
    ['TWD', -5, GREEN],
    ['TWD', 0.4, GREY],
    ['TWD', -0.4, GREY],
    ['USD', -0.004, GREY],
    ['USD', 0.006, RED],
    ['USD', null, GREY],
  ] as const)('%s unrealized %s → colour %s', (currency, unrealized, color) => {
    const r = row({ market: currency === 'USD' ? 'US' : 'TPE', ticker: 'X', name: 'x' })
    const s = cur(currency, { rows: [r], unrealized })
    const p = buildHoldingsPayload(
      currency === 'TWD' ? { ymd: YMD, twd: s, usd: cur('USD') } : { ymd: YMD, twd: cur('TWD'), usd: s },
      { generatedAt: GEN, preview: false },
    )!
    expect(p.embeds[0].color).toBe(color)
  })

  it('formats TWD prices with up to two decimals, trailing zeros trimmed', () => {
    const rows = [
      row({ ticker: '1111', name: 'a', shares: 1, close: 600, quoteYmd: YMD, mktVal: 600 }),
      row({ ticker: '2222', name: 'b', shares: 1, close: 12.35, quoteYmd: YMD, mktVal: 12.35 }),
      row({ ticker: '3333', name: 'c', shares: 1, close: 1085.5, quoteYmd: YMD, mktVal: 1085.5 }),
    ]
    const d = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows, newestQuoteYmd: YMD }), usd: cur('USD') }, { generatedAt: GEN, preview: false })!.embeds[0].description!
    expect(d).toContain('  1股 @ 600')
    expect(d).toContain('  1股 @ 12.35')
    expect(d).toContain('  1股 @ 1,085.5')
  })

  it('shows 空單市值 as -- when shorts exist but none is quoted, and hides it without shorts', () => {
    const short = row({ ticker: '2603', name: '長榮', direction: 'SHORT' })
    const withShort = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows: [short], missingCount: 1 }), usd: cur('USD') }, { generatedAt: GEN, preview: false })!
    expect(withShort.embeds[0].description).toContain('空單市值            --')
    const noShort = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows: [row({ ticker: '6488', name: '環球晶' })], missingCount: 1 }), usd: cur('USD') }, { generatedAt: GEN, preview: false })!
    expect(noShort.embeds[0].description).not.toContain('空單市值')
  })

  it('cuts a long name with an ellipsis', () => {
    const r = row({ ticker: '1234', name: '非常非常非常非常長的公司名稱股份有限公司', dayPct: 0.1 })
    const d = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows: [r], missingCount: 1 }), usd: cur('USD') }, { generatedAt: GEN, preview: false })!.embeds[0].description!
    expect(d.split('\n')).toContain('1234 非常非常…   ▲0.10%')
  })

  it('never cuts a number that is wider than its column', () => {
    const r = row({ ticker: '2330', name: '台積電', shares: 1_234_000, close: 1085.5, quoteYmd: YMD, mktVal: 1, unrealized: -123_456_789, returnPct: -12.5 })
    const d = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows: [r], unrealized: -123_456_789, newestQuoteYmd: YMD }), usd: cur('USD') }, { generatedAt: GEN, preview: false })!.embeds[0].description!
    expect(d).toContain('1,234,000股 @ 1,085.5')
    expect(d).toContain('-123,456,789')
  })

  it('drops rows from the end to stay within budget and says how many', () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      row({ ticker: String(1000 + i), name: '測試股票', close: 100, prevClose: 99, quoteYmd: YMD, mktVal: 100_000 - i, unrealized: 1234, returnPct: 1.5, dayPct: 1.01 }),
    )
    const p = buildHoldingsPayload({ ymd: YMD, twd: cur('TWD', { rows, unrealized: 148_080, newestQuoteYmd: YMD }), usd: USD_FULL }, { generatedAt: GEN, preview: false })!
    const d = p.embeds[0].description!
    expect(d.length).toBeLessThanOrEqual(2800)
    const shown = d.split('\n').filter((l) => /^\d{4} 測試股票/.test(l)).length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(120)
    expect(d).toContain(`\n…另 ${120 - shown} 檔，完整明細請見網站\n\`\`\``)
    // the kept rows are the first ones, in order
    expect(d).toContain('1000 測試股票')
    expect(d).not.toContain('1119 測試股票')
    const total =
      (p.content ?? '').length +
      p.embeds.reduce((n, e) => n + e.title.length + (e.description ?? '').length + (e.footer?.text.length ?? 0), 0)
    expect(total).toBeLessThan(6000)
  })

  it('does not truncate when everything fits', () => {
    const p = buildHoldingsPayload(both, { generatedAt: GEN, preview: false })!
    expect(p.embeds[0].description).not.toContain('…另')
  })
})

describe('buildHoldingsTestPayload', () => {
  it('is its own connection test, not the site-wide summary text', () => {
    expect(buildHoldingsTestPayload(GEN)).toEqual({
      username: '持股日報',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: '🔔 Discord 連線測試',
          fields: [{ name: '狀態', value: '連線正常，持股日報會發送到這個頻道。', inline: false }],
          footer: { text: '資料來源：Yahoo Finance' },
          timestamp: GEN,
        },
      ],
    })
  })
})

// ── revision 3: more P&L on the card (spec discord-holdings.md Revision 3) ───
const WS_C: WorkspaceInput = {
  id: 'ws-c',
  fee_rate: 0.001425,
  transactions: [
    tx({ ws: 'ws-c', date: '2025-05-01', market: 'TPE', ticker: '2454', name: '聯發科', type: 'BUY', price: 900, qty: 2000, fee: 0 }),
    tx({ ws: 'ws-c', date: '2026-04-01', market: 'TPE', ticker: '2454', name: '聯發科', type: 'SELL', price: 950, qty: 500, fee: 2000 }),
    tx({ ws: 'ws-c', date: YMD, market: 'TPE', ticker: '2454', name: '聯發科', type: 'SELL', price: 1000, qty: 500, fee: 2100 }),
    tx({ ws: 'ws-c', date: '2025-06-01', market: 'US', ticker: 'AAPL', name: 'Apple', type: 'BUY', price: 100, qty: 4, fee: 1 }),
  ],
}

const QUOTES_C = new Map<string, HoldingQuote | null>([
  ['TPE:2454', { ymd: YMD, close: 1010, prevClose: 1000 }],
  ['US:AAPL', { ymd: YMD, close: 200, prevClose: 198 }],
])

function rowOfSummary(s: CurrencySummary, key: string, dir: 'LONG' | 'SHORT' = 'LONG'): HoldingRowOut {
  const r = s.rows.find((x) => x.key === key && x.direction === dir)
  if (!r) throw new Error(`no row ${key} ${dir}`)
  return r
}

describe('aggregateHoldings — average cost, break-even and realized', () => {
  const ledgers = buildLedgers([WS_C])
  const summary = aggregateHoldings(ledgers, QUOTES_C, YMD)

  it('reports the merged average cost per share', () => {
    const twd = rowOfSummary(summary.twd, 'TPE:2454')
    expect(twd.avgCost).toBeCloseTo(twd.basis / twd.shares, 9)
    expect(twd.avgCost).toBeCloseTo(holdingOf(ledgers[0], 'TPE:2454').avgCost, 6)
    const usd = rowOfSummary(summary.usd, 'US:AAPL')
    expect(usd.avgCost).toBeCloseTo(usd.basis / usd.shares, 9)
  })

  it('averages the cost of one ticker held in two workspaces', () => {
    const both = aggregateHoldings(buildLedgers([WS_A, WS_B]), QUOTES, YMD)
    const r = rowOfSummary(both.twd, 'TPE:2330')
    expect(r.avgCost).toBeCloseTo(r.basis / 1200, 9)
  })

  it('reports the cumulative realized P&L of that position, across all years', () => {
    const h = holdingOf(ledgers[0], 'TPE:2454')
    expect(h.realized).not.toBe(0)
    expect(rowOfSummary(summary.twd, 'TPE:2454').realized).toBeCloseTo(h.realized, 6)
  })

  it('reports no realized P&L for a position that was never sold', () => {
    expect(rowOfSummary(summary.usd, 'US:AAPL').realized).toBe(0)
  })

  it("sums today's realized P&L per currency, counting only sells dated as the card", () => {
    const sells = ledgers[0].ledger.yearly[2026].tickers['TPE:2454'].sells
    const today = sells.filter((x) => x.date === YMD)
    const earlier = sells.filter((x) => x.date !== YMD)
    expect(today).toHaveLength(1)
    expect(earlier).toHaveLength(1)
    expect(summary.twd.realizedToday).toBeCloseTo(today[0].realized, 6)
    expect(summary.twd.realizedToday).not.toBeCloseTo(summary.twd.realizedYtd, 6)
    expect(summary.twd.realizedYtd).toBeCloseTo(today[0].realized + earlier[0].realized, 6)
    expect(summary.usd.realizedToday).toBe(0)
  })

  it('reports no realized P&L today when the card is built for another day', () => {
    const other = aggregateHoldings(ledgers, QUOTES_C, '2026-09-16')
    expect(other.twd.realizedToday).toBe(0)
  })

  it('breaks even above the average cost in TWD, and exactly there in USD', () => {
    const twd = rowOfSummary(summary.twd, 'TPE:2454')
    expect(twd.breakEven).not.toBeNull()
    expect(twd.breakEven as number).toBeGreaterThan(twd.avgCost)
    const usd = rowOfSummary(summary.usd, 'US:AAPL')
    expect(usd.breakEven as number).toBeCloseTo(usd.avgCost, 2)
  })

  it('is the lowest cent at which this position stops losing money', () => {
    const be = rowOfSummary(summary.twd, 'TPE:2454').breakEven as number
    const at = (price: number) =>
      rowOfSummary(aggregateHoldings(ledgers, new Map([['TPE:2454', { ymd: YMD, close: price, prevClose: price }]]), YMD).twd, 'TPE:2454')
        .unrealized as number
    expect(be).toBeCloseTo(Math.round(be * 100) / 100, 9)
    expect(at(be)).toBeGreaterThanOrEqual(0)
    expect(at(Math.round((be - 0.01) * 100) / 100)).toBeLessThan(0)
  })

  it('gives a short leg no break-even price', () => {
    const short = aggregateHoldings(buildLedgers([WS_B]), QUOTES, YMD)
    const r = rowOfSummary(short.twd, 'TPE:2603', 'SHORT')
    expect(r.breakEven).toBeNull()
    expect(r.avgCost).toBeCloseTo(r.basis / r.shares, 9)
  })
})
