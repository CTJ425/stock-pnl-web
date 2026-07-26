import { describe, expect, it } from 'vitest'
import { normalizeAiSettings, validateAiSettings } from './aiSettings'

describe('aiSettings', () => {
  describe('normalizeAiSettings', () => {
    it('應正確正規化 CamelCase 格式的 Google AI 設定', () => {
      const input = {
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'key-123 ',
      }
      const res = normalizeAiSettings(input)
      expect(res).toEqual({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'key-123',
      })
    })

    it('應正確正規化 DB 蛇形命名 (snake_case) 的 OpenAI 相容設定', () => {
      const input = {
        ai_provider: 'openai-compatible',
        ai_base_url: 'http://localhost:11434 ',
        ai_model: 'llama3 ',
        ai_api_key: '',
      }
      const res = normalizeAiSettings(input)
      expect(res).toEqual({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        apiKey: '',
      })
    })

    it('當 provider 無效時應傳回 null', () => {
      expect(normalizeAiSettings({ provider: 'anthropic', model: 'claude-3' })).toBeNull()
      expect(normalizeAiSettings(null)).toBeNull()
      expect(normalizeAiSettings('invalid')).toBeNull()
    })
  })

  describe('validateAiSettings', () => {
    it('當 model 為空時應傳回錯誤訊息', () => {
      const err = validateAiSettings({
        provider: 'google',
        baseUrl: '',
        model: '   ',
        apiKey: 'key',
      })
      expect(err).toContain('Model')
    })

    it('當 Google AI 模式缺少 apiKey 時應傳回錯誤訊息', () => {
      const err = validateAiSettings({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: '',
      })
      expect(err).toContain('API Key')
    })

    it('當 OpenAI 相容模式缺少 baseUrl 或 URL 不合法時應傳回錯誤訊息', () => {
      const errEmpty = validateAiSettings({
        provider: 'openai-compatible',
        baseUrl: '',
        model: 'llama3',
        apiKey: '',
      })
      expect(errEmpty).toContain('Base URL')

      const errInvalid = validateAiSettings({
        provider: 'openai-compatible',
        baseUrl: 'not-a-url',
        model: 'llama3',
        apiKey: '',
      })
      expect(errInvalid).toContain('不正確')
    })

    it('合法的 Google 設定應回傳 null', () => {
      const err = validateAiSettings({
        provider: 'google',
        baseUrl: '',
        model: 'gemini-2.5-flash',
        apiKey: 'key123',
      })
      expect(err).toBeNull()
    })

    it('合法的 OpenAI 相容設定 (允許空金鑰) 應回傳 null', () => {
      const err = validateAiSettings({
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        apiKey: '',
      })
      expect(err).toBeNull()
    })
  })
})
