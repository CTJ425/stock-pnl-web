/**
 * Task 165 step 2f — per-account send times (spec docs/agent/specs/discord-account-schedule.md).
 *
 * `dueAt` carries the whole inherit rule. It is pure on purpose: the tick fires every 30 minutes,
 * so a wrong answer here is either a missed send or a duplicate one, and neither is loud.
 */
import { describe, expect, it } from 'vitest'
import { ACCOUNT_TICK_BUDGET_MS, dueAt, type AccountRow, type GlobalSchedule } from './accountTick.ts'
import { FAKE_WEBHOOK } from './discordTestFixtures.ts'

const GLOBAL: GlobalSchedule = { brief: '17:30', full: '21:30' }
const HOOK_M = FAKE_WEBHOOK.replace(/.{4}$/, 'Mmmm')
const HOOK_H = FAKE_WEBHOOK.replace(/.{4}$/, 'Hhhh')

function row(over: Partial<AccountRow> = {}): AccountRow {
  return {
    userId: 'u1',
    marketWebhookUrl: HOOK_M,
    marketEnabled: true,
    marketBriefTime: null,
    marketFullTime: null,
    holdingsWebhookUrl: HOOK_H,
    holdingsEnabled: true,
    holdingsTime: null,
    ...over,
  }
}

describe('dueAt — inheriting the admin schedule', () => {
  it('sends the brief copy at the global brief time', () => {
    expect(dueAt('17:30', GLOBAL, row())).toEqual({ marketBrief: true, marketFull: false, holdings: true })
  })

  // Task 166 (ED-01): 「到期」= 排定時間已過，不再要求剛好相等；重複由當日 claim 擋下，
  // 所以漏跑一次 tick 之後仍補得回來。以下斷言都改成「時間未到」與「時間已過」兩側。
  it('sends the full copy once the global full time has passed', () => {
    expect(dueAt('21:30', GLOBAL, row())).toEqual({ marketBrief: true, marketFull: true, holdings: true })
    expect(dueAt('21:00', GLOBAL, row()).marketFull).toBe(false)
  })

  it('sends nothing before the first scheduled time', () => {
    expect(dueAt('17:00', GLOBAL, row())).toEqual({ marketBrief: false, marketFull: false, holdings: false })
  })

  it('inherits the BRIEF time for 個人持股, never the full one', () => {
    const r = row({ marketBriefTime: '20:00' })
    expect(dueAt('17:30', GLOBAL, r).holdings).toBe(true)
    expect(dueAt('17:00', GLOBAL, r).holdings).toBe(false)
  })

  it('is not due at any tick when the global time is unknown', () => {
    // A missing cron job must mean "nobody is due", not "everybody, every half hour".
    const none: GlobalSchedule = { brief: null, full: null }
    for (const t of ['17:30', '19:00', '21:30', '23:30']) {
      expect(dueAt(t, none, row())).toEqual({ marketBrief: false, marketFull: false, holdings: false })
    }
  })
})

describe('dueAt — a time of the account’s own', () => {
  it('uses the account time and ignores the global one', () => {
    const r = row({ marketBriefTime: '19:30', marketFullTime: '23:00', holdingsTime: '18:00' })
    expect(dueAt('19:30', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: false, holdings: true })
    expect(dueAt('23:00', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: true, holdings: true })
    expect(dueAt('18:00', GLOBAL, r)).toEqual({ marketBrief: false, marketFull: false, holdings: true })
  })

  it('does not fall back to the global time once a custom one is set', () => {
    const r = row({ marketBriefTime: '19:30', marketFullTime: '23:00', holdingsTime: '18:00' })
    // 全站時間 17:30／21:30 都已過，但這個帳號自訂 19:30／23:00／18:00，所以 17:30 一個都不到期
    expect(dueAt('17:30', GLOBAL, r)).toEqual({ marketBrief: false, marketFull: false, holdings: false })
    expect(dueAt('21:30', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: false, holdings: true })
  })

  it('lets one stream be custom while the others inherit', () => {
    const r = row({ marketFullTime: '22:30' })
    expect(dueAt('17:30', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: false, holdings: true })
    expect(dueAt('21:30', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: false, holdings: true })
    expect(dueAt('22:30', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: true, holdings: true })
  })
})

describe('dueAt — a stream with nowhere to send is never due', () => {
  it('skips 經濟快報 without a webhook of its own', () => {
    const r = row({ marketWebhookUrl: null })
    expect(dueAt('17:30', GLOBAL, r).marketBrief).toBe(false)
    expect(dueAt('21:30', GLOBAL, r).marketFull).toBe(false)
  })

  it('skips 經濟快報 that is switched off, URL and time notwithstanding', () => {
    const r = row({ marketEnabled: false, marketBriefTime: '17:30' })
    expect(dueAt('17:30', GLOBAL, r).marketBrief).toBe(false)
  })

  it('skips 個人持股 without a webhook', () => {
    expect(dueAt('17:30', GLOBAL, row({ holdingsWebhookUrl: null })).holdings).toBe(false)
  })

  it('skips 個人持股 that is switched off', () => {
    expect(dueAt('17:30', GLOBAL, row({ holdingsEnabled: false })).holdings).toBe(false)
  })

  it('still sends the streams that are configured when another is not', () => {
    const r = row({ holdingsWebhookUrl: null })
    expect(dueAt('17:30', GLOBAL, r)).toEqual({ marketBrief: true, marketFull: false, holdings: false })
  })
})

// ── runAccountTick ───────────────────────────────────────────────────────────────────────────

import { vi } from 'vitest'
import { runAccountTick, type TickDeps } from './accountTick.ts'
import type { DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import {
  GSPC_PREOPEN,
  MACRO_LINES,
  MARGIN_MS_0916,
  MARKET_ASOF_0916,
  MARKET_DAY_0916,
  N225_MIDSESSION,
  USD_TWD,
} from './discordTestFixtures.ts'

/** Taipei 17:30 on 2026-09-16 — the global brief slot. */
const AT_1730 = new Date('2026-09-16T09:30:00Z')
const HOOK_A = FAKE_WEBHOOK.replace(/.{4}$/, 'Aaaa')

function tickDeps(over: Partial<TickDeps> = {}) {
  const d = {
    now: vi.fn(() => AT_1730),
    elapsedMs: vi.fn(() => 0),
    loadMarketFile: vi.fn(async () => ({ asOf: MARKET_ASOF_0916, days: [MARKET_DAY_0916] })),
    loadGlobalSchedule: vi.fn(async () => ({ brief: '17:30', full: '21:30' })),
    loadGlobalWebhookUrl: vi.fn(async () => FAKE_WEBHOOK as string | null),
    listAccounts: vi.fn(async () => [] as AccountRow[]),
    loadIndex: vi.fn(async (symbol: string) => (symbol === '^GSPC' ? GSPC_PREOPEN : N225_MIDSESSION)),
    loadUsdTwd: vi.fn(async () => USD_TWD),
    loadMacro: vi.fn(async () => MACRO_LINES),
    loadMargin: vi.fn(async () => MARGIN_MS_0916),
    post: vi.fn(async (_u: string, _p: DiscordPayload): Promise<DiscordSendResult> => ({ ok: true, httpStatus: 204 })),
    claimMarketCopy: vi.fn(async () => true),
    finishMarketCopy: vi.fn(async () => {}),
    claimHoldings: vi.fn(async () => true),
    finish: vi.fn(async () => {}),
    loadWorkspaces: vi.fn(async () => []),
    fetchChart: vi.fn(async () => null),
    log: vi.fn(async () => {}),
    ...over,
  }
  return d as unknown as TickDeps & typeof d
}

const marketOnly = (over: Partial<AccountRow> = {}): AccountRow =>
  row({ holdingsWebhookUrl: null, holdingsEnabled: false, ...over })

describe('runAccountTick', () => {
  it('does nothing on a day with no market data', async () => {
    const d = tickDeps({
      loadMarketFile: vi.fn(async () => ({ asOf: MARKET_ASOF_0916, days: [] })),
      listAccounts: vi.fn(async () => [marketOnly()]),
    })
    const out = await runAccountTick(d)
    expect(out.skipped).toBe('no-market-day')
    expect(d.post).not.toHaveBeenCalled()
    expect(d.claimMarketCopy).not.toHaveBeenCalled()
  })

  it('posts once for two accounts that share a URL, and records each of them', async () => {
    const d = tickDeps({
      listAccounts: vi.fn(async () => [
        marketOnly({ userId: 'u1', marketWebhookUrl: HOOK_A }),
        marketOnly({ userId: 'u2', marketWebhookUrl: HOOK_A }),
      ]),
    })
    const out = await runAccountTick(d)
    expect(d.post).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.post).mock.calls[0][0]).toBe(HOOK_A)
    expect(out.marketBriefSent).toBe(2)
    expect(vi.mocked(d.finishMarketCopy).mock.calls.map((c) => c[0]).sort()).toEqual(['u1', 'u2'])
  })

  it('sends nothing for an account whose claim was already taken', async () => {
    const d = tickDeps({
      listAccounts: vi.fn(async () => [marketOnly({ marketWebhookUrl: HOOK_A })]),
      claimMarketCopy: vi.fn(async () => false),
    })
    const out = await runAccountTick(d)
    expect(d.post).not.toHaveBeenCalled()
    expect(out.alreadySent).toBe(1)
    expect(out.marketBriefSent).toBe(0)
  })

  it('claims before it posts, so a crash mid-tick cannot re-send', async () => {
    const order: string[] = []
    const d = tickDeps({
      listAccounts: vi.fn(async () => [marketOnly({ marketWebhookUrl: HOOK_A })]),
      claimMarketCopy: vi.fn(async () => {
        order.push('claim')
        return true
      }),
      post: vi.fn(async (): Promise<DiscordSendResult> => {
        order.push('post')
        return { ok: true, httpStatus: 204 }
      }),
    })
    await runAccountTick(d)
    expect(order).toEqual(['claim', 'post'])
  })

  it('builds the edition payload once and shares it across distinct URLs', async () => {
    const d = tickDeps({
      listAccounts: vi.fn(async () => [
        marketOnly({ userId: 'u1', marketWebhookUrl: HOOK_A }),
        marketOnly({ userId: 'u2', marketWebhookUrl: FAKE_WEBHOOK.replace(/.{4}$/, 'Bbbb') }),
      ]),
    })
    await runAccountTick(d)
    expect(d.post).toHaveBeenCalledTimes(2)
    // Same object, not merely equal: proof the edition was gathered and built once for the tick
    // rather than once per account.
    expect(vi.mocked(d.post).mock.calls[1][1]).toBe(vi.mocked(d.post).mock.calls[0][1])
  })

  it('stops at the time budget and reports what it did not reach', async () => {
    let calls = 0
    const d = tickDeps({
      elapsedMs: vi.fn(() => (calls++ === 0 ? 0 : ACCOUNT_TICK_BUDGET_MS + 1)),
      listAccounts: vi.fn(async () => [
        row({ userId: 'u1', marketWebhookUrl: null, marketEnabled: false }),
        row({ userId: 'u2', marketWebhookUrl: null, marketEnabled: false }),
        row({ userId: 'u3', marketWebhookUrl: null, marketEnabled: false }),
      ]),
    })
    const out = await runAccountTick(d)
    expect(out.leftOver).toBeGreaterThan(0)
  })

  it('does not touch an account whose scheduled time has not arrived yet', async () => {
    // Task 166 (ED-01): 19:00 已過 17:30，所以那是「補送」而不是「不到期」；真正不到期的是更早的時間。
    const d = tickDeps({
      now: vi.fn(() => new Date('2026-09-16T09:00:00Z')), // Taipei 17:00
      listAccounts: vi.fn(async () => [marketOnly({ marketWebhookUrl: HOOK_A })]),
    })
    const out = await runAccountTick(d)
    expect(out.hhmm).toBe('17:00')
    expect(d.claimMarketCopy).not.toHaveBeenCalled()
    expect(d.post).not.toHaveBeenCalled()
  })
})

/**
 * Task 166 (ED-01). A single missed 30-minute tick used to drop that day's card entirely:
 * `dueAt` required the scheduled time to equal the current slot exactly. Sends are already
 * idempotent through the per-day claim, so "due" must mean "scheduled time has passed today".
 */
describe('漏跑一次 tick 之後仍會補送（Task 166 ED-01）', () => {
  const row: AccountRow = {
    userId: 'u-1',
    marketEnabled: true,
    marketWebhookUrl: FAKE_WEBHOOK,
    marketBriefTime: '17:30',
    marketFullTime: '21:30',
    holdingsEnabled: true,
    holdingsWebhookUrl: FAKE_WEBHOOK,
    holdingsTime: null,
  }

  const global: GlobalSchedule = { brief: '17:30', full: '21:30' }
  const noGlobal: GlobalSchedule = { brief: null, full: null }

  it('排定時間已過、當天尚未送出時仍算到期', () => {
    expect(dueAt('18:00', global, row).marketBrief).toBe(true)
    expect(dueAt('18:00', global, row).holdings).toBe(true)
  })

  it('排定時間還沒到就不算到期', () => {
    expect(dueAt('17:00', global, row).marketBrief).toBe(false)
    expect(dueAt('21:00', global, row).marketFull).toBe(false)
  })

  it('全站時間未知時，繼承設定的帳號永遠不算到期', () => {
    expect(dueAt('23:00', noGlobal, row).marketBrief).toBe(true)
    expect(dueAt('23:00', noGlobal, { ...row, marketBriefTime: null }).marketBrief).toBe(false)
  })
})
