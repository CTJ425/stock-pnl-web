/**
 * Admin console: manually trigger the five cron-backed batch jobs (0.6.44-dev.2).
 *
 * "全部" = all five in server order; individual checkboxes pick a subset.
 * Authorization is the admin JWT (Edge `admin-run`), never CRON_SECRET.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Info, Play, RefreshCw } from 'lucide-react'
import {
  ADMIN_RUN_JOBS,
  ADMIN_RUN_LABELS,
  runAdminJobs,
  type AdminRunJob,
  type AdminRunResult,
} from '../../services/adminRun'

function summarizeBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '—'
  const o = body as Record<string, unknown>
  if (typeof o.error === 'string') return o.error
  const bits: string[] = []
  if (o.ok === true) bits.push('ok')
  if (o.ok === false) bits.push('not-ok')
  if (typeof o.synced === 'boolean') bits.push(o.synced ? 'synced' : 'unchanged')
  if (typeof o.generated === 'number') bits.push(`generated=${o.generated}`)
  if (typeof o.total === 'number') bits.push(`total=${o.total}`)
  if (typeof o.count === 'number') bits.push(`count=${o.count}`)
  if (typeof o.ymd === 'string') bits.push(`ymd=${o.ymd}`)
  if (typeof o.asOf === 'string') bits.push(`asOf=${o.asOf.slice(0, 19)}`)
  if (typeof o.skipped === 'boolean' && o.skipped) bits.push('skipped')
  if (typeof o.durationMs === 'number') bits.push(`${o.durationMs}ms`)
  return bits.length ? bits.join(' · ') : JSON.stringify(body).slice(0, 120)
}

export function ManualRunSection() {
  const [selected, setSelected] = useState<Set<AdminRunJob>>(
    () => new Set(ADMIN_RUN_JOBS),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [last, setLast] = useState<AdminRunResult | null>(null)

  const allChecked = selected.size === ADMIN_RUN_JOBS.length
  const noneChecked = selected.size === 0

  const selectedList = useMemo(
    () => ADMIN_RUN_JOBS.filter((j) => selected.has(j)),
    [selected],
  )

  function toggle(job: AdminRunJob) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(job)) next.delete(job)
      else next.add(job)
      return next
    })
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(ADMIN_RUN_JOBS))
  }

  async function run(jobs: AdminRunJob[] | 'all') {
    setErr('')
    setLast(null)
    setBusy(true)
    const res = await runAdminJobs(jobs)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setLast(res.data)
    if (!res.data.ok) {
      setErr(
        res.data.failed.length
          ? `部分失敗：${res.data.failed.join(', ')}`
          : '執行完成但有錯誤',
      )
    }
  }

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">手動更新</h3>
        <span className="source-tag section-stamp">
          等同強制觸發排程（管理員 JWT，不用 CRON_SECRET）
        </span>
      </div>

      <div className="notice" style={{ padding: '10px 12px', fontSize: 13, marginTop: 12 }}>
        <Info size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        與後台「抓取狀況」的排程同一組 handler。資料尚未公布時可能回
        unchanged / skipped，不代表壞掉。多項會<strong>逐一</strong>呼叫（各有獨立時間預算）。
        <strong> 盤後個股批次</strong>可能需數十秒到兩分鐘，請勿重複連按；若逾時，到「抓取狀況」
        確認是否已寫入（伺服器端有時仍會跑完）。
        執行後會寫入 admin_run_log，到「抓取狀況」重新整理即可看到最後執行時間（標
        「手動」）。
      </div>

      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allChecked && !noneChecked
                  }}
                  onChange={toggleAll}
                  aria-label="全選"
                  disabled={busy}
                />
              </th>
              <th>項目</th>
              <th>對應排程</th>
              <th>說明</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {ADMIN_RUN_JOBS.map((job) => {
              const meta = ADMIN_RUN_LABELS[job]
              return (
                <tr key={job}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(job)}
                      onChange={() => toggle(job)}
                      aria-label={meta.title}
                      disabled={busy}
                    />
                  </td>
                  <td>
                    <b>{meta.title}</b>
                    <div className="hint" style={{ fontSize: 11 }}>
                      {job}
                    </div>
                  </td>
                  <td>
                    <code style={{ fontSize: 12 }}>{meta.cron}</code>
                  </td>
                  <td className="hint">{meta.hint}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void run([job])}
                    >
                      {busy ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
                      執行
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button
          type="button"
          className="btn"
          disabled={busy || noneChecked}
          onClick={() => void run(selectedList)}
        >
          {busy ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
          執行勾選項目
          {!noneChecked && !busy ? `（${selectedList.length}）` : ''}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run('all')}
        >
          {busy ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
          全部執行
        </button>
      </div>

      {err && (
        <div
          className="notice notice-warn"
          style={{ padding: '8px 12px', fontSize: 13, marginTop: 12 }}
        >
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {err}
        </div>
      )}

      {last && (
        <div style={{ marginTop: 14 }}>
          <div className="rpt-section-head" style={{ marginBottom: 8 }}>
            <h4 className="head-tight" style={{ fontSize: 14, margin: 0 }}>
              最近一次結果
            </h4>
            <span className="source-tag section-stamp">
              {last.ok ? '全部成功' : '有失敗'} · 總耗時 {last.durationMs} ms
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>job</th>
                  <th>HTTP</th>
                  <th>耗時</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {last.jobs.map((job) => {
                  const r = last.results[job]
                  return (
                    <tr key={job}>
                      <td>
                        <code>{job}</code>
                      </td>
                      <td>{r?.httpStatus ?? '—'}</td>
                      <td>{r ? `${r.durationMs} ms` : '—'}</td>
                      <td className="hint" style={{ fontSize: 12 }}>
                        {r ? summarizeBody(r.body) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
