import { describe, expect, it } from 'vitest'
import {
  normalizeFeeRateHistory,
  rateOn,
  withFeeRateFrom,
  withoutFeeRateFrom,
  type FeeRateSegment,
} from './feeRateHistory'

const STATUTORY = 0.001425
const R65 = 0.00092625 // 6.5 折
const R38 = 0.0005415 // 3.8 折
const R30 = 0.0004275 // 3 折

const ESUN: FeeRateSegment[] = [{ from: '2026-10-01', rate: R38 }]

describe('rateOn', () => {
  it('returns the base rate before the first segment', () => {
    expect(rateOn(ESUN, R65, '2026-09-30', STATUTORY)).toBe(R65)
    expect(rateOn(ESUN, R65, '2020-01-01', STATUTORY)).toBe(R65)
  })

  it('takes effect on the `from` date itself', () => {
    expect(rateOn(ESUN, R65, '2026-10-01', STATUTORY)).toBe(R38)
    expect(rateOn(ESUN, R65, '2026-10-02', STATUTORY)).toBe(R38)
  })

  it('picks the newest segment already in effect', () => {
    const h = [
      { from: '2026-10-01', rate: R38 },
      { from: '2027-01-01', rate: R30 },
    ]
    expect(rateOn(h, R65, '2026-12-31', STATUTORY)).toBe(R38)
    expect(rateOn(h, R65, '2027-01-01', STATUTORY)).toBe(R30)
  })

  it('falls back to the statutory rate when the workspace has no rate at all', () => {
    expect(rateOn(null, null, '2026-09-30', STATUTORY)).toBe(STATUTORY)
    expect(rateOn([], undefined, '2026-09-30', STATUTORY)).toBe(STATUTORY)
    // A base outside [0, 1) is not a rate; the segment still applies on its own dates.
    expect(rateOn(ESUN, 1.5, '2026-09-30', STATUTORY)).toBe(STATUTORY)
    expect(rateOn(ESUN, 1.5, '2026-10-01', STATUTORY)).toBe(R38)
  })

  it('treats a zero rate as a real setting, not as missing', () => {
    expect(rateOn([{ from: '2026-10-01', rate: 0 }], R65, '2026-10-01', STATUTORY)).toBe(0)
    expect(rateOn(null, 0, '2026-10-01', STATUTORY)).toBe(0)
  })

  it('ignores a malformed entry instead of throwing', () => {
    const dirty = [{ from: 'yesterday', rate: R38 }, { from: '2026-10-01', rate: R38 }] as FeeRateSegment[]
    expect(rateOn(dirty, R65, '2026-10-02', STATUTORY)).toBe(R65)
    expect(rateOn(normalizeFeeRateHistory(dirty, R65), R65, '2026-10-02', STATUTORY)).toBe(R38)
  })
})

describe('normalizeFeeRateHistory', () => {
  it('sorts ascending and lets a later save win the same date', () => {
    const h = normalizeFeeRateHistory(
      [
        { from: '2027-01-01', rate: R30 },
        { from: '2026-10-01', rate: R65 },
        { from: '2026-10-01', rate: R38 },
      ],
      R65,
    )
    expect(h).toEqual([
      { from: '2026-10-01', rate: R38 },
      { from: '2027-01-01', rate: R30 },
    ])
  })

  it('drops a segment that does not change the effective rate', () => {
    expect(normalizeFeeRateHistory([{ from: '2026-10-01', rate: R65 }], R65)).toEqual([])
    expect(
      normalizeFeeRateHistory(
        [
          { from: '2026-10-01', rate: R38 },
          { from: '2026-11-01', rate: R38 },
        ],
        R65,
      ),
    ).toEqual([{ from: '2026-10-01', rate: R38 }])
  })

  it('keeps a segment that returns to the base rate later', () => {
    const h = normalizeFeeRateHistory(
      [
        { from: '2026-10-01', rate: R38 },
        { from: '2026-11-01', rate: R65 },
      ],
      R65,
    )
    expect(h).toHaveLength(2)
    expect(rateOn(h, R65, '2026-11-01', STATUTORY)).toBe(R65)
  })

  it('discards junk: non-arrays, bad dates, out-of-range rates', () => {
    expect(normalizeFeeRateHistory(null)).toEqual([])
    expect(normalizeFeeRateHistory('nope')).toEqual([])
    expect(
      normalizeFeeRateHistory([
        { from: '2026-13-99', rate: R38 },
        { from: '2026/10/01', rate: R38 },
        { from: '2026-10-01', rate: 1.5 },
        { from: '2026-10-01', rate: -1 },
        null,
        42,
      ]),
    ).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = [{ from: '2026-10-01', rate: R38 }]
    normalizeFeeRateHistory(input, R65)
    expect(input).toEqual([{ from: '2026-10-01', rate: R38 }])
  })
})

describe('withFeeRateFrom / withoutFeeRateFrom', () => {
  it('adds a segment and replaces one on the same date', () => {
    const added = withFeeRateFrom(null, R65, '2026-10-01', R38)
    expect(added).toEqual([{ from: '2026-10-01', rate: R38 }])
    expect(withFeeRateFrom(added, R65, '2026-10-01', R30)).toEqual([{ from: '2026-10-01', rate: R30 }])
  })

  it('removes a segment, restoring the rate that preceded it', () => {
    const h = withFeeRateFrom(null, R65, '2026-10-01', R38)
    expect(withoutFeeRateFrom(h, R65, '2026-10-01')).toEqual([])
    expect(rateOn(withoutFeeRateFrom(h, R65, '2026-10-01'), R65, '2026-10-02', STATUTORY)).toBe(R65)
  })
})
