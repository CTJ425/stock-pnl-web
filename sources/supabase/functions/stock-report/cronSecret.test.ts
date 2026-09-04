import { describe, expect, it } from 'vitest'
import { secretsMatch } from './cronSecret.ts'

/**
 * AUDIT-13: `assertCronSecret` compared the header against `CRON_SECRET` with `!==`, which returns
 * as soon as it meets a differing byte. `secretsMatch` replaces it with a comparison whose work does
 * not depend on where the first difference is. The tests below can only pin the *result*; the
 * constant-time property is a property of the implementation, not something a test can observe.
 */
describe('secretsMatch', () => {
  it('相同字串為 true', () => {
    expect(secretsMatch('s3cr3t-value', 's3cr3t-value')).toBe(true)
  })

  it('內容不同為 false，不論差異出現在哪一個位元組', () => {
    expect(secretsMatch('Xs3cr3t-value', 's3cr3t-valueX')).toBe(false)
    expect(secretsMatch('s3cr3t-valuX', 's3cr3t-value')).toBe(false)
    expect(secretsMatch('X3cr3t-value', 's3cr3t-value')).toBe(false)
  })

  it('長度不同為 false', () => {
    expect(secretsMatch('s3cr3t', 's3cr3t-value')).toBe(false)
    expect(secretsMatch('s3cr3t-value-longer', 's3cr3t-value')).toBe(false)
  })

  it('空字串只與空字串相同', () => {
    expect(secretsMatch('', '')).toBe(true)
    expect(secretsMatch('', 's3cr3t')).toBe(false)
    expect(secretsMatch('s3cr3t', '')).toBe(false)
  })

  it('多位元組字元逐位元組比較', () => {
    expect(secretsMatch('祕密-token', '祕密-token')).toBe(true)
    expect(secretsMatch('祕密-token', '秘密-token')).toBe(false)
  })
})
