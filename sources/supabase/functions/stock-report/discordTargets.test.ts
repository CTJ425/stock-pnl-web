import { describe, expect, it } from 'vitest'
import { FAKE_WEBHOOK } from './discordTestFixtures.ts'
import { groupMarketTargets } from './discordTargets.ts'

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
        { userId: 'u1', url: HOOK_A },
        { userId: 'u2', url: HOOK_B },
      ]),
    ).toEqual([
      { url: HOOK_A, userIds: ['u1'] },
      { url: HOOK_B, userIds: ['u2'] },
    ])
  })

  it('groups accounts that share a URL, in first-appearance order', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_B },
        { userId: 'u2', url: HOOK_A },
        { userId: 'u3', url: HOOK_B },
      ]),
    ).toEqual([
      { url: HOOK_B, userIds: ['u1', 'u3'] },
      { url: HOOK_A, userIds: ['u2'] },
    ])
  })

  it('drops a URL equal to the global one, after trimming both', () => {
    expect(
      groupMarketTargets(` ${GLOBAL}\n`, [
        { userId: 'u1', url: GLOBAL },
        { userId: 'u2', url: `  ${GLOBAL}` },
        { userId: 'u3', url: HOOK_A },
      ]),
    ).toEqual([{ url: HOOK_A, userIds: ['u3'] }])
  })

  it('treats URLs that differ only by whitespace as one target', () => {
    expect(
      groupMarketTargets(GLOBAL, [
        { userId: 'u1', url: HOOK_A },
        { userId: 'u2', url: ` ${HOOK_A} ` },
      ]),
    ).toEqual([{ url: HOOK_A, userIds: ['u1', 'u2'] }])
  })
})
