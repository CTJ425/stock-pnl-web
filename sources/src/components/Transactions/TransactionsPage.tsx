/**
 * 交易紀錄頁：交易列表（日期新到舊）、新增交易、刪除、CSV 匯入 / 匯出。
 * 「損益 / 收支」欄與 GAS 版 H 欄同構：買入 = -(單價×股數+費用)，賣出 = 單價×股數-費用。
 */
import { useMemo, useState } from 'react'
import { Download, ListPlus, NotebookPen, Trash2, Upload } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { NewTransaction, Transaction } from '../../types/models'
import { MARKET_LABEL, TX_TYPE_LABEL, marketCurrency } from '../../types/models'
import { transactionsToCsv } from '../../utils/csv'
import { fmtPrice, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import { Modal } from '../Common/Modal'
import { CsvImportModal } from './CsvImportModal'
import { TransactionForm } from './TransactionForm'

function cashFlow(tx: Transaction): number {
  const gross = tx.price * tx.qty
  return tx.tx_type === 'BUY' ? -(gross + tx.fee_tax) : gross - tx.fee_tax
}

export function TransactionsPage() {
  const { transactions, addTransactions, deleteTransaction, current } = useWorkspace()
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const sorted = useMemo(
    () =>
      transactions
        .slice()
        .sort(
          (a, b) =>
            b.tx_date.localeCompare(a.tx_date) || b.created_at.localeCompare(a.created_at),
        ),
    [transactions],
  )

  const handleImport = async (rows: NewTransaction[]) => {
    await addTransactions(rows)
    setNotice(`✅ 已匯入 ${rows.length} 筆交易，Dashboard 與年度收益已同步更新。`)
  }

  const handleExport = () => {
    const csv = transactionsToCsv(
      transactions
        .slice()
        .sort(
          (a, b) =>
            a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at),
        ),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `交易紀錄-${current?.name ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = async (tx: Transaction) => {
    const ok = window.confirm(
      `確定刪除這筆交易嗎？\n\n${tx.tx_date}　${tx.ticker} ${tx.name}　${TX_TYPE_LABEL[tx.tx_type]} ${fmtQty(tx.qty)} 股\n\n刪除後 Dashboard 與年度收益會立即重算。`,
    )
    if (ok) await deleteTransaction(tx.id)
  }

  return (
    <>
      <div className="section toolbar">
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <ListPlus size={16} />
          新增交易
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowImport(true)}>
          <Upload size={15} />
          匯入 CSV
        </button>
        <button className="btn" onClick={handleExport} disabled={transactions.length === 0}>
          <Download size={15} />
          匯出 CSV
        </button>
      </div>

      {notice && (
        <div className="notice notice-ok section">{notice}</div>
      )}

      <div className="section">
        {sorted.length === 0 ? (
          <div className="glass empty-state">
            <div className="empty-icon">
              <NotebookPen size={36} />
            </div>
            <div>
              尚無交易紀錄。點「新增交易」記下第一筆，或用「匯入 CSV」把舊試算表的資料搬過來。
            </div>
          </div>
        ) : (
          <div className="glass table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>交易日期</th>
                  <th>市場</th>
                  <th>代號</th>
                  <th>名稱</th>
                  <th>類型</th>
                  <th className="num">單價</th>
                  <th className="num">股數</th>
                  <th className="num">手續費 / 稅金</th>
                  <th className="num">損益 / 收支</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((tx) => {
                  const currency = marketCurrency(tx.market)
                  const flow = cashFlow(tx)
                  return (
                    <tr key={tx.id}>
                      <td>{tx.tx_date}</td>
                      <td className="cell-muted">{MARKET_LABEL[tx.market]}</td>
                      <td>{tx.ticker}</td>
                      <td>{tx.name}</td>
                      <td>{TX_TYPE_LABEL[tx.tx_type]}</td>
                      <td className="num">{fmtPrice(tx.price, currency)}</td>
                      <td className="num">{fmtQty(tx.qty)}</td>
                      <td className="num">
                        {tx.fee_tax.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className={`num ${pnlClass(flow)}`}>
                        {fmtSignedMoney(flow, currency, currency === 'TWD' ? 0 : 2)}
                      </td>
                      <td className="num">
                        <button
                          className="btn btn-sm btn-danger btn-icon"
                          title="刪除這筆交易"
                          aria-label="刪除這筆交易"
                          onClick={() => void handleDelete(tx)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <Modal title="新增交易紀錄" onClose={() => setShowForm(false)}>
          <TransactionForm onSubmit={(tx) => addTransactions([tx])} />
        </Modal>
      )}

      {showImport && (
        <CsvImportModal onClose={() => setShowImport(false)} onImport={handleImport} />
      )}
    </>
  )
}
