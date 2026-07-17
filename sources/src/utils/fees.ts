/**
 * 手續費 / 證交稅估算（移植自 GAS 版 Sidebar.html 的 calculateFee）：
 * - 台股：券商手續費「元以下無條件捨去」，可套用單筆最低手續費（整股常見 20 元、零股 1 元）；
 *   賣出加計證交稅（同樣捨去到元）
 * - 美股：保留兩位小數
 */
import type { Market, Transaction, TxType } from '../types/models'
import type { Holding } from './pnlEngine'
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
  /** 台股單筆最低手續費（元）；feeRate 為 0（免佣）時不套用 */
  minFee?: number
}

export function calculateFee(input: FeeInput): number {
  const { market, txType, price, qty, feeRate } = input
  if (!(price > 0) || !(qty > 0) || !(feeRate >= 0)) return 0
  const amount = price * qty

  if (market === 'TPE') {
    let fee = floorSafe(amount * feeRate)
    if (feeRate > 0 && input.minFee !== undefined && input.minFee > fee) fee = input.minFee
    if (txType === 'SELL') {
      const taxRate = input.taxRate ?? sellTaxRate(input.ticker ?? '')
      fee += floorSafe(amount * taxRate)
    }
    return fee
  }
  return parseFloat((amount * feeRate).toFixed(2))
}

export interface FeeCorrection {
  tx: Transaction
  /** 依目前費率設定重新估算的手續費（賣出含證交稅） */
  newFee: number
}

/**
 * 找出手續費與「目前費率設定」不符的台股交易，供批次修正。
 * - 僅台股：美股各券商收費結構差異大（免佣 / 固定費 / SEC fee），不納入批次重算
 * - 賣出證交稅依代號自動判斷（ETF 0.1%、債券 ETF 0%、其餘 0.3%）；
 *   當沖等特殊稅率的交易重算會不準，由使用者在預覽中取消勾選或個別編輯
 */
export function proposeFeeCorrections(
  transactions: Transaction[],
  opts: { feeRate: number; minFeeWhole: number; minFeeOdd: number },
): FeeCorrection[] {
  const out: FeeCorrection[] = []
  for (const tx of transactions) {
    if (tx.market !== 'TPE' || !(tx.price > 0) || !(tx.qty > 0)) continue
    const newFee = calculateFee({
      market: tx.market,
      txType: tx.tx_type,
      price: tx.price,
      qty: tx.qty,
      feeRate: opts.feeRate,
      taxRate: sellTaxRate(tx.ticker),
      minFee: tx.qty >= 1000 ? opts.minFeeWhole : opts.minFeeOdd,
    })
    if (newFee !== tx.fee_tax) out.push({ tx, newFee })
  }
  return out
}

/**
 * 保本賣出價（損益平衡價）：以此價全數賣出時「實收金額 ≥ 目前部位成本」的最低價（0.01 刻度）。
 * 先用封閉式解出候選價（比例費率與最低手續費兩種情形取較高者），
 * 再以 calculateFee 實算雙向收斂——floor 到元與最低手續費會造成封閉式的邊界誤差，
 * 不足時往上補、有餘裕時往下找最低，保證回傳「賣出必不虧的最低價」。
 */
export function breakEvenPrice(holding: Holding, feeRate: number, minFee?: number): number {
  const { qty, cost, market, ticker } = holding
  if (!(qty > 0) || !(cost > 0)) return 0
  const taxRate = market === 'TPE' ? sellTaxRate(ticker) : 0

  const isBreakEven = (p: number) =>
    p * qty - calculateFee({ market, txType: 'SELL', price: p, qty, feeRate, taxRate, minFee }) >= cost

  const byRate = cost / (qty * (1 - feeRate - taxRate))
  // feeRate 為 0（免佣）時 calculateFee 不套最低手續費，封閉式同步略過
  const byMinFee = (cost + (feeRate > 0 ? minFee ?? 0 : 0)) / (qty * (1 - taxRate))
  let price = Math.floor(Math.max(byRate, byMinFee) * 100) / 100

  for (let i = 0; i < 1000 && !isBreakEven(price); i++) {
    price = Math.round(price * 100 + 1) / 100
  }
  for (let i = 0; i < 1000; i++) {
    const lower = Math.round(price * 100 - 1) / 100
    if (!(lower > 0) || !isBreakEven(lower)) break
    price = lower
  }
  return price
}
