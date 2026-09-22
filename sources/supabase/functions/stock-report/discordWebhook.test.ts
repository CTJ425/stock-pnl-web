import { describe, expect, it, vi } from 'vitest'
import { MAX_RETRY_AFTER_MS, postDiscordWebhook, type DiscordPayload } from './discordWebhook.ts'
import { FAKE_TOKEN, FAKE_WEBHOOK } from './discordTestFixtures.ts'

const PAYLOAD: DiscordPayload = {
  username: '盤後總結',
  embeds: [{ title: 't', fields: [] }],
  allowed_mentions: { parse: [] },
}

function res(status: number, body?: unknown, headers?: Record<string, string>): Response {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(status === 204 ? null : text, { status, headers })
}

function setup(...responses: Array<Response | Error>) {
  const fetchImpl = vi.fn()
  for (const r of responses) {
    if (r instanceof Error) fetchImpl.mockRejectedValueOnce(r)
    else fetchImpl.mockResolvedValueOnce(r)
  }
  const sleep = vi.fn().mockResolvedValue(undefined)
  return { fetchImpl, sleep, deps: { fetchImpl: fetchImpl as unknown as typeof fetch, sleep } }
}

describe('postDiscordWebhook', () => {
  it('POSTs JSON to the webhook with ?wait=true and reports 204 as ok', async () => {
    const { fetchImpl, deps } = setup(res(204))
    const out = await postDiscordWebhook(`  ${FAKE_WEBHOOK} `, PAYLOAD, deps)
    expect(out).toEqual({ ok: true, httpStatus: 204 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${FAKE_WEBHOOK}?wait=true`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual(PAYLOAD)
    expect(init.signal).toBeDefined()
  })

  it('reports 200 as ok', async () => {
    const { deps } = setup(res(200, { id: '1' }))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({ ok: true, httpStatus: 200 })
  })

  it('waits retry_after from the body once, then succeeds', async () => {
    const { fetchImpl, sleep, deps } = setup(res(429, { retry_after: 1.25, global: false }), res(204))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({ ok: true, httpStatus: 204 })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1250)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls back to the Retry-After header when the body is not JSON', async () => {
    const { sleep, deps } = setup(res(429, 'slow down', { 'Retry-After': '2' }), res(204))
    await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('waits 1 s when neither body nor header says how long', async () => {
    const { sleep, deps } = setup(res(429, 'slow down'), res(204))
    await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('caps the back-off', async () => {
    const { sleep, deps } = setup(res(429, { retry_after: 3600 }), res(204))
    await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)
    expect(MAX_RETRY_AFTER_MS).toBe(10_000)
    expect(sleep).toHaveBeenCalledWith(MAX_RETRY_AFTER_MS)
  })

  it('gives up after a second 429', async () => {
    const { fetchImpl, sleep, deps } = setup(res(429, { retry_after: 0.1 }), res(429, { retry_after: 0.1 }))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({
      ok: false,
      httpStatus: 429,
      reason: 'rate-limited',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('classifies the retried response normally', async () => {
    const { deps } = setup(res(429, { retry_after: 0.1 }), res(404, { code: 10015 }))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({
      ok: false,
      httpStatus: 404,
      reason: 'webhook-gone',
    })
  })

  it.each([404, 401])('treats %i as a deleted webhook and does not retry', async (status) => {
    const { fetchImpl, sleep, deps } = setup(res(status, { message: 'Unknown Webhook' }))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({
      ok: false,
      httpStatus: status,
      reason: 'webhook-gone',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  // Task 166 (ED-05): 5xx (Discord is down) and 4xx (our payload is wrong) need different
  // reasons — the old single 'http-error' made the two indistinguishable in the logs.
  it.each([
    [400, 'bad-request'],
    [403, 'bad-request'],
    [500, 'server-error'],
    [502, 'server-error'],
  ])('reports %i as %s without retrying', async (status, reason) => {
    const { fetchImpl, deps } = setup(res(status as number, { message: 'nope' }))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({
      ok: false,
      httpStatus: status,
      reason,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected fetch as network and never throws', async () => {
    const { fetchImpl, deps } = setup(new Error(`connect failed for ${FAKE_WEBHOOK}`))
    expect(await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, deps)).toEqual({
      ok: false,
      httpStatus: null,
      reason: 'network',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses an invalid URL without fetching', async () => {
    const { fetchImpl, deps } = setup(res(204))
    expect(await postDiscordWebhook('https://example.com/hook', PAYLOAD, deps)).toEqual({
      ok: false,
      httpStatus: null,
      reason: 'invalid-url',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never puts the token in any result', async () => {
    const cases = [
      setup(res(204)),
      setup(res(404, { message: FAKE_TOKEN })),
      setup(res(500, FAKE_WEBHOOK)),
      setup(new Error(FAKE_WEBHOOK)),
      setup(res(429, { retry_after: 0 }), res(429, { retry_after: 0 })),
    ]
    for (const c of cases) {
      const out = await postDiscordWebhook(FAKE_WEBHOOK, PAYLOAD, c.deps)
      expect(JSON.stringify(out)).not.toContain(FAKE_TOKEN)
    }
  })
})
