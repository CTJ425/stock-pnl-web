/**
 * Supabase 客戶端初始化。
 * 未設定環境變數時回傳 null，應用程式降級為「本機模式」
 * （localStorage 儲存、免登入），方便在建立 Supabase 專案前先行使用。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured: boolean = Boolean(
  url && anonKey && !url.startsWith('YOUR_') && !anonKey.startsWith('YOUR_'),
)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null
