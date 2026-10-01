/**
 * Which fee rate the dashboard withholds on Taiwan unrealized P&L (2026-09-26 redesign).
 *
 * Broker apps disagree: a 月退 (monthly-rebate) broker charges the statutory 0.1425% at trade
 * time and refunds the discount later, so its app withholds the full rate; a 現折 broker withholds
 * the discounted rate. The basis is derived from the workspace's own fee settings, never stored
 * separately, so the two can not drift apart. US rows have no statutory rate to withhold and
 * always use the net figure.
 */
import type { FeeRebate } from '../types/models'
import { DEFAULT_FEE_RATE } from './fees'
import type { HoldingRow } from './holdingRows'

export type PnlBasis = 'net' | 'list'

export function pnlBasis(feeRate: number, rebate: FeeRebate | null | undefined): PnlBasis {
  return rebate === 'monthly' && feeRate < DEFAULT_FEE_RATE ? 'list' : 'net'
}

/** 0.001425 → '0.1425%', 0.000399 → '0.0399%'. */
export function formatFeeRatePct(rate: number): string {
  return `${(rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`
}

/** The short phrase the dashboard prints under 未實現淨損益, e.g. 「牌告 0.1425% 預扣」. */
export function basisLabel(basis: PnlBasis, feeRate: number): string {
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
