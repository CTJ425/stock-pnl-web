/**
 * Transaction record page: transaction list (date from new to old), deletion (single transaction/checked batch), CSV import/export.
 * New transactions are opened by the global floating button in the shell layer (available in any page).
 * The "Profit and Loss/Income and Expenses" column is the same as column H in the GAS version: buy = -(unit price × number of shares + expenses), sell = unit price × number of shares - expenses.
 */
import { useEffect, useMemo, useState } from 'react'
import { Calculator, Download, NotebookPen, Pencil, Search, Trash2, Upload, X } from 'lucide-react'
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
import { filterTransactions } from './txSearch'

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

/** The text field has the ascending power by default, and the date and numeric fields have the descending power by default.*/
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
      // Order of codes: Market first (Taiwan stocks first) and then code
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
  // If the values ​​are the same, the date will be sorted from newer to older, and then the creation time will be the order.
  return d || b.tx_date.localeCompare(a.tx_date) || b.created_at.localeCompare(a.created_at)
}

export function TransactionsPage() {
  const {
    transactions,
    addTransactions,
    updateTransaction,
    deleteTransactions,
    current,
  } = useWorkspace()
  const [showImport, setShowImport] = useState(false)
  const [showRecalc, setShowRecalc] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [sort, setSort] = useState<SortState<TxSortKey>>({ key: 'tx_date', dir: 'desc' })

  // Clear the check and search when switching workspaces: the transactions in the previous workspace are checked and cannot be brought to the new view
  useEffect(() => {
    setSelected(new Set())
    setSearchQuery('')
  }, [current?.id])

  const filtered = useMemo(() => {
    return filterTransactions(transactions, searchQuery)
  }, [transactions, searchQuery])

  const sorted = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1
    return filtered.slice().sort((a, b) => sign * compareTx(a, b, sort.key))
  }, [filtered, sort])

  // The number of transactions that are visible and checked
  const visibleSelectedCount = useMemo(
    () => sorted.filter((tx) => selected.has(tx.id)).length,
    [sorted, selected],
  )

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
    const visibleSelected = sorted.filter((tx) => selected.has(tx.id))
    const ids = visibleSelected.map((tx) => tx.id)
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
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        next.delete(id)
      }
      return next
    })
    setNotice(`🗑️ 已刪除 ${ids.length} 筆交易。`)
  }

  const isFiltering = searchQuery.trim() !== ''

  return (
    <>
      <div className="section toolbar">
        {visibleSelectedCount > 0 && (
          <button className="btn btn-danger" onClick={() => void handleDeleteSelected()}>
            <Trash2 size={15} />
            刪除選取（{visibleSelectedCount}）
          </button>
        )}
        <div className="search-box">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋代號或名稱"
            aria-label="搜尋交易"
            className="search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="清除搜尋"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {isFiltering && (
          <span className="badge">
            顯示 {sorted.length} / {transactions.length} 筆
          </span>
        )}
        <div className="spacer" />
        <button
          className="btn"
          title="依目前費率重算所有台股交易的手續費"
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
        <button className="btn" onClick={handleExport} disabled={transactions.length === 0}>
          <Download size={15} />
          匯出 CSV
        </button>
      </div>

      {notice && (
        <div className="notice notice-ok section">{notice}</div>
      )}

      <div className="section">
        {transactions.length === 0 ? (
          <div className="glass empty-state">
            <div className="empty-icon">
              <NotebookPen size={36} />
            </div>
            <div>
              尚無交易紀錄。點右下角「新增交易」記下第一筆，或用「匯入 CSV」把舊試算表的資料搬過來。
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="glass empty-state">
            <div className="empty-icon">
              <Search size={36} />
            </div>
            <div>找不到符合「{searchQuery.trim()}」的交易。</div>
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-sm" onClick={() => setSearchQuery('')}>
                清除搜尋
              </button>
            </div>
          </div>
        ) : (
          <div className="glass table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-label="全選 / 取消全選"
                      onChange={toggleAll}
                    />
                  </th>
                  <SortableTh label="交易日期" sortKey="tx_date" sort={sort} onSort={handleSort} />
                  <SortableTh label="市場" sortKey="market" sort={sort} onSort={handleSort} />
                  <SortableTh label="代號" sortKey="ticker" sort={sort} onSort={handleSort} />
                  <SortableTh label="名稱" sortKey="name" sort={sort} onSort={handleSort} />
                  <SortableTh label="類型" sortKey="tx_type" sort={sort} onSort={handleSort} />
                  <SortableTh label="單價" sortKey="price" sort={sort} onSort={handleSort} numeric />
                  <SortableTh label="股數" sortKey="qty" sort={sort} onSort={handleSort} numeric />
                  <SortableTh label="手續費 / 稅金" sortKey="fee_tax" sort={sort} onSort={handleSort} numeric />
                  <SortableTh label="損益 / 收支" sortKey="flow" sort={sort} onSort={handleSort} numeric />
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((tx) => {
                  const currency = marketCurrency(tx.market)
                  const flow = cashFlow(tx)
                  return (
                    <tr key={tx.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(tx.id)}
                          aria-label={`選取 ${tx.tx_date} ${tx.ticker} 這筆交易`}
                          onChange={() => toggleOne(tx.id)}
                        />
                      </td>
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
