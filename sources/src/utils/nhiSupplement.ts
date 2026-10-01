/**
 * 二代健保補充保費 (NHI supplementary premium) on a Taiwan cash dividend — an **input hint only**.
 *
 * What the law says: a single dividend payment of NT$20,000 or more is charged 2.11% of the whole
 * payment, capped at a payment of NT$10,000,000. Below the threshold nothing is charged, which is
 * why a small ETF distribution comes back short by the wire fee alone.
 *
 * Why this never runs on read. The figure this module produces is offered beside the 代扣費用 field
 * and, once the user saves, it is just `transactions.fee_tax` — a number typed by a human against
 * their broker's dividend notice. The broker's figure is the authority: wire fees differ between
 * 股務代理, a same-payment stock dividend raises the base by its 面額 (which this module cannot see
 * from one row), and the 衛福部 has a standing proposal to move interest and dividends to an
 * **annual** settlement, which no per-payment formula can express. Computing on read would make
 * every one of those changes rewrite figures the user already reconciled years ago.
 *
 * The rules therefore carry a `from` date, the same shape as `feeRateHistory`: a dividend paid in
 * 2026 is estimated with the rule that was in force in 2026, whatever the table gains later.
 */

/** One period's parameters. `from` is inclusive and 'YYYY-MM-DD'. */
export interface NhiRule {
  from: string
  /** Premium rate applied to the whole payment once it reaches `min`. */
  rate: number
  /** 起扣點: a single payment below this is not charged at all. */
  min: number
  /** 單次給付上限: the part of a payment above this is not counted. */
  cap: number
}

/**
 * Ascending by `from`. 2.11% has been the rate since 2021-01-01 and the NT$20,000 threshold since
 * 2016-01-01; the project has no dividend older than that, so one segment covers every row it can
 * ever hold. Add a segment when the law changes — never edit this one, or history moves.
 */
export const NHI_RULES: readonly NhiRule[] = [
  { from: '2021-01-01', rate: 0.0211, min: 20_000, cap: 10_000_000 },
]

/** The wire fee most 股務代理 deduct per payment. A starting value for the hint, not a constant of nature. */
export const DEFAULT_WIRE_FEE = 10

/** The rule in force on `date`; the earliest rule for any date before the table starts. */
export function nhiRuleOn(date: string): NhiRule {
  let rule = NHI_RULES[0]
  for (const candidate of NHI_RULES) {
    if (candidate.from <= date) rule = candidate
    else break
  }
  return rule
}

/**
 * The premium withheld from a single payment of `gross`, rounded to the whole dollar.
 *
 * Rounding is 四捨五入, which is what the user's own 陽明 notice shows: 28,000 × 2.11% = 590.8 was
 * withheld as 591, and 591 + 10 wire fee is exactly the 601 the broker deducted.
 */
export function estimateNhi(gross: number, date: string): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0
  const { rate, min, cap } = nhiRuleOn(date)
  if (gross < min) return 0
  return Math.round(Math.min(gross, cap) * rate)
}

/** What the hint prints: the premium, the wire fee, and the total to drop into 代扣費用. */
export interface WithholdingEstimate {
  nhi: number
  wire: number
  total: number
  /** True when `gross` did not reach the threshold, so only the wire fee is left. */
  belowThreshold: boolean
  /** The threshold that was applied, for the explanatory line. */
  threshold: number
}

export function estimateWithholding(
  gross: number,
  date: string,
  wireFee: number = DEFAULT_WIRE_FEE,
): WithholdingEstimate {
  const { min } = nhiRuleOn(date)
  const nhi = estimateNhi(gross, date)
  const wire = Number.isFinite(wireFee) && wireFee > 0 ? Math.round(wireFee) : 0
  return {
    nhi,
    wire,
    total: nhi + wire,
    belowThreshold: gross > 0 && gross < min,
    threshold: min,
  }
}
