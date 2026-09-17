// Task 165 Phase 2 step 2c — spec docs/agent/specs/discord-holdings.md §2.7 (service).
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
  getHoldingsPush,
  previewHoldings,
  saveHoldingsWebhook,
  setHoldingsPushEnabled,
  testHoldingsWebhook,
  type HoldingsPushStatus,
} from './discordHoldings'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
const URL_ = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN

const STATUS: HoldingsPushStatus = {
  configured: true,
  last4: 'Wxyz',
  enabled: true,
  lastSend: { kind: 'daily', ymd: '2026-09-16', status: 'sent', reason: null, at: '2026-09-16T09:15:03Z' },
}

function invoke() {
  return state.client!.functions.invoke
}

function body(op: Record<string, unknown>) {
  return { action: 'discord-holdings-settings', ...op }
}

function httpError(status: number, payload: unknown) {
  return {
    data: null,
    error: { message: `Edge Function returned a non-2xx status code ${URL_}`, context: new Response(JSON.stringify(payload), { status }) },
  }
}

describe('discordHoldings service', () => {
  beforeEach(() => {
    state.client = { functions: { invoke: vi.fn() } }
  })

  it('gets the status', async () => {
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS }, error: null })
    expect(await getHoldingsPush()).toEqual(STATUS)
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: body({ op: 'get' }), timeout: 45_000 })
  })

  it('saves a URL', async () => {
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS }, error: null })
    expect(await saveHoldingsWebhook(URL_)).toEqual(STATUS)
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: body({ op: 'set', url: URL_ }), timeout: 45_000 })
  })

  it('clears the URL', async () => {
    const cleared = { ...STATUS, configured: false, last4: null, enabled: false }
    invoke().mockResolvedValue({ data: { ok: true, status: cleared }, error: null })
    expect(await clearHoldingsWebhook()).toEqual(cleared)
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: body({ op: 'clear' }), timeout: 45_000 })
  })

  it.each([true, false])('sets enabled=%s', async (enabled) => {
    invoke().mockResolvedValue({ data: { ok: true, status: { ...STATUS, enabled } }, error: null })
    expect((await setHoldingsPushEnabled(enabled)).enabled).toBe(enabled)
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: body({ op: 'enable', enabled }), timeout: 45_000 })
  })

  it('runs a test send', async () => {
    const send = { ok: false, httpStatus: 404, reason: 'webhook-gone' }
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS, send }, error: null })
    expect(await testHoldingsWebhook()).toEqual({ status: STATUS, send })
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: body({ op: 'test' }), timeout: 45_000 })
  })

  it('runs a preview with the longer timeout', async () => {
    const send = { ok: true, httpStatus: 204 }
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS, send, previewYmd: '2026-09-17' }, error: null })
    expect(await previewHoldings()).toEqual({ status: STATUS, send, previewYmd: '2026-09-17' })
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: body({ op: 'preview' }), timeout: 90_000 })
  })

  it('refuses in local mode', async () => {
    state.client = null
    await expect(getHoldingsPush()).rejects.toThrow('本機模式無法設定 Discord 推播')
    await expect(previewHoldings()).rejects.toThrow('本機模式無法設定 Discord 推播')
  })

  it.each([
    ['quota', 429, 'Discord 推播設定失敗（HTTP 429：今日測試／預覽次數已達上限）'],
    ['not-configured', 400, 'Discord 推播設定失敗（HTTP 400：尚未設定 Webhook）'],
    ['invalid-url', 400, 'Discord 推播設定失敗（HTTP 400：網址格式不正確）'],
    ['no-market-data', 409, 'Discord 推播設定失敗（HTTP 409：找不到任何台股大盤資料）'],
    ['no-holdings', 409, 'Discord 推播設定失敗（HTTP 409：目前沒有持股）'],
    ['bad-request', 400, 'Discord 推播設定失敗（HTTP 400：請求格式錯誤）'],
  ])('explains the %s error code', async (code, status, message) => {
    invoke().mockResolvedValue(httpError(status, { ok: false, error: code }))
    await expect(previewHoldings()).rejects.toThrow(message)
  })

  it('reports only the status for an unknown or inherited code, never server text', async () => {
    invoke().mockResolvedValue(httpError(500, { error: `boom ${URL_}` }))
    const err1 = await getHoldingsPush().catch((e: Error) => e)
    expect((err1 as Error).message).toBe('Discord 推播設定失敗（HTTP 500）')

    invoke().mockResolvedValue(httpError(400, { error: 'constructor' }))
    const err2 = await getHoldingsPush().catch((e: Error) => e)
    expect((err2 as Error).message).toBe('Discord 推播設定失敗（HTTP 400）')
  })

  it('reports 401 without text', async () => {
    invoke().mockResolvedValue(httpError(401, { error: 'Unauthorized' }))
    await expect(getHoldingsPush()).rejects.toThrow(/^Discord 推播設定失敗（HTTP 401）$/)
  })

  it('never surfaces the supabase-js message on a network failure', async () => {
    invoke().mockResolvedValue({ data: null, error: { message: `Failed to send a request to ${URL_}` } })
    const err = await saveHoldingsWebhook(URL_).catch((e: Error) => e)
    expect((err as Error).message).toBe('Discord 推播設定失敗')
    expect((err as Error).message).not.toContain(TOKEN)
  })
})
