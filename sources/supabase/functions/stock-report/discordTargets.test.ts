import { describe, expect, it } from 'vitest'
import { FAKE_WEBHOOK } from './discordTestFixtures.ts'
import { groupMarketTargets, toMarketOverride } from './discordTargets.ts'

const GLOBAL = FAKE_WEBHOOK
const HOOK_A = FAKE_WEBHOOK.replace(/.{4}$/, 'Aaaa')
const HOOK_B = FAKE_WEBHOOK.replace(/.{4}$/, 'Bbbb')

describe('groupMarketTargets', () => {
  it('returns nothing without overrides', () => {
    expect(groupMarketTargets(GLOBAL, [])).toEqual([])
  })

  it('gives each distinct URL one target', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_A, enabled: true },
        { userId: 'u2', url: HOOK_B, enabled: true },
      ]),
    ).toEqual([
      { url: HOOK_A, userIds: ['u1'] },
      { url: HOOK_B, userIds: ['u2'] },
    ])
  })

  it('groups accounts that share a URL, in first-appearance order', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_B, enabled: true },
        { userId: 'u2', url: HOOK_A, enabled: true },
        { userId: 'u3', url: HOOK_B, enabled: true },
      ]),
    ).toEqual([
      { url: HOOK_B, userIds: ['u1', 'u3'] },
      { url: HOOK_A, userIds: ['u2'] },
    ])
  })

  it('drops a URL equal to the global one, after trimming both', () => {
    expect(
      groupMarketTargets(` ${GLOBAL}\n`, [
        { userId: 'u1', url: GLOBAL, enabled: true },
        { userId: 'u2', url: `  ${GLOBAL}`, enabled: true },
        { userId: 'u3', url: HOOK_A, enabled: true },
      ]),
    ).toEqual([{ url: HOOK_A, userIds: ['u3'] }])
  })

  it('treats URLs that differ only by whitespace as one target', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_A, enabled: true },
        { userId: 'u2', url: ` ${HOOK_A} `, enabled: true },
      ]),
    ).toEqual([{ url: HOOK_A, userIds: ['u1', 'u2'] }])
  })

  it('drops an override whose account switched 經濟快報 off', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_A, enabled: false },
        { userId: 'u2', url: HOOK_B, enabled: true },
      ]),
    ).toEqual([{ url: HOOK_B, userIds: ['u2'] }])
  })

  it('keeps a shared URL alive for the accounts that are still on', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_A, enabled: true },
        { userId: 'u2', url: HOOK_A, enabled: false },
        { userId: 'u3', url: HOOK_A, enabled: true },
      ]),
    ).toEqual([{ url: HOOK_A, userIds: ['u1', 'u3'] }])
  })

  it('returns nothing when every override is switched off', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_A, enabled: false },
        { userId: 'u2', url: HOOK_B, enabled: false },
      ]),
    ).toEqual([])
  })
})

/** Task 165 step 2e (spec §5b.6). `db.select()` types as `any`, so a column left out of the
 * query is invisible to the compiler — this mapper is the only thing that catches it. */
describe('toMarketOverride', () => {
  it('maps a settings row', () => {
    expect(
      toMarketOverride({ user_id: 'u1', market_webhook_url: HOOK_A, market_enabled: true }),
    ).toEqual({ userId: 'u1', url: HOOK_A, enabled: true })
  })

  it('keeps a switched-off row instead of silently dropping it', () => {
    expect(
      toMarketOverride({ user_id: 'u1', market_webhook_url: HOOK_A, market_enabled: false }),
    ).toEqual({ userId: 'u1', url: HOOK_A, enabled: false })
  })

  it('throws when the query forgot market_enabled', () => {
    expect(() => toMarketOverride({ user_id: 'u1', market_webhook_url: HOOK_A })).toThrow()
  })

  it('throws when market_enabled is not a boolean', () => {
    expect(() =>
      toMarketOverride({ user_id: 'u1', market_webhook_url: HOOK_A, market_enabled: 'true' }),
    ).toThrow()
  })

  it('throws when the URL is missing', () => {
    expect(() => toMarketOverride({ user_id: 'u1', market_webhook_url: null, market_enabled: true })).toThrow()
  })
})
