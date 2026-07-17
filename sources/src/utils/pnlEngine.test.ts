import { describe, expect, it } from 'vitest'
import type { Market, Transaction, TxType } from '../types/models'
import { computeLedger, estimateUnrealized, sellTaxRate } from './pnlEngine'

let seq = 0
function tx(input: {
  date: string
  market: Market
  ticker: string
  name?: string
  type: TxType
  price: number
  qty: number
  fee?: number
}): Transaction {
  seq++
  return {
    id: `tx-${seq}`,
    workspace_id: 'ws-1',
    tx_date: input.date,
    market: input.market,
    ticker: input.ticker,
    name: input.name ?? input.ticker,
    tx_type: input.type,
    price: input.price,
    qty: input.qty,
    fee_tax: input.fee ?? 0,
    created_at: `2026-01-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

describe('computeLedger（移動平均成本法，與 GAS computeLedger_ 同構）', () => {
  it('台股買賣：移動平均成本與已實現損益', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-10', market: 'TPE', ticker: '2330', name: '台積電', type: 'BUY', price: 500, qty: 1000, fee: 712 }),
      tx({ date: '2024-03-05', market: 'TPE', ticker: '2330', name: '台積電', type: 'BUY', price: 600, qty: 1000, fee: 855 }),
      tx({ date: '2025-02-01', market: 'TPE', ticker: '2330', name: '台積電', type: 'SELL', price: 700, qty: 500, fee: 1548 }),
    ])

    // 買入成本含手續費：500*1000+712 + 600*1000+855 = 1,101,567
    // 賣出收入扣手續費：700*500-1548 = 348,452
    // 均價 = 1,101,567 / 2000 = 550.7835；成本基礎 = 550.7835*500 = 275,391.75
    // 已實現 = 348,452 - 275,391.75 = 73,060.25
    expect(ledger.holdings).toHaveLength(1)
    const h = ledger.holdings[0]
    expect(h.qty).toBe(1500)
    expect(h.cost).toBeCloseTo(826175.25, 6)
    expect(h.avgCost).toBeCloseTo(550.7835, 6)
    expect(h.buyCostTotal).toBeCloseTo(1101567, 6)
    expect(h.realized).toBeCloseTo(73060.25, 6)
    expect(h.currency).toBe('TWD')

    expect(ledger.years).toEqual([2024, 2025])
    expect(ledger.yearly[2024].buyAmt).toBeCloseTo(1101567, 6)
    expect(ledger.yearly[2024].count).toBe(2)
    expect(ledger.yearly[2024].fees).toBeCloseTo(1567, 6)
    expect(ledger.yearly[2024].realizedTw).toBe(0)
    expect(ledger.yearly[2025].sellAmt).toBeCloseTo(348452, 6)
    expect(ledger.yearly[2025].realizedTw).toBeCloseTo(73060.25, 6)

    expect(ledger.summary.realizedTw).toBeCloseTo(73060.25, 6)
    expect(ledger.summary.fees).toBeCloseTo(3115, 6)
    expect(ledger.summary.count).toBe(3)
    expect(ledger.warnings).toHaveLength(0)
  })

  it('超賣：超賣部分成本以 0 計算並產生警告', () => {
    const ledger = computeLedger([
      tx({ date: '2024-05-01', market: 'US', ticker: 'AAPL', type: 'SELL', price: 100, qty: 10 }),
    ])
    expect(ledger.warnings).toHaveLength(1)
    expect(ledger.summary.realizedUs).toBeCloseTo(1000, 6)
    expect(ledger.holdings).toHaveLength(0)
    expect(ledger.positions['US:AAPL'].qty).toBe(0)
  })

  it('輸入順序無關：依日期排序、同日依建立時間', () => {
    const buy = tx({ date: '2024-01-01', market: 'US', ticker: 'VOO', type: 'BUY', price: 400, qty: 10 })
    const sell = tx({ date: '2024-06-01', market: 'US', ticker: 'VOO', type: 'SELL', price: 450, qty: 10 })
    // 陣列順序故意顛倒
    const ledger = computeLedger([sell, buy])
    expect(ledger.warnings).toHaveLength(0)
    expect(ledger.summary.realizedUs).toBeCloseTo(500, 6)
  })

  it('清倉個股不出現在 holdings，已實現損益保留於 summary 與年度', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'TPE', ticker: '2603', name: '長榮', type: 'BUY', price: 100, qty: 1000, fee: 142 }),
      tx({ date: '2024-02-01', market: 'TPE', ticker: '2603', name: '長榮', type: 'SELL', price: 120, qty: 1000, fee: 531 }),
    ])
    expect(ledger.holdings).toHaveLength(0)
    // 已實現 = (120000-531) - (100142) = 19,327
    expect(ledger.summary.realizedTw).toBeCloseTo(19327, 6)
    expect(ledger.yearly[2024].tickers['TPE:2603'].realized).toBeCloseTo(19327, 6)
  })

  it('holdings 排序：台股在前、代號遞增', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'AAPL', type: 'BUY', price: 100, qty: 1 }),
      tx({ date: '2024-01-02', market: 'TPE', ticker: '2603', type: 'BUY', price: 100, qty: 1000 }),
      tx({ date: '2024-01-03', market: 'TPE', ticker: '0050', type: 'BUY', price: 100, qty: 1000 }),
    ])
    expect(ledger.holdings.map((h) => h.ticker)).toEqual(['0050', '2603', 'AAPL'])
  })
})

describe('estimateUnrealized（與 GAS Dashboard 未實現損益公式同構）', () => {
  it('台股：分項 floor 預扣賣出手續費與證交稅，外層 round 收整', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-10', market: 'TPE', ticker: '2330', type: 'BUY', price: 500, qty: 1000, fee: 712 }),
      tx({ date: '2024-03-05', market: 'TPE', ticker: '2330', type: 'BUY', price: 600, qty: 1000, fee: 855 }),
      tx({ date: '2025-02-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 700, qty: 500, fee: 1548 }),
    ])
    const h = ledger.holdings[0]
    // mkt = 900*1500 = 1,350,000；fee = floor(1923.75) = 1923；tax = floor(4050) = 4050
    // round(1,350,000 - 826,175.25 - 1923 - 4050) = round(517,851.75) = 517,852
    expect(estimateUnrealized(h, 900, 0.001425)).toBe(517852)
  })

  it('台股 ETF（00 開頭）證交稅率 0.1%', () => {
    expect(sellTaxRate('0050')).toBe(0.001)
    expect(sellTaxRate('2330')).toBe(0.003)
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'TPE', ticker: '0050', type: 'BUY', price: 100, qty: 1000 }),
    ])
    const h = ledger.holdings[0]
    // mkt = 110,000；fee = floor(156.75) = 156；tax = floor(110) = 110
    // round(110,000 - 100,000 - 156 - 110) = 9,734
    expect(estimateUnrealized(h, 110, 0.001425)).toBe(9734)
  })

  it('美股：不預扣費用', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'AAPL', type: 'BUY', price: 90, qty: 10 }),
    ])
    expect(estimateUnrealized(ledger.holdings[0], 100, 0.001425)).toBeCloseTo(100, 6)
  })
})
