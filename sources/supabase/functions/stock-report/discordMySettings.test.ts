/**
 * Task 165 step 2e — the signed-in account editing its own two Discord webhooks.
 * Spec: docs/agent/specs/discord-user-self-service.md §5.3 and §7.
 *
 * The §7 invariants are what this file exists for: the caller id comes from the JWT, a URL is
 * never taken from the request body, and no response may carry a whole webhook URL.
 */
import { describe, expect, it, vi } from 'vitest'
import { runMySettingsOp, type MySettingsDeps, type MySettingsResult } from './discordMySettings.ts'
import { FAKE_WEBHOOK, MARKET_DAY_0916 } from './discordTestFixtures.ts'
import type { DiscordPayload, DiscordSendResult } from './discordWebhook.ts'

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const MARKET_HOOK = FAKE_WEBHOOK.replace(/.{4}$/, 'Mmmm')
const HOLD_HOOK = FAKE_WEBHOOK.replace(/.{4}$/, 'Hhhh')
const GLOBAL_HOOK = FAKE_WEBHOOK.replace(/.{4}$/, 'Gggg')
const AT = new Date('2026-09-16T09:00:00Z')

function fake(over: Record<string, unknown> = {}) {
  const d = {
    now: vi.fn(() => AT),
    loadMarketFile: vi.fn(async () => ({ days: [MARKET_DAY_0916] })),
    loadWorkspaces: vi.fn(async () => []),
    fetchChart: vi.fn(async () => null),
    post: vi.fn(async (_u: string, _p: DiscordPayload): Promise<DiscordSendResult> => ({ ok: true, httpStatus: 204 })),
    finish: vi.fn(async () => {}),
    finishMarket: vi.fn(async () => {}),
    readSettings: vi.fn(async () => ({ enabled: false, webhookUrl: null as string | null })),
    saveWebhook: vi.fn(async () => {}),
    clearWebhook: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    lastSend: vi.fn(async () => null),
    countManualToday: vi.fn(async () => 0),
    readWebhook: vi.fn(async () => null as { url: string; updatedAt: string } | null),
    readScheduleJobs: vi.fn(async () => [
      { jobname: 'discord-summary-brief', schedule: '30 9 * * 1-5' },
      { jobname: 'discord-summary-full', schedule: '30 13 * * 1-5' },
    ]),
    saveTimes: vi.fn(async (_userId: string, _times: Record<string, string | null>) => {}),
    readMarket: vi.fn(async () => ({ enabled: false, webhookUrl: null as string | null, briefTime: null as string | null, fullTime: null as string | null })),
    saveMarketWebhook: vi.fn(async () => {}),
    setMarketEnabled: vi.fn(async () => {}),
    ...over,
  }
  return d as unknown as MySettingsDeps & typeof d
}

function ok(r: MySettingsResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`)
  return r
}

describe('runMySettingsOp — status', () => {
  it('reports both blocks by last4 and never returns a whole URL', async () => {
    const d = fake({
      readMarket: vi.fn(async () => ({ enabled: true, webhookUrl: MARKET_HOOK, briefTime: null, fullTime: null })),
      readSettings: vi.fn(async () => ({ enabled: true, webhookUrl: HOLD_HOOK })),
    })
    const result = ok(await runMySettingsOp(d, ME, { op: 'get' }))
    expect(result.status.market).toEqual({ enabled: true, configured: true, last4: 'Mmmm', briefTime: null, fullTime: null })
    expect(result.status.holdings.configured).toBe(true)
    expect(result.status.holdings.last4).toBe('Hhhh')
    const body = JSON.stringify(result)
    expect(body).not.toContain(MARKET_HOOK)
    expect(body).not.toContain(HOLD_HOOK)
  })

  it('reports an unconfigured account as inheriting the global channel', async () => {
    const result = ok(await runMySettingsOp(fake(), ME, { op: 'get' }))
    expect(result.status.market).toEqual({ enabled: false, configured: false, last4: null, briefTime: null, fullTime: null })
  })

  it('reports the global channel as unset when the admin has not configured one', async () => {
    const result = ok(await runMySettingsOp(fake(), ME, { op: 'get' }))
    expect(result.status.global).toEqual({ configured: false, last4: null })
  })

  it('reports the global channel by last4, never by URL', async () => {
    const d = fake({ readWebhook: vi.fn(async () => ({ url: GLOBAL_HOOK, updatedAt: '2026-09-20T00:00:00Z' })) })
    const result = ok(await runMySettingsOp(d, ME, { op: 'get' }))
    expect(result.status.global).toEqual({ configured: true, last4: 'Gggg' })
    expect(JSON.stringify(result)).not.toContain(GLOBAL_HOOK)
  })
})

describe('runMySettingsOp — the caller is the JWT user', () => {
  it('writes the JWT user even when the body names another account', async () => {
    const d = fake()
    ok(await runMySettingsOp(d, ME, { op: 'set-market', url: MARKET_HOOK, userId: OTHER }))
    expect(d.saveMarketWebhook).toHaveBeenCalledWith(ME, MARKET_HOOK)
    expect(d.saveMarketWebhook).not.toHaveBeenCalledWith(OTHER, expect.anything())
  })

  it('reads the JWT user even when the body names another account', async () => {
    const d = fake()
    ok(await runMySettingsOp(d, ME, { op: 'get', userId: OTHER }))
    expect(d.readMarket).toHaveBeenCalledWith(ME)
    expect(d.readSettings).toHaveBeenCalledWith(ME)
  })
})

describe('runMySettingsOp — 經濟快報', () => {
  it('refuses to switch on without a stored URL', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, { op: 'toggle-market', enabled: true })).toEqual({
      ok: false,
      error: 'not-configured',
    })
    expect(d.setMarketEnabled).not.toHaveBeenCalled()
  })

  it('switches on once a URL is stored', async () => {
    const d = fake({ readMarket: vi.fn(async () => ({ enabled: false, webhookUrl: MARKET_HOOK, briefTime: null, fullTime: null })) })
    ok(await runMySettingsOp(d, ME, { op: 'toggle-market', enabled: true }))
    expect(d.setMarketEnabled).toHaveBeenCalledWith(ME, true)
  })

  it('switches on when a URL is stored, so saving is never a dead end', async () => {
    const d = fake()
    ok(await runMySettingsOp(d, ME, { op: 'set-market', url: MARKET_HOOK }))
    expect(d.saveMarketWebhook).toHaveBeenCalledWith(ME, MARKET_HOOK)
    expect(d.setMarketEnabled).toHaveBeenCalledWith(ME, true)
  })

  it('rejects a URL that is not a Discord webhook', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, { op: 'set-market', url: 'https://example.com/hook' })).toEqual({
      ok: false,
      error: 'invalid-url',
    })
    expect(d.saveMarketWebhook).not.toHaveBeenCalled()
  })

  it('switches off when the URL is cleared', async () => {
    const d = fake({ readMarket: vi.fn(async () => ({ enabled: true, webhookUrl: MARKET_HOOK, briefTime: null, fullTime: null })) })
    ok(await runMySettingsOp(d, ME, { op: 'clear-market' }))
    expect(d.saveMarketWebhook).toHaveBeenCalledWith(ME, null)
    expect(d.setMarketEnabled).toHaveBeenCalledWith(ME, false)
  })
})

describe('runMySettingsOp — test sends', () => {
  it('posts to the stored URL, never to one supplied in the body', async () => {
    const evil = FAKE_WEBHOOK.replace(/.{4}$/, 'Evil')
    const d = fake({ readMarket: vi.fn(async () => ({ enabled: true, webhookUrl: MARKET_HOOK, briefTime: null, fullTime: null })) })
    ok(await runMySettingsOp(d, ME, { op: 'test-market', url: evil }))
    expect(d.post).toHaveBeenCalledTimes(1)
    expect(d.post.mock.calls[0][0]).toBe(MARKET_HOOK)
    expect(d.finishMarket).toHaveBeenCalledWith(ME, expect.any(String), { kind: 'sent', httpStatus: 204 })
  })

  it('sends nothing when 經濟快報 has no stored URL', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, { op: 'test-market' })).toEqual({ ok: false, error: 'not-configured' })
    expect(d.post).not.toHaveBeenCalled()
  })

  it('posts a holdings test to the stored holdings URL', async () => {
    const d = fake({ readSettings: vi.fn(async () => ({ enabled: true, webhookUrl: HOLD_HOOK })) })
    ok(await runMySettingsOp(d, ME, { op: 'test-holdings' }))
    expect(d.post).toHaveBeenCalledTimes(1)
    expect(d.post.mock.calls[0][0]).toBe(HOLD_HOOK)
  })

  it('sends nothing when 個人持股 has no stored URL', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, { op: 'test-holdings' })).toEqual({ ok: false, error: 'not-configured' })
    expect(d.post).not.toHaveBeenCalled()
  })

  it('charges the same daily manual allowance as the admin path', async () => {
    const d = fake({
      readMarket: vi.fn(async () => ({ enabled: true, webhookUrl: MARKET_HOOK, briefTime: null, fullTime: null })),
      countManualToday: vi.fn(async () => 10),
    })
    expect(await runMySettingsOp(d, ME, { op: 'test-market' })).toEqual({ ok: false, error: 'quota' })
    expect(d.post).not.toHaveBeenCalled()
  })
})

describe('runMySettingsOp — input', () => {
  it('rejects an unknown op', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, { op: 'drop-table' })).toEqual({ ok: false, error: 'bad-request' })
    expect(d.post).not.toHaveBeenCalled()
  })

  it('rejects a non-object input', async () => {
    expect(await runMySettingsOp(fake(), ME, null)).toEqual({ ok: false, error: 'bad-request' })
  })
})

/** Task 165 step 2f (spec discord-account-schedule.md §5.4). */
describe('runMySettingsOp — send times', () => {
  it('reports the admin schedule, so the page can label the inherit option', async () => {
    const result = ok(await runMySettingsOp(fake(), ME, { op: 'get' }))
    expect(result.status.globalSchedule).toEqual({ brief: '17:30', full: '21:30' })
    expect(result.status.market.briefTime).toBeNull()
    expect(result.status.market.fullTime).toBeNull()
    expect(result.status.holdings.time).toBeNull()
  })

  it('stores three chosen times', async () => {
    const d = fake()
    ok(await runMySettingsOp(d, ME, {
      op: 'set-times',
      marketBriefTime: '19:30',
      marketFullTime: '22:30',
      holdingsTime: '18:00',
    }))
    expect(d.saveTimes).toHaveBeenCalledWith(ME, {
      marketBriefTime: '19:30',
      marketFullTime: '22:30',
      holdingsTime: '18:00',
    })
  })

  it('stores null as "inherit the admin schedule"', async () => {
    const d = fake()
    ok(await runMySettingsOp(d, ME, {
      op: 'set-times',
      marketBriefTime: null,
      marketFullTime: null,
      holdingsTime: null,
    }))
    expect(d.saveTimes).toHaveBeenCalledWith(ME, {
      marketBriefTime: null,
      marketFullTime: null,
      holdingsTime: null,
    })
  })

  it('refuses a time outside the window and writes nothing', async () => {
    const d = fake()
    // 17:00 was withdrawn when the FX file's 17:00 refresh made it too early to be useful.
    expect(await runMySettingsOp(d, ME, {
      op: 'set-times',
      marketBriefTime: '17:00',
      marketFullTime: null,
      holdingsTime: null,
    })).toEqual({ ok: false, error: 'invalid-time' })
    expect(d.saveTimes).not.toHaveBeenCalled()
  })

  it('refuses a full-edition time taken from the brief window', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, {
      op: 'set-times',
      marketBriefTime: null,
      marketFullTime: '19:30',
      holdingsTime: null,
    })).toEqual({ ok: false, error: 'invalid-time' })
    expect(d.saveTimes).not.toHaveBeenCalled()
  })

  it('validates the holdings time against the brief window', async () => {
    const d = fake()
    expect(await runMySettingsOp(d, ME, {
      op: 'set-times',
      marketBriefTime: null,
      marketFullTime: null,
      holdingsTime: '23:00',
    })).toEqual({ ok: false, error: 'invalid-time' })
    expect(d.saveTimes).not.toHaveBeenCalled()
  })

  it('never takes the account from the body on set-times', async () => {
    const d = fake()
    ok(await runMySettingsOp(d, ME, {
      op: 'set-times',
      marketBriefTime: '19:30',
      marketFullTime: null,
      holdingsTime: null,
      userId: OTHER,
    }))
    expect(vi.mocked(d.saveTimes).mock.calls[0][0]).toBe(ME)
  })
})
