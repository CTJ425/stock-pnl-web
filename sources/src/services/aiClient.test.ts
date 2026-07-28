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
      // 釘住 0.6.0-dev.5 的實際災情：Gemini Flash 只寫了半句就被切斷，
      // 舊版把半截文字當成完整結果回傳，使用者無從得知它不完整。
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
      // 思考 token 計入 maxOutputTokens，額度不足時 parts 會整個消失
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
      // 額度要夠寫完整篇（思考 token 也算在這個上限裡），且預設關閉思考
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
      // fetch 在收到 headers 就 resolve。若在那之後才 clearTimeout，
      // 「headers 回來了但 body 不來」的伺服器會讓 UI 永遠停在解讀中。
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
    // ⚠️ Gemini 的助理角色叫 model。送成 assistant 會被當成使用者發言，
    // 模型會以為自己上一輪講的話是使用者說的，整段對話的角色就錯位了。
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
