/**
 * Admin console: per-account Discord settings and the send schedule (Task 165 Phase 2 step
 * 2d revision 2, spec discord-admin-accounts.md §9.2, overriding §3.7 where they differ).
 * Mounted between `<DiscordSection />` and `<DiscordHelpSection />` on the `discord` panel.
 *
 * The webhook URL never round-trips back from the server (only `last4` does), so every URL
 * input is write-only: it starts empty and is cleared again after a successful save.
 */
import { useEffect, useState } from 'react'
import {
  clearHoldingsWebhook,
  clearMarketWebhook,
  getDiscordAccounts,
  previewHoldingsReport,
  saveDiscordSchedule,
  saveHoldingsWebhook,
  saveMarketWebhook,
  setHoldingsEnabled,
  testHoldingsWebhook,
  testMarketWebhook,
  type DiscordAccountLastSend,
  type DiscordAccountRow,
  type DiscordAccountsSendResult,
  type DiscordAccountsSnapshot,
  type ScheduleView,
} from '../../services/discordAccounts'
import { isDiscordWebhookUrl } from '../../../supabase/functions/stock-report/discordUrl'
import { DEFAULT_DISCORD_SCHEDULE, SCHEDULE_OPTIONS } from '../../../supabase/functions/stock-report/discordSchedule'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const KIND_LABELS: Record<DiscordAccountLastSend['kind'], string> = {
  daily: '持股日報',
  market: '經濟快報',
  preview: '預覽',
  test: '測試',
}

const STATUS_LABELS: Record<DiscordAccountLastSend['status'], string> = {
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

function lastSendLine(last: DiscordAccountLastSend | null): string {
  if (!last) return '上次發送：—'
  return `上次發送：${last.ymd} ${KIND_LABELS[last.kind]} ${STATUS_LABELS[last.status]}`
}

function sendResultText(send: DiscordAccountsSendResult): string {
  if (send.ok) return '測試訊息已送出'
  const reason = FAIL_REASON_LABELS[send.reason ?? ''] ?? '未知錯誤'
  return `發送失敗（${reason}）`
}

/** Left-hand nav status: `繼承|自訂・推送中|已暫停|未設定`. Spec §9.2. */
function statusLine(acc: DiscordAccountRow): string {
  const market = acc.market.custom ? '自訂' : '繼承'
  const holdings = !acc.holdings.configured ? '未設定' : acc.holdings.enabled ? '推送中' : '已暫停'
  return `${market}・${holdings}`
}

function marketStatusText(market: DiscordAccountRow['market']): string {
  return market.custom ? `目前：自訂 …${market.last4}` : '目前：繼承全域（不另外發送）'
}

function holdingsStatusText(holdings: DiscordAccountRow['holdings']): string {
  return holdings.configured ? `目前：…${holdings.last4}` : '目前：未設定'
}

interface ScheduleOption {
  value: string
  label: string
}

/** SCHEDULE_OPTIONS for the slot, with the current server value prepended as an extra,
 * clearly-marked option when it no longer falls on the grid (spec §9.2). */
function scheduleOptions(slot: 'brief' | 'full', base: string): ScheduleOption[] {
  const opts = SCHEDULE_OPTIONS[slot] as readonly string[]
  const plain = opts.map((v) => ({ value: v, label: v }))
  if (opts.includes(base)) return plain
  return [{ value: base, label: `${base}（目前設定，請改選）` }, ...plain]
}

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

function AccountEditor({
  account,
  onChange,
}: {
  account: DiscordAccountRow
  onChange: (next: DiscordAccountsSnapshot) => void
}) {
  const label = account.email ?? '（無 Email）'

  const [marketMode, setMarketMode] = useState<'inherit' | 'custom'>(account.market.custom ? 'custom' : 'inherit')
  const [marketUrl, setMarketUrl] = useState('')
  const [marketMessage, setMarketMessage] = useState<string | null>(null)
  const [marketBusy, setMarketBusy] = useState(false)

  const [holdingsUrl, setHoldingsUrl] = useState('')
  const [holdingsMessage, setHoldingsMessage] = useState<string | null>(null)
  const [holdingsBusy, setHoldingsBusy] = useState(false)

  async function handleMarketSwitchToInherit() {
    if (marketBusy) return
    if (!window.confirm('改回繼承全域？這個帳號的自訂網址會被刪除。')) return
    setMarketMessage(null)
    setMarketBusy(true)
    try {
      const next = await clearMarketWebhook(account.userId)
      onChange(next)
      setMarketMode('inherit')
      setMarketUrl('')
    } catch (err) {
      setMarketMessage(errorMessage(err))
    } finally {
      setMarketBusy(false)
    }
  }

  function handleMarketSwitchToCustom() {
    setMarketMessage(null)
    setMarketMode('custom')
  }

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
      const next = await saveMarketWebhook(account.userId, trimmed)
      onChange(next)
      setMarketUrl('')
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
      const next = await testMarketWebhook(account.userId)
      onChange({ schedule: next.schedule, accounts: next.accounts })
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
      const next = await saveHoldingsWebhook(account.userId, trimmed)
      onChange(next)
      setHoldingsUrl('')
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  async function handleHoldingsToggle() {
    if (holdingsBusy) return
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await setHoldingsEnabled(account.userId, !account.holdings.enabled)
      onChange(next)
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
      const next = await testHoldingsWebhook(account.userId)
      onChange({ schedule: next.schedule, accounts: next.accounts })
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
      const next = await previewHoldingsReport(account.userId)
      onChange({ schedule: next.schedule, accounts: next.accounts })
      if (next.send?.ok && next.previewYmd) {
        setHoldingsMessage(`已送出完整持股報告（資料日 ${next.previewYmd}）`)
      } else if (next.send) {
        setHoldingsMessage(sendResultText(next.send))
      }
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  async function handleHoldingsClear() {
    if (holdingsBusy) return
    if (!window.confirm('清除這個帳號的個人持股報告網址？')) return
    setHoldingsMessage(null)
    setHoldingsBusy(true)
    try {
      const next = await clearHoldingsWebhook(account.userId)
      onChange(next)
    } catch (err) {
      setHoldingsMessage(errorMessage(err))
    } finally {
      setHoldingsBusy(false)
    }
  }

  return (
    <div role="region" aria-label={`${label} 的 Discord 設定`} className="dsc-detail-card">
      <h4>{label}</h4>
      <p className="hint">{lastSendLine(account.lastSend)}</p>

      <div className="dsc-block">
        <h5 className="dsc-block-title">經濟快報</h5>
        <p className="hint">{marketStatusText(account.market)}</p>

        <div className="dsc-radio-row">
          <label>
            <input
              type="radio"
              name={`market-${account.userId}`}
              checked={marketMode === 'inherit'}
              disabled={marketBusy}
              onChange={() => void handleMarketSwitchToInherit()}
            />
            繼承全域
          </label>
          <label>
            <input
              type="radio"
              name={`market-${account.userId}`}
              checked={marketMode === 'custom'}
              disabled={marketBusy}
              onChange={handleMarketSwitchToCustom}
            />
            自訂 Webhook
          </label>
        </div>

        {marketMode === 'custom' && (
          <>
            <div className="ai-form-group">
              <label>經濟快報 Webhook 網址</label>
              <input
                type="password"
                className="ai-input"
                aria-label="經濟快報 Webhook 網址"
                autoComplete="off"
                value={marketUrl}
                onChange={(e) => setMarketUrl(e.target.value)}
              />
            </div>
            <div className="ai-actions">
              <button type="button" className="btn btn-sm" onClick={() => void handleMarketSave()} disabled={marketBusy}>
                儲存經濟快報網址
              </button>
              {account.market.custom && (
                <button type="button" className="btn btn-sm" onClick={() => void handleMarketTest()} disabled={marketBusy}>
                  測試經濟快報連線
                </button>
              )}
            </div>
          </>
        )}

        {marketMessage && (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {marketMessage}
          </div>
        )}
      </div>

      <div className="dsc-block">
        <h5 className="dsc-block-title">個人持股報告</h5>
        <p className="hint">{holdingsStatusText(account.holdings)}</p>

        <div className="ai-form-group">
          <label>個人持股報告 Webhook 網址</label>
          <input
            type="password"
            className="ai-input"
            aria-label="個人持股報告 Webhook 網址"
            autoComplete="off"
            value={holdingsUrl}
            onChange={(e) => setHoldingsUrl(e.target.value)}
          />
        </div>

        <div className="ai-actions">
          <button type="button" className="btn btn-sm" onClick={() => void handleHoldingsSave()} disabled={holdingsBusy}>
            儲存持股報告網址
          </button>
        </div>

        {account.holdings.configured && (
          <div className="dsc-toggle-row">
            <button
              type="button"
              aria-label="每個交易日推送個人持股報告"
              aria-pressed={account.holdings.enabled}
              className={account.holdings.enabled ? 'adm-toggle on' : 'adm-toggle'}
              onClick={() => void handleHoldingsToggle()}
              disabled={holdingsBusy}
            />
            <span>每日推送</span>
          </div>
        )}

        {account.holdings.configured && (
          <div className="ai-actions dsc-holdings-actions">
            <button type="button" className="btn btn-sm" onClick={() => void handleHoldingsTest()} disabled={holdingsBusy}>
              測試持股報告連線
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void handleHoldingsPreview()} disabled={holdingsBusy}>
              完整推送測試
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleHoldingsClear()} disabled={holdingsBusy}>
              清除持股報告網址
            </button>
          </div>
        )}

        {holdingsMessage && (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {holdingsMessage}
          </div>
        )}
      </div>
    </div>
  )
}

export function DiscordAccountsSection() {
  const [data, setData] = useState<DiscordAccountsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDiscordAccounts()
      .then((next) => {
        if (cancelled) return
        setLoadError(null)
        setData(next)
        setSelectedUserId(next.accounts[0]?.userId ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!data) {
    return (
      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">各帳號設定與發送排程</h3>
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

  const selected = data.accounts.find((acc) => acc.userId === selectedUserId) ?? data.accounts[0] ?? null

  return (
    <>
      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">各帳號設定</h3>
        </div>
        <div className="dsc-master-detail">
          <nav aria-label="帳號清單" className="dsc-account-nav">
            {data.accounts.map((acc) => {
              const accLabel = acc.email ?? '（無 Email）'
              const isCurrent = selected?.userId === acc.userId
              return (
                <button
                  key={acc.userId}
                  type="button"
                  className={isCurrent ? 'adm-side-item active' : 'adm-side-item'}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => setSelectedUserId(acc.userId)}
                >
                  <span className="dsc-account-email">{accLabel}</span>
                  <span className="dsc-account-status hint">{statusLine(acc)}</span>
                </button>
              )
            })}
          </nav>
          {selected && <AccountEditor key={selected.userId} account={selected} onChange={setData} />}
        </div>
      </section>

      <ScheduleSection schedule={data.schedule} onChange={setData} />
    </>
  )
}
