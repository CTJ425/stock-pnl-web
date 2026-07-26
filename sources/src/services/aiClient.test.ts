import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiError,
  createAiProvider,
  extractGoogleText,
  extractOpenAiText,
  mapHttpError,
  normalizeBaseUrl,
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

      const res = await provider.complete({ system: 'sys', user: 'usr' })
      expect(res).toBe('Gemini 分析結果')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('generativelanguage.googleapis.com')
      expect(url).toContain('gemini-2.5-flash')
      expect(opts.headers['x-goog-api-key']).toBe('test-google-key')
      const body = JSON.parse(opts.body)
      expect(body.systemInstruction.parts[0].text).toBe('sys')
      expect(body.contents[0].parts[0].text).toBe('usr')
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

      const res = await provider.complete({ system: 'sys', user: 'usr' })
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

      const res = await provider.complete({ system: 'sys', user: 'usr' })
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
        await provider.complete({ system: 's', user: 'u' })
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
        await provider.complete({ system: 's', user: 'u', timeoutMs: 100 })
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
        await provider.complete({ system: 's', user: 'u', timeoutMs: 30 })
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
        await provider.complete({ system: 's', user: 'u' })
      } catch (e: any) {
        expect(e.kind).toBe('auth')
      }
    })
  })
})
