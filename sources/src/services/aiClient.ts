/**
 * AI 服務客戶端 Adapter：支援 Google Gemini 與 OpenAI 相容 API (ollama / vLLM)。
 * 提供純函式與 Provider 物件，不依賴任何外部 SDK。
 */
import type { AiProviderKind, AiSettings } from './aiSettings'

export type AiErrorKind = 'auth' | 'rate-limit' | 'server' | 'timeout' | 'network' | 'bad-response'

/** 預設逾時。local model 推論慢，30 秒常常跑不完，放寬到 180 秒。UI 字樣一律由此推導。 */
export const AI_TIMEOUT_MS = 180_000

/**
 * Google 的輸出上限。
 *
 * 原本是 1200，實測 Gemini Flash 只寫了一句話就被切斷 —— 因為 Gemini 2.5 起的
 * **思考（thinking）token 也計入 maxOutputTokens**，1200 幾乎被思考吃光。
 * 本專案的輸出是「3–5 段解讀＋建議操作＋注意事項＋免責聲明」，繁中約需 1500–2500 token，
 * 8192 留足餘裕；同時以 thinkingConfig 關閉思考（見 GoogleProviderImpl.buildBody）。
 * 這是上限不是預約量，調高不會增加實際用量與費用。
 */
export const GOOGLE_MAX_OUTPUT_TOKENS = 8192

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

/** 輸出被長度上限截斷時附加的標記。有半截總比丟掉好，但**不能讓它看起來像完整結果** */
export const TRUNCATION_NOTICE = '\n\n（⚠️ 本次輸出達到長度上限而未寫完，以上內容並不完整。）'

/**
 * 純函式：解析 Google Gemini API 回傳 JSON。取不到內容時拋出 AiError('bad-response', …)
 *
 * `finishReason` 必須看：Gemini 2.5 起的思考（thinking）token 會計入 maxOutputTokens，
 * 額度不足時可能出現「finishReason=MAX_TOKENS 但 parts 是空的」——
 * 舊版只檢查 parts 存在與否，遇到這種情況會回一句莫名其妙的結構錯誤，
 * 更糟的是截斷但有內容時會把半截文字當成完整結果回傳（0.6.0-dev.5 實際踩到）。
 */
export function extractGoogleText(json: unknown): string {
  if (!json || typeof json !== 'object') {
    throw new AiError('bad-response', 'Google API 回傳資料非有效 JSON 物件')
  }
  const data = json as {
    candidates?: Array<{
      finishReason?: string
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }
  const candidate = data.candidates?.[0]
  if (!candidate) {
    throw new AiError('bad-response', 'Google API 回傳結構未包含有效的 candidates[0].content.parts')
  }

  const finishReason = candidate.finishReason
  const parts = candidate.content?.parts
  const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : ''

  if (!text.trim()) {
    if (finishReason === 'MAX_TOKENS') {
      throw new AiError(
        'bad-response',
        '模型還沒開始寫正文就用完了輸出額度（Gemini 2.5 起的思考 token 也計入上限）。' +
          '請改用較新的模型，或改用 OpenAI 相容端點。',
      )
    }
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new AiError('bad-response', `Google API 因 ${finishReason} 政策中止輸出，未產生任何內容`)
    }
    if (!Array.isArray(parts)) {
      throw new AiError(
        'bad-response',
        'Google API 回傳結構未包含有效的 candidates[0].content.parts',
      )
    }
    throw new AiError('bad-response', 'Google API 回傳文字內容為空')
  }

  // 有內容但被截斷：保留已產生的文字（使用者已為它付費），但明講它不完整
  return finishReason === 'MAX_TOKENS' ? text + TRUNCATION_NOTICE : text
}

/**
 * 純函式：解析 OpenAI 相容 API 回傳 JSON。取不到內容時拋出 AiError('bad-response', …)
 *
 * `finish_reason: 'length'` 與 Google 的 MAX_TOKENS 是同一件事（ollama 的 num_predict
 * 上限也會這樣切斷），同樣附上未完成標記，不讓半截文字看起來像完整結果。
 */
export function extractOpenAiText(json: unknown): string {
  if (!json || typeof json !== 'object') {
    throw new AiError('bad-response', 'OpenAI 相容 API 回傳資料非有效 JSON 物件')
  }
  const data = json as {
    choices?: Array<{
      finish_reason?: string
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
  return choice?.finish_reason === 'length'
    ? content.trim() + TRUNCATION_NOTICE
    : content.trim()
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
  timeoutMs: number = AI_TIMEOUT_MS,
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

  private buildBody(req: AiRequest, withThinkingConfig: boolean): string {
    return JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS,
        // 這份工作不需要推理：數字全由程式算好，模型只負責照著寫成白話。
        // 思考 token 會計入 maxOutputTokens，開著只會壓縮正文額度。
        ...(withThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    })
  }

  async complete(req: AiRequest): Promise<string> {
    const model = encodeURIComponent(this.settings.model)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.settings.apiKey,
    }
    const post = (body: string) =>
      requestJson(url, { method: 'POST', headers, body }, req.timeoutMs)

    let res = await post(this.buildBody(req, true))

    // 400 可能是模型不吃 thinkingConfig（各世代的控制欄位不同，不做模型名稱猜測）。
    // 去掉該欄位重送一次；若仍是 400，就照原本的錯誤處理往下走。
    // 這不違反「不自動重試」——那條是講不要替使用者重跑失敗的解讀（會重複計費），
    // 這裡是同一次請求的參數協商，且只試一次。
    if (!res.ok && res.status === 400) {
      res = await post(this.buildBody(req, false))
    }

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
