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
  clearDiscordWebhook,
  getDiscordWebhookStatus,
  saveDiscordWebhook,
  testDiscordWebhook,
  type DiscordWebhookStatus,
} from './discordWebhook'

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
const URL_ = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN

const STATUS: DiscordWebhookStatus = { configured: true, last4: 'Wxyz', updatedAt: '2026-09-16T09:00:00Z', recent: [] }

function invoke() {
  return state.client!.functions.invoke
}

describe('discordWebhook service', () => {
  beforeEach(() => {
    state.client = { functions: { invoke: vi.fn() } }
  })

  it('gets the status', async () => {
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS }, error: null })
    expect(await getDiscordWebhookStatus()).toEqual(STATUS)
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: { action: 'discord-webhook', op: 'get' }, timeout: 45_000 })
  })

  it('saves a URL', async () => {
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS }, error: null })
    expect(await saveDiscordWebhook(URL_)).toEqual(STATUS)
    expect(invoke()).toHaveBeenCalledWith('stock-report', {
      body: { action: 'discord-webhook', op: 'set', url: URL_ },
      timeout: 45_000,
    })
  })

  it('clears the URL', async () => {
    const cleared = { ...STATUS, configured: false, last4: null, updatedAt: null }
    invoke().mockResolvedValue({ data: { ok: true, status: cleared }, error: null })
    expect(await clearDiscordWebhook()).toEqual(cleared)
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: { action: 'discord-webhook', op: 'clear' }, timeout: 45_000 })
  })

  it('runs a test send', async () => {
    const test = { ok: false, httpStatus: 404, reason: 'webhook-gone' }
    invoke().mockResolvedValue({ data: { ok: true, status: STATUS, test }, error: null })
    expect(await testDiscordWebhook()).toEqual({ status: STATUS, test })
    expect(invoke()).toHaveBeenCalledWith('stock-report', { body: { action: 'discord-webhook', op: 'test' }, timeout: 45_000 })
  })

  it('refuses in local mode', async () => {
    state.client = null
    await expect(getDiscordWebhookStatus()).rejects.toThrow('本機模式無法設定 Discord')
    await expect(saveDiscordWebhook(URL_)).rejects.toThrow('本機模式無法設定 Discord')
  })

  it('reports an HTTP failure with its status and without the URL', async () => {
    const error = Object.assign(new Error(`Edge Function returned a non-2xx status code for ${URL_}`), {
      context: new Response(JSON.stringify({ ok: false, error: 'invalid-url' }), { status: 400 }),
    })
    invoke().mockResolvedValue({ data: null, error })
    const err = (await saveDiscordWebhook(URL_).catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('Discord 設定失敗')
    expect(err.message).toContain('400')
    expect(err.message).not.toContain(TOKEN)
  })

  it('reports a failure without a status', async () => {
    invoke().mockResolvedValue({ data: null, error: new Error(`fetch failed ${URL_}`) })
    const err = (await getDiscordWebhookStatus().catch((e: unknown) => e)) as Error
    expect(err.message).toContain('Discord 設定失敗')
    expect(err.message).not.toContain(TOKEN)
  })
})
