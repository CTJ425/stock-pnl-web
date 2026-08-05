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
  signOut: () => Promise<void>
}

const LOCAL_USER: AuthUser = { id: 'local-user', email: '本機模式（資料存於此瀏覽器）' }

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(isSupabaseConfigured ? null : LOCAL_USER)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [recovery, setRecovery] = useState(false)

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
    const { data, error } = await supabase.auth.signUp({ email, password })
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

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
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
      signOut,
    }),
    [user, loading, recovery, signIn, signUp, resetPassword, updatePassword, dismissRecovery, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
