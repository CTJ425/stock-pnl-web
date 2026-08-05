/**
 * AI service client Adapter: supports Google Gemini and OpenAI compatible API (ollama / vLLM).
 * Provides pure functions and Provider objects without relying on any external SDK.
 */
import type { AiProviderKind, AiSettings } from './aiSettings'

export type AiErrorKind = 'auth' | 'rate-limit' | 'server' | 'timeout' | 'network' | 'bad-response'

/** Default timeout. The local model inference is slow and often cannot run in 30 seconds, so it is relaxed to 180 seconds. UI typefaces are always derived from this.*/
export const AI_TIMEOUT_MS = 180_000

/**
 * Google's output cap.
 *
 * Originally it was 1200. In actual testing, Gemini Flash was cut off after writing only one sentence - because Gemini 2.5 and above
 * **Thinking tokens are also included in maxOutputTokens**, 1200 are almost eaten up by thinking.
 * The output of this project is "3-5 paragraphs of interpretation + recommended operations + precautions + disclaimer", which costs about 1500-2500 tokens in Traditional Chinese.
 * 8192 Leave enough margin; also turn off thinking with thinkingConfig (see GoogleProviderImpl.buildBody).
 * This is the upper limit, not the reservation amount, and increasing it will not increase actual usage or costs.
 */
export const GOOGLE_MAX_OUTPUT_TOKENS = 8192

/**
 * Output cap for OpenAI compliant endpoints.
 *
 * **Originally this field was not sent at all**, the default value of the endpoint was used - and many endpoints (including some settings of Ollama)
 * By default, there are only a few hundred tokens, so the output is cut off by `finish_reason: length` halfway through writing.
 * Only the first one or two paragraphs and one line "unfinished" remain on the screen. This is the same pitfall that Google has stepped into.
 * (See GOOGLE_MAX_OUTPUT_TOKENS), but this path has not been filled.
 *
 * Use the same values ​​as Google: about 1500–2500 tokens for output, 8192 to spare.
 * This is the upper limit, not the reservation amount, and increasing it will not increase actual usage or costs.
 */
export const OPENAI_MAX_TOKENS = 8192

export class AiError extends Error {
  public kind: AiErrorKind

  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
  }
}

/** A conversational message. `assistant` is the model’s previous reply*/
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  system: string
  /**
   * A conversation from old to new. A single round means there is only one `user`.
   *
   * Before 0.6.5, this was a single `user: string`; it was changed to an array to support "after generating the analysis
   * Keep asking." **system will resend every round** (see the frame rules of aiChat.ts),
   * So the frame doesn't get diluted as the dialogue gets longer.
   */
  messages: AiMessage[]
  timeoutMs?: number
}

/**
 * Pure function: mapping conversations to Google’s `contents`.
 *
 * ⚠️ **Gemini’s assistant role is called `model`, not `assistant`**. If you send it wrongly, it will be regarded as a user speaking.
 * The model will think that what it said in the last round was said by the user - the most error-prone frame, so it is selected for testing.
 */
export function toGoogleContents(messages: AiMessage[]): Array<{
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}> {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }))
}

/** Pure functions: mapping system and dialogue into OpenAI compatible `messages`*/
export function toOpenAiMessages(
  system: string,
  messages: AiMessage[],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [{ role: 'system' as const, content: system }, ...messages]
}

export interface AiProvider {
  readonly kind: AiProviderKind
  complete(req: AiRequest): Promise<string>
}

/**
 * Pure functions: Base URL normalization.
 * Remove the trailing slash; if the end of /v1 is already included, do not append it again, otherwise add /v1.
 * Examples: http://h:11434, http://h:11434/, http://h:11434/v1, http://h:11434/v1/
 * Both output http://h:11434/v1
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) {
    return trimmed
  }
  return `${trimmed}/v1`
}

/**
 * Pure function: HTTP status code corresponds to AiErrorKind
 */
export function mapHttpError(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  return 'bad-response'
}

/** Marks appended when the output is truncated by the upper length limit. It's better to have half than throw it away, but **don't make it look like the complete result***/
export const TRUNCATION_NOTICE = '\n\n（⚠️ 本次輸出達到長度上限而未寫完，以上內容並不完整。）'

/**
 * I only get the warning posted at the top when thinking about the content.
 *
 * **Do not omit or downplay. ** Thinking is a draft of model derivation: there will be self-doubt, overturning,
 * Count to half the number. It would be misleading to read it as a formal analysis - this is a pitfall that users have actually stepped on.
 * This is also the reason why we had to deal with `<think>` in the first place.
 */
export const REASONING_FALLBACK_NOTICE =
  '⚠️ **以下是模型的思考過程，不是正式結論。**\n\n' +
  '這個模型沒有寫出正文（推理型模型常見），且本端點不接受關閉思考的設定。' +
  '思考內容包含推導草稿與中途自我修正，**數字與判斷都可能是它後來否定掉的**，請勿直接採信。' +
  '若要正式的分析，請改用一般對話模型。\n\n---\n\n'

/**
 * Remove the `<think>…</think>` package (some endpoints do not split the fields and directly insert the thoughts into the text).
 * Unclosed `<think>` are also handled - this is common when the output is truncated.
 */
export function stripThinkTags(text: string): string {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim()
}

/**
 * Pure function: parsing the JSON returned by the Google Gemini API. AiError('bad-response', …) is thrown when the content cannot be obtained.
 *
 * `finishReason` must read: thinking tokens from Gemini 2.5 will count towards maxOutputTokens,
 * When the quota is insufficient, "finishReason=MAX_TOKENS but parts is empty" may appear——
 * The old version only checks whether parts exists. In this case, an inexplicable structural error will be returned.
 * What's worse is that when it is truncated but has content, the half text will be returned as the complete result (actually stepped on by 0.6.0-dev.5).
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

  // Contains content but truncated: retains the text that was generated (the user paid for it), but makes it clear that it is incomplete
  return finishReason === 'MAX_TOKENS' ? text + TRUNCATION_NOTICE : text
}

/**
 * Pure function: Parse OpenAI compatible API and return JSON. AiError('bad-response', …) is thrown when the content cannot be obtained.
 *
 * `finish_reason: 'length'` is the same thing as Google's MAX_TOKENS (ollama's num_predict
 * The upper limit will also be cut off like this), and an unfinished mark is also attached to prevent the half text from looking like the complete result.
 */
export function extractOpenAiText(json: unknown): string {
  if (!json || typeof json !== 'object') {
    throw new AiError('bad-response', 'OpenAI 相容 API 回傳資料非有效 JSON 物件')
  }
  const data = json as {
    error?: { message?: string }
    choices?: Array<{
      finish_reason?: string
      message?: {
        content?: string | null
        /** Inferential models (deepseek-r1 / qwq / gpt-oss...) put the thinking process here and name them differently.*/
        reasoning_content?: string | null
        reasoning?: string | null
        refusal?: string | null
      }
    }>
  }

  // Some endpoints HTTP 200 but return errors in the body (Ollama model not loaded, vLLM queue full...)
  const bodyError = data.error?.message
  if (typeof bodyError === 'string' && bodyError.trim()) {
    throw new AiError('bad-response', `AI 端點回報錯誤：${bodyError.trim()}`)
  }

  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    throw new AiError(
      'bad-response',
      'OpenAI 相容 API 沒有回傳任何 choices。請確認模型名稱在該端點存在、且已載入。',
    )
  }

  const choice = data.choices[0]
  const content = choice?.message?.content
  const finish = choice?.finish_reason

  /*
    Use the body when it has content, but strip `<think>…</think>` first: some endpoints do not split
    reasoning into its own field and stuff it into `content` together with the answer. Without stripping, the
    screen opens with a long stretch of the model talking to itself and buries the real conclusion below it.

    If stripping leaves nothing (content really was only reasoning), fall through to the reasoning branch ——
    that one presents it with a warning instead of passing it off as a normal result.
  */
  if (typeof content === 'string') {
    const clean = stripThinkTags(content)
    if (clean) {
      return finish === 'length' ? clean + TRUNCATION_NOTICE : clean
    }
  }

  /*
    Everything below is "HTTP 200 with no body". This used to throw the same sentence regardless of cause,
    which told the user nothing about what to do next —— while the Google path had long separated MAX_TOKENS /
    SAFETY / malformed structure. These are the matching diagnostics.
  */
  const msg = choice?.message ?? {}

  /*
    1) Reasoning models: the answer went entirely into the reasoning field and content came back empty.

    The request side already tries to switch reasoning off (see OpenAiCompatibleProviderImpl.buildBody), but
    not every endpoint honours those fields. Reaching here means it could not be switched off ——
    **Rather than fail altogether, take the reflection and use it, but be sure to label what it is. **

    The label must not be dropped: reasoning is the model's working draft and carries self-doubt, retractions
    and half-finished numbers. Read as a finished analysis it misleads —— a user actually hit this.
  */
  const reasoning = msg.reasoning_content ?? msg.reasoning
  if (typeof reasoning === 'string' && stripThinkTags(reasoning).trim()) {
    return REASONING_FALLBACK_NOTICE + stripThinkTags(reasoning).trim()
  }

  // 2) Thoughts/Preface: The output quota is used up, and the text is cut off before the text is written (equivalent to Google's MAX_TOKENS)
  if (finish === 'length') {
    throw new AiError(
      'bad-response',
      '模型還沒開始寫正文就用完了輸出額度（finish_reason: length）。' +
        '請調高該端點的輸出上限（Ollama 是 num_predict），或改用較小的思考模型。',
    )
  }

  // 3) The model explicitly refuses to answer
  if (typeof msg.refusal === 'string' && msg.refusal.trim()) {
    throw new AiError('bad-response', `模型拒絕回答：${msg.refusal.trim()}`)
  }
  if (finish === 'content_filter') {
    throw new AiError('bad-response', '內容被端點的安全過濾擋下（finish_reason: content_filter）')
  }

  // 4) The rest: Bring out finish_reason, at least let people know where to look.
  throw new AiError(
    'bad-response',
    `OpenAI 相容 API 回傳的 choices[0].message.content 是空的${
      finish ? `（finish_reason: ${finish}）` : ''
    }。請確認模型名稱正確，或改用其他模型再試一次。`,
  )
}

/**
 * Make the request and finish reading the body within the same timeout timer.
 *
 * Timeout cannot just wrap `fetch()`: fetch will resolve after receiving the response headers.
 * body has not been read yet. If you clearTimeout after fetch, you will encounter "headers are back but the body is stuck"
 * The server has no timeout protection at all, and the UI will always stop at "interpreting".
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
      // If abort is timed out while reading the body, it must be passed out and mapped to timeout below.
      // It cannot always be regarded as "the return format is incorrect".
      if (err instanceof Error && err.name === 'AbortError') throw err
      throw new AiError('bad-response', 'AI 服務回傳的內容不是合法的 JSON')
    })
    return { ok: true, status: res.status, json }
  } catch (err: unknown) {
    // The AiError deliberately thrown above should not be wrapped by the network error below.
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
      contents: toGoogleContents(req.messages),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS,
        // This job does not require reasoning: the numbers are all calculated by the program, and the model is only responsible for writing them down in the vernacular.
        // Thinking token will be included in maxOutputTokens, and turning it on will only compress the text quota.
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

    // 400 may be because the model does not use thinkingConfig (the control fields of each generation are different, so model name guessing is not performed).
    // Remove this field and resend it; if it is still 400, continue processing according to the original error.
    // This does not violate the interpretation of "no automatic retries" - that is, do not rerun failed attempts for the user (repetitive billing will occur).
    // Here is the parameter negotiation for the same request, and it is only tried once.
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

  /**
   * When `full` is true, compatibility fields are attached; when false, only the minimum set that is eaten by all endpoints is left.
   *
   * **Output upper limit** (`max_tokens`): If not sent, use the endpoint default. Many endpoints only have a few hundred tokens.
   * The output will be cut in the middle by `finish_reason: length`. See OPENAI_MAX_TOKENS.
   *
   * **Close thinking**: This job does not require reasoning (the numbers are all calculated by the program, and the model is only responsible for writing them in vernacular),
   * The inference model will spend the entire output quota on thinking and not write a single word of the text.
   * There is no universal switch across homes, so all three are provided and each endpoint takes what it needs:
   * - `reasoning_effort`: OpenAI o series with most compatible endpoints
   * - `think`：Ollama
    * - `chat_template_kwargs.enable_thinking`: Qwen3 and friends on vLLM / SGLang
   *
   * Most of the unrecognized fields will be ignored; if it is really 400, the caller will resend it with `full = false`.
   * **Return to the minimum set instead of just taking away one of them** - 400 will not tell you which column is inconsistent,
   * Trying them one by one equals several rounds.
   */
  private buildBody(req: AiRequest, full: boolean): string {
    return JSON.stringify({
      model: this.settings.model,
      messages: toOpenAiMessages(req.system, req.messages),
      temperature: 0.2,
      stream: false,
      ...(full
        ? {
            max_tokens: OPENAI_MAX_TOKENS,
            reasoning_effort: 'none',
            think: false,
            chat_template_kwargs: { enable_thinking: false },
          }
        : {}),
    })
  }

  async complete(req: AiRequest): Promise<string> {
    const base = normalizeBaseUrl(this.settings.baseUrl)
    const url = `${base}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.settings.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${this.settings.apiKey.trim()}`
    }

    const post = (body: string) =>
      requestJson(url, { method: 'POST', headers, body }, req.timeoutMs)

    let res = await post(this.buildBody(req, true))

    /*
       A 400 may mean the endpoint does not recognise the compatibility fields (`max_tokens` plus the three
       reasoning-off fields, see buildBody). Fall back to the minimal set and send once more; if it still fails,
       carry on into the normal error handling. Same pattern as the Google path, and it does not break the
       "no automatic retry" rule either —— that rule is about not re-running a failed interpretation for the
       user (which bills twice); this is parameter negotiation inside one request, attempted once.
    */
    if (!res.ok && res.status === 400) {
      res = await post(this.buildBody(req, false))
    }

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

/** Create the corresponding AiProvider based on the setting factory*/
export function createAiProvider(s: AiSettings): AiProvider {
  if (s.provider === 'google') {
    return new GoogleProviderImpl(s)
  }
  return new OpenAiCompatibleProviderImpl(s)
}
