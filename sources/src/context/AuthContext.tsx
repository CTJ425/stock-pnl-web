/**
 * Login status management:
 * - Supabase mode: email/password registration and login, maintaining session
 * - Local mode (no Supabase is set): no need to log in, enter directly as the local user
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { isSupabaseConfigured, supabase } from '../services/supabase'

export interface AuthUser {
  id: string
  email: string
}

export interface AuthState {
  mode: 'local' | 'supabase'
  user: AuthUser | null
  /** Session is being restored (first screen loading)*/
  loading: boolean
  /** Users who enter through the "Reset Password" email link should be prompted to set a new password.*/
  recovery: boolean
  /** Returns an error message; null on success*/
  signIn: (email: string, password: string) => Promise<string | null>
  /** Returns an error message; null on success. If mailbox verification is enabled for the project, a prompt message string (not an error) will be returned.*/
  signUp: (email: string, password: string) => Promise<string | null>
  /** Send password reset email; return error message, success is null*/
  resetPassword: (email: string) => Promise<string | null>
  /** Set a new password (after entering the reset process); return an error message, and return null if successful*/
  updatePassword: (password: string) => Promise<string | null>
  /** Skip this prompt to set a new password*/
  dismissRecovery: () => void
  /** Change password from inside the account: re-authenticates with the current password first. Returns an error message, null on success.*/
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>
  /**
   * Returns an error message, like the other auth actions above; null on success. On failure the
   * local session is cleared anyway (`{ scope: 'local' }`) so the user is not stuck signed in
   * after a network hiccup — the caller only needs the message to display.
   */
  signOut: () => Promise<string | null>
  /**
   * Bumps on TOKEN_REFRESHED / USER_UPDATED (not just on a user id change), so a consumer that
   * needs to re-check something server-side (e.g. isAdmin()) can depend on it without opening a
   * second `onAuthStateChange` subscription of its own.
   */
  authVersion: number
}

const LOCAL_USER: AuthUser = { id: 'local-user', email: '本機模式（資料存於此瀏覽器）' }

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(isSupabaseConfigured ? null : LOCAL_USER)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [recovery, setRecovery] = useState(false)
  const [authVersion, setAuthVersion] = useState(0)

  // Use the same object when the content does not change: token refresh (such as switching back to paging) should not trigger downstream effect reloading
  const applyUser = useCallback((u: { id: string; email?: string | null } | null | undefined) => {
    setUser((prev) => {
      if (!u) return null
      const email = u.email ?? ''
      return prev && prev.id === u.id && prev.email === email ? prev : { id: u.id, email }
    })
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      applyUser(data.session?.user)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Entering the site from the reset password email link: prompting the user to set a new password
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      applyUser(session?.user)
      // A token refresh or profile update does not change `user` (same id/email), so anything
      // that needs to re-check server-side state (e.g. isAdmin()) needs a separate signal.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setAuthVersion((v) => v + 1)
      }
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [applyUser])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return null
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? error.message : null
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return null
    // Send the confirmation link back to the current site. Without this option Supabase falls
    // back to the project's Site URL, which is `http://localhost:3000` on a new project.
    const emailRedirectTo = window.location.origin + window.location.pathname
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    })
    if (error) return error.message
    // If mailbox verification is enabled for the project, there will be no session immediately after registration.
    if (!data.session) return '註冊成功！請至信箱點擊驗證連結後再登入。'
    return null
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) return null
    // The email link is directed back to the current site (local testing requires adding localhost to Supabase's Redirect URLs)
    const redirectTo = window.location.origin + window.location.pathname
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    return error ? error.message : null
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) return null
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) setRecovery(false)
    return error ? error.message : null
  }, [])

  const dismissRecovery = useCallback(() => setRecovery(false), [])

  // Supabase lets any live session change the password with no proof of the old one, so
  // re-authenticating with the current password is the whole point of this feature.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!supabase || !user) return null
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (reauthError) return '目前密碼不正確'
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      return error ? error.message : null
    },
    [user],
  )

  const signOut = useCallback(async () => {
    if (!supabase) return null
    const { error } = await supabase.auth.signOut()
    if (!error) return null
    // The remote sign-out failed (e.g. offline) — clear the local session anyway so the
    // user is not stuck looking signed-in on this device, then report why.
    await supabase.auth.signOut({ scope: 'local' })
    return `登出時發生錯誤，已在本機清除登入狀態：${error.message}`
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      mode: isSupabaseConfigured ? 'supabase' : 'local',
      user,
      loading,
      recovery,
      signIn,
      signUp,
      resetPassword,
      updatePassword,
      dismissRecovery,
      changePassword,
      signOut,
      authVersion,
    }),
    [
      user,
      loading,
      recovery,
      signIn,
      signUp,
      resetPassword,
      updatePassword,
      dismissRecovery,
      changePassword,
      signOut,
      authVersion,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react/only-export-components -- provider + hook share one private context by design
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
