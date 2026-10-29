/** Login/Registration/Forgot Password page (only displayed in Supabase mode; no login required in local mode)*/
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { BrandMark } from '../BrandMark'
import { PasswordField } from './PasswordField'
import { REMEMBER_DAYS } from '../../services/authPersistence'

type Mode = 'signin' | 'signup' | 'reset'

/** OP-02: minimum new-password length, enforced on sign-up (and mirrored by AppShell for the recovery/change-password modals). */
export const MIN_PASSWORD_LENGTH = 8

const SUBMIT_LABEL: Record<Mode, string> = {
  signin: '登入',
  signup: '建立帳號',
  reset: '寄送重設密碼連結',
}

/** Google's four-color "G", as its branding guidelines require on the sign-in button. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export function AuthPage() {
  const { signIn, signInWithGoogle, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const switchMode = (next: Mode) => {
    setMode(next)
    setMessage(null)
  }

  // Back from Google's page restores this one from the back/forward cache with busy still set.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const startGoogle = async () => {
    if (busy) return
    setMessage(null)
    setBusy(true)
    let err: string | null
    try {
      // 保持登入 is only offered on the sign-in form; a Google sign-up keeps the default.
      err = await signInWithGoogle(mode === 'signin' ? remember : true)
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
    // On success the page navigates to Google, so busy stays set until it unloads.
    if (err) {
      setMessage({ kind: 'error', text: `無法前往 Google 登入：${err}` })
      setBusy(false)
    }
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
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setMessage({ kind: 'error', text: `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元` })
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const err = await signIn(cleanEmail, password, remember)
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
          <BrandMark />
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
            <PasswordField
              id="auth-password"
              label="密碼"
              value={password}
              onChange={setPassword}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? `至少 ${MIN_PASSWORD_LENGTH} 個字元` : '請輸入密碼'}
            />
          )}
          {mode === 'signin' && (
            <div className="field">
              <label className="check-row" htmlFor="auth-remember">
                <input
                  id="auth-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                保持登入 {REMEMBER_DAYS} 天
              </label>
              <div className="field-hint">
                {remember
                  ? `只在這個瀏覽器有效，${REMEMBER_DAYS} 天後需重新登入`
                  : '不勾選時，關閉瀏覽器後需重新登入'}
              </div>
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? '處理中…' : SUBMIT_LABEL[mode]}
          </button>
        </form>

        {mode !== 'reset' && (
          <>
            <div className="auth-divider">或</div>
            <button type="button" className="btn btn-google" onClick={startGoogle} disabled={busy}>
              <GoogleMark />
              使用 Google 帳戶{mode === 'signup' ? '註冊' : '登入'}
            </button>
          </>
        )}

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
