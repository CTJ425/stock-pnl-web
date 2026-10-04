import { describe, expect, it } from 'vitest'
import { GENERATE_DAILY_LIMIT, generateQuotaKey } from './quotaKeys.ts'

describe('generateQuotaKey', () => {
  it('is distinct from the warm key of the same day', () => {
    expect(generateQuotaKey('20261004')).not.toBe('20261004')
  })

  it('sorts below the next day, so pruneChipCache (ymd < cutoff) clears it', () => {
    // Task 193 M11: a key that sorted above the date would never be pruned and the table would grow.
    expect(generateQuotaKey('20261004') < '20261005').toBe(true)
    expect(generateQuotaKey('20261004') < '20261004').toBe(false)
  })

  it('leaves room for real use', () => {
    expect(GENERATE_DAILY_LIMIT).toBeGreaterThanOrEqual(100)
  })
})
