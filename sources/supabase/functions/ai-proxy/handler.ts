/**
 * ai-proxy request logic, kept free of `Deno` / `createClient` so it can be unit-tested under
 * vitest's node environment. `index.ts` wires the real Deno/Supabase dependencies through
 * `AiProxyDeps` and calls `handleAiProxy` from `Deno.serve`.
 *
 * Spec 161: this relay adds exactly two things the browser must not hold — the Google API key
 * and the model name. Everything else (body shape, 400 retry, error mapping) stays in
 * `aiClient.ts` on the browser side; this function forwards Google's status and JSON verbatim.
 */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** 256 KB request body ceiling — a chat prompt has no legitimate reason to exceed this. */
const MAX_BODY_BYTES = 256 * 1024

export interface AiProxySettings {
  provider: string
  model: string
  apiKey: string
}

export interface AiProxyDeps {
  /**
   * Resolves the caller's role from the bearer token. `null` for a missing/invalid JWT
   * (401); `'user'` for a valid but non-admin caller (403, Task 166 AI-01 — AI analysis is
   * admin-only); `'admin'` proceeds.
   */
  authorize: (token: string) => Promise<'admin' | 'user' | null>
  /** Reads provider/model/key for the single shared row (service-role, bypasses RLS). */
  readSettings: () => Promise<AiProxySettings>
  /** Performs the upstream Google request. Swappable so tests never hit the network. */
  fetchUpstream: (url: string, init: RequestInit) => Promise<Response>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export async function handleAiProxy(req: Request, deps: AiProxyDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return json({ error: '未登入或憑證缺失' }, 401)
  }
  const role = await deps.authorize(token)
  if (role === null) {
    return json({ error: '登入憑證無效或已過期' }, 401)
  }
  if (role === 'user') {
    return json({ error: 'AI 分析僅限管理員使用' }, 403)
  }

  const rawBody = await req.text()
  // Byte length, not `rawBody.length`: this app's prompts are Traditional Chinese, and one CJK
  // character is 3 UTF-8 bytes but a single UTF-16 code unit. Measuring the string length would
  // let a body roughly 3x the intended ceiling through.
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json({ error: '請求內容過大' }, 413)
  }

  let parsed: unknown
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null
  } catch {
    return json({ error: '請求內容不是有效的 JSON' }, 400)
  }

  const googleBody = (parsed as { googleBody?: unknown } | null)?.googleBody
  if (!googleBody || typeof googleBody !== 'object') {
    return json({ error: '請求缺少 googleBody' }, 400)
  }

  // A failed settings read must not fall through as `provider === ''`, which would be reported
  // as "not the google provider" (400) and hide a transient database fault behind a wrong cause.
  let settings: AiProxySettings
  try {
    settings = await deps.readSettings()
  } catch (e) {
    return json({ error: `讀取 AI 設定失敗：${e instanceof Error ? e.message : String(e)}` }, 500)
  }

  if (settings.provider !== 'google') {
    return json({ error: 'ai-proxy 只處理 google 供應商' }, 400)
  }
  if (!settings.model) {
    return json({ error: '伺服器尚未設定 ai_model' }, 500)
  }
  if (!settings.apiKey) {
    return json({ error: '伺服器尚未設定 ai_api_key' }, 500)
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    settings.model,
  )}:generateContent`

  const upstream = await deps.fetchUpstream(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.apiKey,
    },
    body: JSON.stringify(googleBody),
  })

  const upstreamText = await upstream.text()
  return new Response(upstreamText, {
    status: upstream.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
