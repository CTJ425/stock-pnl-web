/** Password dialogs of the signed-in shell: the reset-link landing and the in-account change. */
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { MIN_PASSWORD_LENGTH } from './AuthPage'
import { Modal } from '../Common/Modal'

/** After the user clicks the "Reset Password" email link to enter the site, he or she is prompted to set a new password.*/
export function RecoveryPasswordModal() {
  const { updatePassword, dismissRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`新密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`)
      return
    }
    if (password !== confirm) {
      setError('兩次輸入的密碼不一致')
      return
    }
    setBusy(true)
    try {
      const err = await updatePassword(password)
      if (err) setError(`設定失敗：${err}`)
      // updatePassword will automatically close this window when successful (recovery = false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="設定新密碼" onClose={dismissRecovery} disableBackdropClose>
      <div className="notice notice-warn">
        你剛透過「重設密碼」信件連結登入，請立即設定新密碼。
        （關閉此視窗則維持原密碼不變）
      </div>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="field">
          <label htmlFor="new-password">新密碼</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 個字元`}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">確認新密碼</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            placeholder="再輸入一次新密碼"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? '儲存中…' : '儲存新密碼'}
        </button>
      </form>
    </Modal>
  )
}

/** Change password from inside the account: re-authenticates with the current password first (see AuthContext.changePassword). */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (!current) {
      setError('請輸入目前密碼')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`新密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`)
      return
    }
    if (password !== confirm) {
      setError('兩次輸入的密碼不一致')
      return
    }
    setBusy(true)
    try {
      const err = await changePassword(current, password)
      if (err) setError(err)
      else {
        // Keep the modal open so the confirmation is actually seen; clear the fields and lock
        // the button so a second submit cannot fail against the password that just changed.
        setDone(true)
        setCurrent('')
        setPassword('')
        setConfirm('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="變更密碼" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="notice notice-error">{error}</div>}
        {done && <div className="notice notice-ok">密碼已變更</div>}
        <div className="field">
          <label htmlFor="current-password">目前密碼</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="change-new-password">新密碼</label>
          <input
            id="change-new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 個字元`}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="change-confirm-password">確認新密碼</label>
          <input
            id="change-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            placeholder="再輸入一次新密碼"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || done}>
          {busy ? '儲存中…' : '變更密碼'}
        </button>
      </form>
    </Modal>
  )
}

