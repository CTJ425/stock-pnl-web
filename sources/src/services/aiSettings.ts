/**
 * AI 助理設定：儲存於 Supabase `user_settings` 資料表。
 * 提供規格要求的純函式與 CRUD 操作。
 */
import { supabase } from './supabase'

export type AiProviderKind = 'google' | 'openai-compatible'

export interface AiSettings {
  provider: AiProviderKind
  baseUrl: string
  model: string
  apiKey: string
}

function client() {
  if (!supabase) throw new Error('Supabase 未設定')
  return supabase
}

/**
 * 純函式：正規化輸入物為 AiSettings。若欄位缺漏、型別錯誤或 provider 無效則傳回 null。
 */
export function normalizeAiSettings(raw: unknown): AiSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const provider = obj.provider ?? obj.ai_provider
  if (provider !== 'google' && provider !== 'openai-compatible') {
    return null
  }

  const baseUrl = (obj.baseUrl ?? obj.ai_base_url ?? '') as string
  const model = (obj.model ?? obj.ai_model ?? '') as string
  const apiKey = (obj.apiKey ?? obj.ai_api_key ?? '') as string

  if (typeof baseUrl !== 'string' || typeof model !== 'string' || typeof apiKey !== 'string') {
    return null
  }

  return {
    provider,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiKey: apiKey.trim(),
  }
}

/**
 * 純函式：驗證 AiSettings 物件。傳回錯誤訊息字串或 null（驗證通過）。
 * 規則：
 * 1. model 必填
 * 2. openai-compatible 的 baseUrl 必填且需為合法 URL
 * 3. google 的 apiKey 必填（openai-compatible 允許空字串）
 */
export function validateAiSettings(s: AiSettings): string | null {
  if (!s.model || !s.model.trim()) {
    return '請填寫 Model (模型名稱)'
  }

  if (s.provider === 'openai-compatible') {
    if (!s.baseUrl || !s.baseUrl.trim()) {
      return 'OpenAI 相容模式需填寫 Base URL'
    }
    try {
      new URL(s.baseUrl.trim())
    } catch {
      return 'Base URL 格式不正確 (須包含 http:// 或 https://)'
    }
  }

  if (s.provider === 'google') {
    if (!s.apiKey || !s.apiKey.trim()) {
      return 'Google AI 模式需填寫 API Key'
    }
  }

  return null
}

/** 讀取登入使用者的 AI 設定 */
export async function loadAiSettings(): Promise<AiSettings | null> {
  try {
    const { data: userData, error: userErr } = await client().auth.getUser()
    if (userErr || !userData.user) return null
    const uid = userData.user.id

    const { data, error } = await client()
      .from('user_settings')
      .select('ai_provider, ai_base_url, ai_model, ai_api_key')
      .eq('user_id', uid)
      .maybeSingle()

    if (error || !data) return null
    return normalizeAiSettings(data)
  } catch {
    return null
  }
}

/** 儲存使用者的 AI 設定 (upsert user_settings) */
export async function saveAiSettings(s: AiSettings): Promise<{ error: string | null }> {
  const valErr = validateAiSettings(s)
  if (valErr) return { error: valErr }

  try {
    const { data: userData, error: userErr } = await client().auth.getUser()
    if (userErr || !userData.user) return { error: '尚未登入' }
    const uid = userData.user.id

    const { error } = await client()
      .from('user_settings')
      .upsert(
        {
          user_id: uid,
          ai_provider: s.provider,
          ai_base_url: s.baseUrl.trim(),
          ai_model: s.model.trim(),
          ai_api_key: s.apiKey.trim(),
          ai_updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (error) return { error: error.message }
    return { error: null }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '儲存失敗' }
  }
}

/** 清除使用者的 AI 設定 */
export async function clearAiSettings(): Promise<{ error: string | null }> {
  try {
    const { data: userData, error: userErr } = await client().auth.getUser()
    if (userErr || !userData.user) return { error: '尚未登入' }
    const uid = userData.user.id

    const { error } = await client()
      .from('user_settings')
      .upsert(
        {
          user_id: uid,
          ai_provider: null,
          ai_base_url: null,
          ai_model: null,
          ai_api_key: null,
          ai_updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

    if (error) return { error: error.message }
    return { error: null }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '清除失敗' }
  }
}
