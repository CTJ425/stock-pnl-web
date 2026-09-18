/**
 * Admin console: per-account Discord settings and the send schedule (Task 165 Phase 2 step
 * 2d, spec discord-admin-accounts.md §3.7). Mounted directly after `<DiscordSection />` on
 * the `discord` panel.
 *
 * The webhook URL never round-trips back from the server (only `last4` does), so every URL
 * input is write-only: it starts empty and is cleared again after a successful save.
 */
import { useEffect, useState } from 'react'
import {
  clearHoldingsWebhook,
  clearMarketWebhook,
  getDiscordAccounts,
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
import {
  DEFAULT_DISCORD_SCHEDULE,
  SCHEDULE_HOURS,
  scheduleMinuteOptions,
  scheduleTimeParts,
} from '../../../supabase/functions/stock-report/discordSchedule'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
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

function lastSendText(last: DiscordAccountLastSend | null): string {
  if (!last) return '—'
  return `${last.ymd} ${KIND_LABELS[last.kind]} ${STATUS_LABELS[last.status]}`
}

function sendResultText(send: DiscordAccountsSendResult): string {
  if (send.ok) return '測試訊息已送出'
  const reason = FAIL_REASON_LABELS[send.reason ?? ''] ?? '未知錯誤'
  return `發送失敗（${reason}）`
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

  const [briefHour, setBriefHour] = useState(() => scheduleTimeParts(baseBrief).hour)
  const [briefMinute, setBriefMinute] = useState(() => scheduleTimeParts(baseBrief).minute)
  const [fullHour, setFullHour] = useState(() => scheduleTimeParts(baseFull).hour)
  const [fullMinute, setFullMinute] = useState(() => scheduleTimeParts(baseFull).minute)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Resync the drafts whenever the server's schedule changes (initial load, or after a save).
  useEffect(() => {
    const brief = scheduleTimeParts(baseBrief)
    const full = scheduleTimeParts(baseFull)
    setBriefHour(brief.hour)
    setBriefMinute(brief.minute)
    setFullHour(full.hour)
    setFullMinute(full.minute)
  }, [baseBrief, baseFull])

  function changeBriefHour(hour: number) {
    const opts = scheduleMinuteOptions('brief', hour)
    setBriefHour(hour)
    setBriefMinute(opts.includes(briefMinute) ? briefMinute : opts[0])
  }

  function changeFullHour(hour: number) {
    const opts = scheduleMinuteOptions('full', hour)
    setFullHour(hour)
    setFullMinute(opts.includes(fullMinute) ? fullMinute : opts[0])
  }

  const briefHHMM = `${pad(briefHour)}:${pad(briefMinute)}`
  const fullHHMM = `${pad(fullHour)}:${pad(fullMinute)}`
  const changed = briefHHMM !== baseBrief || fullHHMM !== baseFull
  const saveDisabled = locked || saving || (!changed && schedule.holdingsAligned)

  async function handleSave() {
    if (saveDisabled) return
    setMessage(null)
    setSaving(true)
    try {
      const next = await saveDiscordSchedule(briefHHMM, fullHHMM)
      onChange(next)
      setMessage('排程已儲存')
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const briefMinuteOptions = scheduleMinuteOptions('brief', briefHour)
  const fullMinuteOptions = scheduleMinuteOptions('full', fullHour)

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">Discord 排程</h3>
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
      <p className="hint">平日（週一至週五）台北時間；快報與個人持股報告同時發送。</p>

      <div className="ai-form">
        <div className="ai-form-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>快報與個人持股報告</span>
            <select
              aria-label="快報與個人持股報告（時）"
              className="ai-input"
              style={{ width: 'auto', minWidth: 72 }}
              value={pad(briefHour)}
              disabled={locked}
              onChange={(e) => changeBriefHour(Number(e.target.value))}
            >
              {SCHEDULE_HOURS.brief.map((h) => (
                <option key={h} value={pad(h)}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label="快報與個人持股報告（分）"
              className="ai-input"
              style={{ width: 'auto', minWidth: 72 }}
              value={pad(briefMinute)}
              disabled={locked}
              onChange={(e) => setBriefMinute(Number(e.target.value))}
            >
              {briefMinuteOptions.map((m) => (
                <option key={m} value={pad(m)}>
                  {pad(m)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>經濟快報</span>
            <select
              aria-label="經濟快報（時）"
              className="ai-input"
              style={{ width: 'auto', minWidth: 72 }}
              value={pad(fullHour)}
              disabled={locked}
              onChange={(e) => changeFullHour(Number(e.target.value))}
            >
              {SCHEDULE_HOURS.full.map((h) => (
                <option key={h} value={pad(h)}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label="經濟快報（分）"
              className="ai-input"
              style={{ width: 'auto', minWidth: 72 }}
              value={pad(fullMinute)}
              disabled={locked}
              onChange={(e) => setFullMinute(Number(e.target.value))}
            >
              {fullMinuteOptions.map((m) => (
                <option key={m} value={pad(m)}>
                  {pad(m)}
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
    <div role="region" aria-label={`${label} 的 Discord 設定`} className="ai-form">
      <div>
        <h4>經濟快報</h4>
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

        {marketMode === 'inherit' && <p className="hint">會送到全域頻道，不另外發送。</p>}

        {marketMode === 'custom' && (
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
            <div className="ai-actions">
              <button type="button" className="btn btn-sm" onClick={() => void handleMarketSave()} disabled={marketBusy}>
                儲存經濟快報網址
              </button>
              {account.market.custom && (
                <button type="button" className="btn btn-sm" onClick={() => void handleMarketTest()} disabled={marketBusy}>
                  測試經濟快報
                </button>
              )}
            </div>
          </div>
        )}

        {marketMessage && (
          <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
            {marketMessage}
          </div>
        )}
      </div>

      <div>
        <h4>個人持股報告</h4>
        <p className="hint">不提供繼承全域：持股屬個人資料，不會送到共用頻道。</p>

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
          <div className="ai-actions">
            <button type="button" className="btn btn-sm" onClick={() => void handleHoldingsSave()} disabled={holdingsBusy}>
              儲存持股報告網址
            </button>
          </div>
        </div>

        {account.holdings.configured && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                aria-label="每個交易日推送個人持股報告"
                aria-pressed={account.holdings.enabled}
                className={account.holdings.enabled ? 'adm-toggle on' : 'adm-toggle'}
                onClick={() => void handleHoldingsToggle()}
                disabled={holdingsBusy}
              />
              <span>每個交易日推送</span>
            </div>
            <div className="ai-actions">
              <button type="button" className="btn btn-sm" onClick={() => void handleHoldingsTest()} disabled={holdingsBusy}>
                測試持股報告
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleHoldingsClear()} disabled={holdingsBusy}>
                清除持股報告網址
              </button>
            </div>
          </>
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
  const [openUserId, setOpenUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDiscordAccounts()
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

  if (!data) {
    return (
      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">Discord 排程與各帳號設定</h3>
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

  const openAccount = data.accounts.find((acc) => acc.userId === openUserId) ?? null

  return (
    <>
      <ScheduleSection schedule={data.schedule} onChange={setData} />

      <section className="section glass adm-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">各帳號 Discord 設定</h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>經濟快報</th>
                <th>個人持股報告</th>
                <th>上次發送</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((acc) => {
                const label = acc.email ?? '（無 Email）'
                return (
                  <tr key={acc.userId}>
                    <td>{label}</td>
                    <td>{acc.market.custom ? `自訂 …${acc.market.last4}` : '繼承全域'}</td>
                    <td>
                      {acc.holdings.configured
                        ? `…${acc.holdings.last4} ${acc.holdings.enabled ? '推送中' : '已暫停'}`
                        : '未設定'}
                    </td>
                    <td>{lastSendText(acc.lastSend)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`編輯 ${label}`}
                        aria-expanded={openUserId === acc.userId}
                        onClick={() => setOpenUserId(acc.userId)}
                      >
                        編輯
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {openAccount && <AccountEditor key={openAccount.userId} account={openAccount} onChange={setData} />}
      </section>
    </>
  )
}
