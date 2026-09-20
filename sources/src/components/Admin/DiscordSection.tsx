/**
 * Admin console: Discord daily summary webhook (Task 165). Behaviour: spec §2.6.
 *
 * The webhook URL never round-trips back from the server (only `last4` does), so the
 * input is write-only: it starts empty, stays empty after a load, and is cleared again
 * after a successful save. Client-side format validation reuses the same predicate the
 * Edge function uses, so an obviously bad URL never leaves the browser.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  clearDiscordWebhook,
  getDiscordWebhookStatus,
  previewDiscordSummary,
  saveDiscordWebhook,
  testDiscordWebhook,
  type DiscordSendEdition,
  type DiscordSendStatus,
  type DiscordTestResult,
  type DiscordWebhookStatus,
} from '../../services/discordWebhook'
import {
  getDiscordAccounts,
  saveDiscordSchedule,
  type DiscordAccountsSnapshot,
  type ScheduleView,
} from '../../services/discordAccounts'
import { isDiscordWebhookUrl } from '../../../supabase/functions/stock-report/discordUrl'
import { DEFAULT_DISCORD_SCHEDULE, SCHEDULE_OPTIONS } from '../../../supabase/functions/stock-report/discordSchedule'

const EDITION_LABELS: Record<DiscordSendEdition, string> = {
  brief: '快報',
  full: '完整版',
  test: '測試',
}

const STATUS_LABELS: Record<DiscordSendStatus, string> = {
  claimed: '處理中',
  sent: '已送出',
  skipped: '略過',
  failed: '失敗',
}

const FAIL_REASON_LABELS: Record<string, string> = {
  'webhook-gone': '網址已失效',
  'rate-limited': 'Discord 限流',
  'http-error': 'Discord 回應錯誤',
  network: '連線失敗',
  'invalid-url': '網址格式不正確',
}

function testResultText(test: DiscordTestResult): string {
  if (test.ok) return '測試訊息已送出'
  const reason = FAIL_REASON_LABELS[test.reason ?? ''] ?? '未知錯誤'
  return `發送失敗（${reason}）`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function fmtAt(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW')
}

// Taipei wall-clock time for the recent-sends table, independent of the host's timezone.
function formatRecentAt(at: string, taipeiYmd: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return taipeiYmd
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

function reasonCellText(reason: string | null): string {
  if (reason === null) return '—'
  if (reason === 'no-market-day') return '非交易日或資料未到'
  if (reason === 'no-webhook') return '未設定網址'
  return FAIL_REASON_LABELS[reason] ?? reason
}

interface ScheduleOption {
  value: string
  label: string
}

/** SCHEDULE_OPTIONS for the slot, with the current server value prepended as an extra,
 * clearly-marked option when it no longer falls on the grid (spec Revision 1 R4, moved from
 * `DiscordAccountsSection.tsx` unchanged). */
function scheduleOptions(slot: 'brief' | 'full', base: string): ScheduleOption[] {
  const opts = SCHEDULE_OPTIONS[slot] as readonly string[]
  const plain = opts.map((v) => ({ value: v, label: v }))
  if (opts.includes(base)) return plain
  return [{ value: base, label: `${base}（目前設定，請改選）` }, ...plain]
}

/** The send schedule — moved here from `DiscordAccountsSection.tsx` (spec Revision 1 R4): it is a
 * site-wide setting, and that component's old home is now read-only. Same dropdowns, same
 * `saveDiscordSchedule` call, same behaviour. */
function ScheduleSection({
  schedule,
  onChange,
}: {
  schedule: ScheduleView
  onChange: (next: DiscordAccountsSnapshot) => void
}) {
  const locked = schedule.brief === null || schedule.full === null
  const baseBrief = schedule.brief ?? DEFAULT_DISCORD_SCHEDULE.brief
  const baseFull = schedule.full ?? DEFAULT_DISCORD_SCHEDULE.full

  const [briefValue, setBriefValue] = useState(baseBrief)
  const [fullValue, setFullValue] = useState(baseFull)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Resync the drafts whenever the server's schedule changes (initial load, or after a save).
  useEffect(() => {
    setBriefValue(baseBrief)
    setFullValue(baseFull)
  }, [baseBrief, baseFull])

  const briefOnGrid = (SCHEDULE_OPTIONS.brief as readonly string[]).includes(baseBrief)
  const fullOnGrid = (SCHEDULE_OPTIONS.full as readonly string[]).includes(baseFull)
  // An off-grid current value blocks saving until that particular slot is changed away from it.
  const briefStale = !briefOnGrid && briefValue === baseBrief
  const fullStale = !fullOnGrid && fullValue === baseFull
  const changed = briefValue !== baseBrief || fullValue !== baseFull
  const saveDisabled = locked || saving || briefStale || fullStale || (!changed && schedule.holdingsAligned)

  async function handleSave() {
    if (saveDisabled) return
    setMessage(null)
    setSaving(true)
    try {
      const next = await saveDiscordSchedule(briefValue, fullValue)
      onChange(next)
      setMessage('排程已儲存')
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const briefOptions = scheduleOptions('brief', baseBrief)
  const fullOptions = scheduleOptions('full', baseFull)

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">發送排程（平日・台北時間）</h3>
      </div>

      {locked && (
        <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
          找不到 Discord 排程工作，無法調整。
        </div>
      )}
      {!locked && !schedule.holdingsAligned && (
        <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
          個人持股報告的時間和快報不一致；再儲存一次排程即可對齊。
        </div>
      )}

      <div className="ai-form">
        <div className="dsc-schedule-row">
          <span>快報＋個人持股報告</span>
          <div className="field dsc-schedule-field">
            <select
              aria-label="快報與個人持股報告發送時間"
              value={briefValue}
              disabled={locked}
              onChange={(e) => setBriefValue(e.target.value)}
            >
              {briefOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="dsc-schedule-row">
          <span>經濟快報（完整版）</span>
          <div className="field dsc-schedule-field">
            <select
              aria-label="經濟快報發送時間"
              value={fullValue}
              disabled={locked}
              onChange={(e) => setFullValue(e.target.value)}
            >
              {fullOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {message && (
          <div
            className={message === '排程已儲存' ? 'notice notice-info' : 'notice notice-warn'}
            style={{ padding: '8px 12px', fontSize: 14 }}
          >
            {message}
          </div>
        )}

        <div className="ai-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saveDisabled}>
            儲存排程
          </button>
        </div>
      </div>
    </section>
  )
}

/** Fetches the schedule via the same `discord-accounts` `list` op `DiscordAccountsSection.tsx`
 * uses, and renders `ScheduleSection` once it arrives. A separate fetch from the per-account
 * status list below, matching that both are now independent read/edit surfaces. */
function GlobalScheduleBlock() {
  const [schedule, setSchedule] = useState<ScheduleView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDiscordAccounts()
      .then((next) => {
        if (cancelled) return
        setLoadError(null)
        setSchedule(next.schedule)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!schedule) {
    return (
      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">發送排程（平日・台北時間）</h3>
        </div>
        {loadError ? (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {loadError}
          </div>
        ) : (
          <p className="hint">載入中…</p>
        )}
      </section>
    )
  }

  return <ScheduleSection schedule={schedule} onChange={(next) => setSchedule(next.schedule)} />
}

export function DiscordSection() {
  const [status, setStatus] = useState<DiscordWebhookStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [formMessage, setFormMessage] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  // Single in-flight flag: 儲存/清除/測試發送 share it so a double click never sends two requests.
  const [busy, setBusy] = useState(false)
  // Recent sends are collapsed by default (moved out of the main flow in §9.2 revision 2).
  const [showRecent, setShowRecent] = useState(false)

  const load = useCallback(() => {
    getDiscordWebhookStatus()
      .then((next) => {
        setLoadError(null)
        setStatus(next)
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    if (busy) return
    const trimmed = url.trim()
    if (!isDiscordWebhookUrl(trimmed)) {
      setUrlError('網址格式不正確，需為 https://discord.com/api/webhooks/…')
      return
    }
    setUrlError(null)
    setFormMessage(null)
    setBusy(true)
    try {
      const next = await saveDiscordWebhook(trimmed)
      setStatus(next)
      setUrl('')
    } catch (err) {
      setFormMessage(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    if (busy) return
    if (!window.confirm('確定要清除 Discord Webhook？')) return
    setFormMessage(null)
    setBusy(true)
    try {
      const next = await clearDiscordWebhook()
      setStatus(next)
    } catch (err) {
      setFormMessage(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    if (busy) return
    setTestMessage(null)
    setBusy(true)
    try {
      const { status: next, test } = await testDiscordWebhook()
      setStatus(next)
      setTestMessage(testResultText(test))
    } catch (err) {
      setTestMessage(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handlePreview = async (edition: 'brief' | 'full') => {
    if (busy) return
    const label = EDITION_LABELS[edition]
    if (!window.confirm(`要把${label}的正式內容傳送到 Discord 頻道嗎？頻道成員都會看到。`)) return
    setTestMessage(null)
    setBusy(true)
    try {
      const { status: next, test, preview } = await previewDiscordSummary(edition)
      setStatus(next)
      setTestMessage(test.ok ? `預覽已送出（${label}，資料日期 ${preview.marketDate}）` : testResultText(test))
    } catch (err) {
      setTestMessage(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">全域 Webhook</h3>
        </div>

        {loadError ? (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {loadError}
          </div>
        ) : (
          <>
            <p className="hint">{status?.configured ? `已設定（…${status.last4}）` : '尚未設定'}</p>
            {status?.configured && status.updatedAt && <p className="hint">更新於 {fmtAt(status.updatedAt)}</p>}
          </>
        )}

        <div className="ai-form">
          <div className="ai-form-group">
            <label>
              Discord Webhook 網址
              <input
                type="password"
                className="ai-input"
                aria-label="Discord Webhook 網址"
                autoComplete="off"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setUrlError(null)
                }}
              />
            </label>
          </div>

          {urlError && (
            <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
              {urlError}
            </div>
          )}
          {formMessage && (
            <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
              {formMessage}
            </div>
          )}
          {testMessage && (
            <div
              className={testMessage === '測試訊息已送出' ? 'notice notice-info' : 'notice notice-warn'}
              style={{ padding: '8px 12px', fontSize: 14 }}
            >
              {testMessage}
            </div>
          )}

          <div className="ai-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void handleSave()}
              disabled={busy || url.trim() === ''}
            >
              儲存
            </button>
            {status?.configured && (
              <button type="button" className="btn btn-sm" onClick={() => void handleTest()} disabled={busy}>
                測試發送
              </button>
            )}
            {status?.configured && (
              <button type="button" className="btn btn-sm" onClick={() => void handlePreview('brief')} disabled={busy}>
                預覽快報
              </button>
            )}
            {status?.configured && (
              <button type="button" className="btn btn-sm" onClick={() => void handlePreview('full')} disabled={busy}>
                預覽完整版
              </button>
            )}
            {status?.configured && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleClear()} disabled={busy}>
                清除
              </button>
            )}
          </div>
        </div>

        {status && status.recent.length > 0 && (
          <>
            <div className="ai-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={showRecent}
                onClick={() => setShowRecent((v) => !v)}
              >
                最近發送紀錄（{status.recent.length} 筆）
              </button>
            </div>
            {showRecent && (
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>類型</th>
                      <th>狀態</th>
                      <th>HTTP</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.recent.map((row, i) => (
                      <tr key={`${row.taipeiYmd}-${row.edition}-${i}`}>
                        <td className="ast-mono">{formatRecentAt(row.at, row.taipeiYmd)}</td>
                        <td>{EDITION_LABELS[row.edition]}</td>
                        <td>{STATUS_LABELS[row.status]}</td>
                        <td>{row.httpStatus ?? '—'}</td>
                        <td>{reasonCellText(row.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <GlobalScheduleBlock />
    </>
  )
}
