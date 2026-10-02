/**
 * Handling fee/certificate tax estimate (ported from calculateFee of GAS version Sidebar.html):
 * - Taiwan stocks: Brokerage fees are "unconditionally rounded off if they are less than ¥", and the minimum single transaction fee can be applied (commonly NT$20 for a whole share and NT$1 for odd lots);
 *   Pay tax on selling additional certificates (also rounded to the nearest dollar)
 * - US stocks: round to two decimal places
 */
import type { FeeRounding, Market, Transaction, TxNature, TxType } from '../types/models'
import type { Holding } from './pnlEngine'
import {
  BORROW_FEE_RATE,
  compareTxOrder,
  dayTradeTaxRate,
  estimateUnrealizedShort,
  floorSafe,
  sellTaxRate,
  splitFeeTax,
} from './pnlEngine'

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
 *
 * EN-05: when the recorded fee implies a ratio above the statutory rate (impossible for a real
 * discount), the function still falls back to defaultRate rather than reporting the impossible
 * ratio — but that fallback is silent unless the caller opts in. Pass `outOfRange` to have its
 * `.value` set to true in that one case, so a caller can flag the row instead of treating the
 * fallback as a confirmed rate.
 */
export function inferFeeRate(
  tx: Pick<Transaction, 'price' | 'qty' | 'fee_tax' | 'tx_type' | 'market' | 'ticker'> &
    Pick<Partial<Transaction>, 'tx_nature'>,
  defaultRate: number,
  minFees: { whole: number; odd: number },
  outOfRange?: { value: boolean },
): number {
  if (outOfRange) outOfRange.value = false
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
    if (outOfRange) outOfRange.value = true
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
  /** Handling fee re-estimated based on the rate in force on the transaction's own date (a sale includes the securities tax). */
  newFee: number
  /**
   * The rate used for this row (Task 182). The wizard both shows it and writes it back to
   * `transactions.fee_rate`, so a re-priced row states which agreement it was priced under.
   */
  feeRate: number
}

/**
 * Find Taiwan stock transactions whose handling fees are inconsistent with the fee setting for
 * batch correction.
 * - Taiwan stocks only: The fee structure of each brokerage in the U.S. stock market is quite different (no commission/fixed fee/SEC fee) and is not included in the batch recalculation.
 * - The tax on selling securities is automatically determined based on the code (0.1% for ETFs, 0% for bond ETFs, and 0.3% for the rest);
 *   Recalculation of transactions with special tax rates such as hedging will not be allowed. Users can uncheck or edit individually in the preview.
 *
 * Task 182: `rateFor` is asked per transaction, with that transaction's own date — never one rate
 * for the whole ledger. A broker that moves from 6.5 折 to 3.8 折 on 2026-10-01 charged the old
 * rate on everything before it, so those rows re-price to exactly what they already hold and never
 * reach this list. Passing a constant function restores the pre-Task-182 behaviour of rewriting
 * the entire history at one rate, which is what made this wizard dangerous.
 */
export function proposeFeeCorrections(
  transactions: Transaction[],
  opts: { rateFor: (txDate: string) => number; minFeeWhole: number; minFeeOdd: number },
): FeeCorrection[] {
  const out: FeeCorrection[] = []
  for (const tx of transactions) {
    if (tx.market !== 'TPE' || !(tx.price > 0) || !(tx.qty > 0)) continue
    // Task 166 (EN-01): a 現金股利 row carries a price and a qty too, but its fee_tax is a
    // withholding, not a brokerage commission — recalculating it would overwrite real data.
    if (tx.tx_type !== 'BUY' && tx.tx_type !== 'SELL') continue
    // The rate this workspace charged on this transaction's own date (Task 182).
    const feeRate = opts.rateFor(tx.tx_date)
    // Day-trade detection (Task 137, revised 2026-09-01): same-date buy/sell matching was
    // measured against two real broker exports and gives 12 false positives out of 14
    // same-day round trips (only 2 are actual day trades), so it is not used. Instead a
    // suspected 現股當沖 sell is one whose recorded total cannot even cover the standard
    // tax, AND whose residual after the halved tax exactly matches the expected fee.
    if (tx.tx_type === 'SELL') {
      // An explicit DAY_TRADE label is trusted directly, skipping the inference test below.
      if (tx.tx_nature === 'DAY_TRADE') continue
      if (hasDayTradeFeeSignature(tx, feeRate, { whole: opts.minFeeWhole, odd: opts.minFeeOdd })) continue
    }
    const newFee = calculateFee({
      market: tx.market,
      txType: tx.tx_type,
      price: tx.price,
      qty: tx.qty,
      feeRate,
      taxRate: sellTaxRate(tx.ticker),
      minFee: tx.qty >= 1000 ? opts.minFeeWhole : opts.minFeeOdd,
      nature: tx.tx_nature,
    })
    if (newFee !== tx.fee_tax) out.push({ tx, newFee, feeRate })
  }
  return out
}

/**
 * Does this SELL's recorded `fee_tax` carry a **halved** securities tax? (BUG-089)
 *
 * Extracted from `proposeFeeCorrections`, which has relied on it since Task 137 to avoid
 * re-pricing a 現股當沖 row. It is the one day-trade test this codebase trusts, and the reason is
 * worth restating: it reads the **money**, not the calendar. Same-date buy/sell matching was
 * measured against two real broker exports and produced 12 false positives out of 14 same-day
 * round trips, so a date match proves nothing on its own. A recorded total that cannot even cover
 * the standard tax, and whose residual after the halved tax lands exactly on the expected
 * brokerage fee, is the broker's own arithmetic — a 0.15% / 0.05% row cannot be produced any
 * other way.
 *
 * EN-06: `fee_tax` is user-entered/imported and not guaranteed to be a clean integer (e.g.
 * 361.9999999999999 from prior float arithmetic), so both sides are rounded before comparing.
 */
export function hasDayTradeFeeSignature(
  tx: Pick<Transaction, 'price' | 'qty' | 'ticker' | 'fee_tax'> & Pick<Partial<Transaction>, 'tx_date'>,
  feeRate: number,
  minFees: { whole: number; odd: number },
): boolean {
  const gross = tx.price * tx.qty
  if (!(gross > 0)) return false
  const rate = sellTaxRate(tx.ticker)
  // Judged on the row's own date: after the §2-2 sunset there is no reduced rate to leave a trace.
  const dtRate = dayTradeTaxRate(tx.ticker, tx.tx_date)
  // BUG-093: the signature only exists where 當沖 is actually taxed differently — §2-2 displaces
  // the 0.3% stock rate and nothing else. An ETF, a TDR, a REIT and a bond ETF pay the same tax
  // either way, so their day trades leave no trace in the fee and cannot be detected from it.
  if (!(rate > dtRate)) return false
  const stdTax = floorSafe(gross * rate)
  const dtTax = floorSafe(gross * dtRate)
  const minFee = tx.qty >= 1000 ? minFees.whole : minFees.odd
  const expFee = Math.max(minFee, floorSafe(gross * feeRate))
  return tx.fee_tax < stdTax && Math.round(tx.fee_tax - dtTax) === Math.round(expFee)
}

/** One 現股當沖 the ledger is not being told about (BUG-089). */
export interface DayTradeProposal {
  /** The SELL leg whose recorded fee carries the halved tax. */
  sell: Transaction
  /**
   * The same-day BUY legs of the same ticker that cover it, FIFO, each with the quantity matched
   * from it. A BUY appears here **only when every one of its shares was matched** — labelling a
   * partly-matched BUY would claim the whole row was day-traded, and the engine does not need it:
   * one labelled leg on that date is enough for `computeLedger` to pair the rest.
   */
  buys: Transaction[]
}

/**
 * Find the 現股當沖 round trips that are recorded as ordinary trades (BUG-089).
 *
 * Why this exists: `computeLedger` already nets a day trade out before the moving average sees it,
 * so the position's cost never moves — but **only when at least one leg of that date carries
 * `tx_nature === 'DAY_TRADE'`**. A broker export that does not carry the label leaves the whole
 * mechanism switched off, and a same-day 買→賣→買 then lands the day trade's profit inside
 * 持股成本 *and* inside 已實現損益 at once (measured on 2303: 均價 162.07 against the broker's
 * 161.82, and 已實現 overstated by 501).
 *
 * Two conditions must both hold, and the second is what keeps this honest:
 * 1. the sell carries the halved-tax fee signature (`hasDayTradeFeeSignature`), and
 * 2. same-day BUYs of the same ticker **fully** cover it. A day trade you could not have made —
 *    no shares bought that day to sell — is not proposed, whatever the fee looks like.
 */
export function proposeDayTradeLabels(
  transactions: Transaction[],
  opts: { rateFor: (txDate: string) => number; minFeeWhole: number; minFeeOdd: number },
): DayTradeProposal[] {
  const minFees = { whole: opts.minFeeWhole, odd: opts.minFeeOdd }
  // Group by (date, ticker): a day trade never crosses either boundary.
  const groups = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    if (tx.market !== 'TPE' || !(tx.price > 0) || !(tx.qty > 0)) continue
    if (tx.tx_type !== 'BUY' && tx.tx_type !== 'SELL') continue
    // Only an **unclassified** row may be relabelled: `null` (never set) or `'SPOT'`. 融券 (SHORT)
    // and 融資 (MARGIN) are different instruments, and 資券當沖 does not get the halved tax at all
    // (`splitFeeTax` says so), so a MARGIN row carrying the signature is contradictory data —
    // overwriting its nature here would destroy what the user actually recorded to fix a figure
    // this wizard cannot be sure about.
    if (tx.tx_nature != null && tx.tx_nature !== 'SPOT' && tx.tx_nature !== 'DAY_TRADE') continue
    const key = `${tx.tx_date}\u0000${tx.ticker}`
    const group = groups.get(key)
    if (group) group.push(tx)
    else groups.set(key, [tx])
  }

  const out: DayTradeProposal[] = []
  for (const group of groups.values()) {
    // Already told? Then the engine is already pairing this date and nothing is missing.
    if (group.some((tx) => tx.tx_nature === 'DAY_TRADE')) continue
    const sells = group.filter((tx) => tx.tx_type === 'SELL')
    const buys = group.filter((tx) => tx.tx_type === 'BUY').sort(compareTxOrder)
    if (sells.length === 0 || buys.length === 0) continue

    // Shares a buy still has left, so two day-trade sells on one date cannot both claim them.
    const remaining = new Map(buys.map((b) => [b.id, b.qty]))
    for (const sell of sells.sort(compareTxOrder)) {
      const feeRate = opts.rateFor(sell.tx_date)
      if (!hasDayTradeFeeSignature(sell, feeRate, minFees)) continue
      let need = sell.qty
      const used = new Map<string, number>()
      for (const buy of buys) {
        if (need <= 0) break
        const left = remaining.get(buy.id) ?? 0
        if (left <= 0) continue
        const take = Math.min(left, need)
        used.set(buy.id, take)
        need -= take
      }
      // Condition 2: anything short of full cover is left alone rather than guessed at.
      if (need > 0) continue
      for (const [id, take] of used) remaining.set(id, (remaining.get(id) ?? 0) - take)
      out.push({
        sell,
        buys: buys.filter((b) => used.get(b.id) === b.qty),
      })
    }
  }
  return out.sort((a, b) => compareTxOrder(a.sell, b.sell))
}

/**
 * Breakeven selling price (breakeven price): The lowest price (0.01 scale) when "the actual amount received ≥ the current position cost" is sold at this price.
 * First use the closed form to solve the candidate price (whichever is higher between the proportional rate and the lowest handling fee),
 * Then use calculateFee to actually calculate the two-way convergence - the floor to yuan and the minimum handling fee will cause a closed boundary error.
 * When there is a shortage, make up for it; when there is a surplus, go down to find the lowest price, and ensure that the "lowest price at which you can sell without losing money" is sent back.
 *
 * BUG-079: the fee model for TWD holdings matches `estimateUnrealized` exactly — same
 * `feeRate` handling (Task 182: callers pass today's workspace rate with `overrideFeeRate`), same
 * `sellTaxRate`, same single minFee clamp, same `overrideFeeRate` override — computed inline
 * (`netAt` below) rather than through `estimateUnrealized` itself, because that function's
 * outer `Math.round` is a display rounding: it can round an actually-negative net (e.g. -0.5)
 * to a "break-even" 0, which is too coarse for this search's cent-level boundary.
 *
 * **US holdings are gross, like `estimateUnrealized` (BUG-079, 0.10.14).** This used to deduct a
 * fee here, which sounded more honest but was not: **the app has no US fee-rate setting** (EN-02),
 * so the only rate available is the *Taiwan* workspace discount, and `minFee` is not even passed
 * for USD. A 3 折 Taiwan rate has nothing to do with a US broker, so the figure was a fee this
 * app cannot know, applied to the wrong market — and it put 保本價 above the price at which the
 * row's own 未實現淨損益 already reads 0. Measured at a 1% rate on a 10-share / $5,000 position:
 * 保本價 $505.06 against a P&L card showing $0 at $500.00, a $50 gap. Both numbers now answer the
 * same question. If a US fee rate is ever added, deduct it in **both** places in the same change.
 */
export function breakEvenPrice(
  holding: Holding,
  feeRate: number,
  minFee?: number,
  overrideFeeRate?: boolean,
  rounding: FeeRounding = 'lot',
): number | null {
  const { qty, cost, market, ticker, currency } = holding
  // A zero-cost holding (e.g. all-stock-dividend position) is still valid; only reject a
  // missing position or a non-numeric/negative cost (NaN >= 0 is false, so NaN still returns 0).
  if (!(qty > 0) || !(cost >= 0)) return 0
  const taxRate = market === 'TPE' ? sellTaxRate(ticker) : 0

  const lots = Array.isArray(holding.openLots) && holding.openLots.length > 0
    ? holding.openLots
    : [{ qty, feeRate }]

  // Net proceeds minus cost at price `p`, same per-lot fee/tax model as `estimateUnrealized`
  // (see the function comment above), without its outer rounding.
  const netAt = (p: number): number => {
    if (currency !== 'TWD') {
      // Gross, matching `estimateUnrealized`'s US branch — see the note above.
      return p * qty - cost
    }
    let fee = 0
    let tax = 0
    for (const lot of lots) {
      const lotVal = p * lot.qty
      const effectiveFeeRate = overrideFeeRate ? feeRate : lot.feeRate ?? feeRate
      // Same per-lot / whole-position flooring as `estimateUnrealized` (BUG-088)
      fee += rounding === 'position' ? lotVal * effectiveFeeRate : floorSafe(lotVal * effectiveFeeRate)
      tax += rounding === 'position' ? lotVal * taxRate : floorSafe(lotVal * taxRate)
    }
    if (rounding === 'position') {
      fee = floorSafe(fee)
      tax = floorSafe(tax)
    }
    if (feeRate > 0 && minFee !== undefined && minFee > fee) fee = minFee
    return p * qty - cost - fee - tax
  }
  const isBreakEven = (p: number) => netAt(p) >= 0

  // Closed-form seed: the quantity-weighted average of each lot's effective fee rate (its own
  // rate, or the workspace rate when the lot has none / `overrideFeeRate` forces it), so the
  // seed lands close to the `isBreakEven` predicate above even when lots carry different
  // historical rates. A seed built from the raw workspace `feeRate` alone can land far enough
  // away that the bounded refinement loop below cannot walk it back to the true minimum.
  const lotQty = lots.reduce((sum, lot) => sum + lot.qty, 0) || qty
  const effRate = lots.reduce((sum, lot) => {
    const r = overrideFeeRate ? feeRate : lot.feeRate ?? feeRate
    return sum + lot.qty * r
  }, 0) / lotQty

  // US seeds at the gross break-even, because `netAt` deducts nothing there.
  const byRate = currency !== 'TWD' ? cost / qty : cost / (qty * (1 - effRate - taxRate))
  // When feeRate is 0 (no commission), calculateFee does not include the minimum handling fee, and closed synchronization is skipped.
  // Gate on the workspace `feeRate`, not the lot-weighted `effRate`: that is what `netAt` (above)
  // actually checks, so seed and predicate must agree — otherwise a holding whose lots carry
  // `feeRate: 0` under a workspace rate > 0 seeds below the true root, and the bounded ±$10
  // refinement can run out of steps for a small odd lot with a large custom minimum fee.
  const byMinFee = currency !== 'TWD'
    ? byRate
    : (cost + (feeRate > 0 ? minFee ?? 0 : 0)) / (qty * (1 - taxRate))
  let price = Math.floor(Math.max(byRate, byMinFee) * 100) / 100

  for (let i = 0; i < 1000 && !isBreakEven(price); i++) {
    price = Math.round(price * 100 + 1) / 100
  }
  // Non-convergence (search exhausted without reaching a break-even price) is reported as
  // "no answer" (null), distinct from the 0-qty "no position" sentinel above and from any real price.
  if (!isBreakEven(price)) return null
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
 *
 * BUG-079: the TWD predicate reuses `estimateUnrealizedShort` (same floor/minFee clamp the
 * displayed unrealized P&L uses). `ShortLot` carries no per-lot fee rate, so there is no
 * lot-weighted seed to build here, unlike `breakEvenPrice`. US holdings are gross, for the same
 * reason as `breakEvenPrice` (0.10.14): the app has no US fee rate, and `estimateUnrealizedShort`
 * does not deduct one either.
 */
export function breakEvenPriceShort(
  holding: Holding, feeRate: number, minFee?: number,
): number | null {
  const { currency } = holding
  const shortQty = holding.shortQty ?? 0
  const shortProceeds = holding.shortProceeds ?? 0
  if (!(shortQty > 0)) return 0

  const isProfitable = (p: number) =>
    currency === 'TWD'
      ? estimateUnrealizedShort(holding, p, feeRate, minFee) >= 0
      : shortProceeds - p * shortQty >= 0

  const byRate = currency === 'TWD' ? shortProceeds / (shortQty * (1 + feeRate)) : shortProceeds / shortQty
  const byMinFee = currency === 'TWD' && feeRate > 0 && minFee !== undefined
    ? (shortProceeds - minFee) / shortQty
    : byRate
  let price = Math.ceil(Math.min(byRate, byMinFee) * 100) / 100

  for (let i = 0; i < 1000 && price > 0 && !isProfitable(price); i++) {
    price = Math.round(price * 100 - 1) / 100
  }
  // Non-convergence (search exhausted without reaching a profitable cover price) is reported as
  // "no answer" (null), distinct from the 0-qty "no short position" sentinel above.
  if (!(price > 0) || !isProfitable(price)) return null
  for (let i = 0; i < 1000; i++) {
    const higher = Math.round(price * 100 + 1) / 100
    if (!isProfitable(higher)) break
    price = higher
  }
  return price
}
