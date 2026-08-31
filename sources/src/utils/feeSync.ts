/**
 * Pure decision logic for reconciling the `workspaces.fee_rate` row with the
 * `localStorage` cache. See docs/agent/specs/fee-rate-persistence.md for the contract.
 */

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
