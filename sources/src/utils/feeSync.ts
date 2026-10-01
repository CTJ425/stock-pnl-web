/**
 * Pure decision logic for reconciling the `workspaces.fee_rate` row with the
 * `localStorage` cache. See docs/agent/specs/fee-rate-persistence.md for the contract.
 */

import type { FeeRateSegment } from '../types/models'
import { normalizeFeeRateHistory } from './feeRateHistory'

export type FeeSyncAction =
  | { kind: 'adopt-remote'; rate: number }
  | { kind: 'push-local'; rate: number }
  | { kind: 'none' }

/** A rate is valid when it is a finite number, >= 0 and < 1. Zero is a real setting. */
export function isValidFeeRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1
}

export function planFeeSync(
  remote: number | null | undefined,
  local: number | null,
): FeeSyncAction {
  if (isValidFeeRate(remote)) {
    if (remote !== local) return { kind: 'adopt-remote', rate: remote }
    return { kind: 'none' }
  }
  if (isValidFeeRate(local)) return { kind: 'push-local', rate: local }
  return { kind: 'none' }
}

export type FeeHistorySyncAction =
  | { kind: 'adopt-remote'; history: FeeRateSegment[] }
  | { kind: 'push-local'; history: FeeRateSegment[] }
  | { kind: 'none' }

/**
 * Same contract as `planFeeSync`, for the fee-rate history (Task 182). The row wins whenever it
 * has one, including an explicit empty array — that is how "I deleted every segment" reaches the
 * other devices. Only a missing column / never-written row (null or undefined) lets a non-empty
 * local cache push upwards, which is what carries a history written before the migration ran.
 */
export function planFeeHistorySync(
  remote: unknown,
  local: FeeRateSegment[] | null,
  base?: number | null,
): FeeHistorySyncAction {
  const baseRate = typeof base === 'number' ? base : undefined
  const localNorm = normalizeFeeRateHistory(local ?? [], baseRate)
  if (Array.isArray(remote)) {
    const remoteNorm = normalizeFeeRateHistory(remote, baseRate)
    if (JSON.stringify(remoteNorm) === JSON.stringify(localNorm)) return { kind: 'none' }
    return { kind: 'adopt-remote', history: remoteNorm }
  }
  if (localNorm.length > 0) return { kind: 'push-local', history: localNorm }
  return { kind: 'none' }
}
