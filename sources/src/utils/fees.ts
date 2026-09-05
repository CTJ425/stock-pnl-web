/**
 * Handling fee/certificate tax estimate (ported from calculateFee of GAS version Sidebar.html):
 * - Taiwan stocks: Brokerage fees are "unconditionally rounded off if they are less than ¥", and the minimum single transaction fee can be applied (commonly NT$20 for a whole share and NT$1 for odd lots);
 *   Pay tax on selling additional certificates (also rounded to the nearest dollar)
 * - US stocks: round to two decimal places
 */
import type { Market, Transaction, TxNature, TxType } from '../types/models'
import type { Holding } from './pnlEngine'
import { BORROW_FEE_RATE, floorSafe, sellTaxRate, splitFeeTax } from './pnlEngine'

/** The legal standard handling fee for Taiwan stocks is 0.1425%*/
export const DEFAULT_FEE_RATE = 0.001425

/** Common Taiwan broker fee rates (discounts on statutory rate 0.001425) */
export const COMMON_FEE_RATES = [
  0.001425, // 1.0 (原價)
  0.00092625, // 6.5 折
  0.000855, // 6.0 折
  0.0007125, // 5.0 折
  0.00057, // 4.0 折
  0.0005415, // 3.8 折
  0.0004275, // 3.0 折
  0.000399, // 2.8 折
  0.00035625, // 2.5 折
  0.000285, // 2.0 折
  0.00021375, // 1.5 折
  0.0001425, // 1.0 折
  0, // 0 免手續費
]

/**
 * Infers the historical brokerage fee rate from an existing transaction record when fee_rate was not explicitly stored.
 * Returns defaultRate if the fee rate cannot be reliably deduced (e.g. zero gross amount or minimum-fee clamp).
 */
export function inferFeeRate(
  tx: Pick<Transaction, 'price' | 'qty' | 'fee_tax' | 'tx_type' | 'market' | 'ticker'> &
    Pick<Partial<Transaction>, 'tx_nature'>,
  defaultRate: number,
  minFees: { whole: number; odd: number },
): number {
  if (tx.market === 'US') {
    const gross = tx.price * tx.qty
    if (gross <= 0) return defaultRate
    if (tx.fee_tax === 0) return 0
    return Number((tx.fee_tax / gross).toFixed(6))
  }

  const gross = tx.price * tx.qty
  if (gross <= 0) return defaultRate

  const { fee } = splitFeeTax(tx)
  if (fee === 0 && tx.fee_tax === 0) return 0
  if (fee < 0) return defaultRate

  // If the fee equals the workspace's minimum fee (whole lot or odd lot) and the calculated fee
  // at defaultRate would be lower than fee, it was clamped by minimum fee. Fall back to
  // defaultRate to avoid a distorted high percentage.
  if ((fee === minFees.whole || fee === minFees.odd) && gross * defaultRate < fee) {
    return defaultRate
  }

  // Check if workspace defaultRate matches exactly
  if (Math.floor(gross * defaultRate) === fee) {
    return defaultRate
  }

  // Check common discount rates
  for (const candidate of COMMON_FEE_RATES) {
    if (Math.floor(gross * candidate) === fee) {
      return candidate
    }
  }

  // Otherwise calculate ratio
  const ratio = fee / gross
  if (ratio > DEFAULT_FEE_RATE) {
    // A TW broker only discounts below the statutory rate; anything above it is impossible.
    // This is also the only guard a minimum-fee clamp needs: a clamp raises the recorded fee
    // above what the real rate would produce, so it always inflates fee/gross. Comparing `fee`
    // against the minimum-fee values here instead would be wrong — an unclamped fee can equal
    // a minimum fee by coincidence (`calculateFee` clamps only when `minFee > fee`), and
    // discarding that recoverable rate overestimates it by up to an order of magnitude.
    return defaultRate
  }

  return Number(ratio.toFixed(8))
}

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
  /** Trading nature; a SHORT sell also pays the borrow fee (借券費), see BORROW_FEE_RATE. */
  nature?: TxNature | null
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
      if (input.nature === 'SHORT') fee += floorSafe(amount * BORROW_FEE_RATE)
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
    // Day-trade detection (Task 137, revised 2026-09-01): same-date buy/sell matching was
    // measured against two real broker exports and gives 12 false positives out of 14
    // same-day round trips (only 2 are actual day trades), so it is not used. Instead a
    // suspected 現股當沖 sell is one whose recorded total cannot even cover the standard
    // tax, AND whose residual after the halved tax exactly matches the expected fee.
    if (tx.tx_type === 'SELL') {
      // An explicit DAY_TRADE label is trusted directly, skipping the inference test below.
      if (tx.tx_nature === 'DAY_TRADE') continue
      const gross = tx.price * tx.qty
      const rate = sellTaxRate(tx.ticker)
      const stdTax = floorSafe(gross * rate)
      const halfTax = floorSafe((gross * rate) / 2)
      const minFee = tx.qty >= 1000 ? opts.minFeeWhole : opts.minFeeOdd
      const expFee = Math.max(minFee, floorSafe(gross * opts.feeRate))
      if (tx.fee_tax < stdTax && tx.fee_tax - halfTax === expFee) continue
    }
    const newFee = calculateFee({
      market: tx.market,
      txType: tx.tx_type,
      price: tx.price,
      qty: tx.qty,
      feeRate: opts.feeRate,
      taxRate: sellTaxRate(tx.ticker),
      minFee: tx.qty >= 1000 ? opts.minFeeWhole : opts.minFeeOdd,
      nature: tx.tx_nature,
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
  // A zero-cost holding (e.g. all-stock-dividend position) is still valid; only reject a
  // missing position or a non-numeric/negative cost (NaN >= 0 is false, so NaN still returns 0).
  if (!(qty > 0) || !(cost >= 0)) return 0
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

/**
 * Cover price at which an open short breaks even. Below it the short is profitable.
 * Mirrors `breakEvenPrice`'s structure, but the predicate is decreasing in price (a higher
 * cover price costs more), so the closed-form seed starts high and steps down to convergence.
 */
export function breakEvenPriceShort(
  holding: Holding, feeRate: number, minFee?: number,
): number {
  const { market } = holding
  const shortQty = holding.shortQty ?? 0
  const shortProceeds = holding.shortProceeds ?? 0
  if (!(shortQty > 0)) return 0

  const isProfitable = (p: number) =>
    shortProceeds -
      (p * shortQty + calculateFee({ market, txType: 'BUY', price: p, qty: shortQty, feeRate, minFee })) >=
    0

  const byRate = shortProceeds / (shortQty * (1 + feeRate))
  const byMinFee = feeRate > 0 && minFee !== undefined ? (shortProceeds - minFee) / shortQty : byRate
  let price = Math.ceil(Math.min(byRate, byMinFee) * 100) / 100

  for (let i = 0; i < 1000 && price > 0 && !isProfitable(price); i++) {
    price = Math.round(price * 100 - 1) / 100
  }
  // Non-convergence returns the same "no answer" sentinel a breakeven price cannot reach.
  if (!(price > 0) || !isProfitable(price)) return 0
  for (let i = 0; i < 1000; i++) {
    const higher = Math.round(price * 100 + 1) / 100
    if (!isProfitable(higher)) break
    price = higher
  }
  return price
}
