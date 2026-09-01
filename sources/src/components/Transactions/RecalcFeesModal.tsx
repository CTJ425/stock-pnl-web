/**
 * Batch recalculation fee:
 * - Find all inconsistent Taiwan stock transactions based on "current workspace rate + minimum handling fee" and preview the list
 * - Check each transaction one by one (select all by default) and then update with one click; for transactions with special tax rates such as hedging, you can uncheck the check box and use individual editing instead.
 * - U.S. stocks are not included in the batch recalculation (the charging structures of each brokerage vary greatly)
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { AppIcon } from '../Common/AppIcon'
import { Modal } from '../Common/Modal'
import { proposeFeeCorrections } from '../../utils/fees'
import { getFeeRate, getMinFee } from '../../utils/settings'
import { TX_TYPE_LABEL } from '../../types/models'

export function RecalcFeesModal({ onClose }: { onClose: () => void }) {
  const { current, transactions, updateTransaction } = useWorkspace()
  const workspaceId = current?.id
  const feeRate = getFeeRate(workspaceId)
  const minFeeWhole = getMinFee('whole', workspaceId)
  const minFeeOdd = getMinFee('odd', workspaceId)

  const proposals = useMemo(
    () => proposeFeeCorrections(transactions, { feeRate, minFeeWhole, minFeeOdd }),
    [transactions, feeRate, minFeeWhole, minFeeOdd],
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
    setBusy(true)
    setError(null)
    try {
      for (const { tx, newFee } of proposals) {
        if (!checked.has(tx.id)) continue
        await updateTransaction(tx.id, {
          tx_date: tx.tx_date,
          market: tx.market,
          ticker: tx.ticker,
          name: tx.name,
          tx_type: tx.tx_type,
          price: tx.price,
          qty: tx.qty,
          fee_tax: newFee,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失敗，請稍後再試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="批次重算手續費" onClose={onClose} wide disableBackdropClose>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        依目前設定（費率 {feeRate}、最低手續費整股 {minFeeWhole} 元 / 零股 {minFeeOdd} 元）
        重算台股手續費，賣出會一併算證交稅。
        美股和當沖請到「交易紀錄 → 編輯」個別調整。
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {proposals.length > 0 && (
        <div className="field-hint" style={{ marginBottom: 12 }}>
          <AppIcon icon={AlertTriangle} size="sm" className="icon-inline" /> 賣出提案含預估證交稅，現股當沖紀錄請勿勾選。
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
                  <th>
                    <input
                      type="checkbox"
                      aria-label="全選"
                      checked={checked.size === proposals.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>日期</th>
                  <th>代號</th>
                  <th>類型</th>
                  <th className="num">單價</th>
                  <th className="num">股數</th>
                  <th className="num">原手續費</th>
                  <th className="num">重算後</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(({ tx, newFee }) => (
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
