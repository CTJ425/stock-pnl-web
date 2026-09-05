import { describe, expect, it } from 'vitest'
import type { Market, Transaction, TxNature, TxType } from '../types/models'
import type { Holding } from './pnlEngine'
import { compareTxOrder, computeLedger, estimateUnrealized, estimateUnrealizedShort, sellTaxRate, splitFeeTax } from './pnlEngine'

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
  nature?: TxNature
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
    tx_nature: input.nature,
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

    // Buying cost including handling fee: 500*1000+712 + 600*1000+855 = 1,101,567
    // Sales income minus handling fee: 700*500-1548 = 348,452
    // Average price = 1,101,567 / 2000 = 550.7835; Cost basis = 550.7835*500 = 275,391.75
    // Realized = 348,452 - 275,391.75 = 73,060.25
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
    // Array order intentionally reversed
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
    // Realized = (120000-531) - (100142) = 19,327
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
    // Including fees: Cost basis 550.7835*500 = 275,391.75; Revenue 350,000-1,548 = 348,452
    expect(y2025.costBasis).toBeCloseTo(275391.75, 6)
    expect(y2025.sellGross).toBeCloseTo(350000, 6)
    expect(y2025.realizedTw).toBeCloseTo(y2025.sellAmt - y2025.costBasis, 6)
    // Excluding fees: cost basis 550*500 = 275,000, spread 350,000-275,000 = 75,000 (more optimistic than actual profit)
    expect(y2025.rawCostBasis).toBeCloseTo(275000, 6)
    expect(y2025.sellGross - y2025.rawCostBasis).toBeCloseTo(75000, 6)
    expect(y2025.sellGross - y2025.rawCostBasis).toBeGreaterThan(y2025.realizedTw)

    // Purchase year: only expenditures, no cost basis; price before fees does not include handling fees
    expect(ledger.yearly[2024].buyGross).toBeCloseTo(1100000, 6)
    expect(ledger.yearly[2024].buyAmt).toBeCloseTo(1101567, 6)
    expect(ledger.yearly[2024].costBasis).toBe(0)

    // Individual stock details are consistent with the annual total
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
    // rawCost = 500*1000 + 600*1000 = 1,100,000; sell 500 shares and discount 550*500 = 275,000 → 825,000
    expect(h.rawCost).toBeCloseTo(825000, 6)
    expect(h.rawAvgCost).toBeCloseTo(550, 6)
    // The average price including fees must be higher than the average transaction price without fees
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
    // Not provided minFee Time maintenance source formula: 11,000 - 10,000 - 15 - 11 = 974
    expect(estimateUnrealized(h, 110, 0.001425)).toBe(974)
  })

  it('美股：不預扣費用', () => {
    const ledger = computeLedger([
      tx({ date: '2024-01-01', market: 'US', ticker: 'AAPL', type: 'BUY', price: 90, qty: 10 }),
    ])
    expect(estimateUnrealized(ledger.holdings[0], 100, 0.001425)).toBeCloseTo(100, 6)
  })
})

describe('股票名稱：代號佔位名不得覆蓋已知名稱', () => {
  it('後來只填代號的交易，不覆蓋既有的中文名（0050 案例）', () => {
    const ledger = computeLedger([
      tx({ date: '2026-06-10', market: 'TPE', ticker: '0050', name: '元大台灣50', type: 'BUY', price: 100, qty: 1000 }),
      tx({ date: '2026-08-18', market: 'TPE', ticker: '0050', name: '0050', type: 'BUY', price: 106, qty: 1000 }),
    ])

    expect(ledger.positions['TPE:0050'].name).toBe('元大台灣50')
    expect(ledger.yearly[2026].tickers['TPE:0050'].name).toBe('元大台灣50')
  })

  it('先有代號佔位名、之後才拿到中文名時，名稱會被補上', () => {
    const ledger = computeLedger([
      tx({ date: '2026-06-10', market: 'TPE', ticker: '0050', name: '0050', type: 'BUY', price: 100, qty: 1000 }),
      tx({ date: '2026-08-18', market: 'TPE', ticker: '0050', name: '元大台灣50', type: 'BUY', price: 106, qty: 1000 }),
    ])

    expect(ledger.positions['TPE:0050'].name).toBe('元大台灣50')
    expect(ledger.yearly[2026].tickers['TPE:0050'].name).toBe('元大台灣50')
  })

  it('全部交易都只有代號時，名稱維持代號', () => {
    const ledger = computeLedger([
      tx({ date: '2026-06-10', market: 'TPE', ticker: '0050', name: '0050', type: 'BUY', price: 100, qty: 1000 }),
    ])

    expect(ledger.positions['TPE:0050'].name).toBe('0050')
    expect(ledger.yearly[2026].tickers['TPE:0050'].name).toBe('0050')
  })
})

describe('sellTaxRate — TDR 與 REITs 同為 0.1%（BUG-035）', () => {
  it('TDR（91xx）證交稅 0.1%，不是一般股票的 0.3%', () => {
    expect(sellTaxRate('9105')).toBe(0.001)
    expect(sellTaxRate('9110')).toBe(0.001)
  })

  it('REITs（01xxx，多帶 T 結尾）證交稅 0.1%', () => {
    expect(sellTaxRate('01001T')).toBe(0.001)
    expect(sellTaxRate('01004T')).toBe(0.001)
  })

  it('既有規則不變：ETF 0.1%、債券 ETF 免稅、一般股票 0.3%', () => {
    expect(sellTaxRate('0050')).toBe(0.001)
    expect(sellTaxRate('00919')).toBe(0.001)
    expect(sellTaxRate('00679B')).toBe(0)
    expect(sellTaxRate('2330')).toBe(0.003)
    // 99xx 是一般上市公司，不可被 91xx 規則掃到
    expect(sellTaxRate('9910')).toBe(0.003)
    expect(sellTaxRate('9945')).toBe(0.003)
  })
})

describe('computeLedger 手續費／證交稅拆分（BUG-036）', () => {
  it('當沖賣出以減半稅率拆分，手續費不會被歸零', () => {
    // 真實資料：2344 華邦電 2026-08-18 現股當沖，fee_tax 362 = 稅 282 + 手續費 80
    // 一般稅率會算出 floor(188500*0.003)=565 > 362，舊版 Math.min 會把手續費壓成 0
    const ledger = computeLedger([
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'BUY', price: 187.5, qty: 1000, fee: 80 }),
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 362 }),
    ])
    expect(ledger.summary.feesTax).toBe(282)
    expect(ledger.summary.feesBrokerage).toBe(160) // 買進 80 + 賣出 80
  })

  it('一般賣出仍用 0.3%，即使當日買賣同一檔', () => {
    // 真實資料：2330 2026-05-20 當日進出，但 fee_tax 413 = 稅 362 + 手續費 51，屬一般稅率
    const ledger = computeLedger([
      tx({ date: '2026-05-20', market: 'TPE', ticker: '2330', type: 'BUY', price: 2170, qty: 50, fee: 46 }),
      tx({ date: '2026-05-20', market: 'TPE', ticker: '2330', type: 'SELL', price: 2415, qty: 50, fee: 413 }),
    ])
    expect(ledger.summary.feesTax).toBe(362)
    expect(ledger.summary.feesBrokerage).toBe(97) // 46 + 51
  })

  it('紀錄金額低於減半稅時，仍以整筆金額為上限', () => {
    const ledger = computeLedger([
      tx({ date: '2026-05-20', market: 'TPE', ticker: '2330', type: 'BUY', price: 100, qty: 1000, fee: 142 }),
      tx({ date: '2026-05-21', market: 'TPE', ticker: '2330', type: 'SELL', price: 100, qty: 1000, fee: 30 }),
    ])
    // floor(100000*0.003)=300、減半 150，兩者都大於 30
    expect(ledger.summary.feesTax).toBe(30)
    expect(ledger.summary.feesBrokerage).toBe(142)
  })
})

describe('computeLedger 清倉後不留浮點殘值（BUG-039）', () => {
  it('全數賣出後 cost 與 rawCost 歸零，再買進不受污染', () => {
    const txs = [
      tx({ date: '2025-11-07', market: 'TPE', ticker: '00919', type: 'BUY', price: 21.43, qty: 2000, fee: 61 }),
      tx({ date: '2025-11-08', market: 'TPE', ticker: '00919', type: 'BUY', price: 21.37, qty: 3000, fee: 91 }),
      tx({ date: '2026-06-23', market: 'TPE', ticker: '00919', type: 'SELL', price: 30.82, qty: 5000, fee: 250 }),
    ]
    const pos = computeLedger(txs).positions['TPE:00919']
    expect(pos.qty).toBe(0)
    expect(pos.cost).toBe(0)
    // 移動平均反算會留下 1.4e-11 的殘值，再買進時會永久污染均價
    expect(pos.rawCost).toBe(0)

    const after = computeLedger([
      ...txs,
      tx({ date: '2026-07-01', market: 'TPE', ticker: '00919', type: 'BUY', price: 22, qty: 1000, fee: 31 }),
    ]).holdings[0]
    expect(after.rawAvgCost).toBe(22)
  })
})

describe('未沖銷庫存明細（openLots，Task 136）', () => {
  it('每筆買進各成一批，FIFO 逐批沖銷', () => {
    const ledger = computeLedger([
      tx({ date: '2026-03-09', market: 'TPE', ticker: '2615', type: 'BUY', price: 82.9, qty: 2000, fee: 236 }),
      tx({ date: '2026-03-10', market: 'TPE', ticker: '2615', type: 'BUY', price: 78.6, qty: 1000, fee: 112 }),
      tx({ date: '2026-03-12', market: 'TPE', ticker: '2615', type: 'BUY', price: 80, qty: 1000, fee: 114 }),
    ])
    const lots = ledger.positions['TPE:2615'].openLots
    expect(lots.map((l) => l.qty)).toEqual([2000, 1000, 1000])
    expect(lots[0].price).toBe(82.9)
    expect(lots[0].cost).toBe(82.9 * 2000 + 236)
    expect(lots[0].rawCost).toBe(82.9 * 2000)
  })

  it('部分賣出先沖最舊的一批，未沖銷批次的成本不變', () => {
    const ledger = computeLedger([
      tx({ date: '2026-03-09', market: 'TPE', ticker: '2615', type: 'BUY', price: 82.9, qty: 2000, fee: 236 }),
      tx({ date: '2026-03-10', market: 'TPE', ticker: '2615', type: 'BUY', price: 78.6, qty: 1000, fee: 112 }),
      tx({ date: '2026-05-21', market: 'TPE', ticker: '2615', type: 'SELL', price: 81.3, qty: 1000, fee: 358 }),
    ])
    const lots = ledger.positions['TPE:2615'].openLots
    expect(lots.map((l) => l.qty)).toEqual([1000, 1000])
    // 最舊那批被沖掉一半，成本按比例減半
    expect(lots[0].price).toBe(82.9)
    expect(lots[0].cost).toBeCloseTo((82.9 * 2000 + 236) / 2, 9)
    // 後面那批完全沒動
    expect(lots[1].cost).toBe(78.6 * 1000 + 112)
  })

  it('清倉後批次清空，再買進只剩新批次', () => {
    const ledger = computeLedger([
      tx({ date: '2026-03-09', market: 'TPE', ticker: '2615', type: 'BUY', price: 82.9, qty: 2000, fee: 236 }),
      tx({ date: '2026-05-21', market: 'TPE', ticker: '2615', type: 'SELL', price: 81.3, qty: 2000, fee: 716 }),
      tx({ date: '2026-05-22', market: 'TPE', ticker: '2615', type: 'BUY', price: 83, qty: 1000, fee: 118 }),
    ])
    const lots = ledger.positions['TPE:2615'].openLots
    expect(lots).toHaveLength(1)
    expect(lots[0].qty).toBe(1000)
    expect(lots[0].price).toBe(83)
  })

  it('超賣時批次全數清空，不留負數量批次', () => {
    const ledger = computeLedger([
      tx({ date: '2026-03-09', market: 'TPE', ticker: '2615', type: 'BUY', price: 82.9, qty: 1000, fee: 118 }),
      tx({ date: '2026-05-21', market: 'TPE', ticker: '2615', type: 'SELL', price: 81.3, qty: 3000, fee: 1074 }),
    ])
    expect(ledger.positions['TPE:2615'].openLots).toEqual([])
    expect(ledger.warnings).toHaveLength(1)
  })
})

describe('estimateUnrealized 逐批計算賣出成本（Task 136）', () => {
  /** 0050 四批：2000/1000/1000/2000 股，現價 106.25 */
  const multiLot = () =>
    computeLedger([
      tx({ date: '2026-06-10', market: 'TPE', ticker: '0050', type: 'BUY', price: 105.0, qty: 2000, fee: 299 }),
      tx({ date: '2026-07-20', market: 'TPE', ticker: '0050', type: 'BUY', price: 103.5, qty: 1000, fee: 147 }),
      tx({ date: '2026-07-28', market: 'TPE', ticker: '0050', type: 'BUY', price: 102.8, qty: 1000, fee: 146 }),
      tx({ date: '2026-08-24', market: 'TPE', ticker: '0050', type: 'BUY', price: 104.0, qty: 2000, fee: 296 }),
    ]).holdings[0]

  it('多批持股：手續費與證交稅逐批無條件捨去，與券商 APP 對得起來', () => {
    const h = multiLot()
    expect(h.qty).toBe(6000)
    expect(h.cost).toBe(625188)
    // 逐批：手續費 302+151+151+302=906、證交稅 212+106+106+212=636
    // 整筆：手續費 908、證交稅 637 —— 少扣 3 元就是券商對不起來的那 3 元
    expect(estimateUnrealized(h, 106.25, 0.001425, 20)).toBe(10770)
  })

  it('單批持股與原本的整筆算法完全相同', () => {
    const h = computeLedger([
      tx({ date: '2026-07-13', market: 'TPE', ticker: '0050', type: 'BUY', price: 92.5, qty: 1000, fee: 39 }),
    ]).holdings[0]
    expect(estimateUnrealized(h, 103.5, 0.0004275, 20)).toBe(10814)
  })

  it('最低手續費以整筆計一次，不是每批各收一次', () => {
    const h = computeLedger([
      tx({ date: '2026-07-01', market: 'TPE', ticker: '00919', type: 'BUY', price: 15.0, qty: 100, fee: 20 }),
      tx({ date: '2026-07-02', market: 'TPE', ticker: '00919', type: 'BUY', price: 15.0, qty: 100, fee: 20 }),
    ]).holdings[0]
    // 逐批手續費 2+2=4 < 20 → 整筆補到 20（不是 20×2=40）；證交稅 1+1=2
    expect(estimateUnrealized(h, 15.0, 0.001425, 20)).toBe(3000 - 3040 - 20 - 2)
  })

  it('沒有批次資料的持股（手工組出來的 Holding）沿用原本的整筆算法', () => {
    // 這條 fallback 是給不是從 computeLedger 來的 Holding 用的，數字必須與改動前一模一樣：
    // 整筆手續費 floor(637500*0.001425)=908、整筆證交稅 floor(637500*0.001)=637
    const h: Holding = {
      key: 'TPE:0050', ticker: '0050', name: '元大台灣50', market: 'TPE', currency: 'TWD',
      qty: 6000, cost: 625188, rawCost: 623300, buyCostTotal: 625188, realized: 0,
      avgCost: 625188 / 6000, rawAvgCost: 623300 / 6000, openLots: [],
      shortQty: 0, shortProceeds: 0, shortRawProceeds: 0, shortLots: [],
    }
    expect(estimateUnrealized(h, 106.25, 0.001425, 20)).toBe(10767)
    // 同樣的部位改由 computeLedger 帶出四個批次時，逐批捨去會少扣 3 元
    expect(estimateUnrealized(multiLot(), 106.25, 0.001425, 20)).toBe(10770)
  })

  it('holdings 的批次是獨立副本，改動它不會污染 positions', () => {
    const ledger = computeLedger([
      tx({ date: '2026-06-10', market: 'TPE', ticker: '0050', type: 'BUY', price: 105.0, qty: 2000, fee: 299 }),
    ])
    ledger.holdings[0].openLots[0].qty = 1
    expect(ledger.positions['TPE:0050'].openLots[0].qty).toBe(2000)
  })

  it('美股不扣賣出手續費與證交稅', () => {
    const h = computeLedger([
      tx({ date: '2026-06-03', market: 'US', ticker: 'AAPL', type: 'BUY', price: 180, qty: 10, fee: 1 }),
    ]).holdings[0]
    expect(estimateUnrealized(h, 200, 0.001425, 20)).toBeCloseTo(199, 9)
  })
})


describe('明確的交易性質優先於推測（Task 137 §C）', () => {
  it('標記為當沖時直接用減半稅，即使金額足以覆蓋一般稅', () => {
    // fee_tax 700 高於一般稅 565，光看數字會判成一般交易；標記說了是當沖，就以標記為準
    const ledger = computeLedger([
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'BUY', price: 187.5, qty: 1000, fee: 80 }),
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 700, nature: 'DAY_TRADE' }),
    ])
    expect(ledger.summary.feesTax).toBe(282)
    expect(ledger.summary.feesBrokerage).toBe(80 + 418)
  })

  it('標記為現股不得讓手續費被歸零：仍走推測階梯', () => {
    // 這是真實的當沖紀錄（362 = 282 + 80）被誤標成現股。
    // 若讓標記強制一般稅率，estTax 會被 Math.min 壓成 362、手續費歸零 —— BUG-036 重演
    const ledger = computeLedger([
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'BUY', price: 187.5, qty: 1000, fee: 80 }),
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 362, nature: 'SPOT' }),
    ])
    expect(ledger.summary.feesTax).toBe(282)
    expect(ledger.summary.feesBrokerage).toBe(160)
  })

  it('融資標記不改變任何計算', () => {
    const ledger = computeLedger([
      tx({ date: '2026-05-20', market: 'TPE', ticker: '2330', type: 'BUY', price: 2170, qty: 50, fee: 46, nature: 'MARGIN' }),
      tx({ date: '2026-05-20', market: 'TPE', ticker: '2330', type: 'SELL', price: 2415, qty: 50, fee: 413, nature: 'MARGIN' }),
    ])
    expect(ledger.summary.feesTax).toBe(362)
    expect(ledger.summary.feesBrokerage).toBe(97)
  })

  it('沒有標記時與現行推測結果完全相同', () => {
    const withoutLabel = computeLedger([
      tx({ date: '2026-08-18', market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 362 }),
    ])
    expect(withoutLabel.summary.feesTax).toBe(282)
    expect(withoutLabel.summary.feesBrokerage).toBe(80)
  })
})

describe('splitFeeTax — 匯出用的費用拆分（Task 137 §C）', () => {
  it('買進全額算手續費，證交稅 0', () => {
    expect(splitFeeTax({ tx_type: 'BUY', market: 'TPE', ticker: '2344', price: 187.5, qty: 1000, fee_tax: 80 })).toEqual({ fee: 80, tax: 0, borrow: 0 })
  })

  it('一般賣出依標準稅率拆分', () => {
    expect(splitFeeTax({ tx_type: 'SELL', market: 'TPE', ticker: '2330', price: 2415, qty: 50, fee_tax: 413 })).toEqual({ fee: 51, tax: 362, borrow: 0 })
  })

  it('當沖賣出依減半稅率拆分', () => {
    expect(splitFeeTax({ tx_type: 'SELL', market: 'TPE', ticker: '2344', price: 188.5, qty: 1000, fee_tax: 362 })).toEqual({ fee: 80, tax: 282, borrow: 0 })
  })

  it('標記為當沖時以標記為準', () => {
    expect(splitFeeTax({ tx_type: 'SELL', market: 'TPE', ticker: '2344', price: 188.5, qty: 1000, fee_tax: 700, tx_nature: 'DAY_TRADE' })).toEqual({ fee: 418, tax: 282, borrow: 0 })
  })

  it('美股沒有證交稅', () => {
    expect(splitFeeTax({ tx_type: 'SELL', market: 'US', ticker: 'AAPL', price: 180, qty: 10, fee_tax: 1 })).toEqual({ fee: 1, tax: 0, borrow: 0 })
  })
})

describe('inferTxFeeRate — 歷史紀錄手續費率自動推導', () => {
  it('00685L 牌告 0.1425% (459元) 自動推導為 0.001425 並正確估算未實現損益 -28,295', () => {
    const ledger = computeLedger([
      tx({
        date: '2026-06-23',
        market: 'TPE',
        ticker: '00685L',
        name: '群益臺灣加權正2',
        type: 'BUY',
        price: 13.44,
        qty: 24000,
        fee: 459, // 歷史交易無 fee_rate 欄位
      }),
    ])

    const h = ledger.holdings[0]
    expect(h.openLots[0].feeRate).toBe(0.001425)

    // 全域工作區設為 3 折 (0.0004275)，但 00685L 應優先使用推導出的 0.001425 牌告費率
    const unrealized = estimateUnrealized(h, 12.31, 0.0004275)
    expect(unrealized).toBe(-28295)
    const roi = unrealized / h.cost
    expect(roi).toBeCloseTo(-0.087595, 4) // -8.76%
  })

  it('3 折交易 (137元) 自動推導為 0.0004275', () => {
    const ledger = computeLedger([
      tx({
        date: '2026-06-23',
        market: 'TPE',
        ticker: '00685L',
        type: 'BUY',
        price: 13.44,
        qty: 24000,
        fee: 137,
      }),
    ])

    const h = ledger.holdings[0]
    expect(h.openLots[0].feeRate).toBe(0.0004275)
  })
})

describe('當日放空 / 當沖先賣後買撮合（Day-Trade Short-First Matching, Plan A）', () => {
  it('當日先賣後買（當沖放空平倉）：損益正確計算，庫存歸零，無超賣警告', () => {
    // 09:10 賣出 1000 股 @ 1000（當沖，fee_tax = 1425 費 + 1500 減半稅 = 2925，實收 997,075）
    // 13:20 買入 1000 股 @ 990（當沖，fee_tax = 1410 費，總成本 991,410）
    // 損益 = 997,075 - 991,410 = +5,665
    const sellTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 1000, qty: 1000, fee: 2925, nature: 'DAY_TRADE' })
    const buyTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 990, qty: 1000, fee: 1410, nature: 'DAY_TRADE' })

    // Note: sellTx is created before buyTx (seq of sell < seq of buy)
    const ledger = computeLedger([sellTx, buyTx])

    expect(ledger.warnings).toHaveLength(0) // No oversold warning!
    expect(ledger.holdings).toHaveLength(0) // Position fully closed!

    const pos = ledger.positions['TPE:2330']
    expect(pos.qty).toBe(0)
    expect(pos.cost).toBe(0)
    expect(pos.realized).toBe(5665)

    const y = ledger.yearly[2026]
    expect(y.realizedTw).toBe(5665)
    expect(y.buyAmt).toBe(991410)
    expect(y.sellAmt).toBe(997075)
    expect(y.costBasis).toBe(991410)

    const yt = y.tickers['TPE:2330']
    expect(yt.realized).toBe(5665)
    expect(yt.sells).toHaveLength(1)
    expect(yt.sells[0].realized).toBe(5665)
    expect(yt.sells[0].costBasis).toBe(991410)
    expect(yt.sells[0].oversold).toBe(false)
  })

  it('既有波段持股 + 當日當沖先賣後買：當沖獨立結算，原波段持股成本不受污染', () => {
    // 歷史持有：2026-08-01 買進 1000 股 @ 800，手續費 1140（成本 801,140，均價 801.14）
    // 2026-09-01 09:10 賣出 1000 股 @ 1000（當沖，實收 997,075）
    // 2026-09-01 13:20 買入 1000 股 @ 990（當沖，成本 991,410）
    const holdTx = tx({ date: '2026-08-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 800, qty: 1000, fee: 1140, nature: 'SPOT' })
    const sellTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 1000, qty: 1000, fee: 2925, nature: 'DAY_TRADE' })
    const buyTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 990, qty: 1000, fee: 1410, nature: 'DAY_TRADE' })

    const ledger = computeLedger([holdTx, sellTx, buyTx])

    expect(ledger.warnings).toHaveLength(0)
    expect(ledger.holdings).toHaveLength(1)

    const h = ledger.holdings[0]
    expect(h.qty).toBe(1000)
    // 原有 800 元持股成本完全保留！未被當沖均化或吃掉
    expect(h.cost).toBe(801140)
    expect(h.avgCost).toBe(801.14)
    expect(h.openLots).toHaveLength(1)
    expect(h.openLots[0].price).toBe(800)

    const y2026 = ledger.yearly[2026]
    expect(y2026.realizedTw).toBe(5665)
  })

  it('當日當沖放空部分回補：已回補部分結算當沖，未回補部分依庫存/超賣處理', () => {
    // 09:10 賣出 1000 股 @ 1000（當沖，實收 997,075）
    // 13:20 買回 600 股 @ 990（當沖，成本 594,846 = 594000 + 846）
    // 600 股當沖實收 = 997075 * 0.6 = 598245, 成本 = 594846 -> 損益 = +3399
    // 剩餘 400 股無庫存 -> 產生超賣警告
    const sellTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 1000, qty: 1000, fee: 2925, nature: 'DAY_TRADE' })
    const buyTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 990, qty: 600, fee: 846, nature: 'DAY_TRADE' })

    const ledger = computeLedger([sellTx, buyTx])
    expect(ledger.warnings).toHaveLength(1)
    expect(ledger.warnings[0]).toContain('超賣')
    expect(ledger.holdings).toHaveLength(0)
    expect(ledger.yearly[2026].realizedTw).toBe(598245 - 594846 + (997075 * 0.4 - 0))
  })
})



/**
 * BUG-071: `YearlyPage` renders one `<tr key={sell.txId}>` per `SellDetail`, and it labels every
 * one of them 「賣出」. Neither holds.
 *
 * (a) One transaction can produce several `SellDetail` rows — the day-trade matcher pushes one per
 *     matched buy, and any residual falls through to the ordinary sell branch and pushes again —
 *     so `txId` is not a key. The fixture below is the project's own oversold day-trade case.
 * (b) A 融券回補 is a BUY that closes a short, and it lands in the same `yt.sells` array as an
 *     ordinary sell with nothing on the record to tell them apart, so the screen calls a buy a sell.
 */
describe('SellDetail 的唯一鍵與方向標記 (BUG-071)', () => {
  it('同一筆交易拆成多列時，每列有唯一的 legId', () => {
    const sellTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 1000, qty: 1000, fee: 2925, nature: 'DAY_TRADE' })
    const buyTx = tx({ date: '2026-09-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 990, qty: 600, fee: 846, nature: 'DAY_TRADE' })

    const sells = computeLedger([sellTx, buyTx]).yearly[2026].tickers['TPE:2330'].sells
    // 同一個 txId 出現兩次：當沖配對 600 股，剩餘 400 股走一般賣出分支
    expect(sells.filter((s) => s.txId === sellTx.id)).toHaveLength(2)
    const legIds = sells.map((s) => s.legId)
    expect(new Set(legIds).size).toBe(legIds.length)
    expect(legIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })

  it('融券回補標記為 SHORT_COVER，現股賣出標記為 SELL', () => {
    const openShort = tx({ date: '2026-03-01', market: 'TPE', ticker: '2603', type: 'SELL', price: 100, qty: 1000, fee: 522, nature: 'SHORT' })
    const cover = tx({ date: '2026-04-01', market: 'TPE', ticker: '2603', type: 'BUY', price: 95, qty: 1000, fee: 135, nature: 'SHORT' })
    const spotBuy = tx({ date: '2026-05-01', market: 'TPE', ticker: '2330', type: 'BUY', price: 1000, qty: 1000, fee: 1425 })
    const spotSell = tx({ date: '2026-06-01', market: 'TPE', ticker: '2330', type: 'SELL', price: 1100, qty: 1000, fee: 4867 })

    const y = computeLedger([openShort, cover, spotBuy, spotSell]).yearly[2026]
    const coverLeg = y.tickers['TPE:2603'].sells.find((s) => s.txId === cover.id)
    const sellLeg = y.tickers['TPE:2330'].sells.find((s) => s.txId === spotSell.id)
    expect(coverLeg?.kind).toBe('SHORT_COVER')
    expect(sellLeg?.kind).toBe('SELL')
  })
})

describe('融券做空（Short selling, Task 141 Stage A）', () => {
  // 2603 一般股 0.3%。1000 股 @100：手續費 142 + 證交稅 300 + 借券費 80 = 522
  const OPEN_FEE_TAX = 522
  const OPEN_PROCEEDS = 100_000 - OPEN_FEE_TAX // 99478
  // 1000 股 @95 回補：手續費 135，回補不課證交稅
  const COVER_FEE = 135
  const COVER_COST = 95_000 + COVER_FEE // 95135

  const short = (input: { date: string; type: TxType; price: number; qty: number; fee: number }) =>
    tx({ market: 'TPE', ticker: '2603', name: '長榮', nature: 'SHORT', ...input })

  it('splitFeeTax 對融券賣出拆出借券費', () => {
    expect(
      splitFeeTax({
        tx_type: 'SELL', market: 'TPE', ticker: '2603',
        price: 100, qty: 1000, fee_tax: OPEN_FEE_TAX, tx_nature: 'SHORT',
      }),
    ).toEqual({ fee: 142, tax: 300, borrow: 80 })
  })

  it('非融券賣出的 borrow 一律為 0', () => {
    expect(
      splitFeeTax({
        tx_type: 'SELL', market: 'TPE', ticker: '2603',
        price: 100, qty: 1000, fee_tax: 442, tx_nature: 'SPOT',
      }),
    ).toEqual({ fee: 142, tax: 300, borrow: 0 })
  })

  it('ETF 融券賣出用 0.1% 稅率，借券費照收', () => {
    // 200000 × 0.001425 = 285；稅 200；借券費 160
    expect(
      splitFeeTax({
        tx_type: 'SELL', market: 'TPE', ticker: '0050',
        price: 200, qty: 1000, fee_tax: 645, tx_nature: 'SHORT',
      }),
    ).toEqual({ fee: 285, tax: 200, borrow: 160 })
  })

  it('只建倉：空單進持股表，不動多頭欄位，不記入年度賣出金額', () => {
    const ledger = computeLedger([
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(1000)
    expect(pos.shortProceeds).toBe(OPEN_PROCEEDS)
    expect(pos.shortRawProceeds).toBe(100_000)
    expect(pos.qty).toBe(0)
    expect(pos.cost).toBe(0)
    expect(ledger.warnings).toHaveLength(0)
    expect(ledger.holdings).toHaveLength(1)
    // qty 為 0 的純空單部位，avgCost 不得為 NaN
    expect(ledger.holdings[0].avgCost).toBe(0)
    // 建倉不記入年度賣出金額，否則年度報表的總賣出金額會被灌水
    expect(ledger.yearly[2026].sellAmt).toBe(0)
    expect(ledger.yearly[2026].sellGross).toBe(0)
    expect(ledger.yearly[2026].realizedTw).toBe(0)
  })

  it('隔日回補：實現損益 = 賣出淨收 − 回補成本，金額記在回補當年', () => {
    const ledger = computeLedger([
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
      short({ date: '2026-03-03', type: 'BUY', price: 95, qty: 1000, fee: COVER_FEE }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(0)
    expect(pos.shortLots).toHaveLength(0)
    expect(pos.shortProceeds).toBe(0)
    expect(pos.realized).toBe(OPEN_PROCEEDS - COVER_COST) // 4343
    expect(ledger.warnings).toHaveLength(0)
    expect(ledger.holdings).toHaveLength(0)

    const y = ledger.yearly[2026]
    expect(y.realizedTw).toBe(OPEN_PROCEEDS - COVER_COST)
    expect(y.sellAmt).toBe(OPEN_PROCEEDS)
    expect(y.costBasis).toBe(COVER_COST)
    // 回補是平倉，不是進貨；計入 buyAmt 會與 costBasis 重複計算
    expect(y.buyAmt).toBe(0)
  })

  it('同日建倉又回補仍用全額證交稅，不走當沖路徑', () => {
    const ledger = computeLedger([
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
      short({ date: '2026-03-02', type: 'BUY', price: 95, qty: 1000, fee: COVER_FEE }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(0)
    expect(pos.realized).toBe(OPEN_PROCEEDS - COVER_COST)
    expect(ledger.warnings).toHaveLength(0)
  })

  it('部分回補：已回補部分結算，剩餘空單維持', () => {
    // 2000 股 @100：手續費 285 + 稅 600 + 借券費 160 = 1045；淨收 198955
    const ledger = computeLedger([
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 2000, fee: 1045 }),
      short({ date: '2026-03-03', type: 'BUY', price: 95, qty: 1000, fee: COVER_FEE }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(1000)
    expect(pos.shortProceeds).toBeCloseTo(99_477.5, 6)
    expect(pos.realized).toBeCloseTo(99_477.5 - COVER_COST, 6) // 4342.5
    expect(ledger.warnings).toHaveLength(0)
  })

  it('超補：多買的部分視為現股買進並發警告', () => {
    // 1500 股 @95 = 142500，手續費 floor(142500 × 0.001425) = 203
    const ledger = computeLedger([
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
      short({ date: '2026-03-03', type: 'BUY', price: 95, qty: 1500, fee: 203 }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(0)
    expect(pos.qty).toBe(500)
    expect(pos.cost).toBeCloseTo((142_500 + 203) * (500 / 1500), 6) // 47567.667
    expect(pos.realized).toBeCloseTo(OPEN_PROCEEDS - (142_500 + 203) * (1000 / 1500), 6)
    expect(ledger.warnings).toHaveLength(1)
    expect(ledger.warnings[0]).toContain('超出部分視為現股買進')
  })

  it('波段持股不被空單吃掉，也不觸發超賣警告', () => {
    // 1000 股 @90 買進，手續費 floor(90000 × 0.001425) = 128
    const ledger = computeLedger([
      tx({ date: '2026-03-01', market: 'TPE', ticker: '2603', name: '長榮', type: 'BUY', price: 90, qty: 1000, fee: 128, nature: 'SPOT' }),
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.qty).toBe(1000)
    expect(pos.cost).toBe(90_128)
    expect(pos.openLots).toHaveLength(1)
    expect(pos.shortQty).toBe(1000)
    expect(ledger.warnings).toHaveLength(0)
    expect(ledger.holdings).toHaveLength(1)
    expect(ledger.holdings[0].avgCost).toBeCloseTo(90.128, 6)
  })

  it('同日有當沖買進時，融券賣出不得被當沖撮合吃掉', () => {
    // 當沖買進 1000 @90（當日沒有對應的當沖賣出），同日另有融券賣出 1000 @100。
    // 當沖撮合的候選清單在 fallback 時不得把融券賣出算進去。
    const ledger = computeLedger([
      tx({ date: '2026-03-02', market: 'TPE', ticker: '2603', name: '長榮', type: 'BUY', price: 90, qty: 1000, fee: 128, nature: 'DAY_TRADE' }),
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(1000)
    expect(pos.shortProceeds).toBe(OPEN_PROCEEDS)
    // 沒被沖銷的當沖買進留成一般部位
    expect(pos.qty).toBe(1000)
    expect(pos.cost).toBe(90_128)
    expect(pos.realized).toBe(0)
  })

  it('同日有當沖賣出時，融券回補不得被當沖撮合吃掉', () => {
    // 當沖賣出 1000 @105（當日沒有對應的當沖買進），同日另有融券回補 1000 @95。
    const ledger = computeLedger([
      tx({ date: '2026-03-01', market: 'TPE', ticker: '2603', name: '長榮', type: 'BUY', price: 90, qty: 1000, fee: 128, nature: 'SPOT' }),
      short({ date: '2026-03-01', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
      tx({ date: '2026-03-02', market: 'TPE', ticker: '2603', name: '長榮', type: 'SELL', price: 105, qty: 1000, fee: 306, nature: 'DAY_TRADE' }),
      short({ date: '2026-03-02', type: 'BUY', price: 95, qty: 1000, fee: COVER_FEE }),
    ])
    const pos = ledger.positions['TPE:2603']
    expect(pos.shortQty).toBe(0)
    expect(pos.qty).toBe(0)
    // 當沖賣出對到波段持股：(105000 − 306) − 90128 = 14566；融券回補：99478 − 95135 = 4343
    expect(pos.realized).toBe(14_566 + (OPEN_PROCEEDS - COVER_COST))
    expect(ledger.warnings).toHaveLength(0)
  })

  it('estimateUnrealizedShort：回補只算手續費，不算證交稅', () => {
    const ledger = computeLedger([
      short({ date: '2026-03-02', type: 'SELL', price: 100, qty: 1000, fee: OPEN_FEE_TAX }),
    ])
    expect(estimateUnrealizedShort(ledger.holdings[0], 95, 0.001425, 20)).toBe(
      OPEN_PROCEEDS - 95_000 - COVER_FEE,
    )
  })
})

describe('BUG-049 同日同 created_at 的排序決勝：開倉腿必須先於平倉腿', () => {
  // A bulk CSV import writes one created_at for every row, so tx_date and created_at both
  // tie. PostgreSQL's sort is not stable, so PostgREST can return the SELL first;
  // Array.sort is stable and preserves that order. The engine must break the tie itself.
  const SAME = '2026-09-01T02:50:16.337075Z'

  it('賣出排在買進之前時，不得誤判超賣', () => {
    const sell = { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '3037', type: 'SELL', price: 915, qty: 50, fee: 202 }), created_at: SAME }
    const buy = { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '3037', type: 'BUY', price: 840, qty: 50, fee: 59 }), created_at: SAME }

    const ledger = computeLedger([sell, buy])

    // Cost = 840*50+59 = 42,059; revenue = 915*50-202 = 45,548; realized = 3,489
    expect(ledger.warnings).toEqual([])
    expect(ledger.holdings).toHaveLength(0)
    expect(ledger.summary.realizedTw).toBeCloseTo(3489, 6)
  })

  it('相同順序下的結果與買進排在前面時完全一致', () => {
    const mk = () => [
      { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '3037', type: 'SELL', price: 915, qty: 50, fee: 202 }), created_at: SAME },
      { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '3037', type: 'BUY', price: 840, qty: 50, fee: 59 }), created_at: SAME },
    ]
    const [s, b] = mk()
    const sellFirst = computeLedger([s, b])
    const [s2, b2] = mk()
    const buyFirst = computeLedger([b2, s2])

    expect(sellFirst.summary.realizedTw).toBeCloseTo(buyFirst.summary.realizedTw, 6)
    expect(sellFirst.warnings).toEqual(buyFirst.warnings)
  })

  it('融券：回補排在放空之前時，不得誤判超額回補', () => {
    const cover = { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '2303', type: 'BUY', price: 90, qty: 1000, nature: 'SHORT' }), created_at: SAME }
    const open = { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '2303', type: 'SELL', price: 100, qty: 1000, nature: 'SHORT' }), created_at: SAME }

    const ledger = computeLedger([cover, open])

    expect(ledger.warnings).toEqual([])
    expect(ledger.holdings).toHaveLength(0)
    expect(ledger.summary.realizedTw).toBeCloseTo(10000, 6)
  })
})

describe('BUG-049 compareTxOrder：列表與匯出共用引擎的排序規則', () => {
  const SAME = '2026-09-01T02:50:16.337075Z'
  const sell = { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '3037', type: 'SELL', price: 915, qty: 50 }), id: 'zzz', created_at: SAME }
  const buy = { ...tx({ date: '2026-04-28', market: 'TPE', ticker: '3037', type: 'BUY', price: 840, qty: 50 }), id: 'aaa', created_at: SAME }

  it('同日同 created_at 時，開倉腿排在前面', () => {
    expect([sell, buy].slice().sort(compareTxOrder).map((t) => t.tx_type)).toEqual(['BUY', 'SELL'])
  })

  it('日期不同時，仍以日期為主', () => {
    const older = { ...tx({ date: '2026-04-27', market: 'TPE', ticker: '3037', type: 'SELL', price: 900, qty: 10 }), id: 'zzz', created_at: SAME }
    expect([buy, older].slice().sort(compareTxOrder)[0].tx_date).toBe('2026-04-27')
  })

  it('同側時以 id 收尾，結果穩定', () => {
    const b2 = { ...buy, id: 'bbb' }
    expect([b2, buy].slice().sort(compareTxOrder).map((t) => t.id)).toEqual(['aaa', 'bbb'])
  })
})
