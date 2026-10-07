/**
 * 損益試算 (what-if) pure calculation.
 *
 * TPE-only by design: fees/tax reuse `calculateFee`/`breakEvenPrice` from `utils/fees.ts`,
 * which apply the Taiwan-stock fee floor and securities-transaction-tax rules. US-stock
 * what-if is out of scope here.
 */
import { calculateFee, breakEvenPrice } from '../../utils/fees'
import { roundPrice } from '../../utils/formatters'
import type { Holding } from '../../utils/pnlEngine'

export interface WhatIfInput {
  ticker: string
  buyPrice: number
  qty: number
  price: number
  feeRate: number
  minFee?: number
  /** When supplied, used verbatim as the buy fee instead of recomputing from feeRate/minFee. */
  buyFee?: number
}

export interface WhatIfResult {
  buyFee: number
  cost: number
  sellFeeTax: number
  proceeds: number
  pnl: number
  roi: number
  /** Null when breakEvenPrice's search does not converge (EN-07); the ladder then omits the mark. */
  breakEven: number | null
}

export function whatIf(input: WhatIfInput): WhatIfResult | null {
  const { ticker, buyPrice, qty, price, feeRate, minFee } = input
  if (!(Number.isFinite(buyPrice) && buyPrice > 0)) return null
  if (!(Number.isFinite(qty) && qty > 0)) return null
  if (!(Number.isFinite(price) && price > 0)) return null

  const buyFee =
    input.buyFee !== undefined
      ? Number.isFinite(input.buyFee) && input.buyFee > 0
        ? input.buyFee
        : 0
      : calculateFee({ market: 'TPE', txType: 'BUY', price: buyPrice, qty, feeRate, minFee })
  const cost = buyPrice * qty + buyFee
  const sellFeeTax = calculateFee({ market: 'TPE', txType: 'SELL', price, qty, feeRate, ticker, minFee })
  const proceeds = price * qty - sellFeeTax
  const pnl = proceeds - cost
  const roi = pnl / cost

  // Synthetic holding, built only to reuse breakEvenPrice's cost-based search.
  const holding: Holding = {
    key: `TPE:${ticker}`,
    market: 'TPE',
    ticker,
    name: '',
    currency: 'TWD',
    qty,
    cost,
    rawCost: buyPrice * qty,
    buyCostTotal: cost,
    realized: 0,
    dividends: 0, // synthetic what-if position, no dividend history
    openLots: [], // breakEvenPrice never reads lots, only avgCost
    shortQty: 0, // long-only what-if; breakEvenPrice never reads the short leg
    shortProceeds: 0,
    shortRawProceeds: 0,
    shortLots: [],
    avgCost: cost / qty,
    rawAvgCost: buyPrice,
  }
  const breakEven = breakEvenPrice(holding, feeRate, minFee)

  return { buyFee, cost, sellFeeTax, proceeds, pnl, roi, breakEven }
}

/**
 * TWSE tick size for a price band (NT$) — the same bands the exchange uses to validate order
 * prices. No table like this existed anywhere in the repo before DT-02/DT-03 (grep
 * `limitUp|漲停|tickSize` came back empty), so it lives here rather than duplicating a second
 * one elsewhere.
 */
function tickSizeFor(price: number): number {
  if (price < 10) return 0.01
  if (price < 50) return 0.05
  if (price < 100) return 0.1
  if (price < 500) return 0.5
  if (price < 1000) return 1
  return 5
}

export interface PriceLimits {
  limitUp: number
  limitDown: number
}

/**
 * TW daily price limit band: ±10% of 昨收, rounded to the exchange's tick size (DT-02's quote
 * badge, DT-03's chart reference lines). Null when there is no usable 昨收 to compute it from.
 */
export function priceLimits(prevClose: number | null): PriceLimits | null {
  if (prevClose === null || !Number.isFinite(prevClose) || prevClose <= 0) return null
  const rawUp = prevClose * 1.1
  const rawDown = prevClose * 0.9
  // 1e-9 absorbs float noise (e.g. 54.99999999 / 0.1) so an exact tick is not pushed one step inward.
  const limitUp = Math.floor(rawUp / tickSizeFor(rawUp) + 1e-9) * tickSizeFor(rawUp)
  const limitDown = Math.ceil(rawDown / tickSizeFor(rawDown) - 1e-9) * tickSizeFor(rawDown)
  return { limitUp: roundPrice(limitUp), limitDown: roundPrice(limitDown) }
}

export type LadderKind = 'step' | 'current' | 'breakEven' | 'avgCost'

export interface LadderRow {
  /** Sell price, rounded to 2 decimals. */
  price: number
  /** price / anchor - 1. The anchor is `input.price`. */
  relative: number
  kind: LadderKind
  /** 'anchor' for the main ±10% ladder around `input.price`, 'quote' for the live-quote cluster. */
  group: 'anchor' | 'quote'
  pnl: number
  roi: number
  proceeds: number
  sellFeeTax: number
}

/** Marks the caller wants overlaid on the ladder. Absent/null/0 marks are simply dropped. */
export interface LadderMarks {
  currentPrice?: number | null
  avgCost?: number | null
}

const LADDER_STEPS = [-0.1, -0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075, 0.1]

/** Steps for the quote cluster, ±7.5% / 5% steps around the live quote. */
const QUOTE_CLUSTER_STEPS = [-0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075]

/**
 * Nine price steps around `input.price` (±10%, 2.5% apart) plus, when they fall inside
 * that window, marked rows for break-even (always computed from `input`) and the caller-
 * supplied `currentPrice` / `avgCost`. `sellLadder` never reads `avgCost` off `input`
 * itself — the anchor is always `input.price`, chosen by the caller. Rows are ordered
 * highest price first (+10% on top). Each row's pnl/roi/proceeds/sellFeeTax is a fresh
 * `whatIf` call at that row's price — the ladder never interpolates fees.
 *
 * When `marks.avgCost` is a real holding (> 0) and the live quote falls outside the main
 * ±10% window, the quote gets its own small cluster (`group: 'quote'`) instead of
 * stretching the main window to cover it. A watched stock (no avgCost) never gets a
 * cluster — its ladder is the fixed ±10% / 2.5% steps unchanged.
 */
export function sellLadder(input: WhatIfInput, marks?: LadderMarks): LadderRow[] {
  const base = whatIf(input)
  if (!base) return []

  const anchor = input.price
  const rowFor = (price: number, kind: LadderKind, group: 'anchor' | 'quote'): LadderRow => {
    const r = whatIf({ ...input, price })!
    return {
      price,
      relative: price / anchor - 1,
      kind,
      group,
      pnl: r.pnl,
      roi: r.roi,
      proceeds: r.proceeds,
      sellFeeTax: r.sellFeeTax,
    }
  }

  // Every row's price must satisfy LadderRow.price's "rounded to 2 decimals" invariant,
  // so mark prices are snapped to the same 0.01 grid as step prices before the window
  // check — otherwise a raw avgCost like 512.923 never equality-matches its own 512.92
  // step and dedupe below can't merge them.
  const snap = roundPrice

  const stepRows = LADDER_STEPS.map((p) => rowFor(snap(anchor * (1 + p)), 'step', 'anchor'))

  const rows = [...stepRows]
  const minStepPrice = Math.min(...stepRows.map((r) => r.price))
  const maxStepPrice = Math.max(...stepRows.map((r) => r.price))
  const inWindow = (price: number) =>
    Number.isFinite(price) && price > 0 && price >= minStepPrice && price <= maxStepPrice

  const breakEvenSnapped = base.breakEven != null ? snap(base.breakEven) : null
  if (breakEvenSnapped != null && inWindow(breakEvenSnapped)) {
    rows.push(rowFor(breakEvenSnapped, 'breakEven', 'anchor'))
  }
  const avgCostMark = marks?.avgCost != null ? snap(marks.avgCost) : null
  if (avgCostMark != null && inWindow(avgCostMark)) rows.push(rowFor(avgCostMark, 'avgCost', 'anchor'))
  const currentMark = marks?.currentPrice != null ? snap(marks.currentPrice) : null
  if (currentMark != null && inWindow(currentMark)) rows.push(rowFor(currentMark, 'current', 'anchor'))

  // Quote cluster: only for a real holding, only when the live quote lands outside the
  // main ±10% window — otherwise it is already covered by the currentMark row above.
  const hasHolding = marks?.avgCost != null && marks.avgCost > 0
  const quote = marks?.currentPrice
  const hasQuote = quote != null && Number.isFinite(quote) && quote > 0
  if (hasHolding && hasQuote && !inWindow(snap(quote))) {
    for (const p of QUOTE_CLUSTER_STEPS) {
      const price = snap(quote * (1 + p))
      if (inWindow(price)) continue
      rows.push(rowFor(price, p === 0 ? 'current' : 'step', 'quote'))
    }
  }

  rows.sort((a, b) => b.price - a.price)

  // Rounding to 2 decimals, or two marks landing on the same price, can collapse rows
  // onto the same price. Merge those, keeping the most specific kind.
  const kindRank: Record<LadderKind, number> = { current: 3, avgCost: 2, breakEven: 1, step: 0 }
  const deduped: LadderRow[] = []
  for (const row of rows) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.price === row.price) {
      if (kindRank[row.kind] > kindRank[prev.kind]) {
        deduped[deduped.length - 1] = row
      }
    } else {
      deduped.push(row)
    }
  }

  return deduped
}

/** The position before the add-on, as the holdings engine states it. */
export interface AveragingBase {
  qty: number
  /** Fee-inclusive cost (庫存總覽's 投入成本). */
  cost: number
  /** Fee-exclusive cost (價金 only). */
  rawCost: number
}

export interface AveragingAddOn {
  ticker: string
  price: number
  qty: number
  feeRate: number
  /** Minimum fee for this add-on's own size; the caller picks whole-lot vs odd-lot. */
  minFee?: number
}

export interface AveragingResult {
  addAmount: number
  addFee: number
  /** addAmount + addFee — the cash the add-on needs. */
  addCost: number
  totalQty: number
  totalCost: number
  totalRawCost: number
  /** Fee-inclusive average after the add-on, the same basis as 庫存總覽's 均價. */
  avgCost: number
  /** Fee-exclusive average after the add-on. */
  rawAvgCost: number
}

/**
 * 攤平試算: one more buy on top of an existing long, merged by moving-average cost — the
 * basis the holdings engine and the broker use. The add-on is a new trade, so its fee is
 * priced at the rate the caller passes (today's workspace rate), not the holding's history.
 */
export function averageDown(base: AveragingBase, add: AveragingAddOn): AveragingResult | null {
  if (!(Number.isFinite(base.qty) && base.qty > 0)) return null
  if (!(Number.isFinite(base.cost) && base.cost >= 0)) return null
  if (!(Number.isFinite(add.price) && add.price > 0)) return null
  if (!(Number.isFinite(add.qty) && add.qty > 0)) return null

  const addAmount = add.price * add.qty
  const addFee = calculateFee({
    market: 'TPE',
    txType: 'BUY',
    price: add.price,
    qty: add.qty,
    feeRate: add.feeRate,
    minFee: add.minFee,
  })
  const addCost = addAmount + addFee
  const totalQty = base.qty + add.qty
  const totalCost = base.cost + addCost
  const totalRawCost = base.rawCost + addAmount
  return {
    addAmount,
    addFee,
    addCost,
    totalQty,
    totalCost,
    totalRawCost,
    avgCost: totalCost / totalQty,
    rawAvgCost: totalRawCost / totalQty,
  }
}

export type TargetSolve =
  | { kind: 'ok'; qty: number }
  | { kind: 'already' }
  | { kind: 'unreachable' }

/**
 * The fewest shares (a multiple of `step`) to buy at `price` so the fee-inclusive average
 * reaches `target`: at or below it when lowering, at or above it when raising.
 *
 * Fees floor to whole dollars and have a minimum, so cost is not linear in qty. The
 * closed form (fee taken as price × feeRate) only seeds the search; every candidate is
 * re-checked through `averageDown`, so the answer is the exact one the ledger will show.
 */
export function sharesForTargetAvg(
  base: AveragingBase,
  add: Omit<AveragingAddOn, 'qty' | 'minFee'> & { minFeeFor: (shares: number) => number | undefined },
  target: number,
  step: number,
): TargetSolve | null {
  if (!(Number.isFinite(target) && target > 0)) return null
  if (!(Number.isFinite(add.price) && add.price > 0)) return null
  if (!(base.qty > 0) || !(step > 0)) return null

  const current = base.cost / base.qty
  if (current === target) return { kind: 'already' }
  const lowering = target < current
  const reached = (avg: number) => (lowering ? avg <= target : avg >= target)
  const avgAt = (shares: number) =>
    averageDown(base, { ...add, qty: shares, minFee: add.minFeeFor(shares) })!.avgCost

  // The average only moves toward the add-on's effective unit cost, price × (1 + feeRate);
  // a target on the far side of it is never reached, however many shares are bought.
  const unitCost = add.price * (1 + add.feeRate)
  const denom = lowering ? target - unitCost : unitCost - target
  if (!(denom > 0)) return { kind: 'unreachable' }

  const estimate = Math.abs(base.cost - target * base.qty) / denom
  let shares = Math.max(step, Math.ceil(estimate / step) * step)
  for (let i = 0; i < 1000 && !reached(avgAt(shares)); i++) shares += step
  if (!reached(avgAt(shares))) return { kind: 'unreachable' }
  for (let i = 0; i < 1000 && shares > step && reached(avgAt(shares - step)); i++) shares -= step
  return { kind: 'ok', qty: shares }
}
