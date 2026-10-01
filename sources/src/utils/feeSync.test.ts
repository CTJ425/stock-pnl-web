/**
 * planFeeSync decides which side wins when the workspace row and the localStorage cache
 * disagree about the fee rate. The rule that earns its own test is S8: a rate of 0 is a
 * real setting, not an unset one, so a falsy check would silently discard it.
 */
import { describe, it, expect } from 'vitest'
import { planFeeHistorySync, planFeeSync, isValidFeeRate } from './feeSync'

describe('isValidFeeRate', () => {
  it('accepts 0 and rejects the boundary, negatives and non-numbers', () => {
    expect(isValidFeeRate(0)).toBe(true)
    expect(isValidFeeRate(0.001425)).toBe(true)
    expect(isValidFeeRate(1)).toBe(false)
    expect(isValidFeeRate(-0.1)).toBe(false)
    expect(isValidFeeRate(NaN)).toBe(false)
    expect(isValidFeeRate(null)).toBe(false)
    expect(isValidFeeRate('0.001')).toBe(false)
  })
})

describe('planFeeSync', () => {
  it('S1 adopts the remote rate when the cache is empty', () => {
    expect(planFeeSync(0.0004275, null)).toEqual({ kind: 'adopt-remote', rate: 0.0004275 })
  })

  it('S2 adopts the remote rate when the cache disagrees', () => {
    expect(planFeeSync(0.0004275, 0.001425)).toEqual({ kind: 'adopt-remote', rate: 0.0004275 })
  })

  it('S3 does nothing when both sides agree', () => {
    expect(planFeeSync(0.0004275, 0.0004275)).toEqual({ kind: 'none' })
  })

  it('S4 pushes the cache up when the row has no rate', () => {
    expect(planFeeSync(null, 0.0004275)).toEqual({ kind: 'push-local', rate: 0.0004275 })
  })

  it('S5 does nothing when neither side has a rate', () => {
    expect(planFeeSync(null, null)).toEqual({ kind: 'none' })
  })

  it('S6 treats an absent column as no rate', () => {
    expect(planFeeSync(undefined, null)).toEqual({ kind: 'none' })
  })

  it('S7 treats an out-of-range row value as unset and pushes the cache up', () => {
    expect(planFeeSync(1.5, 0.0004275)).toEqual({ kind: 'push-local', rate: 0.0004275 })
  })

  it('S8 adopts a remote rate of 0, because zero is a setting and not "unset"', () => {
    expect(planFeeSync(0, null)).toEqual({ kind: 'adopt-remote', rate: 0 })
  })
})

// Task 182: the history reconciles on the same contract as the rate itself.
describe('planFeeHistorySync', () => {
  const H = [{ from: '2026-10-01', rate: 0.0005415 }]

  it('H1 adopts the row whenever it has one', () => {
    expect(planFeeHistorySync(H, [])).toEqual({ kind: 'adopt-remote', history: H })
  })

  it('H2 does nothing when the two already agree', () => {
    expect(planFeeHistorySync(H, H)).toEqual({ kind: 'none' })
  })

  it('H3 adopts an empty row array — that is how a deletion reaches the other devices', () => {
    expect(planFeeHistorySync([], H)).toEqual({ kind: 'adopt-remote', history: [] })
  })

  it('H4 pushes the cache up when the column is missing or never written', () => {
    expect(planFeeHistorySync(null, H)).toEqual({ kind: 'push-local', history: H })
    expect(planFeeHistorySync(undefined, H)).toEqual({ kind: 'push-local', history: H })
  })

  it('H5 does nothing when neither side has a history', () => {
    expect(planFeeHistorySync(null, [])).toEqual({ kind: 'none' })
  })

  it('H6 normalises before comparing, so ordering alone is not a difference', () => {
    const unsorted = [
      { from: '2027-01-01', rate: 0.0004275 },
      { from: '2026-10-01', rate: 0.0005415 },
    ]
    const sorted = [
      { from: '2026-10-01', rate: 0.0005415 },
      { from: '2027-01-01', rate: 0.0004275 },
    ]
    expect(planFeeHistorySync(unsorted, sorted)).toEqual({ kind: 'none' })
  })
})
