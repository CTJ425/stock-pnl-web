/**
 * 登入狀態管理：
 * - Supabase 模式：email/密碼註冊與登入，維持 session
 * - 本機模式（未設定 Supabase）：免登入，直接以本機使用者進入
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
  /** session 還原中（首屏 loading） */
  loading: boolean
  /** 回傳錯誤訊息；成功為 null */
  signIn: (email: string, password: string) => Promise<string | null>
  /** 回傳錯誤訊息；成功為 null。若專案開啟信箱驗證，回傳提示訊息字串（非錯誤） */
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const LOCAL_USER: AuthUser = { id: 'local-user', email: '本機模式（資料存於此瀏覽器）' }

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(isSupabaseConfigured ? null : LOCAL_USER)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  // 內容未變時沿用同一物件：token 刷新（如切回分頁）不應觸發下游 effect 重載
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
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
    // 專案若開啟信箱驗證，註冊後不會立即有 session
    if (!data.session) return '註冊成功！請至信箱點擊驗證連結後再登入。'
    return null
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      mode: isSupabaseConfigured ? 'supabase' : 'local',
      user,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [user, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
