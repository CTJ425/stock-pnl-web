/**
 * 損益試算 (what-if) pure calculation.
 *
 * TPE-only by design: fees/tax reuse `calculateFee`/`breakEvenPrice` from `utils/fees.ts`,
 * which apply the Taiwan-stock fee floor and securities-transaction-tax rules. US-stock
 * what-if is out of scope here.
 */
import { calculateFee, breakEvenPrice } from '../../utils/fees'
import type { Holding } from '../../utils/pnlEngine'

export interface WhatIfInput {
  ticker: string
  buyPrice: number
  qty: number
  price: number
  feeRate: number
  minFee?: number
}

export interface WhatIfResult {
  buyFee: number
  cost: number
  sellFeeTax: number
  proceeds: number
  pnl: number
  roi: number
  breakEven: number
}

export function whatIf(input: WhatIfInput): WhatIfResult | null {
  const { ticker, buyPrice, qty, price, feeRate, minFee } = input
  if (!(Number.isFinite(buyPrice) && buyPrice > 0)) return null
  if (!(Number.isFinite(qty) && qty > 0)) return null
  if (!(Number.isFinite(price) && price > 0)) return null

  const buyFee = calculateFee({ market: 'TPE', txType: 'BUY', price: buyPrice, qty, feeRate, minFee })
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
    avgCost: cost / qty,
    rawAvgCost: buyPrice,
  }
  const breakEven = breakEvenPrice(holding, feeRate, minFee)

  return { buyFee, cost, sellFeeTax, proceeds, pnl, roi, breakEven }
}

export type LadderKind = 'step' | 'current' | 'breakEven'

export interface LadderRow {
  /** Sell price, rounded to 2 decimals. */
  price: number
  /** price / anchor - 1. The anchor is `input.price`. */
  relative: number
  kind: LadderKind
  pnl: number
  roi: number
  proceeds: number
  sellFeeTax: number
}

const LADDER_STEPS = [-0.1, -0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075, 0.1]

/**
 * Nine price steps around `input.price` (±10%, 2.5% apart) plus, when it falls inside
 * that window and does not already coincide with a step, the break-even price. Each
 * row's pnl/roi/proceeds/sellFeeTax is a fresh `whatIf` call at that row's price — the
 * ladder never interpolates fees.
 */
export function sellLadder(input: WhatIfInput): LadderRow[] {
  const base = whatIf(input)
  if (!base) return []

  const anchor = input.price
  const rowFor = (price: number, kind: LadderKind): LadderRow => {
    const r = whatIf({ ...input, price })!
    return {
      price,
      relative: price / anchor - 1,
      kind,
      pnl: r.pnl,
      roi: r.roi,
      proceeds: r.proceeds,
      sellFeeTax: r.sellFeeTax,
    }
  }

  const stepRows = LADDER_STEPS.map((p) =>
    rowFor(Math.round(anchor * (1 + p) * 100) / 100, p === 0 ? 'current' : 'step'),
  )

  const rows = [...stepRows]
  const minStepPrice = stepRows[0].price
  const maxStepPrice = stepRows[stepRows.length - 1].price
  const breakEven = base.breakEven
  const hasExactStep = stepRows.some((r) => r.price === breakEven)
  if (breakEven >= minStepPrice && breakEven <= maxStepPrice && !hasExactStep) {
    rows.push(rowFor(breakEven, 'breakEven'))
  }

  rows.sort((a, b) => a.price - b.price)

  // Rounding to 2 decimals can collapse adjacent steps onto the same price once the
  // anchor is small (anchor * 0.025 under the 0.01 grid). Merge those into one row,
  // keeping the most specific kind: current > breakEven > step.
  const kindRank: Record<LadderKind, number> = { current: 2, breakEven: 1, step: 0 }
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
