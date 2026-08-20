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

/** Candidate step multipliers, tried smallest first (Renard-ish "round price" grid). */
const STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10]

/**
 * Round-price step size for a `[lo, hi]window: about 12 steps across the window, snapped
 * up to the first "nice" multiplier so grid lines land on round prices, never finer than
 * the TWSE 0.01 tick.
 */
function stepSize(lo: number, hi: number): number {
  const raw = (hi - lo) / 12
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = STEP_MULTIPLIERS.find((m) => m * mag >= raw)! * mag
  return Math.max(step, 0.01)
}

/**
 * Nine price steps around `input.price` (±10%, 2.5% apart) plus, when they fall inside
 * that window, marked rows for break-even (always computed from `input`) and the caller-
 * supplied `currentPrice` / `avgCost`. `sellLadder` never reads `avgCost` off `input`
 * itself — the anchor is always `input.price`, chosen by the caller. Rows are ordered
 * highest price first (+10% on top). Each row's pnl/roi/proceeds/sellFeeTax is a fresh
 * `whatIf` call at that row's price — the ladder never interpolates fees.
 *
 * When `marks.avgCost` is a real holding (> 0), the window switches to a union that
 * always covers the anchor, the average cost, and the live quote, laid out on a round-
 * price grid instead of fixed 2.5% steps — see `stepSize`. A watched stock (no avgCost)
 * keeps the fixed ±10% / 2.5% ladder unchanged.
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

  const avgCostForWindow = marks?.avgCost != null && marks.avgCost > 0 ? marks.avgCost : null
  const currentForWindow =
    marks?.currentPrice != null && Number.isFinite(marks.currentPrice) && marks.currentPrice > 0
      ? marks.currentPrice
      : null

  let stepRows: LadderRow[]
  let windowLo: number | null = null
  let windowHi: number | null = null
  if (avgCostForWindow != null) {
    const lo = Math.min(anchor, avgCostForWindow, currentForWindow ?? Infinity) * 0.9
    const hi = Math.max(anchor, avgCostForWindow, currentForWindow ?? -Infinity) * 1.1
    const step = stepSize(lo, hi)
    const start = Math.ceil(lo / step)
    const end = Math.floor(hi / step)
    const prices: number[] = []
    for (let i = start; i <= end; i++) prices.push(snap(i * step))
    stepRows = prices.map((p) => rowFor(p, 'step'))
    if (stepRows.length >= 2) {
      windowLo = lo
      windowHi = hi
    }
  } else {
    stepRows = []
  }

  if (stepRows.length < 2) {
    stepRows = LADDER_STEPS.map((p) => rowFor(snap(anchor * (1 + p)), 'step'))
    windowLo = null
    windowHi = null
  }

  const rows = [...stepRows]
  // Mode 2's grid rounds inward (ceil/floor), so the window itself — not the grid extremes
  // — is the correct test: an outermost mark can legitimately sit outside the grid's own rows.
  const minStepPrice = windowLo ?? Math.min(...stepRows.map((r) => r.price))
  const maxStepPrice = windowHi ?? Math.max(...stepRows.map((r) => r.price))
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
