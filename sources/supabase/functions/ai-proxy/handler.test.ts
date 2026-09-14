import { describe, expect, it, vi } from 'vitest'
import { handleAiProxy, type AiProxyDeps } from './handler'

/**
 * Spec 161. The proxy exists so the browser never holds the google key. Every test here
 * guards one of the two things the client must not be able to control: the key, and the model.
 */

const GOOGLE_OK = {
  candidates: [{ content: { parts: [{ text: '結果' }] } }],
}

function deps(over: Partial<AiProxyDeps> = {}): AiProxyDeps {
  return {
    verifyJwt: vi.fn(async () => true),
    readSettings: vi.fn(async () => ({
      provider: 'google',
      model: 'gemini-2.5-flash',
      apiKey: 'server-side-key',
    })),
    fetchUpstream: vi.fn(async () => new Response(JSON.stringify(GOOGLE_OK), { status: 200 })),
    ...over,
  }
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer jwt' }) {
  return new Request('https://edge.example/functions/v1/ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const okBody = { googleBody: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } }

describe('ai-proxy handler', () => {
  it('OPTIONS 回 CORS preflight', async () => {
    const res = await handleAiProxy(
      new Request('https://edge.example', { method: 'OPTIONS' }),
      deps(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
  })

  it('非 POST 回 405', async () => {
    const res = await handleAiProxy(new Request('https://edge.example', { method: 'GET' }), deps())
    expect(res.status).toBe(405)
  })

  it('缺少 Authorization 回 401，且不讀設定、不打上游', async () => {
    const d = deps()
    const res = await handleAiProxy(post(okBody, {}), d)
    expect(res.status).toBe(401)
    expect(d.readSettings).not.toHaveBeenCalled()
    expect(d.fetchUpstream).not.toHaveBeenCalled()
  })

  it('JWT 驗證失敗回 401', async () => {
    const d = deps({ verifyJwt: vi.fn(async () => false) })
    const res = await handleAiProxy(post(okBody), d)
    expect(res.status).toBe(401)
    expect(d.fetchUpstream).not.toHaveBeenCalled()
  })

  it('缺少 googleBody 回 400', async () => {
    const res = await handleAiProxy(post({ notIt: 1 }), deps())
    expect(res.status).toBe(400)
  })

  it('超過 256KB 的請求回 413', async () => {
    const huge = { googleBody: { pad: 'x'.repeat(256 * 1024 + 10) } }
    const res = await handleAiProxy(post(huge), deps())
    expect(res.status).toBe(413)
  })

  it('供應商不是 google 時回 400，不打上游', async () => {
    const d = deps({
      readSettings: vi.fn(async () => ({
        provider: 'openai-compatible',
        model: 'llama3',
        apiKey: '',
      })),
    })
    const res = await handleAiProxy(post(okBody), d)
    expect(res.status).toBe(400)
    expect(d.fetchUpstream).not.toHaveBeenCalled()
  })

  it('伺服器沒設金鑰時回 500 並指出欄位', async () => {
    const d = deps({
      readSettings: vi.fn(async () => ({ provider: 'google', model: 'gemini-2.5-flash', apiKey: '' })),
    })
    const res = await handleAiProxy(post(okBody), d)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).toContain('ai_api_key')
  })

  it('把伺服器端的 model 與金鑰送上游，原樣轉送 googleBody', async () => {
    const d = deps()
    await handleAiProxy(post(okBody), d)

    const [url, init] = (d.fetchUpstream as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('server-side-key')
    expect(JSON.parse(init.body as string)).toEqual(okBody.googleBody)
  })

  it('用戶端自帶 model 會被忽略，一律用資料庫存的那個', async () => {
    const d = deps()
    await handleAiProxy(post({ ...okBody, model: 'gemini-1.0-attacker' }), d)

    const [url] = (d.fetchUpstream as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('gemini-2.5-flash')
    expect(url).not.toContain('attacker')
  })

  it('原樣轉送上游狀態碼與 JSON（400 重送邏輯留在前端）', async () => {
    const d = deps({
      fetchUpstream: vi.fn(
        async () => new Response(JSON.stringify({ error: { code: 400 } }), { status: 400 }),
      ),
    })
    const res = await handleAiProxy(post(okBody), d)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 400 } })
  })

  // Reviewer finding, 2026-09-14: a failed settings read used to fall through as provider ''
  // and surface as 400 "not the google provider", hiding the real fault.
  it('讀取設定失敗時回 500 並帶出真正原因，不是 400', async () => {
    const d = deps({
      readSettings: vi.fn(async () => {
        throw new Error('could not connect to server')
      }),
    })
    const res = await handleAiProxy(post(okBody), d)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).toContain('could not connect to server')
    expect(d.fetchUpstream).not.toHaveBeenCalled()
  })

  // Reviewer finding, 2026-09-14: the ceiling measured UTF-16 code units. This app's prompts are
  // Traditional Chinese, so one character is 3 UTF-8 bytes — a body ~3x the cap slipped through.
  it('中文請求以位元組計算上限，超過 256KB 一樣回 413', async () => {
    // 100_000 CJK characters = 100_000 UTF-16 units (under the old check) but 300_000 bytes.
    const cjk = { googleBody: { pad: '股'.repeat(100_000) } }
    const res = await handleAiProxy(post(cjk), deps())
    expect(res.status).toBe(413)
  })

  it('未超過上限的中文請求照常放行', async () => {
    const d = deps()
    const small = { googleBody: { pad: '股'.repeat(1000) } }
    const res = await handleAiProxy(post(small), d)
    expect(res.status).toBe(200)
    expect(d.fetchUpstream).toHaveBeenCalledTimes(1)
  })

  it('任何回應都不得帶出金鑰', async () => {
    const d = deps({
      fetchUpstream: vi.fn(async () => new Response('upstream exploded', { status: 500 })),
    })
    const res = await handleAiProxy(post(okBody), d)
    expect(await res.text()).not.toContain('server-side-key')
  })
})
