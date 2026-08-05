import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiError,
  createAiProvider,
  extractGoogleText,
  extractOpenAiText,
  mapHttpError,
  normalizeBaseUrl,
  toGoogleContents,
  toOpenAiMessages,
  GOOGLE_MAX_OUTPUT_TOKENS,
  TRUNCATION_NOTICE,
  OPENAI_MAX_TOKENS,
  REASONING_FALLBACK_NOTICE,
  stripThinkTags,
  type AiMessage,
} from './aiClient'

describe('aiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('normalizeBaseUrl', () => {
    it('應正確處理四種 Base URL 輸入，皆產出相同 /v1 端點', () => {
      const cases = [
        'http://h:11434',
        'http://h:11434/',
        'http://h:11434/v1',
        'http://h:11434/v1/',
      ]
      for (const input of cases) {
        expect(normalizeBaseUrl(input)).toBe('http://h:11434/v1')
      }
    })

    it('應處理多餘斜線與空白', () => {
      expect(normalizeBaseUrl('  https://api.openai.com///  ')).toBe('https://api.openai.com/v1')
    })
  })

  describe('mapHttpError', () => {
    it('應正確將 HTTP 狀態碼映射至 AiErrorKind', () => {
      expect(mapHttpError(401)).toBe('auth')
      expect(mapHttpError(403)).toBe('auth')
      expect(mapHttpError(429)).toBe('rate-limit')
      expect(mapHttpError(500)).toBe('server')
      expect(mapHttpError(503)).toBe('server')
      expect(mapHttpError(400)).toBe('bad-response')
      expect(mapHttpError(404)).toBe('bad-response')
    })
  })

  describe('extractGoogleText', () => {
    it('應成功從 Google 回覆中提取串接後的文字', () => {
      const sample = {
        candidates: [
          {
            content: {
              parts: [{ text: '第一段解讀。' }, { text: '第二段解讀。' }],
            },
          },
        ],
      }
      expect(extractGoogleText(sample)).toBe('第一段解讀。第二段解讀。')
    })

    it('當結構缺少 candidates 或 parts 時應拋出 AiError(bad-response)', () => {
      expect(() => extractGoogleText({})).toThrowError(AiError)
      try {
        extractGoogleText({ candidates: [] })
      } catch (e: any) {
        expect(e.kind).toBe('bad-response')
      }
    })

    it('當提取內容為空字串時應拋出 AiError(bad-response)', () => {
      try {
        extractGoogleText({ candidates: [{ content: { parts: [{ text: '   ' }] } }] })
      } catch (e: any) {
        expect(e.kind).toBe('bad-response')
      }
    })

    it('finishReason=MAX_TOKENS 且有內容時，保留文字但附上「未完成」標記', () => {
      // The actual disaster that pinned 0.6.0-dev.5: Gemini Flash was cut off after writing only half a sentence,
      // The old version returned half of the text as a complete result, so the user had no way of knowing that it was incomplete.
      const out = extractGoogleText({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: '元大台灣50（0050）於 2026 年 7 月 24 日收盤價為 101.7 元，跌幅' }] },
          },
        ],
      })
      expect(out).toContain('101.7 元')
      expect(out).toContain(TRUNCATION_NOTICE.trim())
    })

    it('finishReason=MAX_TOKENS 但完全沒有內容時，錯誤訊息要點出思考 token 吃掉額度', () => {
      // Thinking tokens are included in maxOutputTokens. When the quota is insufficient, parts will disappear entirely.
      try {
        extractGoogleText({ candidates: [{ finishReason: 'MAX_TOKENS' }] })
        throw new Error('should have thrown')
      } catch (e: any) {
        expect(e.kind).toBe('bad-response')
        expect(e.message).toContain('思考 token')
      }
    })

    it('finishReason=SAFETY 時給出政策中止的專屬訊息', () => {
      try {
        extractGoogleText({ candidates: [{ finishReason: 'SAFETY' }] })
        throw new Error('should have thrown')
      } catch (e: any) {
        expect(e.message).toContain('SAFETY')
      }
    })

    it('正常結束時不附加任何標記', () => {
      const out = extractGoogleText({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '完整解讀。' }] } }],
      })
      expect(out).toBe('完整解讀。')
    })
  })

  describe('stripThinkTags', () => {
    it('剝掉成對的 <think> 區塊', () => {
      expect(stripThinkTags('<think>草稿</think>結論')).toBe('結論')
    })

    it('未閉合的 <think> 也要處理（輸出被截斷時很常見）', () => {
      expect(stripThinkTags('<think>想到一半就沒額度了')).toBe('想到一半就沒額度了')
    })

    it('沒有 think 標籤時原樣回傳（去頭尾空白）', () => {
      expect(stripThinkTags('  正常內容  ')).toBe('正常內容')
    })

    it('大小寫與多個區塊都認得', () => {
      expect(stripThinkTags('<THINK>a</THINK>甲<think>b</think>乙')).toBe('甲乙')
    })
  })

  describe('extractOpenAiText', () => {
    it('應成功從 OpenAI 回覆中提取 choices[0].message.content', () => {
      const sample = {
        choices: [
          {
            message: {
              content: '這是 OpenAI 解讀結果。',
            },
          },
        ],
      }
      expect(extractOpenAiText(sample)).toBe('這是 OpenAI 解讀結果。')
    })

    it('當結構無效時應拋出 AiError(bad-response)', () => {
      try {
        extractOpenAiText({ choices: [] })
      } catch (e: any) {
        expect(e.kind).toBe('bad-response')
      }
    })

    /*
     * The following are various causes of "HTTP 200 but no body".
     * Originally, regardless of the reason, the same sentence "The return structure does not contain a valid choices[0].message.content" was thrown.
     * The user has no idea what to do next when they get that sentence - and Google's path has long been divided.
     * MAX_TOKENS / SAFETY / structure does not match. This set of tests nails the diagnosis after completion.
     */
    const kindOf = (json: unknown) => {
      try {
        extractOpenAiText(json)
        return null
      } catch (e) {
        return e as { kind: string; message: string }
      }
    }

    /*
     * Inferential model: no longer fails directly starting from 0.6.9-dev.4.
     * The requester will first try to turn off thinking; if it cannot be turned off, it will be changed to "use the thinking content, but clearly mark it"——
     * Users don't have to keep changing models just to do this, and thinking about misleading issues is handled by warnings.
     */
    it('關不掉思考時改用思考內容，但前面必須加警語', () => {
      const out = extractOpenAiText({
        choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '我先想一下…' } }],
      })
      expect(out).toContain('以下是模型的思考過程，不是正式結論')
      expect(out).toContain('我先想一下…')
    })

    it('警語要明講數字可能是模型後來否定掉的（這是使用者踩過的坑）', () => {
      expect(REASONING_FALLBACK_NOTICE).toContain('不是正式結論')
      expect(REASONING_FALLBACK_NOTICE).toContain('數字與判斷都可能是它後來否定掉的')
      expect(REASONING_FALLBACK_NOTICE).toContain('請勿直接採信')
    })

    it('reasoning 這個欄位名也認得（各家命名不同）', () => {
      expect(extractOpenAiText({ choices: [{ message: { content: null, reasoning: '思考中' } }] })).toContain(
        '思考中',
      )
    })

    it('content 裡夾著 <think> 時剝掉思考、只留正文（有些端點不拆欄位）', () => {
      const out = extractOpenAiText({
        choices: [{ finish_reason: 'stop', message: { content: '<think>嗯…也許不對</think>這是正式結論。' } }],
      })
      expect(out).toBe('這是正式結論。')
      expect(out).not.toContain('也許不對')
    })

    it('content 裡只有 <think>、沒有正文時，退到思考內容並加警語', () => {
      const out = extractOpenAiText({
        choices: [{ message: { content: '<think>只有思考</think>', reasoning_content: '只有思考' } }],
      })
      expect(out).toContain('不是正式結論')
    })

    it('還沒寫正文就用完輸出額度時，指出是輸出上限而不是結構壞掉', () => {
      const e = kindOf({ choices: [{ finish_reason: 'length', message: { content: '' } }] })!
      expect(e.message).toContain('用完了輸出額度')
      expect(e.message).toContain('num_predict')
    })

    it('body 內夾帶 error 時把端點的原話帶出來', () => {
      const e = kindOf({ error: { message: 'model "foo" not found' } })!
      expect(e.message).toContain('model "foo" not found')
    })

    it('沒有任何 choices 時提示模型名稱 / 未載入', () => {
      expect(kindOf({ choices: [] })!.message).toContain('模型名稱')
    })

    it('模型明確拒答時帶出拒答內容', () => {
      expect(kindOf({ choices: [{ message: { content: '', refusal: '我不能回答' } }] })!.message).toContain(
        '我不能回答',
      )
    })

    it('被安全過濾擋下時講明是 content_filter', () => {
      expect(
        kindOf({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] })!.message,
      ).toContain('content_filter')
    })

    it('其餘情況把 finish_reason 帶進訊息，至少讓人知道往哪查', () => {
      expect(kindOf({ choices: [{ finish_reason: 'tool_calls', message: { content: '' } }] })!.message).toContain(
        'tool_calls',
      )
    })

    it('finish_reason=length 時附上「未完成」標記（ollama num_predict 截斷同理）', () => {
      const out = extractOpenAiText({
        choices: [{ finish_reason: 'length', message: { content: '寫到一半就' } }],
      })
      expect(out).toContain('寫到一半就')
      expect(out).toContain(TRUNCATION_NOTICE.trim())
    })

    it('finish_reason=stop 時不附加標記', () => {
      expect(
        extractOpenAiText({ choices: [{ finish_reason: 'stop', message: { content: '完整結果。' } }] }),
      ).toBe('完整結果。')
    })
  })

  describe('createAiProvider complete 網路整合 (Mocked Fetch)', () => {
    const okBody = (content: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    })
    const mkProvider = () =>
      createAiProvider({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        apiKey: '',
      })

    it('OpenAI 相容請求會附上關閉思考的欄位（這份工作不需要推理）', async () => {
      const mockFetch = vi.fn().mockResolvedValue(okBody('結果'))
      vi.stubGlobal('fetch', mockFetch)

      await mkProvider().complete({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      // There is no universal switch across homes, all three are provided, and each endpoint takes what it needs.
      expect(body.reasoning_effort).toBe('none')
      expect(body.think).toBe(false)
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
    })

    it('OpenAI 相容請求會送出輸出上限 —— 不送的話端點預設值常常只有幾百 token', async () => {
      const mockFetch = vi.fn().mockResolvedValue(okBody('結果'))
      vi.stubGlobal('fetch', mockFetch)

      await mkProvider().complete({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] })

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.max_tokens).toBe(OPENAI_MAX_TOKENS)
      // The output requires about 1500~2500 tokens, and there should be enough margin for the upper limit.
      expect(OPENAI_MAX_TOKENS).toBeGreaterThanOrEqual(4096)
    })

    it('端點不認得那些欄位而回 400 時，去掉重送一次並成功', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
        .mockResolvedValueOnce(okBody('第二次就好了'))
      vi.stubGlobal('fetch', mockFetch)

      const res = await mkProvider().complete({
        system: 'sys',
        messages: [{ role: 'user', content: 'usr' }],
      })

      expect(res).toBe('第二次就好了')
      expect(mockFetch).toHaveBeenCalledTimes(2)
      const first = JSON.parse(mockFetch.mock.calls[0][1].body)
      const second = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(first.reasoning_effort).toBe('none')
      expect(first.max_tokens).toBe(OPENAI_MAX_TOKENS)
      /*
        第二次退回最小集合。400 不會告訴你是哪個欄位不合，
        逐一嘗試等於要打好幾輪，所以一次全部拿掉。
      */
      expect(second.reasoning_effort).toBeUndefined()
      expect(second.think).toBeUndefined()
      expect(second.chat_template_kwargs).toBeUndefined()
      expect(second.max_tokens).toBeUndefined()
      // But the business cannot be lost: the model and messages must still be there
      expect(second.model).toBe('llama3')
      expect(second.messages).toHaveLength(2)
    })

    it('只重送一次 —— 第二次仍 400 就照常報錯，不無限重試', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) })
      vi.stubGlobal('fetch', mockFetch)

      await expect(
        mkProvider().complete({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] }),
      ).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('Google Provider 應帶上 x-goog-api-key 並正確傳送及解析', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: 'Gemini 分析結果' }],
              },
            },
          ],
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'test-google-key',
      })

      const res = await provider.complete({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] })
      expect(res).toBe('Gemini 分析結果')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('generativelanguage.googleapis.com')
      expect(url).toContain('gemini-2.5-flash')
      expect(opts.headers['x-goog-api-key']).toBe('test-google-key')
      const body = JSON.parse(opts.body)
      expect(body.systemInstruction.parts[0].text).toBe('sys')
      expect(body.contents[0].parts[0].text).toBe('usr')
      // The quota must be enough to write the entire article (thinking tokens are also included in this limit), and thinking is turned off by default.
      expect(body.generationConfig.maxOutputTokens).toBe(GOOGLE_MAX_OUTPUT_TOKENS)
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    })

    it('模型不接受 thinkingConfig（400）時，去掉該欄位重送一次並成功', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: '退回後的結果' }] } }] }),
        })
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'some-model-without-thinking',
        apiKey: 'k',
      })

      expect(await provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] })).toBe('退回後的結果')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      const first = JSON.parse(mockFetch.mock.calls[0][1].body)
      const second = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(first.generationConfig.thinkingConfig).toBeDefined()
      expect(second.generationConfig.thinkingConfig).toBeUndefined()
      expect(second.generationConfig.maxOutputTokens).toBe(GOOGLE_MAX_OUTPUT_TOKENS)
    })

    it('退回後仍是 400 時只再試一次就放棄（不無限重試）', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) })
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'nonexistent-model',
        apiKey: 'k',
      })

      await expect(provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow(AiError)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('401 不觸發退回重送（那是金鑰問題，不是參數問題）', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'bad',
      })

      try {
        await provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] })
        expect.fail('應丟出錯誤')
      } catch (e: any) {
        expect(e.kind).toBe('auth')
      }
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('OpenAI-compatible Provider 有 API Key 時應帶上 Authorization Bearer', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'LLM 分析結果' } }],
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        apiKey: 'secret-token',
      })

      const res = await provider.complete({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] })
      expect(res).toBe('LLM 分析結果')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      expect(opts.headers['Authorization']).toBe('Bearer secret-token')
    })

    it('OpenAI-compatible Provider 無 API Key 時不應帶上 Authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Ollama 本機結果' } }],
        }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1/',
        model: 'llama3',
        apiKey: '',
      })

      const res = await provider.complete({ system: 'sys', messages: [{ role: 'user', content: 'usr' }] })
      expect(res).toBe('Ollama 本機結果')

      const [, opts] = mockFetch.mock.calls[0]
      expect(opts.headers['Authorization']).toBeUndefined()
    })

    it('當 fetch 丟出 TypeError 時應轉為 AiError(network) 並提示 CORS / OLLAMA_ORIGINS', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

      const provider = createAiProvider({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        apiKey: '',
      })

      try {
        await provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] })
        expect.fail('應丟出錯誤')
      } catch (e: any) {
        expect(e).toBeInstanceOf(AiError)
        expect(e.kind).toBe('network')
        expect(e.message).toContain('OLLAMA_ORIGINS')
      }
    })

    it('當 AbortError 觸發時應轉為 AiError(timeout)', async () => {
      const abortErr = new Error('The operation was aborted')
      abortErr.name = 'AbortError'
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr))

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'key',
      })

      try {
        await provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }], timeoutMs: 100 })
        expect.fail('應丟出逾時錯誤')
      } catch (e: any) {
        expect(e).toBeInstanceOf(AiError)
        expect(e.kind).toBe('timeout')
        expect(e.message).toContain('逾時')
      }
    })

    it('headers 回來但 body 卡住時仍要逾時（逾時計時器必須包住讀 body）', async () => {
      // fetch resolves after receiving headers. If clearTimeout occurs after that,
      // A server with "headers coming back but not body" will cause the UI to be stuck in interpretation forever.
      const mockFetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              opts.signal?.addEventListener('abort', () => {
                const err = new Error('The operation was aborted')
                err.name = 'AbortError'
                reject(err)
              })
            }),
        }),
      )
      vi.stubGlobal('fetch', mockFetch)

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'key',
      })

      try {
        await provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }], timeoutMs: 30 })
        expect.fail('應丟出逾時錯誤')
      } catch (e: any) {
        expect(e).toBeInstanceOf(AiError)
        expect(e.kind).toBe('timeout')
      }
    })

    it('當 HTTP 回傳 401 時應拋出 AiError(auth)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }))

      const provider = createAiProvider({
        provider: 'google',
        baseUrl: '',
        model: 'm',
        apiKey: 'bad-key',
      })

      try {
        await provider.complete({ system: 's', messages: [{ role: 'user', content: 'u' }] })
      } catch (e: any) {
        expect(e.kind).toBe('auth')
      }
    })
  })
})

describe('多輪對話的角色映射（0.6.5）', () => {
  const convo: AiMessage[] = [
    { role: 'user', content: '第一次的分析請求' },
    { role: 'assistant', content: '這是分析結果' },
    { role: 'user', content: '毛利率趨勢如何？' },
  ]

  it('Google：assistant 必須映射成 model', () => {
    // ⚠️ Gemini’s assistant character is called model. If sent as assistant, it will be treated as a user speaking.
    // The model will think that what it said in the last round was said by the user, and the role of the entire conversation will be misplaced.
    expect(toGoogleContents(convo)).toEqual([
      { role: 'user', parts: [{ text: '第一次的分析請求' }] },
      { role: 'model', parts: [{ text: '這是分析結果' }] },
      { role: 'user', parts: [{ text: '毛利率趨勢如何？' }] },
    ])
    expect(toGoogleContents(convo).some((c) => (c.role as string) === 'assistant')).toBe(false)
  })

  it('OpenAI 相容：system 排在最前面，其餘原樣展開', () => {
    expect(toOpenAiMessages('規則', convo)).toEqual([
      { role: 'system', content: '規則' },
      ...convo,
    ])
  })

  it('單輪與空對話都不出錯', () => {
    expect(toGoogleContents([{ role: 'user', content: 'x' }])).toHaveLength(1)
    expect(toGoogleContents([])).toEqual([])
    expect(toOpenAiMessages('規則', [])).toEqual([{ role: 'system', content: '規則' }])
  })

  it('Google 實際送出的 body 帶著多輪 contents 與 systemInstruction', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '好' }] } }] }),
    }))
    vi.stubGlobal('fetch', mockFetch)

    const provider = createAiProvider({
      provider: 'google',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: 'k',
    })
    await provider.complete({ system: '規則', messages: convo })

    const body = JSON.parse((mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.systemInstruction.parts[0].text).toBe('規則')
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user'])
  })
})
