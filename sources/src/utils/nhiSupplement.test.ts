/**
 * The estimate exists to be *offered*, so the only thing worth pinning is that it reproduces a
 * real broker deduction. Both cases below are the user's own 2026 dividend notices: 陽明 cleared
 * the threshold and came back 601 short, 0050 did not and came back 10 short.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WIRE_FEE,
  NHI_RULES,
  estimateNhi,
  estimateWithholding,
  nhiRuleOn,
} from './nhiSupplement'

describe('estimateNhi', () => {
  it('reproduces the 陽明 notice: 28,000 × 2.11% = 590.8 withheld as 591', () => {
    expect(estimateNhi(28_000, '2026-08-05')).toBe(591)
    expect(estimateWithholding(28_000, '2026-08-05').total).toBe(601)
    expect(28_000 - estimateWithholding(28_000, '2026-08-05').total).toBe(27_399)
  })

  it('charges nothing below the 20,000 threshold — the 0050 notice is the wire fee alone', () => {
    expect(estimateNhi(1_200, '2026-08-10')).toBe(0)
    const est = estimateWithholding(1_200, '2026-08-10')
    expect(est).toMatchObject({ nhi: 0, wire: 10, total: 10, belowThreshold: true, threshold: 20_000 })
    expect(1_200 - est.total).toBe(1_190)
  })

  it('charges the whole payment once it reaches the threshold, not only the excess', () => {
    // The boundary itself is charged: 20,000 × 2.11% = 422, not 0 and not a marginal amount.
    expect(estimateNhi(19_999, '2026-01-01')).toBe(0)
    expect(estimateNhi(20_000, '2026-01-01')).toBe(422)
  })

  it('rounds to the whole dollar rather than truncating', () => {
    // 21,100 × 2.11% = 445.21 → 445; 28,000 → 590.8 → 591. Truncation would give 590 and miss 陽明.
    expect(estimateNhi(21_100, '2026-01-01')).toBe(445)
    expect(estimateNhi(28_000, '2026-01-01')).toBe(591)
  })

  it('stops counting above the single-payment cap', () => {
    const { cap, rate } = nhiRuleOn('2026-01-01')
    expect(estimateNhi(cap, '2026-01-01')).toBe(Math.round(cap * rate))
    expect(estimateNhi(cap * 2, '2026-01-01')).toBe(estimateNhi(cap, '2026-01-01'))
  })

  it('returns 0 for a gross that is not a positive number', () => {
    expect(estimateNhi(0, '2026-01-01')).toBe(0)
    expect(estimateNhi(-5_000, '2026-01-01')).toBe(0)
    expect(estimateNhi(Number.NaN, '2026-01-01')).toBe(0)
  })
})

describe('nhiRuleOn', () => {
  it('reads the rule in force on the payment date, not the newest one', () => {
    // With one segment every date resolves to it; the property that matters is that a date before
    // the table starts still gets a real rule instead of undefined.
    expect(nhiRuleOn('1999-01-01')).toBe(NHI_RULES[0])
    expect(nhiRuleOn('2026-08-05').rate).toBe(0.0211)
  })

  it('keeps the segments ascending, so a later one never hides an earlier one', () => {
    const sorted = [...NHI_RULES].sort((a, b) => a.from.localeCompare(b.from))
    expect(NHI_RULES.map((r) => r.from)).toEqual(sorted.map((r) => r.from))
  })
})

describe('estimateWithholding', () => {
  it('takes a wire fee of its own and rounds it', () => {
    expect(estimateWithholding(28_000, '2026-08-05', 30).total).toBe(621)
    expect(estimateWithholding(28_000, '2026-08-05', 0)).toMatchObject({ wire: 0, total: 591 })
    expect(estimateWithholding(28_000, '2026-08-05', 9.6).wire).toBe(10)
  })

  it('defaults to the 10 元 wire fee', () => {
    expect(DEFAULT_WIRE_FEE).toBe(10)
    expect(estimateWithholding(1_000, '2026-01-01').wire).toBe(DEFAULT_WIRE_FEE)
  })

  it('does not flag belowThreshold when there is no payment at all', () => {
    expect(estimateWithholding(0, '2026-01-01').belowThreshold).toBe(false)
  })
})
