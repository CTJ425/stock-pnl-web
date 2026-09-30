/**
 * Shared arithmetic for 年度收益 and 區間收益 (Task 176). Both tables answer the same question over
 * a different slice of the same sell legs, so the oversold rule below must have exactly one home.
 */
import type { SellDetail } from '../../utils/pnlEngine'

/** Price difference without any fees: 成交價金 − 未含費成本, the figure to compare with the broker. */
export function rawRealized(d: { sellGross: number; rawCostBasis: number }): number {
  return d.sellGross - d.rawCostBasis
}

/**
 * DA-07: a year's (or a ticker's) ROI must skip oversold sell legs (`SellDetail.oversold`)
 * entirely, in both the numerator and the denominator — an oversold leg's cost basis is already
 * 0 (nothing was actually held for the excess shares), so folding its full sale proceeds into
 * `realized` without a matching `costBasis` would inflate the percentage. When every leg is
 * oversold this sums to 0 realized / 0 cost, which `RoiCell` already renders as "—".
 */
export function roiBasis(sells: SellDetail[]): {
  realized: number
  costBasis: number
  raw: number
  rawCostBasis: number
} {
  let realized = 0
  let costBasis = 0
  let raw = 0
  let rawCostBasis = 0
  for (const s of sells) {
    if (s.oversold) continue
    realized += s.realized
    costBasis += s.costBasis
    raw += rawRealized(s)
    rawCostBasis += s.rawCostBasis
  }
  return { realized, costBasis, raw, rawCostBasis }
}
