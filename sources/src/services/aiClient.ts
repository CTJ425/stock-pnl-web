/**
 * AI 服務客戶端 Adapter：支援 Google Gemini 與 OpenAI 相容 API (ollama / vLLM)。
 * 提供純函式與 Provider 物件，不依賴任何外部 SDK。
 */
import type { AiProviderKind, AiSettings } from './aiSettings'

export type AiErrorKind = 'auth' | 'rate-limit' | 'server' | 'timeout' | 'network' | 'bad-response'

export class AiError extends Error {
  public kind: AiErrorKind

  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
  }
}

export interface AiRequest {
  system: string
  user: string
  timeoutMs?: number
}

export interface AiProvider {
  readonly kind: AiProviderKind
  complete(req: AiRequest): Promise<string>
}

/**
 * 純函式：Base URL 正規化。
 * 去除尾斜線；若已包含 /v1 結尾則不重複附加，否則補上 /v1。
 * 範例：http://h:11434, http://h:11434/, http://h:11434/v1, http://h:11434/v1/
 * 皆產出 http://h:11434/v1
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) {
    return trimmed
  }
  return `${trimmed}/v1`
}

/**
 * 純函式：HTTP 狀態碼對應 AiErrorKind
 */
export function mapHttpError(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return 'bad-response'
}

/**
 * 純函式：解析 Google Gemini API 回傳 JSON。取不到內容時拋出 AiError('bad-response', …)
 */
export function extractGoogleText(json: unknown): string {
  if (!json || typeof json !== 'object') {
    throw new AiError('bad-response', 'Google API 回傳資料非有效 JSON 物件')
  }
  const data = json as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }
  const candidate = data.candidates?.[0]
  if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
    throw new AiError('bad-response', 'Google API 回傳結構未包含有效的 candidates[0].content.parts')
  }
  const text = candidate.content.parts.map((p) => p.text || '').join('')
  if (!text.trim()) {
    throw new AiError('bad-response', 'Google API 回傳文字內容為空')
  }
  return text
}

/**
 * 純函式：解析 OpenAI 相容 API 回傳 JSON。取不到內容時拋出 AiError('bad-response', …)
 */
export function extractOpenAiText(json: unknown): string {
  if (!json || typeof json !== 'object') {
    throw new AiError('bad-response', 'OpenAI 相容 API 回傳資料非有效 JSON 物件')
  }
  const data = json as {
    choices?: Array<{
      message?: {
        content?: string | null
      }
    }>
  }
  const choice = data.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiError('bad-response', 'OpenAI 相容 API 回傳結構未包含有效的 choices[0].message.content')
  }
  return content.trim()
}

/**
 * 發出請求並在**同一個逾時計時器內**讀完 body。
 *
 * 逾時不可以只包住 `fetch()`：fetch 在收到 response headers 就 resolve，
 * body 還沒讀。若在 fetch 之後才 clearTimeout，遇到「headers 回來了但 body 卡住」
 * 的伺服器就完全沒有逾時保護，UI 會永遠停在「解讀中」。
 */
async function requestJson(
  url: string,
  options: RequestInit,
  timeoutMs: number = 30000,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, status: res.status, json: null }
    const json = await res.json().catch((err: unknown) => {
      // 讀 body 途中被逾時 abort 的話要往外傳，交給下面映射成 timeout，
      // 不能一律當成「回傳格式不對」。
      if (err instanceof Error && err.name === 'AbortError') throw err
      throw new AiError('bad-response', 'AI 服務回傳的內容不是合法的 JSON')
    })
    return { ok: true, status: res.status, json }
  } catch (err: unknown) {
    // 上面刻意丟出的 AiError 不要被下面的網路錯誤包裝掉
    if (err instanceof AiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiError('timeout', `請求逾時（最長 ${Math.round(timeoutMs / 1000)} 秒），請稍後重試`)
    }
    const rawMsg = err instanceof Error ? err.message : String(err)
    throw new AiError(
      'network',
      `網路連線失敗 (${rawMsg})。如果是跨網域請求 (例如 Ollama 本機端點)，請確認已設定 OLLAMA_ORIGINS 環境變數允許 CORS。`,
    )
  } finally {
    clearTimeout(timer)
  }
}

class GoogleProviderImpl implements AiProvider {
  readonly kind = 'google' as const
  private settings: AiSettings

  constructor(settings: AiSettings) {
    this.settings = settings
  }

  async complete(req: AiRequest): Promise<string> {
    const model = encodeURIComponent(this.settings.model)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const body = {
      systemInstruction: {
        parts: [{ text: req.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: req.user }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
      },
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.settings.apiKey,
    }

    const res = await requestJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, req.timeoutMs)

    if (!res.ok) {
      const kind = mapHttpError(res.status)
      let msg = `Google API 回傳錯誤 (HTTP ${res.status})，常見原因是模型名稱或 API 金鑰不正確`
      if (kind === 'auth') msg = `Google API 金鑰驗證失敗 (HTTP ${res.status})`
      else if (kind === 'rate-limit') msg = `超出 Google API 呼叫頻率限制 (HTTP 429)`
      else if (kind === 'server') msg = `Google API 伺服器內部錯誤 (HTTP ${res.status})`
      throw new AiError(kind, msg)
    }

    return extractGoogleText(res.json)
  }
}

class OpenAiCompatibleProviderImpl implements AiProvider {
  readonly kind = 'openai-compatible' as const
  private settings: AiSettings

  constructor(settings: AiSettings) {
    this.settings = settings
  }

  async complete(req: AiRequest): Promise<string> {
    const base = normalizeBaseUrl(this.settings.baseUrl)
    const url = `${base}/chat/completions`
    const body = {
      model: this.settings.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: 0.2,
      stream: false,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.settings.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${this.settings.apiKey.trim()}`
    }

    const res = await requestJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, req.timeoutMs)

    if (!res.ok) {
      const kind = mapHttpError(res.status)
      let msg = `OpenAI 相容 API 回傳錯誤 (HTTP ${res.status})，常見原因是模型名稱不存在於該端點`
      if (kind === 'auth') msg = `API 認證授權失敗 (HTTP ${res.status})`
      else if (kind === 'rate-limit') msg = `超出 API 呼叫頻率限制 (HTTP 429)`
      else if (kind === 'server') msg = `AI 伺服器內部錯誤 (HTTP ${res.status})`
      throw new AiError(kind, msg)
    }

    return extractOpenAiText(res.json)
  }
}

/** 依據設定工廠建立對應的 AiProvider */
export function createAiProvider(s: AiSettings): AiProvider {
  if (s.provider === 'google') {
    return new GoogleProviderImpl(s)
  }
  return new OpenAiCompatibleProviderImpl(s)
}
