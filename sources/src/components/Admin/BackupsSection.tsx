/**
 * Management backend "備份" (task 130, phase 2): per-account summary of the nightly
 * `backup-transactions` run, with an admin-only, short-lived download link per file.
 *
 * Modeled on `AccountsSection.tsx` — same panel chrome, same "read-only summary, swallow
 * fetch errors into a screen message" shape. The download call is the one place that must
 * surface the backend's real error message: the user just pressed a button.
 *
 * ⚠️ There is no self-service download path anywhere else. This is the only screen that can
 * reach the `backups` bucket, and only because `admin-backup-url` gates on `assertAdmin` +
 * `isValidBackupPath` before minting a signed URL.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, Info, RefreshCw } from 'lucide-react'
import { fetchAdminBackups, requestBackupUrl, type AccountBackups, type BackupFile } from '../../services/adminBackups'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function statusLabel(run: AccountBackups['lastRun']): string {
  if (!run) return '尚無備份紀錄'
  if (run.status === 'ok') return `${run.runDate}・成功`
  return `${run.runDate}・失敗：${run.error ?? '未知錯誤'}`
}

export function BackupsSection() {
  const [accounts, setAccounts] = useState<AccountBackups[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string>('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setAccounts(await fetchAdminBackups())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function download(userId: string, file: BackupFile) {
    setErr('')
    const res = await requestBackupUrl(`${userId}/${file.name}`)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  const totalFiles = accounts?.reduce((sum, a) => sum + a.fileCount, 0) ?? 0

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">備份</h3>
        <span className="source-tag section-stamp">
          {accounts ? `共 ${accounts.length} 個帳號・${totalFiles} 份備份` : '　'}
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

      {loading && !accounts ? (
        <p className="hint" style={{ marginTop: 12 }}>
          正在讀取備份清單…
        </p>
      ) : !accounts ? (
        <p className="hint" style={{ marginTop: 12 }}>
          讀不到備份清單。這一頁只有管理員看得到，若你確定帳號有權限，可能是後端尚未部署最新版本。
        </p>
      ) : (
        <>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>帳號</th>
                  <th>備份份數</th>
                  <th>最新備份</th>
                  <th>總大小</th>
                  <th>最近狀態</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const isOpen = expanded === a.userId
                  return (
                    <Fragment key={a.userId}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="link-btn"
                            aria-expanded={isOpen}
                            onClick={() => setExpanded(isOpen ? '' : a.userId)}
                          >
                            <ChevronRight
                              size={14}
                              style={{
                                verticalAlign: -2,
                                marginRight: 6,
                                transform: isOpen ? 'rotate(90deg)' : undefined,
                              }}
                            />
                            {a.email || '（沒有 email）'}
                          </button>
                        </td>
                        <td>{a.fileCount}</td>
                        <td className="ast-mono">{a.newestDate ?? '—'}</td>
                        <td className="ast-mono">{formatBytes(a.totalBytes)}</td>
                        <td>{statusLabel(a.lastRun)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5}>
                            {a.files.length === 0 ? (
                              <p className="hint">這個帳號還沒有任何備份檔。</p>
                            ) : (
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>檔名</th>
                                    <th>大小</th>
                                    <th>建立於</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {a.files.map((f) => (
                                    <tr key={f.name}>
                                      <td>{f.name}</td>
                                      <td className="ast-mono">{formatBytes(f.size)}</td>
                                      <td className="ast-mono">{f.createdAt ?? '—'}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="btn btn-sm"
                                          onClick={() => void download(a.userId, f)}
                                        >
                                          下載
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="ast-note" style={{ marginTop: 12 }}>
            <Info size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            下載連結是<b>短效連結</b>，60 秒後失效；只有管理員能取得，一般使用者沒有任何自助下載備份的入口。
          </p>
        </>
      )}
    </section>
  )
}
