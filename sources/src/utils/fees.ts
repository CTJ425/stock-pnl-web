/**
 * Handling fee/certificate tax estimate (ported from calculateFee of GAS version Sidebar.html):
 * - Taiwan stocks: Brokerage fees are "unconditionally rounded off if they are less than ¥", and the minimum single transaction fee can be applied (commonly NT$20 for a whole share and NT$1 for odd lots);
 *   Pay tax on selling additional certificates (also rounded to the nearest dollar)
 * - US stocks: round to two decimal places
 */
import type { Market, Transaction, TxType } from '../types/models'
import type { Holding } from './pnlEngine'
import { floorSafe, sellTaxRate } from './pnlEngine'

/** The legal standard handling fee for Taiwan stocks is 0.1425%*/
export const DEFAULT_FEE_RATE = 0.001425

export interface FeeInput {
  market: Market
  txType: TxType
  price: number
  qty: number
  feeRate: number
  /**
   * Securities tax rate for selling Taiwan stocks; if not provided, it will be automatically determined based on the code (0.1% starting with ETF 00, and 0.3% for the rest).
   * Contract: a SELL must supply `taxRate` or `ticker`. Supplying neither falls back to the 0.3% general-stock
   * rate, which is wrong for ETFs. All current SELL callers satisfy this (`fees.ts:63`, `fees.ts:89` and
   * `TransactionForm.tsx:108` pass `taxRate`; `whatIf.ts:46` passes `ticker`).
   */
  taxRate?: number
  /** See `taxRate` doc above for the SELL contract this field is part of. */
  ticker?: string
  /** Minimum handling fee for Taiwan stocks (yuan); not applicable when feeRate is 0 (no commission)*/
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
  /** Handling fee re-estimated based on current rate setting (sale includes certificate payment tax)*/
  newFee: number
}

/**
 * Find Taiwan stock transactions whose handling fees are inconsistent with the "current fee setting" for batch correction.
 * - Taiwan stocks only: The fee structure of each brokerage in the U.S. stock market is quite different (no commission/fixed fee/SEC fee) and is not included in the batch recalculation.
 * - The tax on selling securities is automatically determined based on the code (0.1% for ETFs, 0% for bond ETFs, and 0.3% for the rest);
 *   Recalculation of transactions with special tax rates such as hedging will not be allowed. Users can uncheck or edit individually in the preview.
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
 * Breakeven selling price (breakeven price): The lowest price (0.01 scale) when "the actual amount received ≥ the current position cost" is sold at this price.
 * First use the closed form to solve the candidate price (whichever is higher between the proportional rate and the lowest handling fee),
 * Then use calculateFee to actually calculate the two-way convergence - the floor to yuan and the minimum handling fee will cause a closed boundary error.
 * When there is a shortage, make up for it; when there is a surplus, go down to find the lowest price, and ensure that the "lowest price at which you can sell without losing money" is sent back.
 */
export function breakEvenPrice(holding: Holding, feeRate: number, minFee?: number): number {
  const { qty, cost, market, ticker } = holding
  if (!(qty > 0) || !(cost > 0)) return 0
  const taxRate = market === 'TPE' ? sellTaxRate(ticker) : 0

  const isBreakEven = (p: number) =>
    p * qty - calculateFee({ market, txType: 'SELL', price: p, qty, feeRate, taxRate, minFee }) >= cost

  const byRate = cost / (qty * (1 - feeRate - taxRate))
  // When feeRate is 0 (no commission), calculateFee does not include the minimum handling fee, and closed synchronization is skipped.
  const byMinFee = (cost + (feeRate > 0 ? minFee ?? 0 : 0)) / (qty * (1 - taxRate))
  let price = Math.floor(Math.max(byRate, byMinFee) * 100) / 100

  for (let i = 0; i < 1000 && !isBreakEven(price); i++) {
    price = Math.round(price * 100 + 1) / 100
  }
  // Non-convergence returns the same "no answer" sentinel as an empty position, rather than a price
  // that is not actually break-even (would lose money).
  if (!isBreakEven(price)) return 0
  for (let i = 0; i < 1000; i++) {
    const lower = Math.round(price * 100 - 1) / 100
    if (!(lower > 0) || !isBreakEven(lower)) break
    price = lower
  }
  return price
}
