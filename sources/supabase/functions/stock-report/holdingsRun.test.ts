// Task 165 Phase 2 step 2c — spec docs/agent/specs/discord-holdings.md §2.6.
import { describe, expect, it } from 'vitest'
import type { Market, Transaction } from '../_shared/engine/models.ts'
import { FAKE_TOKEN, FAKE_WEBHOOK, MARKET_DAY_0916 } from './discordTestFixtures.ts'
import type { DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import type { IndexChartResponse } from './globalIndexClose.ts'
import { buildHoldingsTestPayload, type WorkspaceInput } from './holdingsCard.ts'
import {
  HOLDINGS_RUN_BUDGET_MS,
  MANUAL_SENDS_PER_DAY,
  runHoldingsDaily,
  runHoldingsSettingsOp,
  type HoldingsKind,
  type HoldingsOutcome,
  type HoldingsRunDeps,
  type HoldingsSettingsDeps,
  type LastSend,
} from './holdingsRun.ts'
import type { MarketDay } from './twMarket.ts'

const NOW = new Date('2026-09-17T09:15:00.000Z') // Thu 17:15 Taipei
const TODAY = '2026-09-17'
const HOOK_1 = FAKE_WEBHOOK
const HOOK_2 = FAKE_WEBHOOK.replace(/.{4}$/, 'Abcd')
const MARKET_FILE = { days: [MARKET_DAY_0916, { ...MARKET_DAY_0916, date: TODAY }] }

let seq = 0
function buy(ws: string, market: Market, ticker: string, price: number, qty: number): Transaction {
  seq++
  return {
    id: `t${seq}`,
    workspace_id: ws,
    tx_date: '2026-01-05',
    market,
    ticker,
    name: ticker,
    tx_type: 'BUY',
    price,
    qty,
    fee_tax: 0,
    created_at: `2026-01-05T00:00:00.${String(seq).padStart(3, '0')}Z`,
  }
}

const WORKSPACES: Record<string, WorkspaceInput[]> = {
  u1: [{ id: 'w1', fee_rate: null, transactions: [buy('w1', 'TPE', '2330', 900, 1000)] }],
  u2: [
    { id: 'w2', fee_rate: 0.0004275, transactions: [buy('w2', 'TPE', '2330', 950, 100)] },
    { id: 'w3', fee_rate: null, transactions: [buy('w3', 'US', 'AAPL', 150, 2)] },
  ],
  u3: [],
}

function chartFor(close: number, prev: number): IndexChartResponse {
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: 8 * 3600 },
          timestamp: [Date.parse('2026-09-16T01:00:00Z') / 1000, Date.parse('2026-09-17T01:00:00Z') / 1000],
          indicators: { quote: [{ close: [prev, close] }] },
        },
      ],
    },
  }
}

interface Recorder {
  finishes: Array<{ userId: string; ymd: string; kind: HoldingsKind; outcome: HoldingsOutcome }>
  posts: Array<{ url: string; payload: DiscordPayload }>
  claims: Array<{ userId: string; ymd: string }>
  charts: string[]
  logs: Array<{ level: string; message: string; detail: Record<string, unknown> }>
  calls: string[]
}

function dataDeps(rec: Recorder, over: Partial<HoldingsRunDeps> = {}) {
  return {
    now: () => NOW,
    loadMarketFile: async () => {
      rec.calls.push('loadMarketFile')
      return MARKET_FILE as { days?: MarketDay[] }
    },
    loadWorkspaces: async (userId: string) => {
      rec.calls.push(`loadWorkspaces:${userId}`)
      return WORKSPACES[userId] ?? []
    },
    fetchChart: async (url: string) => {
      rec.charts.push(url)
      if (url.includes('2330.TW')) return chartFor(1000, 990)
      if (url.includes('AAPL')) return chartFor(200, 198)
      throw new Error('HTTP 404')
    },
    post: async (url: string, payload: DiscordPayload): Promise<DiscordSendResult> => {
      rec.posts.push({ url, payload })
      return { ok: true, httpStatus: 204 }
    },
    finish: async (userId: string, ymd: string, kind: HoldingsKind, outcome: HoldingsOutcome) => {
      rec.finishes.push({ userId, ymd, kind, outcome })
    },
    ...over,
  }
}

function newRec(): Recorder {
  return { finishes: [], posts: [], claims: [], charts: [], logs: [], calls: [] }
}

function runDeps(rec: Recorder, over: Partial<HoldingsRunDeps> = {}): HoldingsRunDeps {
  return {
    ...dataDeps(rec),
    elapsedMs: () => 0,
    listEnabledUsers: async () => {
      rec.calls.push('listEnabledUsers')
      return [
        { userId: 'u1', webhookUrl: HOOK_1 },
        { userId: 'u2', webhookUrl: HOOK_2 },
      ]
    },
    claimDaily: async (userId: string, ymd: string) => {
      rec.claims.push({ userId, ymd })
      return true
    },
    log: async (e) => {
      rec.logs.push(e)
    },
    ...over,
  }
}

const ZERO = { sent: 0, failed: 0, noHoldings: 0, alreadySent: 0, leftOver: 0 }

describe('runHoldingsDaily', () => {
  it('does nothing on a day without a market row', async () => {
    const rec = newRec()
    const deps = runDeps(rec, { loadMarketFile: async () => ({ days: [MARKET_DAY_0916] }) })
    await expect(runHoldingsDaily(deps)).resolves.toEqual({ ymd: TODAY, skipped: 'no-market-day', ...ZERO })
    expect(rec.calls).not.toContain('listEnabledUsers')
    expect(rec.claims).toEqual([])
    expect(rec.charts).toEqual([])
    expect(rec.posts).toEqual([])
    expect(rec.finishes).toEqual([])
  })

  it('treats an unreadable market file as no market day', async () => {
    const rec = newRec()
    const deps = runDeps(rec, { loadMarketFile: () => Promise.reject(new Error('storage down')) })
    await expect(runHoldingsDaily(deps)).resolves.toEqual({ ymd: TODAY, skipped: 'no-market-day', ...ZERO })
    expect(rec.posts).toEqual([])
  })

  it('sends each enabled user their own card on their own webhook', async () => {
    const rec = newRec()
    const result = await runHoldingsDaily(runDeps(rec))
    expect(result).toEqual({ ymd: TODAY, ...ZERO, sent: 2 })
    expect(rec.claims).toEqual([
      { userId: 'u1', ymd: TODAY },
      { userId: 'u2', ymd: TODAY },
    ])
    expect(rec.posts.map((p) => p.url)).toEqual([HOOK_1, HOOK_2])
    expect(rec.posts[0].payload.content).toBe('📒 持股日報 09/17（四）')
    expect(rec.posts[0].payload.embeds.map((e) => e.title)).toEqual(['台股持股・09/17 收盤'])
    expect(rec.posts[1].payload.embeds.map((e) => e.title)).toEqual(['台股持股・09/17 收盤', '美股持股・美東 09/17 收盤'])
    expect(rec.posts[0].payload.embeds[0].description).toContain('2330 2330')
    expect(rec.posts[0].payload.embeds[0].description).toContain('1,000股 1,000')
    expect(rec.finishes).toEqual([
      { userId: 'u1', ymd: TODAY, kind: 'daily', outcome: { kind: 'sent', httpStatus: 204 } },
      { userId: 'u2', ymd: TODAY, kind: 'daily', outcome: { kind: 'sent', httpStatus: 204 } },
    ])
  })

  it('fetches a ticker held by several users only once per run', async () => {
    const rec = newRec()
    await runHoldingsDaily(runDeps(rec))
    expect(rec.charts.filter((u) => u.includes('2330.TW'))).toHaveLength(1)
    expect(rec.charts.filter((u) => u.includes('AAPL'))).toHaveLength(1)
  })

  it('skips a user already claimed today without touching their data', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      claimDaily: async (userId) => {
        rec.claims.push({ userId, ymd: TODAY })
        return userId !== 'u1'
      },
    })
    const result = await runHoldingsDaily(deps)
    expect(result).toEqual({ ymd: TODAY, ...ZERO, sent: 1, alreadySent: 1 })
    expect(rec.calls).not.toContain('loadWorkspaces:u1')
    expect(rec.posts.map((p) => p.url)).toEqual([HOOK_2])
    expect(rec.finishes.map((f) => f.userId)).toEqual(['u2'])
  })

  it('records a webhook failure with the send result', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      post: async (url, payload) => {
        rec.posts.push({ url, payload })
        return url === HOOK_1 ? { ok: false, httpStatus: 404, reason: 'webhook-gone' } : { ok: true, httpStatus: 204 }
      },
    })
    const result = await runHoldingsDaily(deps)
    expect(result).toEqual({ ymd: TODAY, ...ZERO, sent: 1, failed: 1 })
    expect(rec.finishes[0]).toEqual({
      userId: 'u1',
      ymd: TODAY,
      kind: 'daily',
      outcome: { kind: 'failed', httpStatus: 404, reason: 'webhook-gone' },
    })
  })

  it('isolates a user whose data load throws, and logs no secrets or amounts', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      loadWorkspaces: async (userId) => {
        rec.calls.push(`loadWorkspaces:${userId}`)
        if (userId === 'u1') throw new TypeError(`boom ${HOOK_1} 123,456`)
        return WORKSPACES[userId] ?? []
      },
    })
    const result = await runHoldingsDaily(deps)
    expect(result).toEqual({ ymd: TODAY, ...ZERO, sent: 1, failed: 1 })
    expect(rec.finishes[0]).toEqual({
      userId: 'u1',
      ymd: TODAY,
      kind: 'daily',
      outcome: { kind: 'failed', httpStatus: null, reason: 'exception' },
    })
    expect(rec.posts.map((p) => p.url)).toEqual([HOOK_2])
    expect(rec.logs).toHaveLength(1)
    expect(rec.logs[0]).toMatchObject({ level: 'warn', detail: { userId: 'u1', error: 'TypeError' } })
    const logged = JSON.stringify(rec.logs)
    expect(logged).not.toContain('discord.com')
    expect(logged).not.toContain(FAKE_TOKEN)
    expect(logged).not.toContain('123,456')
  })

  it('keeps going when recording a failure itself throws', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      loadWorkspaces: async (userId) => {
        if (userId === 'u1') throw new Error('db')
        return WORKSPACES[userId] ?? []
      },
      finish: async (userId, ymd, kind, outcome) => {
        if (userId === 'u1') throw new Error('finish failed')
        rec.finishes.push({ userId, ymd, kind, outcome })
      },
    })
    const result = await runHoldingsDaily(deps)
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    expect(rec.posts.map((p) => p.url)).toEqual([HOOK_2])
    expect(rec.logs.length).toBeGreaterThanOrEqual(2)
  })

  it('logs a user with no holdings as skipped and posts nothing for them', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      listEnabledUsers: async () => [
        { userId: 'u3', webhookUrl: HOOK_1 },
        { userId: 'u1', webhookUrl: HOOK_1 },
      ],
    })
    const result = await runHoldingsDaily(deps)
    expect(result).toEqual({ ymd: TODAY, ...ZERO, sent: 1, noHoldings: 1 })
    expect(rec.finishes[0]).toEqual({ userId: 'u3', ymd: TODAY, kind: 'daily', outcome: { kind: 'skipped', reason: 'no-holdings' } })
    expect(rec.posts).toHaveLength(1)
  })

  it('stops starting users once the time budget is spent', async () => {
    const rec = newRec()
    let checks = 0
    const deps = runDeps(rec, {
      elapsedMs: () => (checks++ === 0 ? 0 : HOLDINGS_RUN_BUDGET_MS + 1),
      listEnabledUsers: async () => [
        { userId: 'u1', webhookUrl: HOOK_1 },
        { userId: 'u2', webhookUrl: HOOK_2 },
        { userId: 'u3', webhookUrl: HOOK_2 },
      ],
    })
    const result = await runHoldingsDaily(deps)
    expect(HOLDINGS_RUN_BUDGET_MS).toBe(80_000)
    expect(result).toEqual({ ymd: TODAY, ...ZERO, sent: 1, leftOver: 2 })
    expect(rec.claims.map((c) => c.userId)).toEqual(['u1'])
  })

  it('writes only known reason codes', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      listEnabledUsers: async () => [
        { userId: 'u1', webhookUrl: HOOK_1 },
        { userId: 'u2', webhookUrl: HOOK_2 },
        { userId: 'u3', webhookUrl: HOOK_2 },
      ],
      loadWorkspaces: async (userId) => {
        if (userId === 'u2') throw new Error(`fail at ${HOOK_2}`)
        return WORKSPACES[userId] ?? []
      },
      post: async () => ({ ok: false, httpStatus: 500, reason: 'http-error' }),
    })
    await runHoldingsDaily(deps)
    const reasons = rec.finishes.map((f) => ('reason' in f.outcome ? f.outcome.reason : null))
    expect(reasons).toEqual(['http-error', 'exception', 'no-holdings'])
    for (const r of reasons) expect(r).toMatch(/^[a-z0-9-]+$/)
  })
})

// ── settings ops ─────────────────────────────────────────────────────────────
interface Stored {
  enabled: boolean
  webhookUrl: string | null
}

function settingsDeps(rec: Recorder, initial: Stored | null, over: Partial<HoldingsSettingsDeps> = {}) {
  let row: Stored | null = initial
  const writes: string[] = []
  const last: LastSend = { kind: 'daily', ymd: '2026-09-16', status: 'sent', reason: null, at: '2026-09-16T09:15:03.000Z' }
  const deps: HoldingsSettingsDeps = {
    ...dataDeps(rec),
    readSettings: async () => (row ? { ...row } : null),
    saveWebhook: async (userId, url) => {
      writes.push(`save:${userId}:${url}`)
      row = { enabled: row?.enabled ?? false, webhookUrl: url }
    },
    clearWebhook: async (userId) => {
      writes.push(`clear:${userId}`)
      if (row) row = { enabled: false, webhookUrl: null }
    },
    setEnabled: async (userId, enabled) => {
      writes.push(`enable:${userId}:${enabled}`)
      row = { enabled, webhookUrl: row?.webhookUrl ?? null }
    },
    lastSend: async () => last,
    countManualToday: async () => 0,
    ...over,
  }
  return { deps, writes, last }
}

const CONFIGURED: Stored = { enabled: false, webhookUrl: HOOK_1 }

describe('runHoldingsSettingsOp', () => {
  it.each([null, undefined, 'get', 42, [], {}, { op: 'nope' }, { op: 'GET' }])('rejects %j as bad-request', async (input) => {
    const { deps } = settingsDeps(newRec(), null)
    await expect(runHoldingsSettingsOp(deps, 'u1', input)).resolves.toEqual({ ok: false, error: 'bad-request' })
  })

  it('get: reports an unconfigured user', async () => {
    const { deps, last } = settingsDeps(newRec(), null)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'get' })).resolves.toEqual({
      ok: true,
      status: { configured: false, last4: null, enabled: false, lastSend: last },
    })
  })

  it('get: never returns the webhook URL', async () => {
    const { deps } = settingsDeps(newRec(), { enabled: true, webhookUrl: HOOK_1 })
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'get' })
    expect(result).toMatchObject({ ok: true, status: { configured: true, last4: 'Wxyz', enabled: true } })
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN)
    expect(JSON.stringify(result)).not.toContain('discord.com')
  })

  it.each([['https://example.com/api/webhooks/1/x'], [123], [null], ['']])('set: rejects %j without writing', async (url) => {
    const { deps, writes } = settingsDeps(newRec(), null)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'set', url })).resolves.toEqual({ ok: false, error: 'invalid-url' })
    expect(writes).toEqual([])
  })

  it('set: trims, saves for the JWT user only, and ignores a user_id in the body', async () => {
    const { deps, writes } = settingsDeps(newRec(), null)
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'set', url: `  ${HOOK_1}  `, user_id: 'someone-else' })
    expect(writes).toEqual([`save:u1:${HOOK_1}`])
    expect(result).toMatchObject({ ok: true, status: { configured: true, last4: 'Wxyz', enabled: false } })
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN)
  })

  it('clear: removes the webhook and disables', async () => {
    const { deps, writes } = settingsDeps(newRec(), { enabled: true, webhookUrl: HOOK_1 })
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'clear' })
    expect(writes).toEqual(['clear:u1'])
    expect(result).toMatchObject({ ok: true, status: { configured: false, last4: null, enabled: false } })
  })

  it.each([[undefined], ['yes'], [1], [null]])('enable: rejects enabled=%j', async (enabled) => {
    const { deps, writes } = settingsDeps(newRec(), CONFIGURED)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'enable', enabled })).resolves.toEqual({ ok: false, error: 'bad-request' })
    expect(writes).toEqual([])
  })

  it('enable: refuses to turn on without a webhook', async () => {
    const { deps, writes } = settingsDeps(newRec(), null)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'enable', enabled: true })).resolves.toEqual({ ok: false, error: 'not-configured' })
    expect(writes).toEqual([])
  })

  it('enable: turns on and off', async () => {
    const { deps, writes } = settingsDeps(newRec(), CONFIGURED)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'enable', enabled: true })).resolves.toMatchObject({
      ok: true,
      status: { enabled: true, configured: true },
    })
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'enable', enabled: false })).resolves.toMatchObject({
      ok: true,
      status: { enabled: false },
    })
    expect(writes).toEqual(['enable:u1:true', 'enable:u1:false'])
  })

  it('enable: turning off is allowed without a webhook', async () => {
    const { deps, writes } = settingsDeps(newRec(), null)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'enable', enabled: false })).resolves.toMatchObject({ ok: true })
    expect(writes).toEqual(['enable:u1:false'])
  })

  it('test: needs a webhook', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, null)
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'test' })).resolves.toEqual({ ok: false, error: 'not-configured' })
    expect(rec.posts).toEqual([])
  })

  it('test: posts the holdings test card and logs it under today', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED)
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'test' })
    expect(rec.posts).toEqual([{ url: HOOK_1, payload: buildHoldingsTestPayload(NOW.toISOString()) }])
    expect(rec.finishes).toEqual([{ userId: 'u1', ymd: TODAY, kind: 'test', outcome: { kind: 'sent', httpStatus: 204 } }])
    expect(result).toMatchObject({ ok: true, send: { ok: true, httpStatus: 204 }, status: { configured: true } })
  })

  it('test and preview stop at the daily quota', async () => {
    expect(MANUAL_SENDS_PER_DAY).toBe(10)
    for (const op of ['test', 'preview']) {
      const rec = newRec()
      const asked: string[] = []
      const { deps } = settingsDeps(rec, CONFIGURED, {
        countManualToday: async (userId, ymd) => {
          asked.push(`${userId}:${ymd}`)
          return 10
        },
      })
      await expect(runHoldingsSettingsOp(deps, 'u1', { op })).resolves.toEqual({ ok: false, error: 'quota' })
      expect(asked).toEqual([`u1:${TODAY}`])
      expect(rec.posts).toEqual([])
      expect(rec.finishes).toEqual([])
    }
  })

  it('allows the tenth manual send of the day', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED, { countManualToday: async () => 9 })
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'test' })).resolves.toMatchObject({ ok: true })
    expect(rec.posts).toHaveLength(1)
  })

  it('preview: sends today with the preview prefix and logs it as preview', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED)
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })
    expect(rec.posts).toHaveLength(1)
    expect(rec.posts[0].url).toBe(HOOK_1)
    expect(rec.posts[0].payload.content).toBe('【預覽】📒 持股日報 09/17（四）')
    expect(rec.finishes).toEqual([{ userId: 'u1', ymd: TODAY, kind: 'preview', outcome: { kind: 'sent', httpStatus: 204 } }])
    expect(result).toMatchObject({ ok: true, previewYmd: TODAY, send: { ok: true, httpStatus: 204 } })
  })

  it('preview: falls back to the latest well-formed market day, still logged under today', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED, {
      loadMarketFile: async () =>
        ({ days: [{ ...MARKET_DAY_0916, date: '2026-09-15' }, MARKET_DAY_0916, { ...MARKET_DAY_0916, date: 'bogus' }, { ...MARKET_DAY_0916, date: '2026-9-18' }] }) as {
          days?: MarketDay[]
        },
    })
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })
    expect(result).toMatchObject({ ok: true, previewYmd: '2026-09-16' })
    expect(rec.posts[0].payload.content).toBe('【預覽】📒 持股日報 09/16（三）')
    expect(rec.finishes).toEqual([{ userId: 'u1', ymd: TODAY, kind: 'preview', outcome: { kind: 'sent', httpStatus: 204 } }])
  })

  it('preview: reports no market data', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED, { loadMarketFile: async () => ({ days: [{ ...MARKET_DAY_0916, date: 'x' }] }) })
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })).resolves.toEqual({ ok: false, error: 'no-market-data' })
    expect(rec.posts).toEqual([])
  })

  it('preview: reports no holdings and logs the skip', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED)
    await expect(runHoldingsSettingsOp(deps, 'u3', { op: 'preview' })).resolves.toEqual({ ok: false, error: 'no-holdings' })
    expect(rec.posts).toEqual([])
    expect(rec.finishes).toEqual([{ userId: 'u3', ymd: TODAY, kind: 'preview', outcome: { kind: 'skipped', reason: 'no-holdings' } }])
  })

  it('preview: needs a webhook', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, { enabled: false, webhookUrl: null })
    await expect(runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })).resolves.toEqual({ ok: false, error: 'not-configured' })
    expect(rec.calls).not.toContain('loadWorkspaces:u1')
  })

  it('preview: a failed post is still logged and returned', async () => {
    const rec = newRec()
    const { deps } = settingsDeps(rec, CONFIGURED, {
      post: async (url, payload) => {
        rec.posts.push({ url, payload })
        return { ok: false, httpStatus: 429, reason: 'rate-limited' }
      },
    })
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })
    expect(result).toMatchObject({ ok: true, send: { ok: false, httpStatus: 429, reason: 'rate-limited' } })
    expect(rec.finishes[0].outcome).toEqual({ kind: 'failed', httpStatus: 429, reason: 'rate-limited' })
  })
})

// ── missing quotes (spec discord-holdings.md Revision 4 R3) ──────────────────
const NO_QUOTE_WS: WorkspaceInput[] = [{ id: 'w9', fee_rate: null, transactions: [buy('w9', 'TPE', '1101', 30, 1000)] }]

describe('missing quotes', () => {
  it('reports how many rows had no quote in a preview', async () => {
    const { deps } = settingsDeps(newRec(), CONFIGURED, { loadWorkspaces: async () => NO_QUOTE_WS })
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })
    expect(result).toMatchObject({ ok: true, missingQuotes: 1 })
  })

  it('reports zero when every row is quoted', async () => {
    const { deps } = settingsDeps(newRec(), CONFIGURED)
    const result = await runHoldingsSettingsOp(deps, 'u1', { op: 'preview' })
    expect(result).toMatchObject({ ok: true, missingQuotes: 0 })
  })

  it('logs the count for a daily send, without any price', async () => {
    const rec = newRec()
    const deps = runDeps(rec, {
      listEnabledUsers: async () => [{ userId: 'u9', webhookUrl: HOOK_1 }],
      loadWorkspaces: async () => NO_QUOTE_WS,
    })
    await runHoldingsDaily(deps)
    expect(rec.logs).toEqual([{ level: 'warn', message: 'holdings quotes missing', detail: { userId: 'u9', missing: 1, rows: 1 } }])
  })

  it('logs nothing when every row is quoted', async () => {
    const rec = newRec()
    await runHoldingsDaily(runDeps(rec, { listEnabledUsers: async () => [{ userId: 'u1', webhookUrl: HOOK_1 }] }))
    expect(rec.logs.filter((l) => l.message === 'holdings quotes missing')).toEqual([])
  })
})
