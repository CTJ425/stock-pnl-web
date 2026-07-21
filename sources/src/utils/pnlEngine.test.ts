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

  it('年度成本基礎：已實現損益 = 賣出收入 − 賣出成本（含費與未含費各自成立）', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-10', market: 'TPE', ticker: '2330', type: 'BUY', price: 500, qty: 1000, fee: 712 }),
      tx({ date: '2024-03-05', market: 'TPE', ticker: '2330', type: 'BUY', price: 600, qty: 1000, fee: 855 }),
      tx({ date: '2025-02-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 700, qty: 500, fee: 1548 }),
    ])

    const y2025 = ledger.yearly[2025]
    // 含費：成本基礎 550.7835*500 = 275,391.75；收入 350,000-1,548 = 348,452
    expect(y2025.costBasis).toBeCloseTo(275391.75, 6)
    expect(y2025.sellGross).toBeCloseTo(350000, 6)
    expect(y2025.realizedTw).toBeCloseTo(y2025.sellAmt - y2025.costBasis, 6)
    // 未含費：成本基礎 550*500 = 275,000，價差 350,000-275,000 = 75,000（比實際獲利樂觀）
    expect(y2025.rawCostBasis).toBeCloseTo(275000, 6)
    expect(y2025.sellGross - y2025.rawCostBasis).toBeCloseTo(75000, 6)
    expect(y2025.sellGross - y2025.rawCostBasis).toBeGreaterThan(y2025.realizedTw)

    // 買進年度：只有支出、無成本基礎；未含費價金不含手續費
    expect(ledger.yearly[2024].buyGross).toBeCloseTo(1100000, 6)
    expect(ledger.yearly[2024].buyAmt).toBeCloseTo(1101567, 6)
    expect(ledger.yearly[2024].costBasis).toBe(0)

    // 個股明細與年度加總一致
    const yt = y2025.tickers['TPE:2330']
    expect(yt.costBasis).toBeCloseTo(y2025.costBasis, 6)
    expect(yt.realized).toBeCloseTo(yt.sellAmt - yt.costBasis, 6)
  })

  it('rawCost：成交均價不含手續費，賣出依比例扣減', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-10', market: 'TPE', ticker: '2330', type: 'BUY', price: 500, qty: 1000, fee: 712 }),
      tx({ date: '2024-03-05', market: 'TPE', ticker: '2330', type: 'BUY', price: 600, qty: 1000, fee: 855 }),
      tx({ date: '2025-02-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 700, qty: 500, fee: 1548 }),
    ])
    const h = ledger.holdings[0]
    // rawCost = 500*1000 + 600*1000 = 1,100,000；賣 500 股扣 550*500 = 275,000 → 825,000
    expect(h.rawCost).toBeCloseTo(825000, 6)
    expect(h.rawAvgCost).toBeCloseTo(550, 6)
    // 含費均價必高於未含費成交均價
    expect(h.avgCost).toBeGreaterThan(h.rawAvgCost)
  })

  it('holdings 排序：台股在前、代號遞增', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'AAPL', type: 'BUY', price: 100, qty: 1 }),
      tx({ date: '2024-01-02', market: 'TPE', ticker: '2603', type: 'BUY', price: 100, qty: 1000 }),
      tx({ date: '2024-01-03', market: 'TPE', ticker: '0050', type: 'BUY', price: 100, qty: 1000 }),
    ])
    expect(ledger.holdings.map((h) => h.ticker)).toEqual(['0050', '2603', 'AAPL'])
  })

  it('SellDetail 明細與 summary buyCount/sellCount 驗證', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'TSLA', type: 'BUY', price: 100, qty: 10, fee: 1 }), // cost: 1001, rawCost: 1000
      tx({ date: '2024-02-01', market: 'US', ticker: 'TSLA', type: 'BUY', price: 200, qty: 10, fee: 1 }), // cost: 2001, rawCost: 2000. Total cost: 3002. avgCost: 150.1
      tx({ date: '2024-03-01', market: 'US', ticker: 'TSLA', type: 'SELL', price: 300, qty: 5, fee: 2 }), // costBasis: 750.5. revenue: 1498. realized: 747.5
      tx({ date: '2024-04-01', market: 'US', ticker: 'TSLA', type: 'SELL', price: 150, qty: 5, fee: 2 }), // avgCost still 150.1. costBasis: 750.5. revenue: 748. realized: -2.5
    ])

    const yt = ledger.yearly[2024].tickers['US:TSLA']
    expect(yt.sells).toHaveLength(2)

    const s1 = yt.sells[0]
    expect(s1.date).toBe('2024-03-01')
    expect(s1.qty).toBe(5)
    expect(s1.price).toBe(300)
    expect(s1.sellAmt).toBe(1498)
    expect(s1.sellGross).toBe(1500)
    expect(s1.costBasis).toBeCloseTo(750.5, 6)
    expect(s1.rawCostBasis).toBeCloseTo(750, 6)
    expect(s1.realized).toBeCloseTo(747.5, 6)
    expect(s1.fees).toBe(2)
    expect(s1.avgCost).toBeCloseTo(150.1, 6)
    expect(s1.oversold).toBe(false)

    const s2 = yt.sells[1]
    expect(s2.date).toBe('2024-04-01')
    expect(s2.qty).toBe(5)
    expect(s2.price).toBe(150)
    expect(s2.sellAmt).toBe(748)
    expect(s2.sellGross).toBe(750)
    expect(s2.costBasis).toBeCloseTo(750.5, 6)
    expect(s2.rawCostBasis).toBeCloseTo(750, 6)
    expect(s2.realized).toBeCloseTo(-2.5, 6)
    expect(s2.fees).toBe(2)
    expect(s2.avgCost).toBeCloseTo(150.1, 6)
    expect(s2.oversold).toBe(false)

    // Identity check
    expect(yt.sells.reduce((sum, s) => sum + s.realized, 0)).toBeCloseTo(yt.realized, 6)
    expect(yt.sells.reduce((sum, s) => sum + s.costBasis, 0)).toBeCloseTo(yt.costBasis, 6)
    expect(yt.sells.reduce((sum, s) => sum + s.sellAmt, 0)).toBeCloseTo(yt.sellAmt, 6)

    // Summary counts
    expect(ledger.summary.buyCount).toBe(2)
    expect(ledger.summary.sellCount).toBe(2)
    expect(ledger.summary.buyCount + ledger.summary.sellCount).toBe(ledger.summary.count)
  })

  it('SellDetail 超賣標記', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'TSLA', type: 'BUY', price: 100, qty: 5, fee: 0 }),
      tx({ date: '2024-02-01', market: 'US', ticker: 'TSLA', type: 'SELL', price: 200, qty: 10, fee: 0 }),
    ])
    const yt = ledger.yearly[2024].tickers['US:TSLA']
    expect(yt.sells).toHaveLength(1)
    const s1 = yt.sells[0]
    expect(s1.oversold).toBe(true)
    expect(s1.costBasis).toBeCloseTo(500, 6) // Only 5 shares matched at cost 100
    expect(s1.sellAmt).toBeCloseTo(2000, 6)
  })

  it('歷史累計手續費拆分：估算手續費與交易稅', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 100, qty: 1000, fee: 142 }), // tax 0
      tx({ date: '2024-01-02', market: 'TPE', ticker: '2330', type: 'SELL', price: 120, qty: 1000, fee: 531 }), // 稅 120000*0.003 = 360
      tx({ date: '2024-01-03', market: 'TPE', ticker: '0050', type: 'SELL', price: 100, qty: 1000, fee: 142 }), // 稅 100000*0.001 = 100
      tx({ date: '2024-01-04', market: 'TPE', ticker: '00679B', type: 'SELL', price: 100, qty: 1000, fee: 142 }), // 稅 0
      tx({ date: '2024-01-05', market: 'US', ticker: 'AAPL', type: 'SELL', price: 100, qty: 10, fee: 2 }), // 稅 0
      tx({ date: '2024-01-06', market: 'TPE', ticker: '2330', type: 'SELL', price: 100, qty: 1000, fee: 1 }), // 稅應為 300，但 capped at 1
    ])

    const summary = ledger.summary
    expect(summary.feesTax).toBe(0 + 360 + 100 + 0 + 0 + 1)
    expect(summary.feesBrokerage).toBe(142 + (531 - 360) + (142 - 100) + 142 + 2 + 0)
    expect(summary.feesBrokerage + summary.feesTax).toBe(summary.fees)

    const y2024 = ledger.yearly[2024]
    expect(y2024.feesTax).toBe(461)

    let ytSumFeesTax = 0
    for (const key of Object.keys(y2024.tickers)) {
      ytSumFeesTax += y2024.tickers[key].feesTax
    }
    expect(ytSumFeesTax).toBe(y2024.feesTax)

    const yt2330 = y2024.tickers['TPE:2330']
    expect(yt2330.feesTax).toBe(361)
    expect(yt2330.sells[0].feesTax).toBe(360)
    expect(yt2330.sells[1].feesTax).toBe(1)
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

  it('台股 ETF（00 開頭）證交稅率 0.1%、債券 ETF（B 結尾）免稅', () => {
    expect(sellTaxRate('0050')).toBe(0.001)
    expect(sellTaxRate('2330')).toBe(0.003)
    expect(sellTaxRate('00679B')).toBe(0)
    expect(sellTaxRate('00679b')).toBe(0)
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'TPE', ticker: '0050', type: 'BUY', price: 100, qty: 1000 }),
    ])
    const h = ledger.holdings[0]
    // mkt = 110,000；fee = floor(156.75) = 156；tax = floor(110) = 110
    // round(110,000 - 100,000 - 156 - 110) = 9,734
    expect(estimateUnrealized(h, 110, 0.001425)).toBe(9734)
  })

  it('台股：手續費不足下限時以最低手續費預扣', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'TPE', ticker: '0050', type: 'BUY', price: 100, qty: 100 }),
    ])
    const h = ledger.holdings[0]
    // mkt = 11,000；fee = max(floor(15.675), 20) = 20；tax = floor(11) = 11
    // round(11,000 - 10,000 - 20 - 11) = 969
    expect(estimateUnrealized(h, 110, 0.001425, 20)).toBe(969)
    // 未提供 minFee 時維持原公式：11,000 - 10,000 - 15 - 11 = 974
    expect(estimateUnrealized(h, 110, 0.001425)).toBe(974)
  })

  it('美股：不預扣費用', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'AAPL', type: 'BUY', price: 90, qty: 10 }),
    ])
    expect(estimateUnrealized(ledger.holdings[0], 100, 0.001425)).toBeCloseTo(100, 6)
  })
})
