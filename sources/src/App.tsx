import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { AuthPage } from './components/Auth/AuthPage'
import { AppShell } from './components/AppShell'
import { APP_VERSION } from './version'
import { initialAuthNotice } from './services/supabase'

/**
 * Signup confirmation redirects the browser back with the result in the URL hash, which the
 * Supabase client consumes before this component ever renders (see services/supabase.ts).
 * Shown above both branches below: an expired link leaves the user logged out.
 */
function AuthRedirectBanner() {
  const [visible, setVisible] = useState(initialAuthNotice !== null)
  if (!visible || !initialAuthNotice) return null

  const { className, text } =
    initialAuthNotice.kind === 'signup-confirmed'
      ? { className: 'notice notice-ok', text: '信箱驗證成功，歡迎使用。' }
      : { className: 'notice notice-error', text: `驗證連結無效或已過期：${initialAuthNotice.message}` }

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

  if (!user) {
    return (
      <>
        <AuthRedirectBanner />
        <AuthPage />
      </>
    )
  }

  return (
    <WorkspaceProvider>
      <AuthRedirectBanner />
      <AppShell />
    </WorkspaceProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
      <div className="version-badge">{APP_VERSION}</div>
    </AuthProvider>
  )
}
