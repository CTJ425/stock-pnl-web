/**
 * Account list and administrator permission assignment in the management background (0.6.19).
 *
 * The reason for using Edge Function is the same as `adminStatus.ts`, but harder:
 * **`auth.users` is not in the exposed schemas of PostgREST at all**, the front end gets the user JWT
 * I can't find it no matter how I search; there is no profiles table for the project to map. Only service role can be read.
 *
 * Authorization is also the user JWT automatically brought by `functions.invoke`, and the backend then checks `app_metadata.role`.
 */
import { supabase } from './supabase'

export interface AdminUser {
  id: string
  email: string
  /** ISO time; bad value or missing value is null, the screen displays "—"*/
  createdAt: string | null
  /**
   * The latest connection (the backend takes `auth.users.updated_at`).
   *
   * **Not `last_sign_in_at`**: that is only updated when you actually log in again,
   * Accounts that have not been logged out will always be stuck at a very old time, and the screen will look broken (fixed in 0.6.20).
   */
  lastActiveAt: string | null
  admin: boolean
}

/** Read the account list. Check if there is no / no permission and return null (error will not be thrown, compare with other proxies)*/
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
        lastActiveAt: typeof u.lastActiveAt === 'string' ? u.lastActiveAt : null,
        admin: u.admin === true,
      }
    })
  } catch {
    return null
  }
}

/**
 * Assign or revoke administrator privileges.
 *
 * Return an error message string or null (success) - this one can't swallow errors:
 * After the user presses the switch, the screen must truthfully answer "Did it succeed?"
 * The backend will block the operation of "cancelling one's own permissions", and the reason must be transmitted to the screen as it is.
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
 * Digging out the messages written by the backend from the FunctionsHttpError of supabase-js.
 *
 * When it is not 2xx, `invoke` will only give "Edge Function returned a non-2xx status code".
 * The real reason (for example, "cannot revoke one's administrator privileges") is in the Response of `error.context`.
 * Without this step, users will see technical errors that say nothing.
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
