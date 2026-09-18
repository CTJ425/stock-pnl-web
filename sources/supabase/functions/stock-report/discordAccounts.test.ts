/**
 * Task 165 step 2d: the admin console's per-account Discord ops (spec discord-admin-accounts.md §3.4).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  runDiscordAccountsOp,
  type AccountSettingsRow,
  type DiscordAccountsDeps,
  type DiscordAccountsResult,
} from './discordAccounts.ts'
import { FAKE_TOKEN, FAKE_WEBHOOK, MARKET_DAY_0916 } from './discordTestFixtures.ts'
import { buildTestPayload } from './discordSummary.ts'
import type { DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import { buildHoldingsTestPayload } from './holdingsCard.ts'
import type { HoldingsKind, HoldingsOutcome, LastSend } from './holdingsRun.ts'
import type { IndexChartResponse } from './globalIndexClose.ts'
import type { Transaction } from '../_shared/engine/models.ts'

/** 17:05 Taipei on 2026-09-18. */
const NOW = new Date('2026-09-18T09:05:00Z')
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'
const UNKNOWN = '44444444-4444-4444-8444-444444444444'
const HOOK_H = FAKE_WEBHOOK.replace(/.{4}$/, 'Hhhh')
const HOOK_M = FAKE_WEBHOOK.replace(/.{4}$/, 'Mmmm')
const HOOK_NEW = FAKE_WEBHOOK.replace(/.{4}$/, 'Nnnn')
const LAST: LastSend = { kind: 'daily', ymd: '2026-09-17', status: 'sent', reason: null, at: '2026-09-17T09:05:03.000Z' }

function fake(over: Partial<DiscordAccountsDeps> = {}) {
  const settings = new Map<string, AccountSettingsRow>([
    [U1, { userId: U1, enabled: true, webhookUrl: HOOK_H, marketWebhookUrl: null }],
    [U2, { userId: U2, enabled: false, webhookUrl: null, marketWebhookUrl: HOOK_M }],
  ])
  const jobs = [
    { jobname: 'discord-summary-brief', schedule: '5 9 * * 1-5' },
    { jobname: 'discord-summary-full', schedule: '30 13 * * 1-5' },
    { jobname: 'discord-holdings-daily', schedule: '5 9 * * 1-5' },
  ]
  const writes: string[] = []
  const posts: Array<{ url: string; payload: DiscordPayload }> = []
  const finishes: Array<{ userId: string; ymd: string; kind: HoldingsKind; outcome: HoldingsOutcome }> = []
  const row = (userId: string): AccountSettingsRow =>
    settings.get(userId) ?? { userId, enabled: false, webhookUrl: null, marketWebhookUrl: null }

  const deps: DiscordAccountsDeps = {
    now: () => NOW,
    loadMarketFile: async () => ({ days: [] }),
    loadWorkspaces: async () => [],
    fetchChart: async () => {
      throw new Error('not used')
    },
    post: async (url: string, payload: DiscordPayload): Promise<DiscordSendResult> => {
      posts.push({ url, payload })
      return { ok: true, httpStatus: 204 }
    },
    finish: async (userId, ymd, kind, outcome) => {
      finishes.push({ userId, ymd, kind, outcome })
    },
    readSettings: async (userId) => {
      const r = settings.get(userId)
      return r ? { enabled: r.enabled, webhookUrl: r.webhookUrl } : null
    },
    saveWebhook: async (userId, url) => {
      writes.push(`holdings-save:${userId}`)
      settings.set(userId, { ...row(userId), webhookUrl: url })
    },
    clearWebhook: async (userId) => {
      writes.push(`holdings-clear:${userId}`)
      if (settings.has(userId)) settings.set(userId, { ...row(userId), webhookUrl: null, enabled: false })
    },
    setEnabled: async (userId, enabled) => {
      writes.push(`holdings-enable:${userId}:${enabled}`)
      settings.set(userId, { ...row(userId), enabled })
    },
    lastSend: async (userId) => (userId === U1 ? LAST : null),
    countManualToday: async () => 0,
    listAccounts: async () => [
      { userId: U2, email: 'bob@example.com' },
      { userId: U3, email: null },
      { userId: U1, email: 'alice@example.com' },
    ],
    listSettings: async () => [...settings.values()].map((r) => ({ ...r })),
    saveMarketWebhook: async (userId, url) => {
      writes.push(`market:${userId}:${url === null ? 'null' : 'url'}`)
      settings.set(userId, { ...row(userId), marketWebhookUrl: url })
    },
    readScheduleJobs: async () => jobs.map((j) => ({ ...j })),
    writeSchedule: async (s) => {
      writes.push(`schedule:${s.briefHour}:${s.briefMinute}:${s.fullHour}:${s.fullMinute}`)
      for (const j of jobs) {
        const [h, m] = j.jobname === 'discord-summary-full' ? [s.fullHour, s.fullMinute] : [s.briefHour, s.briefMinute]
        j.schedule = `${m} ${h - 8} * * 1-5`
      }
    },
    ...over,
  }
  return { deps, settings, writes, posts, finishes }
}

function ok(result: DiscordAccountsResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN)
  return result
}

function account(result: DiscordAccountsResult, userId: string) {
  return ok(result).accounts.find((a) => a.userId === userId)!
}

describe('runDiscordAccountsOp — input', () => {
  it.each([null, undefined, 'list', 42, [], {}, { op: 'nope' }, { op: 'LIST' }, { op: 'holdings-previews', userId: U1 }])(
    'rejects %j as bad-request',
    async (input) => {
      const { deps, writes } = fake()
      expect(await runDiscordAccountsOp(deps, input)).toEqual({ ok: false, error: 'bad-request' })
      expect(writes).toEqual([])
    },
  )

  it.each([
    { op: 'set-market', url: HOOK_NEW },
    { op: 'set-market', userId: 'u1', url: HOOK_NEW },
    { op: 'clear-market', userId: 42 },
    { op: 'test-market', userId: `${U1} ` },
    { op: 'holdings-set', userId: '', url: HOOK_NEW },
  ])('rejects a missing or malformed userId in %j', async (input) => {
    const { deps, writes, posts } = fake()
    expect(await runDiscordAccountsOp(deps, input)).toEqual({ ok: false, error: 'bad-request' })
    expect(writes).toEqual([])
    expect(posts).toEqual([])
  })

  it.each([
    { op: 'set-market', userId: UNKNOWN, url: HOOK_NEW },
    { op: 'clear-market', userId: UNKNOWN },
    { op: 'test-market', userId: UNKNOWN },
    { op: 'holdings-set', userId: UNKNOWN, url: HOOK_NEW },
    { op: 'holdings-enable', userId: UNKNOWN, enabled: false },
    { op: 'holdings-clear', userId: UNKNOWN },
    { op: 'holdings-test', userId: UNKNOWN },
    { op: 'holdings-preview', userId: UNKNOWN },
  ])('refuses an account that does not exist: %j', async (input) => {
    const { deps, writes, posts } = fake()
    expect(await runDiscordAccountsOp(deps, input)).toEqual({ ok: false, error: 'unknown-user' })
    expect(writes).toEqual([])
    expect(posts).toEqual([])
  })
})

describe('runDiscordAccountsOp — list', () => {
  it('returns the schedule and every account sorted by email, without any URL', async () => {
    const { deps } = fake()
    const result = ok(await runDiscordAccountsOp(deps, { op: 'list' }))
    expect(result.schedule).toEqual({ brief: '17:05', full: '21:30', holdingsAligned: true })
    expect(result.accounts).toEqual([
      {
        userId: U1,
        email: 'alice@example.com',
        market: { custom: false, last4: null },
        holdings: { configured: true, last4: 'Hhhh', enabled: true },
        lastSend: LAST,
      },
      {
        userId: U2,
        email: 'bob@example.com',
        market: { custom: true, last4: 'Mmmm' },
        holdings: { configured: false, last4: null, enabled: false },
        lastSend: null,
      },
      {
        userId: U3,
        email: null,
        market: { custom: false, last4: null },
        holdings: { configured: false, last4: null, enabled: false },
        lastSend: null,
      },
    ])
    expect(result.send).toBeUndefined()
  })
})

describe('runDiscordAccountsOp — schedule', () => {
  it('saves a valid schedule as hour and minute parts and returns the new schedule', async () => {
    const { deps, writes } = fake()
    const result = ok(await runDiscordAccountsOp(deps, { op: 'set-schedule', brief: '18:30', full: '22:00' }))
    expect(writes).toEqual(['schedule:18:30:22:0'])
    expect(result.schedule).toEqual({ brief: '18:30', full: '22:00', holdingsAligned: true })
  })

  it.each([
    { brief: '17:00', full: '21:30' },
    { brief: '17:05', full: '20:55' },
    { brief: '17:03', full: '21:30' },
    { brief: '17:05' },
    { full: '21:30' },
    { brief: 1705, full: 2130 },
    { brief: '17:05', full: '21:30' },
    { brief: '18:30', full: '21:15' },
  ])('refuses %j and writes nothing', async (times) => {
    const { deps, writes } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'set-schedule', ...times })).toEqual({ ok: false, error: 'invalid-time' })
    expect(writes).toEqual([])
  })
})

describe('runDiscordAccountsOp — 經濟快報 per account', () => {
  it('stores a trimmed custom URL and reports only its last four characters', async () => {
    const { deps, writes, settings } = fake()
    const result = await runDiscordAccountsOp(deps, { op: 'set-market', userId: U1, url: `  ${HOOK_NEW}\n` })
    expect(writes).toEqual([`market:${U1}:url`])
    expect(settings.get(U1)!.marketWebhookUrl).toBe(HOOK_NEW)
    expect(account(result, U1).market).toEqual({ custom: true, last4: 'Nnnn' })
  })

  it('creates the settings row for an account that has none', async () => {
    const { deps, settings } = fake()
    const result = await runDiscordAccountsOp(deps, { op: 'set-market', userId: U3, url: HOOK_NEW })
    expect(settings.get(U3)!.marketWebhookUrl).toBe(HOOK_NEW)
    expect(account(result, U3).market).toEqual({ custom: true, last4: 'Nnnn' })
  })

  it.each([undefined, '', 'https://example.com/api/webhooks/1/2', 42])('refuses url %j', async (url) => {
    const { deps, writes } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'set-market', userId: U1, url })).toEqual({ ok: false, error: 'invalid-url' })
    expect(writes).toEqual([])
  })

  it('goes back to inheriting the global webhook', async () => {
    const { deps, writes } = fake()
    const result = await runDiscordAccountsOp(deps, { op: 'clear-market', userId: U2 })
    expect(writes).toEqual([`market:${U2}:null`])
    expect(account(result, U2).market).toEqual({ custom: false, last4: null })
  })

  it('refuses a test send for an account that inherits', async () => {
    const { deps, posts } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'test-market', userId: U1 })).toEqual({ ok: false, error: 'not-configured' })
    expect(posts).toEqual([])
  })

  it('sends the market test message to the custom URL and records it as a test', async () => {
    const { deps, posts, finishes } = fake()
    const result = ok(await runDiscordAccountsOp(deps, { op: 'test-market', userId: U2 }))
    expect(posts).toEqual([{ url: HOOK_M, payload: buildTestPayload(NOW.toISOString()) }])
    expect(finishes).toEqual([{ userId: U2, ymd: '2026-09-18', kind: 'test', outcome: { kind: 'sent', httpStatus: 204 } }])
    expect(result.send).toEqual({ ok: true, httpStatus: 204 })
  })

  it('records a failed market test send', async () => {
    const { deps, finishes } = fake({
      post: async () => ({ ok: false, httpStatus: 404, reason: 'webhook-gone' }),
    })
    const result = ok(await runDiscordAccountsOp(deps, { op: 'test-market', userId: U2 }))
    expect(result.send).toEqual({ ok: false, httpStatus: 404, reason: 'webhook-gone' })
    expect(finishes[0].outcome).toEqual({ kind: 'failed', httpStatus: 404, reason: 'webhook-gone' })
  })

  it('shares the daily manual-send quota', async () => {
    const countManualToday = vi.fn(async () => 10)
    const { deps, posts } = fake({ countManualToday })
    expect(await runDiscordAccountsOp(deps, { op: 'test-market', userId: U2 })).toEqual({ ok: false, error: 'quota' })
    expect(countManualToday).toHaveBeenCalledWith(U2, '2026-09-18')
    expect(posts).toEqual([])
  })
})

describe('runDiscordAccountsOp — 個人持股報告 per account', () => {
  it('saves a holdings webhook for the named account', async () => {
    const { deps, writes } = fake()
    const result = await runDiscordAccountsOp(deps, { op: 'holdings-set', userId: U2, url: HOOK_NEW })
    expect(writes).toEqual([`holdings-save:${U2}`])
    expect(account(result, U2).holdings).toEqual({ configured: true, last4: 'Nnnn', enabled: false })
    // the market setting of that account is untouched
    expect(account(result, U2).market).toEqual({ custom: true, last4: 'Mmmm' })
  })

  it('refuses an invalid holdings URL', async () => {
    const { deps, writes } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-set', userId: U2, url: 'nope' })).toEqual({ ok: false, error: 'invalid-url' })
    expect(writes).toEqual([])
  })

  it('turns the daily card off and on', async () => {
    const { deps, writes } = fake()
    const off = await runDiscordAccountsOp(deps, { op: 'holdings-enable', userId: U1, enabled: false })
    expect(account(off, U1).holdings.enabled).toBe(false)
    const on = await runDiscordAccountsOp(deps, { op: 'holdings-enable', userId: U1, enabled: true })
    expect(account(on, U1).holdings.enabled).toBe(true)
    expect(writes).toEqual([`holdings-enable:${U1}:false`, `holdings-enable:${U1}:true`])
  })

  it('refuses to enable an account without a holdings webhook', async () => {
    const { deps, writes } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-enable', userId: U2, enabled: true })).toEqual({
      ok: false,
      error: 'not-configured',
    })
    expect(writes).toEqual([])
  })

  it('refuses a non-boolean enabled', async () => {
    const { deps } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-enable', userId: U1, enabled: 'yes' })).toEqual({
      ok: false,
      error: 'bad-request',
    })
  })

  it('clears the holdings webhook', async () => {
    const { deps, writes } = fake()
    const result = await runDiscordAccountsOp(deps, { op: 'holdings-clear', userId: U1 })
    expect(writes).toEqual([`holdings-clear:${U1}`])
    expect(account(result, U1).holdings).toEqual({ configured: false, last4: null, enabled: false })
  })

  it('sends the holdings test message to that account only', async () => {
    const { deps, posts, finishes } = fake()
    const result = ok(await runDiscordAccountsOp(deps, { op: 'holdings-test', userId: U1 }))
    expect(posts).toEqual([{ url: HOOK_H, payload: buildHoldingsTestPayload(NOW.toISOString()) }])
    expect(finishes).toEqual([{ userId: U1, ymd: '2026-09-18', kind: 'test', outcome: { kind: 'sent', httpStatus: 204 } }])
    expect(result.send).toEqual({ ok: true, httpStatus: 204 })
  })

  it('passes the holdings quota error through', async () => {
    const { deps, posts } = fake({ countManualToday: async () => 10 })
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-test', userId: U1 })).toEqual({ ok: false, error: 'quota' })
    expect(posts).toEqual([])
  })
})

const BUY_2330: Transaction = {
  id: 't1',
  workspace_id: 'w1',
  tx_date: '2026-01-05',
  market: 'TPE',
  ticker: '2330',
  name: '2330',
  tx_type: 'BUY',
  price: 900,
  qty: 1000,
  fee_tax: 0,
  created_at: '2026-01-05T00:00:00.001Z',
}

const CHART_2330: IndexChartResponse = {
  chart: {
    result: [
      {
        meta: { gmtoffset: 8 * 3600 },
        timestamp: [Date.parse('2026-09-15T01:00:00Z') / 1000, Date.parse('2026-09-16T01:00:00Z') / 1000],
        indicators: { quote: [{ close: [990, 1000] }] },
      },
    ],
  },
}

describe('runDiscordAccountsOp — 完整推送測試 (holdings-preview)', () => {
  it('sends the real holdings card to that account, labelled as a preview, and reports the data date', async () => {
    const { deps, posts, finishes } = fake({
      loadMarketFile: async () => ({ days: [MARKET_DAY_0916] }),
      loadWorkspaces: async (userId) => (userId === U1 ? [{ id: 'w1', fee_rate: null, transactions: [BUY_2330] }] : []),
      fetchChart: async () => CHART_2330,
    })
    const result = ok(await runDiscordAccountsOp(deps, { op: 'holdings-preview', userId: U1 }))
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe(HOOK_H)
    expect(JSON.stringify(posts[0].payload)).toContain('2330')
    expect(result.send).toEqual({ ok: true, httpStatus: 204 })
    // today (2026-09-18) has no market row, so the preview uses the latest one
    expect(result.previewYmd).toBe('2026-09-16')
    expect(finishes).toEqual([{ userId: U1, ymd: '2026-09-18', kind: 'preview', outcome: { kind: 'sent', httpStatus: 204 } }])
  })

  it('refuses an account without a holdings webhook', async () => {
    const { deps, posts } = fake({ loadMarketFile: async () => ({ days: [MARKET_DAY_0916] }) })
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-preview', userId: U2 })).toEqual({ ok: false, error: 'not-configured' })
    expect(posts).toEqual([])
  })

  it('reports no market data', async () => {
    const { deps, posts } = fake()
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-preview', userId: U1 })).toEqual({ ok: false, error: 'no-market-data' })
    expect(posts).toEqual([])
  })

  it('reports an account with no holdings', async () => {
    const { deps, posts } = fake({ loadMarketFile: async () => ({ days: [MARKET_DAY_0916] }) })
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-preview', userId: U1 })).toEqual({ ok: false, error: 'no-holdings' })
    expect(posts).toEqual([])
  })

  it('shares the daily manual-send quota', async () => {
    const { deps, posts } = fake({ countManualToday: async () => 10 })
    expect(await runDiscordAccountsOp(deps, { op: 'holdings-preview', userId: U1 })).toEqual({ ok: false, error: 'quota' })
    expect(posts).toEqual([])
  })
})
