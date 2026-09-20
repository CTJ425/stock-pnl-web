/**
 * Task 165 step 2d: the full edition's per-account copies (spec discord-admin-accounts.md §3.3).
 * The global behaviour itself is covered by discordRun.test.ts, which must stay unchanged.
 */
import { describe, expect, it, vi } from 'vitest'
import { runDiscordSummary, type RunOutcome, type SummaryDeps } from './discordRun.ts'
import type { DiscordPayload, DiscordSendResult } from './discordWebhook.ts'
import {
  FAKE_TOKEN,
  FAKE_WEBHOOK,
  GSPC_PREOPEN,
  MACRO_LINES,
  MARGIN_MS_0916,
  MARKET_ASOF_0916,
  MARKET_DAY_0916,
  N225_MIDSESSION,
  USD_TWD,
} from './discordTestFixtures.ts'

/** 21:30 Taipei on 2026-09-16. */
const FULL_AT = new Date('2026-09-16T13:30:00Z')
const HOOK_A = FAKE_WEBHOOK.replace(/.{4}$/, 'Aaaa')
const HOOK_B = FAKE_WEBHOOK.replace(/.{4}$/, 'Bbbb')

const SENT: RunOutcome = { kind: 'sent', httpStatus: 204 }

function deps(over: Partial<SummaryDeps> = {}) {
  return {
    now: vi.fn(() => FULL_AT),
    loadMarketFile: vi.fn(async () => ({ asOf: MARKET_ASOF_0916, days: [MARKET_DAY_0916] })),
    loadWebhookUrl: vi.fn(async (): Promise<string | null> => FAKE_WEBHOOK),
    claimSend: vi.fn(async () => true),
    finishSend: vi.fn(async () => {}),
    loadIndex: vi.fn(async (symbol: string) => (symbol === '^GSPC' ? GSPC_PREOPEN : N225_MIDSESSION)),
    loadUsdTwd: vi.fn(async () => USD_TWD),
    loadMacro: vi.fn(async () => MACRO_LINES),
    loadMargin: vi.fn(async () => MARGIN_MS_0916),
    post: vi.fn(async (_url: string, _p: DiscordPayload): Promise<DiscordSendResult> => ({ ok: true, httpStatus: 204 })),
    log: vi.fn(async () => {}),
    loadMarketOverrides: vi.fn(async () => [
      { userId: 'u1', url: HOOK_A, enabled: true },
      { userId: 'u2', url: HOOK_B, enabled: true },
      { userId: 'u3', url: HOOK_A, enabled: true },
      { userId: 'u4', url: FAKE_WEBHOOK, enabled: true },
    ]),
    finishMarketOverride: vi.fn(async (_userId: string, _ymd: string, _o: RunOutcome) => {}),
    ...over,
  }
}

function postedUrls(d: ReturnType<typeof deps>): string[] {
  return vi.mocked(d.post).mock.calls.map((c) => c[0])
}

describe('runDiscordSummary — per-account copies', () => {
  it('posts the global message first, then one copy per distinct account URL', async () => {
    const d = deps()
    const out = await runDiscordSummary(d, 'full')
    expect(out).toEqual(SENT)
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK, HOOK_A, HOOK_B])
    // the same content everywhere
    const payloads = vi.mocked(d.post).mock.calls.map((c) => c[1])
    expect(payloads[1]).toBe(payloads[0])
    expect(payloads[2]).toBe(payloads[0])
  })

  it('records each account once, with its target outcome, after the global record', async () => {
    const order: string[] = []
    const d = deps({
      finishSend: vi.fn(async () => {
        order.push('global')
      }),
      finishMarketOverride: vi.fn(async (userId: string) => {
        order.push(userId)
      }),
    })
    await runDiscordSummary(d, 'full')
    expect(order).toEqual(['global', 'u1', 'u3', 'u2'])
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u1', '2026-09-16', SENT)
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u3', '2026-09-16', SENT)
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u2', '2026-09-16', SENT)
    // u4 inherits in effect (same URL as global): no copy, no record
    expect(d.finishMarketOverride).not.toHaveBeenCalledWith('u4', expect.anything(), expect.anything())
  })

  it('still sends the copies when the global post failed, and returns the global outcome', async () => {
    const d = deps({
      post: vi.fn(async (url: string): Promise<DiscordSendResult> =>
        url === FAKE_WEBHOOK ? { ok: false, httpStatus: 404, reason: 'webhook-gone' } : { ok: true, httpStatus: 204 },
      ),
    })
    const out = await runDiscordSummary(d, 'full')
    expect(out).toEqual({ kind: 'failed', httpStatus: 404, reason: 'webhook-gone' })
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK, HOOK_A, HOOK_B])
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u2', '2026-09-16', SENT)
  })

  it('records a failed copy for every account on that URL and logs it without the URL', async () => {
    const d = deps({
      post: vi.fn(async (url: string): Promise<DiscordSendResult> =>
        url === HOOK_A ? { ok: false, httpStatus: 429, reason: 'rate-limited' } : { ok: true, httpStatus: 204 },
      ),
    })
    const out = await runDiscordSummary(d, 'full')
    expect(out).toEqual(SENT)
    const failed: RunOutcome = { kind: 'failed', httpStatus: 429, reason: 'rate-limited' }
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u1', '2026-09-16', failed)
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u3', '2026-09-16', failed)
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u2', '2026-09-16', SENT)
    expect(d.log).toHaveBeenCalledWith({
      level: 'warn',
      message: 'discord market override send failed',
      detail: { status: 429, code: 'rate-limited', users: 2 },
    })
    expect(JSON.stringify(vi.mocked(d.log).mock.calls)).not.toContain(FAKE_TOKEN)
    expect(JSON.stringify(vi.mocked(d.log).mock.calls)).not.toContain('Aaaa')
  })

  it('treats a throwing post as a network failure and carries on', async () => {
    const d = deps({
      post: vi.fn(async (url: string): Promise<DiscordSendResult> => {
        if (url === HOOK_A) throw new Error(`fetch failed for ${url}`)
        return { ok: true, httpStatus: 204 }
      }),
    })
    expect(await runDiscordSummary(d, 'full')).toEqual(SENT)
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u1', '2026-09-16', { kind: 'failed', httpStatus: null, reason: 'network' })
    expect(d.finishMarketOverride).toHaveBeenCalledWith('u2', '2026-09-16', SENT)
    expect(JSON.stringify(vi.mocked(d.log).mock.calls)).not.toContain(FAKE_TOKEN)
  })

  it('carries on when recording one account throws', async () => {
    const d = deps({
      finishMarketOverride: vi.fn(async (userId: string) => {
        if (userId === 'u1') throw new Error('db down')
      }),
    })
    expect(await runDiscordSummary(d, 'full')).toEqual(SENT)
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK, HOOK_A, HOOK_B])
    expect(d.finishMarketOverride).toHaveBeenCalledTimes(3)
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }))
  })

  it('sends only the global message when loading the overrides fails', async () => {
    const d = deps({ loadMarketOverrides: vi.fn(async () => { throw new Error('db down') }) })
    expect(await runDiscordSummary(d, 'full')).toEqual(SENT)
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK])
    expect(d.log).toHaveBeenCalledWith({ level: 'warn', message: 'discord market overrides failed', detail: {} })
  })

  it('sends no copies without a global webhook', async () => {
    const d = deps({ loadWebhookUrl: vi.fn(async () => null) })
    expect(await runDiscordSummary(d, 'full')).toEqual({ kind: 'skipped', reason: 'no-webhook' })
    expect(d.loadMarketOverrides).not.toHaveBeenCalled()
    expect(d.post).not.toHaveBeenCalled()
  })

  it('sends no copies on a day with no market data', async () => {
    const d = deps({ loadMarketFile: vi.fn(async () => ({ days: [{ ...MARKET_DAY_0916, date: '2026-09-15' }] })) })
    expect(await runDiscordSummary(d, 'full')).toEqual({ kind: 'skipped', reason: 'no-market-day' })
    expect(d.loadMarketOverrides).not.toHaveBeenCalled()
    expect(d.post).not.toHaveBeenCalled()
  })

  it('sends no copies when the day is already claimed', async () => {
    const d = deps({ claimSend: vi.fn(async () => false) })
    expect(await runDiscordSummary(d, 'full')).toEqual({ kind: 'skipped', reason: 'already-sent' })
    expect(d.loadMarketOverrides).not.toHaveBeenCalled()
    expect(d.post).not.toHaveBeenCalled()
  })

  it('behaves as before when the override deps are absent', async () => {
    const { loadMarketOverrides: _l, finishMarketOverride: _f, ...rest } = deps()
    const d = rest as SummaryDeps & { post: ReturnType<typeof vi.fn> }
    expect(await runDiscordSummary(d, 'full')).toEqual(SENT)
    expect(d.post).toHaveBeenCalledTimes(1)
  })
})

/** Task 165 step 2e (spec discord-user-self-service.md §4, D4/D5). */
describe('runDiscordSummary — both editions, and the market_enabled switch', () => {
  it('sends the per-account copies for the brief edition too', async () => {
    const d = deps()
    expect(await runDiscordSummary(d, 'brief')).toEqual(SENT)
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK, HOOK_A, HOOK_B])
  })

  it('skips an account whose 經濟快報 is switched off, keeping its URL', async () => {
    const d = deps({
      loadMarketOverrides: vi.fn(async () => [
        { userId: 'u1', url: HOOK_A, enabled: false },
        { userId: 'u2', url: HOOK_B, enabled: true },
      ]),
    })
    expect(await runDiscordSummary(d, 'full')).toEqual(SENT)
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK, HOOK_B])
    expect(vi.mocked(d.finishMarketOverride!).mock.calls.map((c) => c[0])).toEqual(['u2'])
  })

  it('posts only the global message when every override is switched off', async () => {
    const d = deps({
      loadMarketOverrides: vi.fn(async () => [
        { userId: 'u1', url: HOOK_A, enabled: false },
        { userId: 'u2', url: HOOK_B, enabled: false },
      ]),
    })
    expect(await runDiscordSummary(d, 'full')).toEqual(SENT)
    expect(postedUrls(d)).toEqual([FAKE_WEBHOOK])
    expect(d.finishMarketOverride).not.toHaveBeenCalled()
  })
})
