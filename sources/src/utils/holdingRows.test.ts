import { describe, it, expect } from 'vitest'
import { buildHoldingRows } from './holdingRows'
import { computeLedger } from './pnlEngine'
import type { PriceMap } from '../services/priceProxy'
import type { Transaction } from '../types/models'

/** Quotation for testing: only price / prevClose / stale are meaningful, the rest are fields required by the type*/
const quote = (price: number, stale = false, prevClose: number | null = null): PriceMap[string] => ({
  price,
  prevClose,
  open: null,
  high: null,
  low: null,
  volume: null,
  tradeDate: null,
  tradeTime: null,
  trial: false,
  asOf: '2026-07-25T12:00:00.000Z',
  source: stale ? 'cache' : 'edge',
  stale,
})

let seq = 0
function tx(p: Partial<Transaction>): Transaction {
  seq += 1
  return {
    id: `t${seq}`,
    workspace_id: 'ws',
    tx_date: '2026-03-02',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 100,
    qty: 1000,
    fee_tax: 20,
    created_at: '2026-03-02T01:00:00.000Z',
    ...p,
  }
}

const holdingsOf = (txs: Transaction[]) => computeLedger(txs).holdings

describe('buildHoldingRows', () => {
  it('有現價時算出市值、未實現淨損益與報酬率', () => {
    const holdings = holdingsOf([tx({ price: 100, qty: 1000, fee_tax: 142 })])
    const [row] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(row.mktVal).toBe(120000)
    expect(row.unrealized).not.toBeNull()
    // Taiwan stocks withhold selling fees and securities taxes, so the net profit or loss must be less than the pure price difference
    expect(row.unrealized!).toBeLessThan(row.rawUnrealized!)
    expect(row.roi).toBeCloseTo(row.unrealized! / row.holding.cost, 10)
    expect(row.priceStale).toBe(false)
  })

  it('無現價時市值 / 未實現 / 報酬率皆為 null（不以 0 冒充）', () => {
    const holdings = holdingsOf([tx({})])
    const [row] = buildHoldingRows(holdings, {}, 0.001425)
    expect(row.price).toBeNull()
    expect(row.mktVal).toBeNull()
    expect(row.unrealized).toBeNull()
    expect(row.rawUnrealized).toBeNull()
    expect(row.roi).toBeNull()
    // The breakeven price does not require the current price, it can still be calculated.
    expect(row.breakEven).toBeGreaterThan(0)
  })

  it('dayChange 為現價與昨收的差；報價沒帶昨收時為 null（不以 0 冒充平盤）', () => {
    const holdings = holdingsOf([tx({})])
    const [up] = buildHoldingRows(holdings, { 'TPE:2330': quote(120, false, 118) }, 0.001425)
    expect(up.dayChange).toBeCloseTo(2, 10)
    const [down] = buildHoldingRows(holdings, { 'TPE:2330': quote(120, false, 125) }, 0.001425)
    expect(down.dayChange).toBeCloseTo(-5, 10)
    const [unknown] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(unknown.dayChange).toBeNull()
  })

  it('帶出快取價的 stale 旗標', () => {
    const holdings = holdingsOf([tx({})])
    const [row] = buildHoldingRows(holdings, { 'TPE:2330': quote(120, true) }, 0.001425)
    expect(row.priceStale).toBe(true)
  })

  it('零股（<1000 股）與整股套用不同的台股最低手續費', () => {
    const odd = holdingsOf([tx({ ticker: '2330', qty: 100, price: 100, fee_tax: 1 })])
    const whole = holdingsOf([tx({ ticker: '2330', qty: 1000, price: 100, fee_tax: 20 })])
    const prices: PriceMap = { 'TPE:2330': quote(100) }
    const [oddRow] = buildHoldingRows(odd, prices, 0.001425)
    const [wholeRow] = buildHoldingRows(whole, prices, 0.001425)
    // Both have withheld selling costs, so the net unrealized gains and losses are negative; the absolute amount of the entire stock is larger (the position is 10 times larger)
    expect(oddRow.unrealized!).toBeLessThan(0)
    expect(wholeRow.unrealized!).toBeLessThan(oddRow.unrealized!)
  })

  it('美股不套用最低手續費、也不預扣賣出費用（淨損益＝純價差）', () => {
    const holdings = holdingsOf([
      tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.', price: 100, qty: 10, fee_tax: 0 }),
    ])
    const [row] = buildHoldingRows(holdings, { 'US:AAPL': quote(120) }, 0.001425)
    expect(row.holding.currency).toBe('USD')
    expect(row.unrealized).toBe(row.rawUnrealized)
  })

  it('空持股回空陣列', () => {
    expect(buildHoldingRows([], {}, 0.001425)).toEqual([])
  })
})
