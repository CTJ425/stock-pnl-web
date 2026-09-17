/**
 * Per-user Discord holdings card settings (Task 165 Phase 2). Spec §2.7.
 *
 * The webhook URL never round-trips back from the server (only `last4` does), so the
 * input is write-only: it starts empty and is cleared again after a successful save.
 */
import { useEffect, useState } from 'react'
import {
  clearHoldingsWebhook,
  getHoldingsPush,
  previewHoldings,
  saveHoldingsWebhook,
  setHoldingsPushEnabled,
  testHoldingsWebhook,
  type HoldingsLastSend,
  type HoldingsPushStatus,
  type HoldingsSendResult,
} from '../../services/discordHoldings'

const WARNING =
  '卡片會顯示完整的股數、成本與損益金額。請使用只有你看得到的私人頻道 Webhook；貼到共用頻道，頻道裡所有人都會看到。'

const KIND_LABELS: Record<HoldingsLastSend['kind'], string> = {
  daily: '每日',
  preview: '預覽',
  test: '測試',
}

const STATUS_LABELS: Record<HoldingsLastSend['status'], string> = {
  claimed: '處理中',
  sent: '已送出',
  skipped: '略過',
  failed: '失敗',
}

/** Known failure reason codes, shared by the last-send history line and the immediate
 * test/preview result — the two contexts differ only in their fallback for an unknown code. */
const REASON_LABELS: Record<string, string> = {
  'webhook-gone': '網址已失效',
  'rate-limited': 'Discord 限流',
  'http-error': 'Discord 回應錯誤',
  network: '連線失敗',
  'invalid-url': '網址格式不正確',
  'no-holdings': '無持股',
  exception: '系統錯誤',
}

/** History line: an unrecognised code is shown as-is. */
function historyReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason
}

/** Immediate send result: an unrecognised code becomes 未知錯誤. */
function sendFailReasonLabel(reason: string | undefined): string {
  return (reason !== undefined ? REASON_LABELS[reason] : undefined) ?? '未知錯誤'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function httpText(status: number | null): string {
  return status == null ? '--' : String(status)
}

function mmdd(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${m}/${d}`
}

// Taipei wall-clock time for the last-send line, independent of the host's timezone.
function formatTaipei(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

function lastSendText(last: HoldingsLastSend | null): string {
  if (!last) return '上次發送：尚無紀錄'
  const base = `上次發送：${formatTaipei(last.at)}・${KIND_LABELS[last.kind]}・${STATUS_LABELS[last.status]}`
  return last.reason ? `${base}（${historyReasonLabel(last.reason)}）` : base
}

function testResultText(send: HoldingsSendResult): string {
  return send.ok
    ? `測試發送成功（HTTP ${httpText(send.httpStatus)}）`
    : `測試發送失敗（HTTP ${httpText(send.httpStatus)}：${sendFailReasonLabel(send.reason)}）`
}

function previewResultText(send: HoldingsSendResult, previewYmd: string): string {
  return send.ok
    ? `已送出 ${mmdd(previewYmd)} 的持股預覽（HTTP ${httpText(send.httpStatus)}）`
    : `預覽發送失敗（HTTP ${httpText(send.httpStatus)}：${sendFailReasonLabel(send.reason)}）`
}

const EMPTY_STATUS: HoldingsPushStatus = { configured: false, last4: null, enabled: false, lastSend: null }

export function DiscordPushSection() {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<HoldingsPushStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  // Only the test/preview result can fail while still producing a message; save/clear/toggle
  // results are always the success (ok) styling.
  const [messageOk, setMessageOk] = useState(true)

  useEffect(() => {
    let cancelled = false
    getHoldingsPush()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(errorMessage(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <section>載入中…</section>

  const s = status ?? EMPTY_STATUS

  async function runAction<T>(action: () => Promise<T>, apply: (result: T) => void): Promise<void> {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      apply(await action())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () =>
    runAction(
      () => saveHoldingsWebhook(url.trim()),
      (next) => {
        setStatus(next)
        setUrl('')
        setMessageOk(true)
        setMessage('已儲存 Webhook')
      },
    )

  const handleClear = () =>
    runAction(
      () => clearHoldingsWebhook(),
      (next) => {
        setStatus(next)
        setMessageOk(true)
        setMessage('已清除 Webhook，推播已關閉')
      },
    )

  const handleToggle = (next: boolean) =>
    runAction(
      () => setHoldingsPushEnabled(next),
      (result) => {
        setStatus(result)
        setMessageOk(true)
        setMessage(next ? '已開啟每日推播' : '已關閉每日推播')
      },
    )

  const handleTest = () =>
    runAction(
      () => testHoldingsWebhook(),
      ({ status: next, send }) => {
        setStatus(next)
        setMessageOk(send.ok)
        setMessage(testResultText(send))
      },
    )

  const handlePreview = () =>
    runAction(
      () => previewHoldings(),
      ({ status: next, send, previewYmd }) => {
        setStatus(next)
        setMessageOk(send.ok)
        setMessage(previewResultText(send, previewYmd))
      },
    )

  const trimmed = url.trim()

  return (
    <section>
      <p className="hint">{s.configured ? `狀態：已設定（…${s.last4}）` : '狀態：未設定'}</p>
      <p className="notice notice-warn">{WARNING}</p>

      <ol aria-label="設定步驟" className="hint">
        <li>在 Discord 頻道設定 → 整合 → Webhook 開啟設定。</li>
        <li>建立一個新 Webhook 並複製它的網址。</li>
        <li>把網址貼到下方欄位，按「儲存」後，按「測試發送」確認頻道有收到訊息。</li>
      </ol>

      {error && <div role="alert" className="notice notice-error">{error}</div>}
      {message && (
        <div role="status" className={messageOk ? 'notice notice-ok' : 'notice notice-warn'}>
          {message}
        </div>
      )}

      <div className="ai-form">
        <div className="ai-form-group">
          <label>
            Discord Webhook 網址
            <input
              type="password"
              className="ai-input"
              autoComplete="off"
              aria-label="Discord Webhook 網址"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
        </div>
        <div className="ai-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void handleSave()}
            disabled={busy || trimmed === ''}
          >
            儲存
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => void handleClear()}
            disabled={busy || !s.configured}
          >
            清除
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label="每個交易日 17:15 推送持股日報"
          className={s.enabled ? 'adm-toggle on' : 'adm-toggle'}
          disabled={busy || !s.configured}
          onClick={() => void handleToggle(!s.enabled)}
        />
        <span>每個交易日 17:15 推送持股日報</span>
      </div>

      <div className="ai-actions">
        <button type="button" className="btn btn-sm" onClick={() => void handleTest()} disabled={busy || !s.configured}>
          測試發送
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void handlePreview()}
          disabled={busy || !s.configured}
        >
          預覽今日持股
        </button>
      </div>

      <p className="hint">{lastSendText(s.lastSend)}</p>
    </section>
  )
}
