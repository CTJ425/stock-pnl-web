/**
 * Management backend "執行記錄" (Spec 146 Phase 1c): read-only viewer over `app_log`.
 *
 * `app_log` has no SELECT policy (§ 3.1 of the spec) — `fetchAppLogs()` is the only path in,
 * reading through the Edge Function's `assertAdmin`-gated `app-logs` action. This is the
 * `app_log` tab only; Spec 144 Feature 2 later adds the cron/probe tabs to this same panel.
 */
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { fetchAppLogs, type AppLogRow, type LogLevel, type LogSource } from '../../services/appLog'

const LIMIT = 100

const LEVEL_LABEL: Record<LogLevel, string> = { error: '錯誤', warn: '警告', info: '資訊' }
const SOURCE_LABEL: Record<LogSource, string> = { edge: '後端排程', web: '前端', db: '資料庫' }

function fmtAt(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW')
}

export function LogsSection() {
  const [rows, setRows] = useState<AppLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [level, setLevel] = useState<LogLevel | ''>('')
  const [source, setSource] = useState<LogSource | ''>('')
  const [hasMore, setHasMore] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async (lv: LogLevel | '', src: LogSource | '') => {
    setLoading(true)
    setError(false)
    try {
      const data = await fetchAppLogs({ limit: LIMIT, level: lv || undefined, source: src || undefined })
      setRows(data)
      setHasMore(data.length === LIMIT)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Changing a filter refetches from the start.
  useEffect(() => {
    void load(level, source)
  }, [load, level, source])

  async function loadMore() {
    const last = rows[rows.length - 1]
    if (!last) return
    setLoadingMore(true)
    try {
      const more = await fetchAppLogs({
        limit: LIMIT,
        level: level || undefined,
        source: source || undefined,
        before: last.at,
      })
      setRows((prev) => [...prev, ...more])
      setHasMore(more.length === LIMIT)
    } catch {
      setError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">執行記錄</h3>
        <span className="source-tag section-stamp">{rows.length > 0 ? `共 ${rows.length} 筆` : '　'}</span>
        <button type="button" className="btn btn-sm" onClick={() => void load(level, source)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      <div className="adm-log-filters">
        <label className="hint">
          等級{' '}
          <select
            className="btn btn-sm"
            aria-label="依等級篩選"
            value={level}
            onChange={(e) => setLevel(e.target.value as LogLevel | '')}
          >
            <option value="">全部</option>
            <option value="error">錯誤</option>
            <option value="warn">警告</option>
            <option value="info">資訊</option>
          </select>
        </label>
        <label className="hint">
          來源{' '}
          <select
            className="btn btn-sm"
            aria-label="依來源篩選"
            value={source}
            onChange={(e) => setSource(e.target.value as LogSource | '')}
          >
            <option value="">全部</option>
            <option value="edge">後端排程</option>
            <option value="web">前端</option>
            <option value="db">資料庫</option>
          </select>
        </label>
      </div>

      {loading && rows.length === 0 ? (
        <p className="hint" style={{ marginTop: 12 }}>
          正在讀取執行記錄…
        </p>
      ) : error ? (
        <div className="notice notice-error" style={{ marginTop: 12 }}>
          讀取執行記錄失敗，請稍後重新整理。
        </div>
      ) : rows.length === 0 ? (
        <p className="hint" style={{ marginTop: 12 }}>
          目前沒有記錄
        </p>
      ) : (
        <>
          <ul className="adm-log-list">
            {rows.map((r) => {
              const open = openId === r.id
              return (
                <li key={r.id} className={open ? 'adm-log-row adm-log-open' : 'adm-log-row'}>
                  <button
                    type="button"
                    className="adm-log-head"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : r.id)}
                  >
                    <span className="adm-log-time ast-mono">{fmtAt(r.at)}</span>
                    <span className={`adm-log-level adm-log-level-${r.level}`}>{LEVEL_LABEL[r.level]}</span>
                    <span className="source-tag">{SOURCE_LABEL[r.source]}</span>
                    <span className="adm-log-action">{r.action}</span>
                    <span className="adm-log-message">{r.message}</span>
                    <ChevronDown className="adm-log-caret" size={15} aria-hidden="true" />
                  </button>
                  {open && (
                    <div className="adm-log-detail">
                      <pre>{JSON.stringify(r.detail, null, 2)}</pre>
                      <p className="hint">
                        request_id：{r.requestId ?? '—'}・app_version：{r.appVersion ?? '—'}・user_id：
                        {r.userId ?? '—'}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {hasMore && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              <RefreshCw size={14} className={loadingMore ? 'spin' : undefined} />
              載入更多
            </button>
          )}
        </>
      )}
    </section>
  )
}
