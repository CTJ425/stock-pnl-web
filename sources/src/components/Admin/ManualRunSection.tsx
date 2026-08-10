/**
 * Admin console: manually trigger the five cron-backed batch jobs (0.6.44-dev.2).
 *
 * "全部" = all five in server order; individual checkboxes pick a subset.
 * Authorization is the admin JWT (Edge `admin-run`), never CRON_SECRET.
 * 0.6.48: live progress bar so multi-job runs show which step is active.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Info, Loader2, Play, RefreshCw, X } from 'lucide-react'
import {
  ADMIN_RUN_JOBS,
  ADMIN_RUN_LABELS,
  runAdminJobs,
  type AdminRunJob,
  type AdminRunJobResult,
  type AdminRunProgress,
  type AdminRunResult,
} from '../../services/adminRun'

type JobUiStatus = 'pending' | 'running' | 'ok' | 'fail'

function summarizeBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '—'
  const o = body as Record<string, unknown>
  if (typeof o.error === 'string') return o.error
  const bits: string[] = []
  if (typeof o.phase === 'string') bits.push(`phase=${o.phase}`)
  if (o.ok === true) bits.push('ok')
  if (o.ok === false) bits.push('not-ok')
  if (Array.isArray(o.phasesDone) && o.phasesDone.length) {
    bits.push(`done=${o.phasesDone.join('+')}`)
  }
  if (Array.isArray(o.phasesSkipped) && o.phasesSkipped.length) {
    bits.push(`skip=${o.phasesSkipped.join('+')}`)
  }
  if (typeof o.synced === 'boolean') bits.push(o.synced ? 'synced' : 'unchanged')
  if (typeof o.generated === 'number') bits.push(`generated=${o.generated}`)
  if (typeof o.dailySynced === 'number') bits.push(`dailySynced=${o.dailySynced}`)
  if (typeof o.dailySkipped === 'number') bits.push(`dailySkipped=${o.dailySkipped}`)
  if (typeof o.fundamentalSynced === 'number') bits.push(`fundSynced=${o.fundamentalSynced}`)
  if (typeof o.fundamentalSkipped === 'number') bits.push(`fundSkipped=${o.fundamentalSkipped}`)
  if (o.allCached === true) bits.push('allCached')
  if (typeof o.total === 'number') bits.push(`total=${o.total}`)
  if (typeof o.count === 'number') bits.push(`count=${o.count}`)
  if (typeof o.ymd === 'string') bits.push(`ymd=${o.ymd}`)
  if (typeof o.asOf === 'string') bits.push(`asOf=${o.asOf.slice(0, 19)}`)
  if (typeof o.skipped === 'boolean' && o.skipped) bits.push('skipped')
  if (typeof o.durationMs === 'number') bits.push(`${o.durationMs}ms`)
  return bits.length ? bits.join(' · ') : JSON.stringify(body).slice(0, 120)
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m} 分 ${r} 秒`
}

function jobStatusLabel(s: JobUiStatus): string {
  if (s === 'running') return '執行中'
  if (s === 'ok') return '完成'
  if (s === 'fail') return '失敗'
  return '等待'
}

export function ManualRunSection() {
  const [selected, setSelected] = useState<Set<AdminRunJob>>(
    () => new Set(ADMIN_RUN_JOBS),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [last, setLast] = useState<AdminRunResult | null>(null)
  const [progress, setProgress] = useState<AdminRunProgress | null>(null)
  /** Per-job UI status for the in-flight (or last) run list. */
  const [runJobs, setRunJobs] = useState<AdminRunJob[]>([])
  const [jobStatus, setJobStatus] = useState<Partial<Record<AdminRunJob, JobUiStatus>>>({})
  const [jobResults, setJobResults] = useState<
    Partial<Record<AdminRunJob, AdminRunJobResult>>
  >({})

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

  function onProgress(p: AdminRunProgress) {
    setProgress(p)
    setJobResults(p.results)
    setJobStatus((prev) => {
      const next = { ...prev }
      if (p.phase === 'job-start') {
        next[p.job] = 'running'
      } else {
        const r = p.results[p.job]
        const fail =
          p.failed.includes(p.job) ||
          (r != null && (r.httpStatus < 200 || r.httpStatus >= 400))
        next[p.job] = fail ? 'fail' : 'ok'
      }
      return next
    })
  }

  async function run(jobs: AdminRunJob[] | 'all') {
    const list: AdminRunJob[] =
      jobs === 'all' ? [...ADMIN_RUN_JOBS] : jobs.filter((j, i, a) => a.indexOf(j) === i)

    setErr('')
    setLast(null)
    setBusy(true)
    setRunJobs(list)
    setJobResults({})
    setJobStatus(Object.fromEntries(list.map((j) => [j, 'pending' as JobUiStatus])))
    setProgress({
      jobs: list,
      total: list.length,
      index: 0,
      job: list[0]!,
      phase: 'job-start',
      completed: 0,
      results: {},
      failed: [],
      elapsedMs: 0,
    })

    const res = await runAdminJobs(jobs, onProgress)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setLast(res.data)
    setJobResults(res.data.results)
    if (!res.data.ok) {
      setErr(
        res.data.failed.length
          ? `部分失敗：${res.data.failed.join(', ')}`
          : '執行完成但有錯誤',
      )
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0
  const currentTitle =
    progress && busy
      ? ADMIN_RUN_LABELS[progress.job]?.title ?? progress.job
      : null

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
        unchanged / skipped，不代表壞掉。多項會<strong>逐一</strong>呼叫（各有獨立時間預算），
        進度條會顯示卡在哪一項。
        <strong>盤後已拆成三階段</strong>（籌碼 → 日K／基本面 → 營收／獲利一輪），避免雲端 Edge
        單次 546；完整歷史靠夜班多輪，手動不必一次補滿。
        請勿重複連按；若某段失敗，到「抓取狀況」確認是否已寫入。
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

      {(busy || (progress && runJobs.length > 0)) && progress && (
        <div
          className="notice"
          style={{ padding: '12px 14px', marginTop: 14, fontSize: 13 }}
          role="status"
          aria-live="polite"
          aria-busy={busy}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
              marginBottom: 8,
            }}
          >
            <div>
              {busy ? (
                <>
                  <Loader2
                    size={14}
                    className="spin"
                    style={{ verticalAlign: -2, marginRight: 6 }}
                  />
                  <strong>
                    執行中 {progress.completed}/{progress.total}
                  </strong>
                  {currentTitle ? (
                    <span className="hint"> — 目前：{currentTitle}</span>
                  ) : null}
                </>
              ) : (
                <>
                  <Check size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  <strong>
                    已結束 {progress.completed}/{progress.total}
                  </strong>
                </>
              )}
            </div>
            <span className="hint" style={{ fontSize: 12 }}>
              已耗時 {formatElapsed(progress.elapsedMs)} · {pct}%
            </span>
          </div>

          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
            aria-hidden
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                borderRadius: 999,
                background: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))',
                transition: 'width 0.25s ease',
              }}
            />
          </div>

          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>項目</th>
                  <th style={{ width: 88 }}>狀態</th>
                  <th style={{ width: 72 }}>HTTP</th>
                  <th style={{ width: 88 }}>耗時</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {runJobs.map((job, i) => {
                  const st = jobStatus[job] ?? 'pending'
                  const r = jobResults[job]
                  const meta = ADMIN_RUN_LABELS[job]
                  return (
                    <tr
                      key={job}
                      style={
                        st === 'running'
                          ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }
                          : undefined
                      }
                    >
                      <td className="hint">{i + 1}</td>
                      <td>
                        <b style={{ fontSize: 13 }}>{meta.title}</b>
                        <div className="hint" style={{ fontSize: 11 }}>
                          {job}
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            color:
                              st === 'fail'
                                ? 'var(--danger)'
                                : st === 'ok'
                                  ? 'var(--accent-2)'
                                  : st === 'running'
                                    ? 'var(--accent)'
                                    : 'var(--ink-muted)',
                          }}
                        >
                          {st === 'running' && <Loader2 size={12} className="spin" />}
                          {st === 'ok' && <Check size={12} />}
                          {st === 'fail' && <X size={12} />}
                          {jobStatusLabel(st)}
                        </span>
                      </td>
                      <td>{r?.httpStatus != null && r.httpStatus > 0 ? r.httpStatus : '—'}</td>
                      <td>{r ? formatElapsed(r.durationMs) : '—'}</td>
                      <td className="hint" style={{ fontSize: 12 }}>
                        {r ? summarizeBody(r.body) : st === 'running' ? '請求中…' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {err && (
        <div
          className="notice notice-warn"
          style={{ padding: '8px 12px', fontSize: 13, marginTop: 12 }}
        >
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {err}
        </div>
      )}

      {last && !busy && (
        <div style={{ marginTop: 14 }}>
          <div className="rpt-section-head" style={{ marginBottom: 8 }}>
            <h4 className="head-tight" style={{ fontSize: 14, margin: 0 }}>
              最近一次結果
            </h4>
            <span className="source-tag section-stamp">
              {last.ok ? '全部成功' : '有失敗'} · 總耗時 {formatElapsed(last.durationMs)}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
