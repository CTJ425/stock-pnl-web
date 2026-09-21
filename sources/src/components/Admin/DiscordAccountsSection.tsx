/**
 * Admin console: per-account Discord status (Task 165 step 2e Revision 1, spec
 * discord-user-self-service.md §Revision 1 R3). Every account now manages its own webhooks
 * through `Settings/DiscordMySettings.tsx` — this block is read-only: who has configured what,
 * and each account's last send. No inputs, no toggles, no test buttons. The send schedule is not
 * here either, and is no longer anywhere in the admin console: each account owns its own times
 * (Task 165 step 2g, spec discord-admin-slim.md D1). The two global cron times survive as the
 * inherited default and are changed at the database, not from a screen (D2).
 */
import { useEffect, useState } from 'react'
import {
  getDiscordAccounts,
  type DiscordAccountLastSend,
  type DiscordAccountRow,
  type DiscordAccountsSnapshot,
} from '../../services/discordAccounts'

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

function lastSendText(last: DiscordAccountLastSend | null): string {
  if (!last) return '—'
  return `${last.ymd} ${KIND_LABELS[last.kind]} ${STATUS_LABELS[last.status]}`
}

function marketStatusText(market: DiscordAccountRow['market']): string {
  if (!market.custom) return '繼承'
  return market.enabled ? '自訂・推送中' : '自訂・已暫停'
}

function holdingsStatusText(holdings: DiscordAccountRow['holdings']): string {
  if (!holdings.configured) return '未設定'
  return holdings.enabled ? '已設定・推送中' : '已設定・已暫停'
}

export function DiscordAccountsSection() {
  const [data, setData] = useState<DiscordAccountsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  return (
    <section className="section glass adm-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">各帳號狀態</h3>
      </div>

      {loadError && (
        <div className="notice notice-warn" style={{ padding: '8px 12px', fontSize: 14 }}>
          {loadError}
        </div>
      )}
      {!data && !loadError && <p className="hint">載入中…</p>}

      {data && (
        <div className="table-scroll">
          <table className="data-table dsc-account-table">
            <thead>
              <tr>
                <th>帳號</th>
                <th>經濟快報</th>
                <th>個人持股</th>
                <th>最近發送</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((acc) => (
                <tr key={acc.userId}>
                  <td>{acc.email ?? '（無 Email）'}</td>
                  <td>{marketStatusText(acc.market)}</td>
                  <td>{holdingsStatusText(acc.holdings)}</td>
                  <td>{lastSendText(acc.lastSend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
