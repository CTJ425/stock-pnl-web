import { describe, expect, it } from 'vitest'
import type { Holding } from './pnlEngine'
import type { Transaction, TxNature, TxType } from '../types/models'
import { breakEvenPrice, calculateFee, DEFAULT_FEE_RATE, proposeFeeCorrections } from './fees'

describe('calculateFee（與 GAS Sidebar calculateFee 同構）', () => {
  it('台股買入：手續費元以下無條件捨去', () => {
    // 500*1000*0.001425 = 712.5 → 712
    expect(
      calculateFee({ market: 'TPE', txType: 'BUY', price: 500, qty: 1000, feeRate: DEFAULT_FEE_RATE }),
    ).toBe(712)
  })

  it('台股賣出：加計證交稅（一般股票 0.3%），分項捨去', () => {
    // fee = floor(700*500*0.001425) = floor(498.75) = 498
    // tax = floor(350000*0.003) = 1050 → 1548
    expect(
      calculateFee({ market: 'TPE', txType: 'SELL', price: 700, qty: 500, feeRate: DEFAULT_FEE_RATE, ticker: '2330' }),
    ).toBe(1548)
  })

  it('台股賣出 ETF（00 開頭）：證交稅率自動 0.1%', () => {
    // fee = floor(100*1000*0.001425) = 142；tax = floor(100000*0.001) = 100
    expect(
      calculateFee({ market: 'TPE', txType: 'SELL', price: 100, qty: 1000, feeRate: DEFAULT_FEE_RATE, ticker: '0050' }),
    ).toBe(242)
  })

  it('台股賣出：可用自訂稅率覆蓋自動判斷', () => {
    expect(
      calculateFee({ market: 'TPE', txType: 'SELL', price: 100, qty: 1000, feeRate: DEFAULT_FEE_RATE, ticker: '2330', taxRate: 0.001 }),
    ).toBe(242)
  })

  it('美股：保留兩位小數，不計證交稅', () => {
    expect(
      calculateFee({ market: 'US', txType: 'SELL', price: 200, qty: 10, feeRate: DEFAULT_FEE_RATE }),
    ).toBeCloseTo(2.85, 2)
  })

  it('無效輸入回傳 0', () => {
    expect(calculateFee({ market: 'TPE', txType: 'BUY', price: 0, qty: 1000, feeRate: DEFAULT_FEE_RATE })).toBe(0)
    expect(calculateFee({ market: 'TPE', txType: 'BUY', price: 100, qty: 0, feeRate: DEFAULT_FEE_RATE })).toBe(0)
  })

  it('台股最低手續費：不足下限時收下限（整股 20 元）', () => {
    // 50*100*0.001425 = 7.125 → floor 7 → minimum 20
    expect(
      calculateFee({ market: 'TPE', txType: 'BUY', price: 50, qty: 100, feeRate: DEFAULT_FEE_RATE, minFee: 20 }),
    ).toBe(20)
  })

  it('台股最低手續費：零股下限 1 元', () => {
    // 10*10*0.001425 = 0.1425 → floor 0 → lowest 1
    expect(
      calculateFee({ market: 'TPE', txType: 'BUY', price: 10, qty: 10, feeRate: DEFAULT_FEE_RATE, minFee: 1 }),
    ).toBe(1)
  })

  it('台股最低手續費：費率為 0（免佣）時不套用下限', () => {
    expect(calculateFee({ market: 'TPE', txType: 'BUY', price: 50, qty: 100, feeRate: 0, minFee: 20 })).toBe(0)
  })

  it('台股賣出：最低手續費與證交稅分項計算', () => {
    // fee = max(floor(50*100*0.001425), 20) = 20；tax = floor(5000*0.003) = 15
    expect(
      calculateFee({ market: 'TPE', txType: 'SELL', price: 50, qty: 100, feeRate: DEFAULT_FEE_RATE, ticker: '2330', minFee: 20 }),
    ).toBe(35)
  })

  it('台股手續費超過下限時不受 minFee 影響', () => {
    expect(
      calculateFee({ market: 'TPE', txType: 'BUY', price: 500, qty: 1000, feeRate: DEFAULT_FEE_RATE, minFee: 20 }),
    ).toBe(712)
  })
})

function holdingOf(input: Partial<Holding> & Pick<Holding, 'ticker' | 'market' | 'qty' | 'cost'>): Holding {
  return {
    key: `${input.market}:${input.ticker}`,
    name: input.ticker,
    currency: input.market === 'TPE' ? 'TWD' : 'USD',
    rawCost: input.cost,
    buyCostTotal: input.cost,
    realized: 0,
    avgCost: input.cost / input.qty,
    rawAvgCost: input.cost / input.qty,
    // breakEvenPrice 不看未沖銷批次；合成部位給空陣列即可
    openLots: [],
    ...input,
  }
}

describe('breakEvenPrice（保本賣出價）', () => {
  it('台股 ETF：對照 bug_fix 0050 案例（成本 102,440 → 102.69）', () => {
    const h = holdingOf({ market: 'TPE', ticker: '0050', qty: 1000, cost: 102440 })
    const p = breakEvenPrice(h, DEFAULT_FEE_RATE)
    // 102.69 Sell: 102,690 - fee 146 - tax 102 = 102,442 ≥ 102,440; 102.68, leaving only 102,432, no capital guarantee
    expect(p).toBe(102.69)
    const fee = calculateFee({ market: 'TPE', txType: 'SELL', price: p, qty: 1000, feeRate: DEFAULT_FEE_RATE, ticker: '0050' })
    expect(p * 1000 - fee).toBeGreaterThanOrEqual(102440)
    const feeLower = calculateFee({ market: 'TPE', txType: 'SELL', price: 102.68, qty: 1000, feeRate: DEFAULT_FEE_RATE, ticker: '0050' })
    expect(102.68 * 1000 - feeLower).toBeLessThan(102440)
  })

  it('極小部位＋最低手續費：qty=1 也收斂到正確最低保本價', () => {
    // P - max(floor(P*0.001425), 20) - floor(P*0.003) ≥ 100 → minimum P = 120.00
    const h = holdingOf({ market: 'TPE', ticker: '2330', qty: 1, cost: 100 })
    expect(breakEvenPrice(h, DEFAULT_FEE_RATE, 20)).toBe(120)
  })

  it('最低手續費會墊高小額部位的保本價', () => {
    const h = holdingOf({ market: 'TPE', ticker: '2330', qty: 10, cost: 5000 })
    const noMin = breakEvenPrice(h, DEFAULT_FEE_RATE)
    const withMin = breakEvenPrice(h, DEFAULT_FEE_RATE, 20)
    expect(withMin).toBeGreaterThan(noMin)
    const fee = calculateFee({ market: 'TPE', txType: 'SELL', price: withMin, qty: 10, feeRate: DEFAULT_FEE_RATE, ticker: '2330', minFee: 20 })
    expect(withMin * 10 - fee).toBeGreaterThanOrEqual(5000)
  })

  it('債券 ETF（B 結尾）免證交稅，保本價低於一般 ETF', () => {
    const bond = holdingOf({ market: 'TPE', ticker: '00679B', qty: 1000, cost: 30000 })
    const etf = holdingOf({ market: 'TPE', ticker: '0050', qty: 1000, cost: 30000 })
    expect(breakEvenPrice(bond, DEFAULT_FEE_RATE)).toBeLessThan(breakEvenPrice(etf, DEFAULT_FEE_RATE))
  })

  it('美股：無證交稅、費率兩位小數', () => {
    const h = holdingOf({ market: 'US', ticker: 'AAPL', qty: 10, cost: 1000 })
    const p = breakEvenPrice(h, DEFAULT_FEE_RATE)
    const fee = calculateFee({ market: 'US', txType: 'SELL', price: p, qty: 10, feeRate: DEFAULT_FEE_RATE })
    expect(p * 10 - fee).toBeGreaterThanOrEqual(1000)
  })

  it('空部位回傳 0', () => {
    const h = holdingOf({ market: 'TPE', ticker: '2330', qty: 0, cost: 0 })
    expect(breakEvenPrice(h, DEFAULT_FEE_RATE)).toBe(0)
  })
})

let txSeq = 0
function txOf(input: {
  market: 'TPE' | 'US'
  ticker: string
  type: TxType
  price: number
  qty: number
  fee: number
  nature?: TxNature
}): Transaction {
  txSeq++
  return {
    id: `tx-${txSeq}`,
    workspace_id: 'ws-1',
    tx_date: '2024-01-01',
    market: input.market,
    ticker: input.ticker,
    name: input.ticker,
    tx_type: input.type,
    price: input.price,
    qty: input.qty,
    fee_tax: input.fee,
    tx_nature: input.nature,
    created_at: '2024-01-01T00:00:00Z',
  }
}

describe('proposeFeeCorrections（批次重算手續費）', () => {
  const opts = { feeRate: 0.0004, minFeeWhole: 20, minFeeOdd: 1 }

  it('找出與目前費率不符的台股交易並附上重算值', () => {
    // 102.4*1000*0.0004 = 40.96 → floor 40; original record 80 → needs to be corrected
    const wrong = txOf({ market: 'TPE', ticker: '0050', type: 'BUY', price: 102.4, qty: 1000, fee: 80 })
    // Correctly not included
    const right = txOf({ market: 'TPE', ticker: '0050', type: 'BUY', price: 102.4, qty: 1000, fee: 40 })
    const out = proposeFeeCorrections([wrong, right], opts)
    expect(out).toHaveLength(1)
    expect(out[0].tx.id).toBe(wrong.id)
    expect(out[0].newFee).toBe(40)
  })

  it('賣出重算含證交稅，稅率依代號判斷（債券 ETF 免稅）', () => {
    // General stocks: fee = max(floor(100000*0.0004), 20) = 40; tax = floor(100000*0.003) = 300 → 340
    const sell = txOf({ market: 'TPE', ticker: '2330', type: 'SELL', price: 100, qty: 1000, fee: 0 })
    // Bond ETF: fee = 40; tax = 0 → 40
    const bond = txOf({ market: 'TPE', ticker: '00679B', type: 'SELL', price: 100, qty: 1000, fee: 0 })
    const out = proposeFeeCorrections([sell, bond], opts)
    expect(out.find((c) => c.tx.id === sell.id)?.newFee).toBe(340)
    expect(out.find((c) => c.tx.id === bond.id)?.newFee).toBe(40)
  })

  it('零股套用零股最低手續費', () => {
    // 50*10*0.0004 = 0.2 → floor 0 → lowest 1
    const odd = txOf({ market: 'TPE', ticker: '2330', type: 'BUY', price: 50, qty: 10, fee: 7 })
    const out = proposeFeeCorrections([odd], opts)
    expect(out[0].newFee).toBe(1)
  })

  it('美股不納入批次重算', () => {
    const us = txOf({ market: 'US', ticker: 'AAPL', type: 'BUY', price: 100, qty: 10, fee: 999 })
    expect(proposeFeeCorrections([us], opts)).toHaveLength(0)
  })
})

describe('proposeFeeCorrections 不覆蓋當沖賣出（Task 137）', () => {
  // Ronlin 匯出檔的實際費率（3 折）
  const opts = { feeRate: 0.0004275, minFeeWhole: 20, minFeeOdd: 1 }

  it('當沖賣出不提案，避免被改成兩倍證交稅', () => {
    // 2344 2026-08-18：362 = 減半稅 282 + 手續費 80；一般稅率會算成 645（多課 283）
    const a = txOf({ market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 362 })
    // 2303 2026-08-24：237 = 減半稅 185 + 手續費 52；一般稅率會算成 422
    const b = txOf({ market: 'TPE', ticker: '2303', type: 'SELL', price: 123.5, qty: 1000, fee: 237 })
    expect(proposeFeeCorrections([a, b], opts)).toEqual([])
  })

  it('當日進出但課一般稅率者不算當沖，記錯仍要提案', () => {
    // 2330 2026-05-20 當日進出，413 = 一般稅 362 + 手續費 51 —— 只用「同日買賣」判斷會誤殺
    const correct = txOf({ market: 'TPE', ticker: '2330', type: 'SELL', price: 2415, qty: 50, fee: 413 })
    expect(proposeFeeCorrections([correct], opts)).toEqual([])

    const wrong = txOf({ market: 'TPE', ticker: '2330', type: 'SELL', price: 2415, qty: 50, fee: 400 })
    const out = proposeFeeCorrections([wrong], opts)
    expect(out).toHaveLength(1)
    expect(out[0].newFee).toBe(413)
  })

  it('ETF 賣出漏記費用仍會提案，不因金額低於一般稅而被當成當沖', () => {
    // 0050 正確值 147。記成 0 時金額確實低於一般稅 310，
    // 但殘差對不上手續費，所以不是當沖 —— 用固定 0.003 當門檻會把每一筆 ETF 都放過
    const zero = txOf({ market: 'TPE', ticker: '0050', type: 'SELL', price: 103.5, qty: 1000, fee: 0 })
    const out = proposeFeeCorrections([zero], opts)
    expect(out).toHaveLength(1)
    expect(out[0].newFee).toBe(147)
  })

  it('買進不套用當沖判定', () => {
    const buy = txOf({ market: 'TPE', ticker: '2344', type: 'BUY', price: 187.5, qty: 1000, fee: 10 })
    const out = proposeFeeCorrections([buy], opts)
    expect(out).toHaveLength(1)
    expect(out[0].newFee).toBe(80)
  })
})

describe('breakEvenPrice 零成本持股（BUG-038）', () => {
  it('成本 0（全數來自股票股利）仍算得出覆蓋手續費與證交稅的最低價', () => {
    const h = holdingOf({ market: 'TPE', ticker: '0050', qty: 1000, cost: 0 })
    const p = breakEvenPrice(h, DEFAULT_FEE_RATE, 20)
    expect(p).toBe(0.02)
    const fee = calculateFee({
      market: 'TPE', txType: 'SELL', price: p, qty: 1000,
      feeRate: DEFAULT_FEE_RATE, ticker: '0050', minFee: 20,
    })
    expect(p * 1000 - fee).toBeGreaterThanOrEqual(0)
    // 再低一檔就不保本
    const lowerFee = calculateFee({
      market: 'TPE', txType: 'SELL', price: 0.01, qty: 1000,
      feeRate: DEFAULT_FEE_RATE, ticker: '0050', minFee: 20,
    })
    expect(0.01 * 1000 - lowerFee).toBeLessThan(0)
  })

  it('沒有部位（qty 0）仍回傳 0', () => {
    const h = holdingOf({ market: 'TPE', ticker: '0050', qty: 0, cost: 0 })
    expect(breakEvenPrice(h, DEFAULT_FEE_RATE, 20)).toBe(0)
  })
})


describe('proposeFeeCorrections 尊重明確的交易性質（Task 137 §C）', () => {
  const opts = { feeRate: 0.0004275, minFeeWhole: 20, minFeeOdd: 1 }

  it('標記為當沖者不提案，即使金額高到推測會判成一般交易', () => {
    const t = txOf({ market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 700, nature: 'DAY_TRADE' })
    expect(proposeFeeCorrections([t], opts)).toEqual([])
  })

  it('標記為現股但數字是當沖者，仍由推測擋下', () => {
    const t = txOf({ market: 'TPE', ticker: '2344', type: 'SELL', price: 188.5, qty: 1000, fee: 362, nature: 'SPOT' })
    expect(proposeFeeCorrections([t], opts)).toEqual([])
  })

  it('標記為現股且金額確實記錯者，照常提案', () => {
    const t = txOf({ market: 'TPE', ticker: '2330', type: 'SELL', price: 2415, qty: 50, fee: 400, nature: 'SPOT' })
    const out = proposeFeeCorrections([t], opts)
    expect(out).toHaveLength(1)
    expect(out[0].newFee).toBe(413)
  })
})
