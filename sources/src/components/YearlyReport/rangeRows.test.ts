/**
 * Task 176 區間收益. The anchor case is `區間 = 整個年度` : every figure must equal the yearly table's
 * row for that year, because both read the same sell legs. If that holds, the date filter is proven
 * to be a slice rather than a recomputation, and the rest of the cases are about window edges.
 */
import { describe, expect, it } from 'vitest'
import { computeLedger } from '../../utils/pnlEngine'
import type { Transaction, TxType } from '../../types/models'
import { addMonthsKey } from '../../utils/taipeiDate'
import { ledgerSpan, rangeRoi, rangeRows, resolveRange } from './rangeRows'

let seq = 0
function tx(
  date: string,
  type: TxType,
  price: number,
  qty: number,
  fee = 0,
  over: Partial<Transaction> = {},
): Transaction {
  seq++
  return {
    id: `tx-${seq}`,
    workspace_id: 'ws',
    tx_date: date,
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: type,
    price,
    qty,
    fee_tax: fee,
    created_at: `2020-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
    ...over,
  }
}

const us = (over: Partial<Transaction> = {}): Partial<Transaction> => ({
  market: 'US',
  ticker: 'AAPL',
  name: 'Apple Inc.',
  ...over,
})

describe('resolveRange', () => {
  const span = { from: '2020-03-02', to: '2026-09-28' }

  it('近 1 / 3 / 12 個月以今天為結束日，起始日往回推整月', () => {
    expect(resolveRange('1m', '2026-09-30', span)).toEqual({ from: '2026-08-30', to: '2026-09-30' })
    expect(resolveRange('3m', '2026-09-30', span)).toEqual({ from: '2026-06-30', to: '2026-09-30' })
    expect(resolveRange('1y', '2026-09-30', span)).toEqual({ from: '2025-09-30', to: '2026-09-30' })
  })

  it('今年以來從 1/1 起算，去年是完整的去年', () => {
    expect(resolveRange('ytd', '2026-09-30', span)).toEqual({ from: '2026-01-01', to: '2026-09-30' })
    expect(resolveRange('lastYear', '2026-09-30', span)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('全部用帳上第一筆到最後一筆', () => {
    expect(resolveRange('all', '2026-09-30', span)).toEqual(span)
  })

  it('往回推月份時把日期夾在當月最後一天，不會溢位到下個月', () => {
    // setUTCMonth would turn this into 2026-03-03.
    expect(addMonthsKey('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonthsKey('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonthsKey('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonthsKey('2026-01-31', -13)).toBe('2024-12-31')
  })
})

describe('rangeRows 與年度表對帳', () => {
  // 2025: buy 1,000 @500 (fee 712), sell 1,000 @600 (fee+tax 2,655), dividend 3.5 × 1,000 (fee 100).
  // 2026: buy 1,000 @700 (fee 997), sell 1,000 @650 (fee+tax 2,877).
  const ledger = computeLedger([
    tx('2025-02-10', 'BUY', 500, 1000, 712),
    tx('2025-06-20', 'SELL', 600, 1000, 2655),
    tx('2025-08-15', 'DIVIDEND', 3.5, 1000, 100),
    tx('2026-03-05', 'BUY', 700, 1000, 997),
    tx('2026-07-11', 'SELL', 650, 1000, 2877),
  ])

  it('區間 = 整個 2025 年時，每個數字都等於 2025 年度列', () => {
    const { rows, totals } = rangeRows(ledger, 'TWD', { from: '2025-01-01', to: '2025-12-31' })
    const yt = ledger.yearly[2025].tickers['TPE:2330']
    expect(rows).toHaveLength(1)
    expect(rows[0].realized).toBeCloseTo(yt.realized, 6)
    expect(rows[0].costBasis).toBeCloseTo(yt.costBasis, 6)
    expect(rows[0].rawCostBasis).toBeCloseTo(yt.rawCostBasis, 6)
    expect(rows[0].sellAmt).toBeCloseTo(yt.sellAmt, 6)
    expect(rows[0].sellGross).toBeCloseTo(yt.sellGross, 6)
    expect(rows[0].dividends).toBeCloseTo(yt.dividends, 6)
    expect(rows[0].total).toBeCloseTo(yt.realized + yt.dividends, 6)
    expect(totals.realized).toBeCloseTo(yt.realized, 6)
    expect(totals.dividends).toBeCloseTo(yt.dividends, 6)
  })

  it('起訖日都包含在內', () => {
    const on = rangeRows(ledger, 'TWD', { from: '2025-06-20', to: '2025-06-20' })
    expect(on.rows).toHaveLength(1)
    expect(on.totals.sellCount).toBe(1)
    expect(on.totals.dividends).toBe(0)

    const before = rangeRows(ledger, 'TWD', { from: '2025-06-21', to: '2025-08-14' })
    expect(before.empty).toBe(true)
  })

  it('切在年中的區間跨年合併同一檔，不會拆成兩列', () => {
    const { rows, totals } = rangeRows(ledger, 'TWD', { from: '2025-07-01', to: '2026-12-31' })
    expect(rows).toHaveLength(1)
    // 2025 的股利 + 2026 的賣出，2025 的賣出落在區間外
    expect(rows[0].dividends).toBeCloseTo(3.5 * 1000 - 100, 6)
    expect(rows[0].sells).toHaveLength(1)
    expect(rows[0].sells[0].date).toBe('2026-07-11')
    expect(rows[0].realized).toBeCloseTo(ledger.yearly[2026].tickers['TPE:2330'].realized, 6)
    expect(totals.total).toBeCloseTo(rows[0].realized + rows[0].dividends, 6)
  })

  it('只有買進的個股不列入：還沒賣掉的錢還沒落袋', () => {
    const onlyBuy = computeLedger([tx('2026-03-05', 'BUY', 700, 1000, 997)])
    expect(rangeRows(onlyBuy, 'TWD', { from: '2026-01-01', to: '2026-12-31' }).empty).toBe(true)
    expect(ledgerSpan(onlyBuy)).toBeNull()
  })

  it('區間內沒有任何賣出或股利時 empty 為真，合計歸零', () => {
    const { rows, totals, empty } = rangeRows(ledger, 'TWD', { from: '2024-01-01', to: '2024-12-31' })
    expect(empty).toBe(true)
    expect(rows).toHaveLength(0)
    expect(totals.total).toBe(0)
    expect(totals.gainers).toBe(0)
    expect(totals.losers).toBe(0)
  })
})

describe('rangeRows 排序、檔數與幣別', () => {
  const ledger = computeLedger([
    // 賺的：2330
    tx('2026-01-05', 'BUY', 500, 1000, 712),
    tx('2026-02-05', 'SELL', 600, 1000, 2655),
    // 賠的：2303
    tx('2026-01-06', 'BUY', 60, 1000, 85, { ticker: '2303', name: '聯電' }),
    tx('2026-02-06', 'SELL', 50, 1000, 221, { ticker: '2303', name: '聯電' }),
    // 只有股利：00878
    tx('2026-03-01', 'BUY', 20, 1000, 28, { ticker: '00878', name: '國泰永續高股息' }),
    tx('2026-06-01', 'DIVIDEND', 1.2, 1000, 0, { ticker: '00878', name: '國泰永續高股息' }),
    // 美股，不該出現在台股區間
    tx('2026-01-07', 'BUY', 180, 10, 0, us()),
    tx('2026-02-07', 'SELL', 200, 10, 0, us()),
  ])
  const range = { from: '2026-01-01', to: '2026-12-31' }

  it('由賺到賠排序，賺賠檔數只看已落袋的總報酬', () => {
    const { rows, totals } = rangeRows(ledger, 'TWD', range)
    expect(rows.map((r) => r.ticker)).toEqual(['2330', '00878', '2303'])
    expect(totals.gainers).toBe(2)
    expect(totals.losers).toBe(1)
    expect(totals.sellCount).toBe(2)
  })

  it('只有股利的個股列出來但沒有賣出腳位，報酬率無從計算', () => {
    const row = rangeRows(ledger, 'TWD', range).rows.find((r) => r.ticker === '00878')!
    expect(row.sells).toHaveLength(0)
    expect(row.realized).toBe(0)
    expect(row.dividends).toBeCloseTo(1200, 6)
    expect(row.total).toBeCloseTo(1200, 6)
    expect(rangeRoi([row]).costBasis).toBe(0)
  })

  it('台股與美股完全分開', () => {
    const tw = rangeRows(ledger, 'TWD', range)
    const usd = rangeRows(ledger, 'USD', range)
    expect(tw.rows.some((r) => r.ticker === 'AAPL')).toBe(false)
    expect(usd.rows.map((r) => r.ticker)).toEqual(['AAPL'])
    expect(usd.totals.realized).toBeCloseTo(200 * 10 - 180 * 10, 6)
  })

  it('ledgerSpan 是第一筆到最後一筆的賣出或股利日，不含只買進的日期', () => {
    expect(ledgerSpan(ledger)).toEqual({ from: '2026-02-05', to: '2026-06-01' })
  })
})

describe('rangeRows 超賣與融券', () => {
  it('超賣腳位算進已實現損益，但報酬率的分子分母都跳過它', () => {
    const ledger = computeLedger([
      tx('2026-01-05', 'BUY', 500, 1000, 712),
      tx('2026-02-05', 'SELL', 600, 1500, 3982),
    ])
    const { rows } = rangeRows(ledger, 'TWD', { from: '2026-01-01', to: '2026-12-31' })
    expect(rows[0].sells.some((s) => s.oversold)).toBe(true)
    // 已實現含超賣那一段（成本以 0 計）
    expect(rows[0].realized).toBeCloseTo(ledger.yearly[2026].tickers['TPE:2330'].realized, 6)
    // 報酬率只看有成本的那一段
    const roi = rangeRoi(rows)
    const priced = rows[0].sells.filter((s) => !s.oversold)
    expect(roi.costBasis).toBeCloseTo(
      priced.reduce((sum, s) => sum + s.costBasis, 0),
      6,
    )
  })

  it('融券回補算成實現腳位', () => {
    const ledger = computeLedger([
      tx('2026-01-05', 'SELL', 600, 1000, 2655, { tx_nature: 'SHORT' }),
      tx('2026-02-05', 'BUY', 550, 1000, 783, { tx_nature: 'SHORT' }),
    ])
    const { rows, totals } = rangeRows(ledger, 'TWD', { from: '2026-01-01', to: '2026-12-31' })
    expect(rows[0].sells.map((s) => s.kind)).toEqual(['SHORT_COVER'])
    expect(totals.sellCount).toBe(1)
    expect(totals.realized).toBeGreaterThan(0)
  })
})
