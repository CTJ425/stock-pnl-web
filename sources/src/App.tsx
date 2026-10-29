import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { AuthPage } from './components/Auth/AuthPage'
import { AppShell } from './components/AppShell'
import { initialAuthNotice } from './services/supabase'

/**
 * Signup confirmation and Google sign-in redirect the browser back with the result in the URL, which the
 * Supabase client consumes before this component ever renders (see services/supabase.ts).
 * Shown above both branches below: an expired link leaves the user logged out.
 */
function AuthRedirectBanner() {
  const [visible, setVisible] = useState(initialAuthNotice !== null)
  if (!visible || !initialAuthNotice) return null

  const { className, text } =
    initialAuthNotice.kind === 'signup-confirmed'
      ? { className: 'notice notice-ok', text: '信箱驗證成功，歡迎使用。' }
      : { className: 'notice notice-error', text: `登入或信箱驗證沒有完成：${initialAuthNotice.message}` }

  return (
    <div className={className}>
      <span>{text}</span>
      <button type="button" onClick={() => setVisible(false)}>
        關閉
      </button>
    </div>
  )
}

function AppInner() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-wrap">
        <div className="glass empty-state" style={{ minWidth: 240 }}>
          載入中…
        </div>
      </div>
    )
  }

  // One banner above both branches: rendered inside each, signing in remounted it and brought
  // back a notice the user had already closed.
  return (
    <>
      <AuthRedirectBanner />
      {user ? (
        <WorkspaceProvider>
          <AppShell />
        </WorkspaceProvider>
      ) : (
        <AuthPage />
      )}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
