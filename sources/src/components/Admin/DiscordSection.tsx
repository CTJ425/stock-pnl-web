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
  saveDiscordWebhook,
  testDiscordWebhook,
  type DiscordSendEdition,
  type DiscordSendStatus,
  type DiscordTestResult,
  type DiscordWebhookStatus,
} from '../../services/discordWebhook'
import { isDiscordWebhookUrl } from '../../../supabase/functions/stock-report/discordUrl'

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

function reasonCellText(reason: string | null): string {
  if (reason === null) return '—'
  if (reason === 'no-market-day') return '非交易日或資料未到'
  if (reason === 'no-webhook') return '未設定網址'
  return FAIL_REASON_LABELS[reason] ?? reason
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

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">Discord 每日總結</h3>
      </div>

      <p className="hint">平日 17:05 快報、21:30 完整版；當天沒有台股大盤資料時不送。</p>

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
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleClear()} disabled={busy}>
              清除
            </button>
          )}
        </div>
      </div>

      <details className="hint" style={{ marginTop: 12 }}>
        <summary>如何取得 Discord Webhook 網址</summary>
        <p>
          每日總結使用 Discord 的 Webhook，不需要建立 Bot，也不需要 API 金鑰或 Bot Token。只要在頻道建立一個
          Webhook，把它的網址貼到上面即可。
        </p>
        <ol>
          <li>
            用電腦版或網頁版 Discord 開啟要接收總結的伺服器。你需要該伺服器的「管理 Webhook」權限（伺服器擁有者與管理員預設都有）。
          </li>
          <li>在要發送的文字頻道名稱旁，點齒輪圖示「編輯頻道」。</li>
          <li>左側選單點「整合」。</li>
          <li>點「Webhook」，再點「新 Webhook」（第一次建立時按鈕可能顯示為「建立 Webhook」）。</li>
          <li>展開剛建立的 Webhook，確認「頻道」是要接收總結的頻道。名稱與頭像可以不改，訊息一律以「盤後總結」的名義送出。</li>
          <li>點「複製 Webhook 網址」。</li>
          <li>回到本頁，把網址貼到「Discord Webhook 網址」欄位，按「儲存」，再按「測試發送」確認頻道有收到訊息。</li>
        </ol>
        <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14, marginTop: 8 }}>
          <strong>安全提醒</strong>
          <ul>
            <li>Webhook 網址等同密碼：任何拿到網址的人都能在這個頻道發訊息。不要貼到聊天室、截圖，也不要提交到 GitHub。</li>
            <li>共用伺服器建議開一個專用頻道，並用頻道權限限制誰能看見與管理 Webhook。</li>
            <li>本系統只把網址存在伺服器，畫面只顯示末 4 碼，儲存後無法從這裡讀回完整網址。</li>
            <li>網址外洩時：回到 Discord 同一個畫面刪除該 Webhook，重新建立一個，再到本頁貼上新網址並儲存。</li>
          </ul>
        </div>
      </details>

      {status && status.recent.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>類型</th>
                <th>狀態</th>
                <th>HTTP</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {status.recent.map((row, i) => (
                <tr key={`${row.taipeiYmd}-${row.edition}-${i}`}>
                  <td className="ast-mono">{row.taipeiYmd}</td>
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
    </section>
  )
}
