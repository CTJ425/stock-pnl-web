/**
 * 手續費 / 證交稅估算（移植自 GAS 版 Sidebar.html 的 calculateFee）：
 * - 台股：券商手續費「元以下無條件捨去」；賣出加計證交稅（同樣捨去到元）
 * - 美股：保留兩位小數
 */
import type { Market, TxType } from '../types/models'
import { floorSafe, sellTaxRate } from './pnlEngine'

/** 台股法定標準手續費率 0.1425% */
export const DEFAULT_FEE_RATE = 0.001425

export interface FeeInput {
  market: Market
  txType: TxType
  price: number
  qty: number
  feeRate: number
  /** 台股賣出證交稅率；未提供時依代號自動判斷（ETF 00 開頭 0.1%，其餘 0.3%） */
  taxRate?: number
  ticker?: string
}

export function calculateFee(input: FeeInput): number {
  const { market, txType, price, qty, feeRate } = input
  if (!(price > 0) || !(qty > 0) || !(feeRate >= 0)) return 0
  const amount = price * qty

  if (market === 'TPE') {
    let fee = floorSafe(amount * feeRate)
    if (txType === 'SELL') {
      const taxRate = input.taxRate ?? sellTaxRate(input.ticker ?? '')
      fee += floorSafe(amount * taxRate)
    }
    return fee
  }
  return parseFloat((amount * feeRate).toFixed(2))
}
