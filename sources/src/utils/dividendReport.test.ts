/**
 * The report's job is to agree with the rest of the app: its `net` must equal what the engine
 * already calls `dividends`, its percentages must add up, and the 其他 bucket must never quietly
 * eat a stock that belongs in the top four.
 */
import { describe, it, expect } from 'vitest'
import type { Transaction, TxType } from '../types/models'
import { computeLedger } from './pnlEngine'
import {
  OTHER_COLOR,
  OTHER_KEY,
  TOP_N,
  buildDividendReport,
  chartScaleMax,
  dividendYears,
  largestRemainderPct,
} from './dividendReport'

let seq = 0
function tx(over: Partial<Transaction> & { tx_date: string; ticker: string }): Transaction {
  seq += 1
  return {
    id: `tx${seq}`,
    workspace_id: 'w1',
    market: 'TPE',
    name: over.ticker,
    tx_type: 'DIVIDEND' as TxType,
    price: 1,
    qty: 1000,
    fee_tax: 10,
    created_at: `2026-01-01T00:00:0${seq % 10}Z`,
    ...over,
  } as Transaction
}

/** The user's own 2026 dividends plus four more, so the top-4 fold has something to fold. */
function seed(): Transaction[] {
  seq = 0
  return [
    tx({ tx_date: '2026-02-12', ticker: '0050', name: '台灣50', price: 0.5, qty: 2000, fee_tax: 10 }),
    tx({ tx_date: '2026-03-12', ticker: '2330', name: '台積電', price: 4.5, qty: 1000, fee_tax: 10 }),
    tx({ tx_date: '2026-05-14', ticker: '0050', name: '台灣50', price: 0.55, qty: 2000, fee_tax: 10 }),
    tx({ tx_date: '2026-06-11', ticker: '2330', name: '台積電', price: 5, qty: 1000, fee_tax: 10 }),
    tx({ tx_date: '2026-07-15', ticker: '2884', name: '玉山金', price: 1.2, qty: 5000, fee_tax: 10 }),
    tx({ tx_date: '2026-07-28', ticker: '2882', name: '國泰金', price: 2, qty: 1000, fee_tax: 10 }),
    tx({ tx_date: '2026-08-05', ticker: '2609', name: '陽明', price: 2, qty: 14000, fee_tax: 601 }),
    tx({ tx_date: '2026-08-10', ticker: '0050', name: '台灣50', price: 0.6, qty: 2000, fee_tax: 10 }),
    tx({ tx_date: '2026-09-10', ticker: '2330', name: '台積電', price: 5, qty: 1000, fee_tax: 10 }),
    tx({ tx_date: '2026-09-18', ticker: '1101', name: '台泥', price: 1, qty: 2000, fee_tax: 10 }),
  ]
}

describe('buildDividendReport totals', () => {
  it('sums gross, fee and net over the year', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    expect(r.gross).toBe(55_800)
    expect(r.fee).toBe(691)
    expect(r.net).toBe(55_109)
    expect(r.count).toBe(10)
    expect(r.tickerCount).toBe(6)
  })

  it('agrees with the engine: net equals the ledger year total for the same market', () => {
    const txs = seed()
    const ledger = computeLedger(txs)
    const engineNet = Object.values(ledger.yearly[2026].tickers)
      .filter((t) => t.market === 'TPE')
      .reduce((sum, t) => sum + t.dividends, 0)
    expect(buildDividendReport(txs, 2026, 'TWD').net).toBe(engineNet)
  })

  it('keeps markets apart and never converts', () => {
    const txs = [
      ...seed(),
      tx({ tx_date: '2026-04-01', ticker: 'AAPL', name: 'Apple', market: 'US', price: 0.25, qty: 100, fee_tax: 8 }),
    ]
    expect(buildDividendReport(txs, 2026, 'TWD').gross).toBe(55_800)
    const us = buildDividendReport(txs, 2026, 'USD')
    expect(us.gross).toBe(25)
    expect(us.count).toBe(1)
  })

  it('ignores other transaction types, other years and malformed rows', () => {
    const txs = [
      ...seed(),
      tx({ tx_date: '2026-04-01', ticker: '2330', tx_type: 'BUY', price: 1000, qty: 1000, fee_tax: 20 }),
      tx({ tx_date: '2026-04-02', ticker: '2330', tx_type: 'STOCK_DIVIDEND', price: 0, qty: 200, fee_tax: 0 }),
      tx({ tx_date: '2025-08-05', ticker: '2609', price: 1, qty: 14000, fee_tax: 200 }),
      tx({ tx_date: '2026-04-03', ticker: '2330', price: 5, qty: 0, fee_tax: 0 }),
    ]
    const r = buildDividendReport(txs, 2026, 'TWD')
    expect(r.gross).toBe(55_800)
    expect(r.count).toBe(10)
  })

  it('returns an empty, well-formed report for a year with no dividends', () => {
    const r = buildDividendReport(seed(), 2024, 'TWD')
    expect(r).toMatchObject({ gross: 0, fee: 0, net: 0, count: 0, tickerCount: 0, peakMonth: 0 })
    expect(r.shares).toEqual([])
    expect(r.months).toHaveLength(12)
    expect(r.months.every((m) => m.gross === 0 && m.segments.length === 0)).toBe(true)
  })
})

describe('rows', () => {
  it('carries the figures a reader can verify a row with, newest first', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    expect(r.rows[0].date).toBe('2026-09-18')
    const yangming = r.rows.find((row) => row.ticker === '2609')!
    expect(yangming).toMatchObject({ qty: 14_000, perShare: 2, gross: 28_000, fee: 601, net: 27_399 })
  })

  it('orders two payments on the same day deterministically', () => {
    const txs = [
      tx({ tx_date: '2026-08-05', ticker: 'BBB', price: 1, qty: 1000 }),
      tx({ tx_date: '2026-08-05', ticker: 'AAA', price: 1, qty: 1000 }),
    ]
    const once = buildDividendReport(txs, 2026, 'TWD').rows.map((r) => r.txId)
    const twice = buildDividendReport([...txs].reverse(), 2026, 'TWD').rows.map((r) => r.txId)
    expect(once).toEqual(twice)
  })
})

describe('shares and the 其他 bucket', () => {
  it('names the top 4 by gross and folds the rest', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    expect(r.shares.map((s) => s.ticker)).toEqual(['2609', '2330', '2884', '0050', ''])
    expect(r.shares.slice(0, TOP_N).map((s) => s.colorIndex)).toEqual([0, 1, 2, 3])
    const other = r.shares[r.shares.length - 1]
    expect(other).toMatchObject({ key: OTHER_KEY, gross: 4_000, colorIndex: OTHER_COLOR, memberCount: 2 })
    expect(other.name).toBe('其他 2 檔')
  })

  it('keeps 其他 last even when it outweighs the smallest named stock', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    const smallestNamed = r.shares[TOP_N - 1]
    const other = r.shares[TOP_N]
    expect(other.gross).toBeGreaterThan(smallestNamed.gross)
    expect(r.shares.indexOf(other)).toBe(r.shares.length - 1)
  })

  it('adds no bucket when four or fewer stocks paid', () => {
    const txs = seed().filter((t) => !['2882', '1101'].includes(t.ticker))
    const r = buildDividendReport(txs, 2026, 'TWD')
    expect(r.shares).toHaveLength(4)
    expect(r.shares.some((s) => s.key === OTHER_KEY)).toBe(false)
  })

  it('percentages sum to exactly 100.0', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    expect(r.shares.map((s) => s.pct)).toEqual([50.2, 26, 10.7, 5.9, 7.2])
    expect(r.shares.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100, 10)
  })
})

describe('largestRemainderPct', () => {
  it('fixes the case where independent rounding overshoots', () => {
    // 54.054 / 27.992 / 11.583 / 6.371 each round up to 100.1 on their own.
    expect(largestRemainderPct([28_000, 14_500, 6_000, 3_300])).toEqual([54, 28, 11.6, 6.4])
  })

  it('always sums to 100 for any positive input', () => {
    for (const values of [[1, 1, 1], [1, 2, 3, 4, 5, 6, 7], [999_999, 1], [5]]) {
      const sum = largestRemainderPct(values).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(100, 10)
    }
  })

  it('returns zeros rather than NaN when there is nothing to split', () => {
    expect(largestRemainderPct([])).toEqual([])
    expect(largestRemainderPct([0, 0])).toEqual([0, 0])
  })
})

describe('months', () => {
  it('buckets by the payment date and stacks largest first with 其他 at the bottom', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    expect(r.months.map((m) => m.gross)).toEqual([0, 1_000, 4_500, 0, 1_100, 5_000, 8_000, 29_200, 7_000, 0, 0, 0])
    expect(r.peakMonth).toBe(29_200)

    const july = r.months[6]
    expect(july.segments.map((s) => s.gross)).toEqual([6_000, 2_000])
    expect(july.segments[1].key).toBe(OTHER_KEY)
    expect(july.segments[1].label).toBe('其他（2882 國泰金）')

    const august = r.months[7]
    expect(august.segments.map((s) => [s.label, s.gross])).toEqual([
      ['2609 陽明', 28_000],
      ['0050 台灣50', 1_200],
    ])
  })

  it('stops naming a single stock once the bucket holds more than one that month', () => {
    const txs = [
      ...seed(),
      tx({ tx_date: '2026-07-20', ticker: '1101', name: '台泥', price: 1, qty: 1000, fee_tax: 10 }),
    ]
    const july = buildDividendReport(txs, 2026, 'TWD').months[6]
    const other = july.segments.find((s) => s.key === OTHER_KEY)!
    expect(other.label).toBe('其他')
    expect(other.gross).toBe(3_000)
  })

  it('month totals add up to the year total', () => {
    const r = buildDividendReport(seed(), 2026, 'TWD')
    expect(r.months.reduce((sum, m) => sum + m.gross, 0)).toBe(r.gross)
  })
})

describe('dividendYears', () => {
  it('lists only the years with a cash dividend in that currency, newest first', () => {
    const txs = [
      ...seed(),
      tx({ tx_date: '2024-08-05', ticker: '2609', price: 1, qty: 1000 }),
      tx({ tx_date: '2025-08-05', ticker: '2609', price: 1, qty: 1000 }),
      tx({ tx_date: '2023-01-01', ticker: '2330', tx_type: 'BUY', price: 500, qty: 1000 }),
      tx({ tx_date: '2022-01-01', ticker: 'AAPL', market: 'US', price: 1, qty: 10 }),
    ]
    expect(dividendYears(txs, 'TWD')).toEqual([2026, 2025, 2024])
    expect(dividendYears(txs, 'USD')).toEqual([2022])
  })

  it('is empty when nothing was ever paid', () => {
    expect(dividendYears([], 'TWD')).toEqual([])
  })
})

describe('chartScaleMax', () => {
  it('rounds the peak up to a readable axis top', () => {
    expect(chartScaleMax(29_200)).toBe(30_000)
    expect(chartScaleMax(30_000)).toBe(30_000)
    expect(chartScaleMax(1_200)).toBe(1_500)
    expect(chartScaleMax(8)).toBe(10)
    expect(chartScaleMax(101)).toBe(150)
  })

  it('is 0 for an empty year, so the caller can skip the chart', () => {
    expect(chartScaleMax(0)).toBe(0)
    expect(chartScaleMax(-1)).toBe(0)
  })
})
