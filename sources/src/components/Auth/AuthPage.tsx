/** 登入 / 註冊 / 忘記密碼頁（僅 Supabase 模式會顯示；本機模式免登入） */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { TrendingUp } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

type Mode = 'signin' | 'signup' | 'reset'

const SUBMIT_LABEL: Record<Mode, string> = {
  signin: '登入',
  signup: '建立帳號',
  reset: '寄送重設密碼連結',
}

export function AuthPage() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const switchMode = (next: Mode) => {
    setMode(next)
    setMessage(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    const cleanEmail = email.trim()
    if (!cleanEmail || (mode !== 'reset' && !password)) {
      setMessage({ kind: 'error', text: mode === 'reset' ? '請填寫電子信箱' : '請填寫電子信箱與密碼' })
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const err = await signIn(cleanEmail, password)
        if (err) setMessage({ kind: 'error', text: `登入失敗：${err}` })
      } else if (mode === 'signup') {
        const err = await signUp(cleanEmail, password)
        if (err) {
          const isHint = err.includes('註冊成功')
          setMessage({ kind: isHint ? 'ok' : 'error', text: isHint ? err : `註冊失敗：${err}` })
          if (isHint) setMode('signin')
        }
      } else {
        const err = await resetPassword(cleanEmail)
        if (err) {
          setMessage({ kind: 'error', text: `寄送失敗：${err}` })
        } else {
          setMessage({
            kind: 'ok',
            text: `✉️ 重設密碼連結已寄至 ${cleanEmail}，請至信箱點擊連結後依畫面指示設定新密碼。`,
          })
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

        {mode === 'signup' && (
          <div className="notice notice-warn">
            註冊後系統會寄出驗證信，需至你輸入的信箱點擊驗證連結，完成驗證後才能登入使用。
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
            {mode === 'reset' && (
              <div className="field-hint">輸入註冊時使用的信箱，我們會寄送重設密碼連結給你</div>
            )}
          </div>
          {mode !== 'reset' && (
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
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? '處理中…' : SUBMIT_LABEL[mode]}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'signin' && (
            <>
              還沒有帳號？
              <button onClick={() => switchMode('signup')}>立即註冊</button>
              ・
              <button onClick={() => switchMode('reset')}>忘記密碼？</button>
            </>
          )}
          {mode === 'signup' && (
            <>
              已經有帳號？
              <button onClick={() => switchMode('signin')}>返回登入</button>
            </>
          )}
          {mode === 'reset' && (
            <>
              想起密碼了？
              <button onClick={() => switchMode('signin')}>返回登入</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
