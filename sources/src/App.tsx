import { AuthProvider, useAuth } from './context/AuthContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { AuthPage } from './components/Auth/AuthPage'
import { AppShell } from './components/AppShell'

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
    </AuthProvider>
  )
}
