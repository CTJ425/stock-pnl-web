import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, upsert, from } = vi.hoisted(() => {
  const upsert = vi.fn(async (_payload: Record<string, unknown>) => ({ error: null }))
  const from = vi.fn(() => ({ upsert }))
  return { rpc: vi.fn(), upsert, from }
})
vi.mock('./supabase', () => ({
  supabase: { rpc, from, auth: { getUser: vi.fn() } },
  isSupabaseConfigured: true,
}))

import {
  loadAiSettings,
  loadAiSettingsView,
  normalizeAiSettings,
  saveAiSettings,
  validateAiSettings,
} from './aiSettings'

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

/**
 * 161: the google key never leaves the server. The browser reads settings through the
 * `get_ai_settings` RPC, which blanks the key for google, and an edit that leaves the key
 * field empty must not wipe the stored one.
 */
describe('aiSettings 161 — google key stays server-side', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({ error: null })
  })

  const googleRow = {
    ai_provider: 'google',
    ai_base_url: '',
    ai_model: 'gemini-2.5-flash',
    ai_api_key: '',
    ai_has_key: true,
  }

  it('loadAiSettings 透過 rpc(get_ai_settings) 讀取，不再直接 select 欄位', async () => {
    rpc.mockResolvedValue({ data: [googleRow], error: null })

    const got = await loadAiSettings()

    expect(rpc).toHaveBeenCalledWith('get_ai_settings')
    expect(from).not.toHaveBeenCalled()
    expect(got).toEqual({
      provider: 'google',
      baseUrl: '',
      model: 'gemini-2.5-flash',
      apiKey: '',
    })
  })

  it('rpc 回錯誤或空結果時回傳 null', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    expect(await loadAiSettings()).toBeNull()

    rpc.mockResolvedValue({ data: [], error: null })
    expect(await loadAiSettings()).toBeNull()
  })

  it('loadAiSettingsView 帶出 hasKey，讓後台能顯示「已設定」', async () => {
    rpc.mockResolvedValue({ data: [googleRow], error: null })

    const view = await loadAiSettingsView()

    expect(view.hasKey).toBe(true)
    expect(view.settings?.model).toBe('gemini-2.5-flash')
  })

  it('google 已有金鑰時，留空儲存不得覆寫既有金鑰', async () => {
    const res = await saveAiSettings(
      { provider: 'google', baseUrl: '', model: 'gemini-3-pro', apiKey: '' },
      true,
    )

    expect(res.error).toBeNull()
    const payload = upsert.mock.calls[0][0]
    expect(payload.ai_model).toBe('gemini-3-pro')
    expect(Object.hasOwn(payload, 'ai_api_key')).toBe(false)
  })

  it('google 填了新金鑰時仍然寫入', async () => {
    const res = await saveAiSettings(
      { provider: 'google', baseUrl: '', model: 'gemini-3-pro', apiKey: 'new-key' },
      true,
    )

    expect(res.error).toBeNull()
    expect(upsert.mock.calls[0][0].ai_api_key).toBe('new-key')
  })

  it('validateAiSettings 在已存金鑰時放行空白 apiKey，未存時照舊擋下', async () => {
    const s = { provider: 'google' as const, baseUrl: '', model: 'gemini-2.5-flash', apiKey: '' }
    expect(validateAiSettings(s, true)).toBeNull()
    expect(validateAiSettings(s)).toContain('API Key')
  })
})
