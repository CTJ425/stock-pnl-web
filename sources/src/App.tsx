import { AuthProvider, useAuth } from './context/AuthContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { AuthPage } from './components/Auth/AuthPage'
import { AppShell } from './components/AppShell'

/** 畫面左下角固定顯示的版本標記 */
const APP_VERSION = 'v0.2.3.1'
const APP_AUTHOR = 'Ivan Chen'

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

  if (!user) return <AuthPage />

  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
      <div className="version-badge">
        {APP_VERSION} | {APP_AUTHOR}
      </div>
    </AuthProvider>
  )
}
