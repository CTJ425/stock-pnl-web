/** 登入 / 註冊頁（僅 Supabase 模式會顯示；本機模式免登入） */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { TrendingUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    if (!email.trim() || !password) {
      setMessage({ kind: 'error', text: '請填寫電子信箱與密碼' })
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const err = await signIn(email.trim(), password)
        if (err) setMessage({ kind: 'error', text: `登入失敗：${err}` })
      } else {
        const err = await signUp(email.trim(), password)
        if (err) {
          const isHint = err.includes('註冊成功')
          setMessage({ kind: isHint ? 'ok' : 'error', text: isHint ? err : `註冊失敗：${err}` })
          if (isHint) setMode('signin')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="glass auth-card">
        <div className="brand">
          <span className="brand-mark">
            <TrendingUp size={17} />
          </span>
          股票小幫手
        </div>
        <p className="auth-sub">台美股交易紀錄・移動平均成本損益・年度收益總覽</p>

        {message && (
          <div className={`notice ${message.kind === 'error' ? 'notice-error' : 'notice-ok'}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="auth-email">電子信箱</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">密碼</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? '至少 6 個字元' : '請輸入密碼'}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? '處理中…' : mode === 'signin' ? '登入' : '建立帳號'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'signin' ? (
            <>
              還沒有帳號？
              <button onClick={() => { setMode('signup'); setMessage(null) }}>立即註冊</button>
            </>
          ) : (
            <>
              已經有帳號？
              <button onClick={() => { setMode('signin'); setMessage(null) }}>返回登入</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
