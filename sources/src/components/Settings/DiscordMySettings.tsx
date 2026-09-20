/**
 * Self-service Discord settings for the signed-in account (Task 165 step 2e, spec
 * discord-user-self-service.md §6.2). Mirrors the per-account card in
 * `Admin/DiscordAccountsSection.tsx`, scoped to the caller only — no admin gate, and no
 * `userId` ever leaves this component (the Edge Function derives it from the JWT, spec §7).
 *
 * The webhook URL never round-trips back from the server (only `last4` does), so every URL
 * input is write-only: it starts empty and is cleared again after a successful save. Both
 * test buttons and both 啟用 toggles stay disabled until the corresponding URL is stored
 * (spec D6) — the save button is the only path to a stored URL.
 */
import { useEffect, useState } from 'react'
import {
  clearMyHoldingsWebhook,
  clearMyMarketWebhook,
  getDiscordMySettings,
  previewMyHoldingsReport,
  saveMyHoldingsWebhook,
  saveMyMarketWebhook,
  testMyHoldingsWebhook,
  testMyMarketWebhook,
  toggleMyHoldingsEnabled,
  toggleMyMarketEnabled,
  type DiscordMySettingsResult,
  type DiscordMySettingsSendResult,
  type DiscordMySettingsStatus,
} from '../../services/discordMySettings'
import { isDiscordWebhookUrl } from '../../../supabase/functions/stock-report/discordUrl'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const FAIL_REASON_LABELS: Record<string, string> = {
  'webhook-gone': '網址已失效',
  'rate-limited': 'Discord 限流',
  'http-error': 'Discord 回應錯誤',
  network: '連線失敗',
  'invalid-url': '網址格式不正確',
}

function sendResultText(send: DiscordMySettingsSendResult): string {
  if (send.ok) return '測試訊息已送出'
  const reason = FAIL_REASON_LABELS[send.reason ?? ''] ?? '未知錯誤'
  return `發送失敗（${reason}）`
}

/** Spec Revision 1 — two lines so the global and per-account channels are never confused. */
function globalStatusText(global: DiscordMySettingsStatus['global']): string {
  return global.configured
    ? `全域頻道：已設定 …${global.last4} — 你會在共用頻道收到`
    : '全域頻道：管理員尚未設定，目前沒有人收得到'
}

function myMarketStatusText(market: DiscordMySettingsStatus['market']): string {
  if (!market.configured) return '我的頻道：未設定（不另外發送）'
  return market.enabled ? `我的頻道：…${market.last4}（推送中）` : `我的頻道：…${market.last4}（已暫停）`
}

function holdingsStatusText(last4: string | null): string {
  return last4 !== null ? `目前：…${last4}` : '目前：未設定'
}

export function DiscordMySettings() {
  const [data, setData] = useState<DiscordMySettingsResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [marketUrl, setMarketUrl] = useState('')
  const [marketMessage, setMarketMessage] = useState<string | null>(null)
  const [marketBusy, setMarketBusy] = useState(false)

  const [holdingsUrl, setHoldingsUrl] = useState('')
  const [holdingsMessage, setHoldingsMessage] = useState<string | null>(null)
  const [holdingsBusy, setHoldingsBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDiscordMySettings()
      .then((next) => {
        if (cancelled) return
        setLoadError(null)
        setData(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleMarketSave() {
    if (marketBusy) return
    const trimmed = marketUrl.trim()
    if (!isDiscordWebhookUrl(trimmed)) {
      setMarketMessage('網址格式不正確')
      return
    }
    setMarketMessage(null)
    setMarketBusy(true)
    try {
      const next = await saveMyMarketWebhook(trimmed)
      setData(next)
      setMarketUrl('')
    } catch (err) {
      setMarketMessage(errorMessage(err))
    } finally {
      setMarketBusy(false)
    }
  }

  async function handleMarketClear() {
    if (marketBusy) return
    if (!window.confirm('清除經濟快報網址？這個帳號將改回接收全域頻道內容。')) return
    setMarketMessage(null)
    setMarketBusy(true)
    try {
      const next = await clearMyMarketWebhook()
      setData(next)
      setMarketUrl('')
    } catch (err) {
      setMarketMessage(errorMessage(err))
    } finally {
      setMarketBusy(false)
    }
  }

  async function handleMarketToggle() {
    if (marketBusy || !data || !data.status.market.configured) return
    setMarketMessage(null)
    setMarketBusy(true)
    try {
      const next = await toggleMyMarketEnabled(!data.status.market.enabled)
      setData(next)
    } catch (err) {
      setMarketMessage(errorMessage(err))
    } finally {
      setMarketBusy(false)
    }
  }

  async function handleMarketTest() {
    if (marketBusy) return
    setMarketMessage(null)
    setMarketBusy(true)
    try {
      const next = await testMyMarketWebhook()
      setData(next)
      if (next.send) setMarketMessage(sendResultText(next.send))
    } catch (err) {
      setMarketMessage(errorMessage(err))
    } finally {
      setMarketBusy(false)
    }
  }

  async function handleHoldingsSave() {
    if (holdingsBusy) return
    const trimmed = holdingsUrl.trim()
    if (!isDiscordWebhookUrl(trimmed)) {
      setHoldingsMessage('網址格式不正確')
      return
    }
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await saveMyHoldingsWebhook(trimmed)
      setData(next)
      setHoldingsUrl('')
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  async function handleHoldingsClear() {
    if (holdingsBusy) return
    if (!window.confirm('清除個人持股報告網址？')) return
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await clearMyHoldingsWebhook()
      setData(next)
      setHoldingsUrl('')
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  async function handleHoldingsToggle() {
    if (holdingsBusy || !data || !data.status.holdings.configured) return
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await toggleMyHoldingsEnabled(!data.status.holdings.enabled)
      setData(next)
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  async function handleHoldingsTest() {
    if (holdingsBusy) return
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await testMyHoldingsWebhook()
      setData(next)
      if (next.send) setHoldingsMessage(sendResultText(next.send))
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  async function handleHoldingsPreview() {
    if (holdingsBusy) return
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await previewMyHoldingsReport()
      setData(next)
      if (next.send?.ok && next.previewYmd) {
        const suffix = next.missingQuotes && next.missingQuotes > 0 ? `，${next.missingQuotes} 檔無報價` : ''
        setHoldingsMessage(`已送出完整持股報告（資料日 ${next.previewYmd}${suffix}）`)
      } else if (next.send) {
        setHoldingsMessage(sendResultText(next.send))
      }
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  if (!data) {
    return (
      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">Discord 通知設定</h3>
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

  const marketUrlStored = data.status.market.configured
  const holdingsUrlStored = data.status.holdings.configured

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">Discord 通知設定</h3>
      </div>

      <div className="dsc-block">
        <h5 className="dsc-block-title">經濟快報</h5>
        <p className="hint">{globalStatusText(data.status.global)}</p>
        <p className="hint">{myMarketStatusText(data.status.market)}</p>

        <div className="ai-form-group">
          <label>
            經濟快報 Webhook 網址
            <input
              type="password"
              className="ai-input"
              aria-label="經濟快報 Webhook 網址"
              autoComplete="off"
              value={marketUrl}
              onChange={(e) => setMarketUrl(e.target.value)}
            />
          </label>
        </div>

        <div className="ai-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            aria-label="儲存經濟快報網址"
            onClick={() => void handleMarketSave()}
            disabled={marketBusy}
          >
            儲存
          </button>
          {marketUrlStored && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              aria-label="清除經濟快報網址"
              onClick={() => void handleMarketClear()}
              disabled={marketBusy}
            >
              清除
            </button>
          )}
          {marketUrlStored && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleMarketTest()}
              disabled={marketBusy}
            >
              測試經濟快報連線
            </button>
          )}
        </div>

        {/* Inheriting the global channel is not something this app can switch on or test: the post
            goes to the admin's shared channel, and whether you see it depends on your Discord
            membership, not on app state. So the switch and the test button are absent until this
            account has a channel of its own — a control that can never fire reads as broken. */}
        {marketUrlStored ? (
          <div className="dsc-toggle-row">
            <button
              type="button"
              aria-label="啟用經濟快報"
              aria-pressed={data.status.market.enabled}
              className={data.status.market.enabled ? 'adm-toggle on' : 'adm-toggle'}
              onClick={() => void handleMarketToggle()}
              disabled={marketBusy}
            />
            <span>啟用</span>
          </div>
        ) : (
          <p className="hint">要在自己的頻道也收到一份，請在上方設定 Webhook 網址。</p>
        )}

        {marketMessage && (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {marketMessage}
          </div>
        )}
      </div>

      <div className="dsc-block">
        <h5 className="dsc-block-title">個人持股報告</h5>
        <p className="hint">{holdingsStatusText(data.status.holdings.last4)}</p>

        <div className="ai-form-group">
          <label>
            個人持股報告 Webhook 網址
            <input
              type="password"
              className="ai-input"
              aria-label="個人持股報告 Webhook 網址"
              autoComplete="off"
              value={holdingsUrl}
              onChange={(e) => setHoldingsUrl(e.target.value)}
            />
          </label>
        </div>

        <div className="ai-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            aria-label="儲存持股報告網址"
            onClick={() => void handleHoldingsSave()}
            disabled={holdingsBusy}
          >
            儲存
          </button>
          {holdingsUrlStored && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              aria-label="清除持股報告網址"
              onClick={() => void handleHoldingsClear()}
              disabled={holdingsBusy}
            >
              清除
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleHoldingsTest()}
            disabled={holdingsBusy || !holdingsUrlStored}
          >
            測試持股報告連線
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleHoldingsPreview()}
            disabled={holdingsBusy || !holdingsUrlStored}
          >
            完整推送測試
          </button>
        </div>

        <div className="dsc-toggle-row">
          <button
            type="button"
            aria-label="啟用個人持股報告"
            aria-pressed={data.status.holdings.enabled}
            className={data.status.holdings.enabled ? 'adm-toggle on' : 'adm-toggle'}
            onClick={() => void handleHoldingsToggle()}
            disabled={holdingsBusy || !holdingsUrlStored}
          />
          <span>啟用</span>
        </div>

        {holdingsMessage && (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {holdingsMessage}
          </div>
        )}
      </div>
    </section>
  )
}
