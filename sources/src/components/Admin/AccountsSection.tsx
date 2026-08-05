/**
 * Management backend "Account": List all registered accounts and assign/revoke administrator rights.
 *
 * ⚠️ **After changing the permissions, the account will not take effect until you log in again. **
 * Permissions are baked into the issued JWT, and the old identity will remain with the old token until it expires.
 * This matter must be written on the screen - if not, the administrator will press the switch and the other party will report "still can't see it".
 * Both sides will think it's broken.
 *
 * The switch adopts "Send first, then change the screen after success": permissions are sensitive operations, and optimistic updates will cause failure
 * On the screen it looks like success.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, RefreshCw } from 'lucide-react'
import { fetchAdminUsers, setUserAdmin, type AdminUser } from '../../services/adminUsers'
import { fmtUpdatedAt } from '../StockDetail/chipFormat'

export function AccountsSection() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setUsers(await fetchAdminUsers())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(u: AdminUser) {
    setErr('')
    setBusyId(u.id)
    const failure = await setUserAdmin(u.id, !u.admin)
    setBusyId('')
    if (failure) {
      setErr(failure)
      return
    }
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, admin: !u.admin } : x)) ?? prev)
  }

  const adminCount = users?.filter((u) => u.admin).length ?? 0

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">帳號</h3>
        <span className="source-tag section-stamp">
          {users ? `共 ${users.length} 個帳號・${adminCount} 位管理員` : '　'}
        </span>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      {err && (
        <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 13, marginTop: 12 }}>
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {err}
        </div>
      )}

      {loading && !users ? (
        <p className="hint" style={{ marginTop: 12 }}>
          正在讀取帳號清單…
        </p>
      ) : !users ? (
        <p className="hint" style={{ marginTop: 12 }}>
          讀不到帳號清單。這一頁只有管理員看得到，若你確定帳號有權限，可能是後端尚未部署最新版本。
        </p>
      ) : (
        <>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>帳號</th>
                  <th>建立於</th>
                  <th>最近活動</th>
                  <th>管理員</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.email || '（沒有 email）'}</b>
                    </td>
                    <td className="ast-mono">{u.createdAt ? fmtUpdatedAt(u.createdAt) : '—'}</td>
                    <td className="ast-mono">
                      {u.lastActiveAt ? fmtUpdatedAt(u.lastActiveAt) : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={u.admin}
                        aria-label={`${u.email} 的管理員權限`}
                        className={u.admin ? 'adm-toggle on' : 'adm-toggle'}
                        onClick={() => void toggle(u)}
                        disabled={busyId === u.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="ast-note" style={{ marginTop: 12 }}>
            <Info size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            持續登入中的帳號不會產生新的登入紀錄，所以「最近活動」看的是
            <b>最近一次連線</b>的時間，不是最後一次輸入密碼。
          </p>
          <p className="ast-note" style={{ marginTop: 6 }}>
            <Info size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            <b>改完權限，該帳號要重新登入才會生效。</b>
            權限寫在登入憑證裡，憑證要重新簽發才會帶上新身分。
          </p>
        </>
      )}
    </section>
  )
}
