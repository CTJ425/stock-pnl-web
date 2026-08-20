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

export type LadderKind = 'step' | 'current' | 'breakEven' | 'avgCost'

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

/** Marks the caller wants overlaid on the ladder. Absent/null/0 marks are simply dropped. */
export interface LadderMarks {
  currentPrice?: number | null
  avgCost?: number | null
}

const LADDER_STEPS = [-0.1, -0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075, 0.1]

/**
 * Nine price steps around `input.price` (±10%, 2.5% apart) plus, when they fall inside
 * that window, marked rows for break-even (always computed from `input`) and the caller-
 * supplied `currentPrice` / `avgCost`. `sellLadder` never reads `avgCost` off `input`
 * itself — the anchor is always `input.price`, chosen by the caller. Rows are ordered
 * highest price first (+10% on top). Each row's pnl/roi/proceeds/sellFeeTax is a fresh
 * `whatIf` call at that row's price — the ladder never interpolates fees.
 */
export function sellLadder(input: WhatIfInput, marks?: LadderMarks): LadderRow[] {
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

  // Every row's price must satisfy LadderRow.price's "rounded to 2 decimals" invariant,
  // so mark prices are snapped to the same 0.01 grid as step prices before the window
  // check — otherwise a raw avgCost like 512.923 never equality-matches its own 512.92
  // step and dedupe below can't merge them.
  const snap = (v: number) => Math.round(v * 100) / 100

  const stepRows = LADDER_STEPS.map((p) => rowFor(snap(anchor * (1 + p)), 'step'))

  const rows = [...stepRows]
  const minStepPrice = stepRows[0].price
  const maxStepPrice = stepRows[stepRows.length - 1].price
  const inWindow = (price: number) =>
    Number.isFinite(price) && price > 0 && price >= minStepPrice && price <= maxStepPrice

  const breakEvenSnapped = snap(base.breakEven)
  if (inWindow(breakEvenSnapped)) rows.push(rowFor(breakEvenSnapped, 'breakEven'))
  const avgCostMark = marks?.avgCost != null ? snap(marks.avgCost) : null
  if (avgCostMark != null && inWindow(avgCostMark)) rows.push(rowFor(avgCostMark, 'avgCost'))
  const currentMark = marks?.currentPrice != null ? snap(marks.currentPrice) : null
  if (currentMark != null && inWindow(currentMark)) rows.push(rowFor(currentMark, 'current'))

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
