import { describe, expect, it } from 'vitest'
import { calculateFee, DEFAULT_FEE_RATE } from './fees'

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
})
