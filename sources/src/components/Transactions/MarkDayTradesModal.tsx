/**
 * Label the 現股當沖 round trips a broker export recorded as ordinary trades (BUG-089).
 *
 * Why a wizard and not a silent fix: `computeLedger` already nets a day trade out before the
 * moving average sees it, but only when a leg of that date carries `tx_nature === 'DAY_TRADE'`.
 * An export without the label leaves that mechanism switched off, and the day trade's profit then
 * lands in 持股成本 *and* in 已實現損益 at once. The proposal comes from the fee the broker
 * actually charged (`hasDayTradeFeeSignature`), not from "there was a buy and a sell that day",
 * so the list is evidence — but it still changes how a trade is classified, which is the user's
 * call to confirm, exactly like `RecalcFeesModal`.
 */
import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { Modal } from '../Common/Modal'
import { useToast } from '../Common/Toast'
import { proposeDayTradeLabels } from '../../utils/fees'
import { getFeeRateOn, getMinFee } from '../../utils/settings'
import type { TxUpdate } from '../../services/dataProvider'
import { runBatchApply } from './batchUpdate'

export function MarkDayTradesModal({ onClose }: { onClose: () => void }) {
  const { current, transactions, updateTransactionsBatch } = useWorkspace()
  const { show } = useToast()
  const workspaceId = current?.id
  const minFeeWhole = getMinFee('whole', workspaceId)
  const minFeeOdd = getMinFee('odd', workspaceId)
  // Task 182: the signature is checked against the rate in force on the trade's own date, or a
  // workspace that renegotiated its discount would stop recognising its own older day trades.
  const rateFor = useCallback((txDate: string) => getFeeRateOn(txDate, workspaceId), [workspaceId])

  const proposals = useMemo(
    () => proposeDayTradeLabels(transactions, { rateFor, minFeeWhole, minFeeOdd }),
    [transactions, rateFor, minFeeWhole, minFeeOdd],
  )
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(proposals.map((p) => p.sell.id)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setChecked((prev) =>
      prev.size === proposals.length ? new Set() : new Set(proposals.map((p) => p.sell.id)),
    )
  }

  const apply = async () => {
    if (busy) return
    const updates: TxUpdate[] = proposals
      .filter((p) => checked.has(p.sell.id))
      .flatMap((p) => [p.sell, ...p.buys])
      // price / qty / fee_tax are sent unchanged: this wizard only reclassifies, it never
      // re-prices. The recorded fee already carries the halved tax — that is what identified it.
      .map((tx) => ({
        id: tx.id,
        price: tx.price,
        qty: tx.qty,
        fee_tax: tx.fee_tax,
        fee_rate: tx.fee_rate ?? null,
        tx_nature: 'DAY_TRADE' as const,
      }))
    const ok = await runBatchApply(updateTransactionsBatch, updates, setBusy, setError)
    if (!ok) return
    show(`已標記 ${updates.length} 筆為當沖`)
    onClose()
  }

  const selectedLegs = proposals
    .filter((p) => checked.has(p.sell.id))
    .reduce((sum, p) => sum + 1 + p.buys.length, 0)

  return (
    <Modal title="標記當沖交易" onClose={onClose} wide disableBackdropClose>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        下面這些賣出的證交稅只收了一半，那是現股當沖才有的收法，所以它們幾乎可以確定是當沖，
        而且當天都有買進足夠的股數可以賣。標記之後，這些買賣會先互相沖銷再算成本，
        <strong>持股成本和已實現損益都會跟著變</strong>，和券商 App 對得起來。
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {proposals.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 0' }}>
          <CheckCircle2 size={28} style={{ marginBottom: 8 }} />
          <div>沒有找到漏標的當沖交易。</div>
        </div>
      ) : (
        <>
          <div className="table-scroll" style={{ maxHeight: '48vh', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="全選"
                      checked={checked.size === proposals.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th scope="col">日期</th>
                  <th scope="col">代號</th>
                  <th scope="col" className="num">買進</th>
                  <th scope="col" className="num">賣出</th>
                  <th scope="col" className="num">股數</th>
                  <th scope="col" className="num">這筆賣出收的費用</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.sell.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`選取 ${p.sell.tx_date} ${p.sell.ticker}`}
                        checked={checked.has(p.sell.id)}
                        onChange={() => toggle(p.sell.id)}
                      />
                    </td>
                    <td>{p.sell.tx_date}</td>
                    <td>{p.sell.ticker}</td>
                    <td className="num">{p.buys.map((b) => b.price).join('、') || '—'}</td>
                    <td className="num">{p.sell.price}</td>
                    <td className="num">{p.sell.qty.toLocaleString('en-US')}</td>
                    <td className="num">{p.sell.fee_tax.toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
            disabled={busy || checked.size === 0}
            onClick={() => void apply()}
          >
            {busy ? '標記中…' : `標記勾選的 ${selectedLegs} 筆為當沖`}
          </button>
        </>
      )}
    </Modal>
  )
}
