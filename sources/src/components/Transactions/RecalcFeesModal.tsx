/**
 * Batch recalculation fee:
 * - Find all inconsistent Taiwan stock transactions based on "the rate in force on each
 *   transaction's own date + minimum handling fee" and preview the list
 * - Check each transaction one by one (select all by default) and then update with one click; for transactions with special tax rates such as hedging, you can uncheck the check box and use individual editing instead.
 * - U.S. stocks are not included in the batch recalculation (the charging structures of each brokerage vary greatly)
 */
import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { Modal } from '../Common/Modal'
import { useToast } from '../Common/Toast'
import { proposeFeeCorrections } from '../../utils/fees'
import { feeDiscountLabel } from '../../utils/feeRateHint'
import { formatFeeRatePct } from '../../utils/pnlBasis'
import { getFeeRateHistory, getFeeRateOn, getMinFee } from '../../utils/settings'
import { TX_TYPE_LABEL } from '../../types/models'
import type { TxUpdate } from '../../services/dataProvider'
import { runBatchApply } from './batchUpdate'

export function RecalcFeesModal({ onClose }: { onClose: () => void }) {
  const { current, transactions, updateTransactionsBatch } = useWorkspace()
  const { show } = useToast()
  const workspaceId = current?.id
  const minFeeWhole = getMinFee('whole', workspaceId)
  const minFeeOdd = getMinFee('odd', workspaceId)
  // Task 182: every row is priced at the rate its own date fell under, so a workspace whose broker
  // changed the discount does not re-price the trades made under the old agreement.
  // 現折 / 月退 deliberately does NOT enter here (user's call, 2026-10-01): a recorded fee is what
  // the trade ends up costing you, and under 月退 the broker refunds the difference. Recording the
  // list price instead would leave that refund outside the ledger, since nothing here records it.
  // The rebate still decides the dashboard's headline basis — see `pnlBasis`.
  const rateFor = useCallback((txDate: string) => getFeeRateOn(txDate, workspaceId), [workspaceId])
  const history = getFeeRateHistory(workspaceId)

  const proposals = useMemo(
    () => proposeFeeCorrections(transactions, { rateFor, minFeeWhole, minFeeOdd }),
    [transactions, rateFor, minFeeWhole, minFeeOdd],
  )
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(proposals.map((p) => p.tx.id)),
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
      prev.size === proposals.length ? new Set() : new Set(proposals.map((p) => p.tx.id)),
    )
  }

  const apply = async () => {
    if (busy) return
    // No extra confirm dialog here: the button that reaches this point already reads
    // "更新勾選的 N 筆手續費" inside a modal the user opened on purpose, so a second dialog
    // would be the same question twice. The success toast below is what was actually missing.
    const updates: TxUpdate[] = proposals
      .filter(({ tx }) => checked.has(tx.id))
      .map(({ tx, newFee, feeRate }) => ({
        id: tx.id,
        price: tx.price,
        qty: tx.qty,
        fee_tax: newFee,
        fee_rate: feeRate,
      }))
    const ok = await runBatchApply(updateTransactionsBatch, updates, setBusy, setError)
    if (!ok) return
    show(`已更新 ${updates.length} 筆手續費`)
    onClose()
  }

  return (
    <Modal title="批次重算手續費" onClose={onClose} wide disableBackdropClose>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        依每筆交易當天的費率重算台股手續費（最低手續費整股 {minFeeWhole} 元 / 零股 {minFeeOdd} 元），
        賣出會一併算證交稅。美股和當沖請到「交易紀錄 → 編輯」個別調整。
        {history.length > 0 && '　費率改過的日期之前，交易維持原本的費率，不會出現在下面的清單裡。'}
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {proposals.length > 0 && (
        <div className="field-hint" style={{ marginBottom: 12 }}>
          ⚠️ 賣出提案含預估證交稅，現股當沖紀錄請勿勾選。
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 0' }}>
          <CheckCircle2 size={28} style={{ marginBottom: 8 }} />
          <div>所有台股手續費都和目前設定一致，不用更新。</div>
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
                  <th scope="col">類型</th>
                  <th scope="col" className="num">單價</th>
                  <th scope="col" className="num">股數</th>
                  <th scope="col">費率</th>
                  <th scope="col" className="num">原手續費</th>
                  <th scope="col" className="num">重算後</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(({ tx, newFee, feeRate }) => (
                  <tr key={tx.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`選取 ${tx.tx_date} ${tx.ticker}`}
                        checked={checked.has(tx.id)}
                        onChange={() => toggle(tx.id)}
                      />
                    </td>
                    <td>{tx.tx_date}</td>
                    <td>{tx.ticker}</td>
                    <td>{TX_TYPE_LABEL[tx.tx_type]}</td>
                    <td className="num">{tx.price}</td>
                    <td className="num">{tx.qty.toLocaleString('en-US')}</td>
                    <td title={formatFeeRatePct(feeRate)}>{feeDiscountLabel(feeRate)}</td>
                    <td className="num">{tx.fee_tax.toLocaleString('en-US')}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {newFee.toLocaleString('en-US')}
                    </td>
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
            {busy ? '更新中…' : `更新勾選的 ${checked.size} 筆手續費`}
          </button>
        </>
      )}
    </Modal>
  )
}
