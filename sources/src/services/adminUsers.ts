/**
 * 管理後台的帳號清單與管理員權限指派（0.6.19）。
 *
 * 走 Edge Function 的理由與 `adminStatus.ts` 相同，但更硬：
 * **`auth.users` 根本不在 PostgREST 的 exposed schemas 裡**，前端拿使用者 JWT
 * 怎麼查都查不到；專案也沒有 profiles 表可以映射。只有 service role 讀得到。
 *
 * 授權同樣是 `functions.invoke` 自動帶上的使用者 JWT，後端再核 `app_metadata.role`。
 */
import { supabase } from './supabase'

export interface AdminUser {
  id: string
  email: string
  /** ISO 時間；壞值或缺值為 null，畫面顯示「—」 */
  createdAt: string | null
  lastSignInAt: string | null
  admin: boolean
}

/** 讀取帳號清單。查無 / 無權限回 null（吞錯不拋，比照其他 proxy） */
export async function fetchAdminUsers(): Promise<AdminUser[] | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-users' },
    })
    if (error || !data || (data as { ok?: boolean }).ok !== true) return null
    const rows = (data as { users?: unknown }).users
    if (!Array.isArray(rows)) return []
    return rows.map((r) => {
      const u = r as Partial<AdminUser>
      return {
        id: typeof u.id === 'string' ? u.id : '',
        email: typeof u.email === 'string' ? u.email : '',
        createdAt: typeof u.createdAt === 'string' ? u.createdAt : null,
        lastSignInAt: typeof u.lastSignInAt === 'string' ? u.lastSignInAt : null,
        admin: u.admin === true,
      }
    })
  } catch {
    return null
  }
}

/**
 * 指派或收回管理員權限。
 *
 * 回傳錯誤訊息字串或 null（成功）—— 這一支**不能吞錯**：
 * 使用者按下開關之後，畫面必須據實回答「成功了沒」，
 * 而後端會擋掉「取消自己的權限」這種操作，那個理由要原樣傳到畫面上。
 */
export async function setUserAdmin(userId: string, admin: boolean): Promise<string | null> {
  if (!supabase) return 'Supabase 未設定'
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-set-role', userId, admin },
    })
    if (error) return (await httpErrorMessage(error)) ?? error.message
    const res = data as { ok?: boolean; error?: string } | null
    if (!res || res.ok !== true) return res?.error ?? '設定失敗'
    return null
  } catch (e: unknown) {
    return e instanceof Error ? e.message : '設定失敗'
  }
}

/**
 * 從 supabase-js 的 FunctionsHttpError 裡挖出後端寫的訊息。
 *
 * 非 2xx 時 `invoke` 只給「Edge Function returned a non-2xx status code」，
 * 真正的原因（例如「不能取消自己的管理員權限」）在 `error.context` 那個 Response 裡。
 * 少了這一步，使用者看到的會是一句什麼都沒說的技術錯誤。
 */
async function httpErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown })?.context
  if (!(ctx instanceof Response)) return null
  try {
    const body = (await ctx.clone().json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
