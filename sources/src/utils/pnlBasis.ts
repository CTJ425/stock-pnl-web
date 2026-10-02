/**
 * Which fee rate the dashboard withholds on Taiwan unrealized P&L (2026-09-26 redesign).
 *
 * Broker apps disagree. Until Task 189 the basis was derived from the rebate alone (月退 + a
 * discount = the posted rate), but that tied two separate facts together: what settlement charges
 * (the rebate, published by the broker) and which rate the app withholds on a sell (only visible
 * in the app — 元大 withholds the posted rate although it charges the discount at settlement). The
 * sell side is now its own setting, `sell_fee_basis`; null keeps the old derivation so a workspace
 * saved before it does not move. US rows have no statutory rate and always use the net figure.
 */
import type { FeeRebate, SellFeeBasis } from '../types/models'
import { DEFAULT_FEE_RATE } from './fees'
import type { HoldingRow } from './holdingRows'

export type PnlBasis = SellFeeBasis

/**
 * Whether the 券商 figure carries the list-price buy fee in cost (Task 189). Only a workspace that
 * saved its fee settings under the split (`sell_fee_basis` set) and says 月退 gets it. A NULL basis
 * is a workspace reconciled before the split, and it must not move by itself: PROD Ron的投資組合
 * was 月退 only to get the posted-rate sell, while 元大 is 日退 and its app keeps the recorded fee
 * (2303 would have moved −1,070 → −1,393 at the same price).
 */
export function listPriceCost(rebate: FeeRebate | null | undefined, sellFeeBasis: SellFeeBasis | null | undefined): boolean {
  return rebate === 'monthly' && sellFeeBasis != null
}

/** What a workspace that never chose a sell-fee basis gets: the pre-Task-189 rule. */
export function defaultSellFeeBasis(feeRate: number, rebate: FeeRebate | null | undefined): PnlBasis {
  return rebate === 'monthly' && feeRate < DEFAULT_FEE_RATE ? 'list' : 'net'
}

export function pnlBasis(
  feeRate: number,
  rebate: FeeRebate | null | undefined,
  sellFeeBasis?: SellFeeBasis | null,
): PnlBasis {
  // A chosen basis holds even at the posted rate: the sell fee is then the same either way, but
  // under 月退 'list' still carries lots bought under an earlier discount at their list-price cost.
  return sellFeeBasis ?? defaultSellFeeBasis(feeRate, rebate)
}

/** 0.001425 → '0.1425%', 0.000399 → '0.0399%'. */
export function formatFeeRatePct(rate: number): string {
  return `${(rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`
}

/**
 * The short phrase the dashboard prints under 未實現淨損益, e.g. 「牌告 0.1425% 預扣」. When the
 * posted-rate figure also carries the list-price buy fee in cost (`listPriceCost`), it says so.
 */
export function basisLabel(basis: PnlBasis, feeRate: number, listCost = false): string {
  if (basis === 'list' && listCost) return `牌告 ${formatFeeRatePct(DEFAULT_FEE_RATE)} 計成本與預扣`
  if (basis === 'list' || feeRate >= DEFAULT_FEE_RATE) return `牌告 ${formatFeeRatePct(DEFAULT_FEE_RATE)} 預扣`
  return `折扣後 ${formatFeeRatePct(feeRate)} 預扣`
}

/** A row's unrealized P&L under the basis. Falls back to the net figure where 牌告 does not apply. */
export function rowUnrealized(row: HoldingRow, basis: PnlBasis): number | null {
  if (basis === 'list' && !row.brokerNotApplicable && row.brokerUnrealized !== null) return row.brokerUnrealized
  return row.unrealized
}

/** A row's unrealized return under the basis, same fallback as `rowUnrealized`. */
export function rowRoi(row: HoldingRow, basis: PnlBasis): number | null {
  if (basis === 'list' && !row.brokerNotApplicable && row.brokerRoi !== null) return row.brokerRoi
  return row.roi
}
