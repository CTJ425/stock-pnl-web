/**
 * 交易紀錄頁：交易列表（日期新到舊）、刪除（單筆 / 勾選批次）、CSV 匯入 / 匯出。
 * 新增交易改由外殼層的全域浮動按鈕開啟（任何分頁皆可用）。
 * 「損益 / 收支」欄與 GAS 版 H 欄同構：買入 = -(單價×股數+費用)，賣出 = 單價×股數-費用。
 */
import { useEffect, useMemo, useState } from 'react'
import { Calculator, Download, NotebookPen, Pencil, Trash2, Upload } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { NewTransaction, Transaction } from '../../types/models'
import { MARKET_LABEL, TX_TYPE_LABEL, marketCurrency } from '../../types/models'
import { displayStockName } from '../../services/usStockNames'
import { transactionsToCsv } from '../../utils/csv'
import { fmtPrice, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import type { SortState } from '../Common/SortableTh'
import { SortableTh, nextSort } from '../Common/SortableTh'
import { Modal } from '../Common/Modal'
import { CsvImportModal } from './CsvImportModal'
import { RecalcFeesModal } from './RecalcFeesModal'
import { TransactionForm } from './TransactionForm'

function cashFlow(tx: Transaction): number {
  const gross = tx.price * tx.qty
  return tx.tx_type === 'BUY' ? -(gross + tx.fee_tax) : gross - tx.fee_tax
}

type TxSortKey =
  | 'tx_date'
  | 'market'
  | 'ticker'
  | 'name'
  | 'tx_type'
  | 'price'
  | 'qty'
  | 'fee_tax'
  | 'flow'

/** 文字欄位預設升冪、日期與數值欄位預設降冪 */
const TX_SORT_DEFAULT_DIR: Record<TxSortKey, 'asc' | 'desc'> = {
  tx_date: 'desc',
  market: 'asc',
  ticker: 'asc',
  name: 'asc',
  tx_type: 'asc',
  price: 'desc',
  qty: 'desc',
  fee_tax: 'desc',
  flow: 'desc',
}

function compareTx(a: Transaction, b: Transaction, key: TxSortKey): number {
  let d = 0
  switch (key) {
    case 'tx_date':
      return a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at)
    case 'market':
      d = a.market.localeCompare(b.market)
      break
    case 'ticker':
      // 代號排序：先市場（台股在前）再代號
      d = a.market.localeCompare(b.market) || a.ticker.localeCompare(b.ticker)
      break
    case 'name':
      d = displayStockName(a.market, a.ticker, a.name).localeCompare(
        displayStockName(b.market, b.ticker, b.name),
        'zh-Hant',
      )
      break
    case 'tx_type':
      d = a.tx_type.localeCompare(b.tx_type)
      break
    case 'price':
      d = a.price - b.price
      break
    case 'qty':
      d = a.qty - b.qty
      break
    case 'fee_tax':
      d = a.fee_tax - b.fee_tax
      break
    case 'flow':
      d = cashFlow(a) - cashFlow(b)
      break
  }
  // 同值時以日期新到舊、再以建立時間為次序
  return d || b.tx_date.localeCompare(a.tx_date) || b.created_at.localeCompare(a.created_at)
}

export function TransactionsPage() {
  const {
    transactions,
    addTransactions,
    updateTransaction,
    deleteTransactions,
    current,
    isAllView,
    workspaces,
  } = useWorkspace()
  // 總覽模式：顯示工作區欄；唯讀（編輯 / 刪除 / 匯入 / 重算須在單一工作區進行）
  const wsNameById = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w.name])),
    [workspaces],
  )
  const [showImport, setShowImport] = useState(false)
  const [showRecalc, setShowRecalc] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [sort, setSort] = useState<SortState<TxSortKey>>({ key: 'tx_date', dir: 'desc' })

  // 切換工作區（含進出總覽）時清空勾選：勾選的是前一個工作區的交易，不可帶到新的檢視
  useEffect(() => {
    setSelected(new Set())
  }, [current?.id, isAllView])

  const sorted = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1
    return transactions.slice().sort((a, b) => sign * compareTx(a, b, sort.key))
  }, [transactions, sort])

  const handleSort = (key: TxSortKey) =>
    setSort((prev) => nextSort(prev, key, TX_SORT_DEFAULT_DIR[key]))

  const allSelected = sorted.length > 0 && sorted.every((tx) => selected.has(tx.id))

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(sorted.map((tx) => tx.id)))
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleImport = async (rows: NewTransaction[]) => {
    await addTransactions(rows)
    setNotice(`✅ 已匯入 ${rows.length} 筆交易，Dashboard 與年度收益已同步更新。`)
  }

  const handleExport = () => {
    // 總覽匯出附「工作區」欄：標示每筆交易的來源券商，並讓匯入端能擋下跨工作區混匯
    const csv = transactionsToCsv(
      transactions
        .slice()
        .sort(
          (a, b) =>
            a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at),
        ),
      isAllView ? wsNameById : undefined,
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `交易紀錄-${current?.name ?? (isAllView ? '全部工作區' : 'export')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = async (tx: Transaction) => {
    const ok = window.confirm(
      `確定刪除這筆交易嗎？\n\n${tx.tx_date}　${tx.ticker} ${displayStockName(tx.market, tx.ticker, tx.name)}　${TX_TYPE_LABEL[tx.tx_type]} ${fmtQty(tx.qty)} 股\n\n刪除後 Dashboard 與年度收益會立即重算。`,
    )
    if (!ok) return
    try {
      await deleteTransactions([tx.id])
    } catch {
      return // 錯誤已顯示於全域錯誤列
    }
    setSelected((prev) => {
      if (!prev.has(tx.id)) return prev
      const next = new Set(prev)
      next.delete(tx.id)
      return next
    })
  }

  const handleDeleteSelected = async () => {
    const ids = sorted.filter((tx) => selected.has(tx.id)).map((tx) => tx.id)
    if (ids.length === 0) return
    const ok = window.confirm(
      `確定刪除選取的 ${ids.length} 筆交易嗎？\n\n刪除後 Dashboard 與年度收益會立即重算，此動作無法復原。`,
    )
    if (!ok) return
    try {
      await deleteTransactions(ids)
    } catch {
      return // 錯誤已顯示於全域錯誤列
    }
    setSelected(new Set())
    setNotice(`🗑️ 已刪除 ${ids.length} 筆交易。`)
  }

  return (
    <>
      <div className="section toolbar">
        {!isAllView && selected.size > 0 && (
          <button className="btn btn-danger" onClick={() => void handleDeleteSelected()}>
            <Trash2 size={15} />
            刪除選取（{selected.size}）
          </button>
        )}
        <div className="spacer" />
        {!isAllView && (
          <>
            <button
              className="btn"
              title="依目前費率設定重新估算所有台股交易的手續費"
              onClick={() => setShowRecalc(true)}
              disabled={transactions.length === 0}
            >
              <Calculator size={15} />
              重算手續費
            </button>
            <button className="btn" onClick={() => setShowImport(true)}>
              <Upload size={15} />
              匯入 CSV
            </button>
          </>
        )}
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
              尚無交易紀錄。點右下角「新增交易」記下第一筆，或用「匯入 CSV」把舊試算表的資料搬過來。
            </div>
          </div>
        ) : (
          <div className="glass table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {!isAllView && (
                    <th>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        aria-label="全選 / 取消全選"
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  {isAllView && <th>工作區</th>}
                  <SortableTh label="交易日期" sortKey="tx_date" sort={sort} onSort={handleSort} />
                  <SortableTh label="市場" sortKey="market" sort={sort} onSort={handleSort} />
                  <SortableTh label="代號" sortKey="ticker" sort={sort} onSort={handleSort} />
                  <SortableTh label="名稱" sortKey="name" sort={sort} onSort={handleSort} />
                  <SortableTh label="類型" sortKey="tx_type" sort={sort} onSort={handleSort} />
                  <SortableTh label="單價" sortKey="price" sort={sort} onSort={handleSort} numeric />
                  <SortableTh label="股數" sortKey="qty" sort={sort} onSort={handleSort} numeric />
                  <SortableTh label="手續費 / 稅金" sortKey="fee_tax" sort={sort} onSort={handleSort} numeric />
                  <SortableTh label="損益 / 收支" sortKey="flow" sort={sort} onSort={handleSort} numeric />
                  {!isAllView && <th aria-label="操作" />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((tx) => {
                  const currency = marketCurrency(tx.market)
                  const flow = cashFlow(tx)
                  return (
                    <tr key={tx.id}>
                      {!isAllView && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(tx.id)}
                            aria-label={`選取 ${tx.tx_date} ${tx.ticker} 這筆交易`}
                            onChange={() => toggleOne(tx.id)}
                          />
                        </td>
                      )}
                      {isAllView && (
                        <td className="cell-muted">{wsNameById.get(tx.workspace_id) ?? '—'}</td>
                      )}
                      <td>{tx.tx_date}</td>
                      <td className="cell-muted">{MARKET_LABEL[tx.market]}</td>
                      <td>{tx.ticker}</td>
                      <td
                        className="cell-ellipsis"
                        title={displayStockName(tx.market, tx.ticker, tx.name)}
                      >
                        {displayStockName(tx.market, tx.ticker, tx.name)}
                      </td>
                      <td>{TX_TYPE_LABEL[tx.tx_type]}</td>
                      <td className="num">{fmtPrice(tx.price, currency)}</td>
                      <td className="num">{fmtQty(tx.qty)}</td>
                      <td className="num">
                        {tx.fee_tax.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className={`num ${pnlClass(flow)}`}>
                        {fmtSignedMoney(flow, currency, currency === 'TWD' ? 0 : 2)}
                      </td>
                      {!isAllView && (
                        <td className="num">
                          <div className="row-actions">
                            <button
                              className="btn btn-sm btn-icon"
                              title="編輯這筆交易"
                              aria-label="編輯這筆交易"
                              onClick={() => setEditTx(tx)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="btn btn-sm btn-danger btn-icon"
                              title="刪除這筆交易"
                              aria-label="刪除這筆交易"
                              onClick={() => void handleDelete(tx)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showImport && (
        <CsvImportModal onClose={() => setShowImport(false)} onImport={handleImport} />
      )}

      {showRecalc && <RecalcFeesModal onClose={() => setShowRecalc(false)} />}

      {editTx && (
        <Modal title="編輯交易紀錄" onClose={() => setEditTx(null)} disableBackdropClose>
          <TransactionForm
            key={editTx.id}
            initial={editTx}
            onSubmit={(tx) => updateTransaction(editTx.id, tx)}
            onDone={() => setEditTx(null)}
          />
        </Modal>
      )}
    </>
  )
}
