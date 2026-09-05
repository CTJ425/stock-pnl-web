/**
 * AUDIT-13: `assertCronSecret` used to compare the header against `CRON_SECRET` with `!==`,
 * which returns as soon as it hits a differing byte — an attacker measuring response timing
 * could learn the secret one byte at a time. `secretsMatch` replaces it with a comparison whose
 * work does not depend on where the first difference is. The constant-time property is a
 * property of this implementation; no test can observe it directly.
 *
 * Copied verbatim from stock-report/cronSecret.ts (BUG-070) — an Edge function bundles only
 * its own directory, so this cannot be a cross-directory import.
 */
export function secretsMatch(got: string, expected: string): boolean {
  const a = new TextEncoder().encode(got)
  const b = new TextEncoder().encode(expected)
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const x = i < a.length ? a[i] : 0
    const y = i < b.length ? b[i] : 0
    diff |= x ^ y
  }
  return diff === 0
}
