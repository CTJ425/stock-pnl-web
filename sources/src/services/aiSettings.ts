/**
 * AI assistant settings: stored in Supabase `app_settings` global single column (id is always 1).
 * Shared by the entire site, regardless of account or workspace; all login accounts are readable (front-end direct connection to suppliers requires a key),
 * Writing to accounts restricted by RLS to app_metadata.role = 'admin'.
 * Provide pure functions and CRUD operations required by specifications.
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
 * Pure function: the normalized input is AiSettings. Returns null if the field is missing, has the wrong type, or the provider is invalid.
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
 * Pure function: validate AiSettings object. Returns an error message string or null (verification passed).
 * rule:
 * 1. model required
 * 2. The baseUrl of openai-compatible is required and must be a legal URL.
 * 3. Google’s apiKey is required (openai-compatible allows empty strings), unless a key is
 *    already stored server-side (`hasStoredKey`) — then an empty field just means "leave it".
 */
export function validateAiSettings(s: AiSettings, hasStoredKey = false): string | null {
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
    if ((!s.apiKey || !s.apiKey.trim()) && !hasStoredKey) {
      return 'Google AI 模式需填寫 API Key'
    }
  }

  return null
}

/** Whether to set an administrator for AI (app_metadata.role === 'admin', can only be set by Dashboard / SQL, users cannot change it)*/
export async function isAiAdmin(): Promise<boolean> {
  try {
    const { data, error } = await client().auth.getUser()
    if (error || !data.user) return false
    const meta = data.user.app_metadata as Record<string, unknown> | undefined
    return meta?.role === 'admin'
  } catch {
    return false
  }
}

/**
 * Read AI settings shared by the entire site.
 *
 * 161: reads through `get_ai_settings()` (SECURITY DEFINER) instead of selecting the column
 * directly — the function blanks `ai_api_key` for the google provider so the key never
 * reaches an authenticated browser. See schema.sql and docs/agent/specs/161-ai-key-proxy.md.
 */
export async function loadAiSettings(): Promise<AiSettings | null> {
  try {
    const { data, error } = await client().rpc('get_ai_settings')
    if (error || !Array.isArray(data) || data.length === 0) return null
    return normalizeAiSettings(data[0])
  } catch {
    return null
  }
}

/**
 * Same read as `loadAiSettings`, plus `hasKey` (from `get_ai_settings().ai_has_key`) so the
 * admin UI can show "already set" without ever seeing the google key itself.
 */
export async function loadAiSettingsView(): Promise<{ settings: AiSettings | null; hasKey: boolean }> {
  try {
    const { data, error } = await client().rpc('get_ai_settings')
    if (error || !Array.isArray(data) || data.length === 0) {
      return { settings: null, hasKey: false }
    }
    const row = data[0] as Record<string, unknown>
    return { settings: normalizeAiSettings(row), hasKey: Boolean(row.ai_has_key) }
  } catch {
    return { settings: null, hasKey: false }
  }
}

/**
 * Stores site-wide shared AI settings (upsert app_settings single column). RLS blocks non-admin writes.
 *
 * `hasStoredKey` is true when a google key is already saved server-side (the admin UI cannot
 * read it back to prefill the field). Leaving the key field empty in that case must not wipe
 * the stored key, so `ai_api_key` is omitted from the upsert entirely.
 */
export async function saveAiSettings(
  s: AiSettings,
  hasStoredKey = false,
): Promise<{ error: string | null }> {
  const valErr = validateAiSettings(s, hasStoredKey)
  if (valErr) return { error: valErr }

  const keepStoredKey = s.provider === 'google' && !s.apiKey.trim() && hasStoredKey

  try {
    const payload: Record<string, unknown> = {
      id: 1,
      ai_provider: s.provider,
      ai_base_url: s.baseUrl.trim(),
      ai_model: s.model.trim(),
      ai_updated_at: new Date().toISOString(),
    }
    if (!keepStoredKey) {
      payload.ai_api_key = s.apiKey.trim()
    }

    const { error } = await client()
      .from('app_settings')
      .upsert(payload, { onConflict: 'id' })

    if (error) return { error: error.message }
    return { error: null }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '儲存失敗' }
  }
}

/** Clear site-wide AI settings. RLS blocks non-admin writes.*/
export async function clearAiSettings(): Promise<{ error: string | null }> {
  try {
    const { error } = await client()
      .from('app_settings')
      .upsert(
        {
          id: 1,
          ai_provider: null,
          ai_base_url: null,
          ai_model: null,
          ai_api_key: null,
          ai_updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )

    if (error) return { error: error.message }
    return { error: null }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '清除失敗' }
  }
}
