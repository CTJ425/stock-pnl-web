import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  client: { functions: { invoke: vi.fn() } } as { functions: { invoke: ReturnType<typeof vi.fn> } } | null,
}))
vi.mock('./supabase', () => ({
  get supabase() {
    return state.client
  },
}))

import {
  clearHoldingsWebhook,
  clearMarketWebhook,
  getDiscordAccounts,
  previewHoldingsReport,
  saveDiscordSchedule,
  saveHoldingsWebhook,
  saveMarketWebhook,
  setHoldingsEnabled,
  testHoldingsWebhook,
  testMarketWebhook,
  type DiscordAccountsSnapshot,
} from './discordAccounts'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
const URL_ = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN
const U1 = '11111111-1111-4111-8111-111111111111'

const SNAPSHOT: DiscordAccountsSnapshot = {
  schedule: { brief: '17:05', full: '21:30', holdingsAligned: true },
  accounts: [
    {
      userId: U1,
      email: 'alice@example.com',
      market: { custom: false, last4: null, enabled: false },
      holdings: { configured: true, last4: 'Wxyz', enabled: true },
      lastSend: null,
    },
  ],
}

function invoke() {
  return state.client!.functions.invoke
}

function expectBody(body: Record<string, unknown>) {
  expect(invoke()).toHaveBeenCalledWith('stock-report', { body: { action: 'discord-accounts', ...body }, timeout: 45_000 })
}

function httpError(status: number, body: unknown) {
  return { data: null, error: { message: `failed ${URL_}`, context: new Response(JSON.stringify(body), { status }) } }
}

describe('discordAccounts service', () => {
  beforeEach(() => {
    state.client = { functions: { invoke: vi.fn() } }
    invoke().mockResolvedValue({ data: { ok: true, ...SNAPSHOT }, error: null })
  })

  it('lists the schedule and the accounts', async () => {
    expect(await getDiscordAccounts()).toEqual(SNAPSHOT)
    expectBody({ op: 'list' })
  })

  it('saves the schedule', async () => {
    expect(await saveDiscordSchedule('18:30', '22:00')).toEqual(SNAPSHOT)
    expectBody({ op: 'set-schedule', brief: '18:30', full: '22:00' })
  })

  it('saves, clears and tests the 經濟快報 webhook of one account', async () => {
    await saveMarketWebhook(U1, URL_)
    expectBody({ op: 'set-market', userId: U1, url: URL_ })
    await clearMarketWebhook(U1)
    expectBody({ op: 'clear-market', userId: U1 })
    invoke().mockResolvedValue({ data: { ok: true, ...SNAPSHOT, send: { ok: true, httpStatus: 204 } }, error: null })
    expect(await testMarketWebhook(U1)).toEqual({ ...SNAPSHOT, send: { ok: true, httpStatus: 204 } })
    expectBody({ op: 'test-market', userId: U1 })
  })

  it('saves, clears, toggles and tests the 個人持股報告 webhook of one account', async () => {
    await saveHoldingsWebhook(U1, URL_)
    expectBody({ op: 'holdings-set', userId: U1, url: URL_ })
    await clearHoldingsWebhook(U1)
    expectBody({ op: 'holdings-clear', userId: U1 })
    await setHoldingsEnabled(U1, false)
    expectBody({ op: 'holdings-enable', userId: U1, enabled: false })
    invoke().mockResolvedValue({ data: { ok: true, ...SNAPSHOT, send: { ok: false, httpStatus: 404, reason: 'webhook-gone' } }, error: null })
    expect((await testHoldingsWebhook(U1)).send).toEqual({ ok: false, httpStatus: 404, reason: 'webhook-gone' })
    expectBody({ op: 'holdings-test', userId: U1 })
  })

  it('sends the full holdings report with a longer timeout and returns its data date', async () => {
    invoke().mockResolvedValue({
      data: { ok: true, ...SNAPSHOT, send: { ok: true, httpStatus: 204 }, previewYmd: '2026-09-17', missingQuotes: 2 },
      error: null,
    })
    expect(await previewHoldingsReport(U1)).toEqual({
      ...SNAPSHOT,
      send: { ok: true, httpStatus: 204 },
      previewYmd: '2026-09-17',
      missingQuotes: 2,
    })
    expect(invoke()).toHaveBeenCalledWith('stock-report', {
      body: { action: 'discord-accounts', op: 'holdings-preview', userId: U1 },
      timeout: 90_000,
    })
  })

  it('strips the ok flag from the snapshot', async () => {
    const res = await getDiscordAccounts()
    expect('ok' in res).toBe(false)
  })

  it.each([
    [400, 'invalid-time', 'Discord 設定失敗（HTTP 400：時間不在可選範圍）'],
    [400, 'unknown-user', 'Discord 設定失敗（HTTP 400：找不到這個帳號）'],
    [429, 'quota', 'Discord 設定失敗（HTTP 429：今天的手動發送次數已用完）'],
    [400, 'invalid-url', 'Discord 設定失敗（HTTP 400：網址格式不正確）'],
    [400, 'not-configured', 'Discord 設定失敗（HTTP 400：尚未設定 Webhook）'],
    [403, 'Forbidden', 'Discord 設定失敗（HTTP 403）'],
    [400, 'constructor', 'Discord 設定失敗（HTTP 400）'],
    [400, 'Unknown action', 'Discord 設定失敗（HTTP 400：後端尚未部署這個功能）'],
    [409, 'no-holdings', 'Discord 設定失敗（HTTP 409：這個帳號目前沒有持股）'],
    [409, 'no-market-data', 'Discord 設定失敗（HTTP 409：找不到任何台股大盤資料）'],
  ])('reports HTTP %i %s without server text or the URL', async (status, code, text) => {
    invoke().mockResolvedValue(httpError(status, { error: code }))
    const err = await saveMarketWebhook(U1, URL_).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(text)
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('never echoes a network-layer error message', async () => {
    invoke().mockResolvedValue({ data: null, error: { message: `fetch failed ${URL_}` } })
    const err = await saveHoldingsWebhook(U1, URL_).catch((e: Error) => e)
    expect((err as Error).message).toBe('Discord 設定失敗')
  })

  it('refuses in local mode', async () => {
    state.client = null
    await expect(getDiscordAccounts()).rejects.toThrow('本機模式無法設定 Discord')
  })
})
