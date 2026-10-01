/**
 * Transaction record page: transaction list (date from new to old), deletion (single transaction/checked batch), CSV import/export.
 * New transactions are opened by the global header button in the shell layer (available in any page).
 * The "Profit and Loss/Income and Expenses" column is the same as column H in the GAS version: buy = -(unit price × number of shares + expenses), sell = unit price × number of shares - expenses.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Calculator, Download, MoreHorizontal, NotebookPen, Pencil, Scissors, Search, Trash2, Upload, X } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { NewTransaction, Transaction } from '../../types/models'
import { MARKET_LABEL, TX_TYPE_LABEL, marketCurrency } from '../../types/models'
import { displayStockName } from '../../services/usStockNames'
import { transactionsToCsv } from '../../utils/csv'
import { compareTxOrder } from '../../utils/pnlEngine'
import { fmtPrice, fmtQty, fmtSignedMoney } from '../../utils/formatters'
import { SortableTh } from '../Common/SortableTh'
import { nextSort, type SortState } from '../Common/sortState'
import { Modal } from '../Common/Modal'
import { useToast } from '../Common/Toast'
import { useConfirm } from '../Common/useConfirm'
import { CsvImportModal } from './CsvImportModal'
import { MarkDayTradesModal } from './MarkDayTradesModal'
import { RecalcFeesModal } from './RecalcFeesModal'
import { StockSplitModal } from './StockSplitModal'
import { TransactionForm } from './TransactionForm'
import { filterTransactions } from './txSearch'
import { txChipClass, txDirection, txNatureChipLabel } from './txChip'

/**
 * STOCK_DIVIDEND is a zero-price BUY (engine: `pnlEngine.ts`), so it shares the BUY outflow
 * formula — gross is always 0, only `fee_tax` leaves the account. DIVIDEND (現金股利) is money
 * coming in net of the withholding fee, same shape as a SELL: `price * qty - fee_tax`.
 */
function cashFlow(tx: Transaction): number {
  const gross = tx.price * tx.qty
  return tx.tx_type === 'BUY' || tx.tx_type === 'STOCK_DIVIDEND'
    ? -(gross + tx.fee_tax)
    : gross - tx.fee_tax
}

/**
 * 類型 cell: the direction mark (買 solid, 賣 outlined) reads before anything else, then the
 * nature chip. Direction never borrows the market up/down colours (PRODUCT.md).
 */
function TxTypeCell({ tx }: { tx: Transaction }) {
  const dir = txDirection(tx)
  const chip = txNatureChipLabel(tx)
  return (
    <span className="tx-type">
      {dir && <span className={`tx-dir tx-dir-${dir === '買' ? 'buy' : 'sell'}`}>{dir}</span>}
      {chip && (
        <span
          className={`tx-chip ${txChipClass(
            tx.tx_type === 'BUY' || tx.tx_type === 'SELL' ? tx.tx_nature : null,
          )}`}
        >
          {chip}
        </span>
      )}
    </span>
  )
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
      return compareTxOrder(a, b)
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
  // If the values are the same, fall back to the engine order, descending.
  return d || -compareTxOrder(a, b)
}

export function TransactionsPage() {
  const {
    transactions,
    addTransactions,
    updateTransaction,
    deleteTransactions,
    current,
  } = useWorkspace()
  const { show } = useToast()
  const confirm = useConfirm()
  const [showImport, setShowImport] = useState(false)
  const [showRecalc, setShowRecalc] = useState(false)
  const [showDayTrades, setShowDayTrades] = useState(false)
  const [showSplit, setShowSplit] = useState(false)
  const [showTools, setShowTools] = useState(false)
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

  /**
   * `replaceIds` (取代 import) are written **before** they are deleted on purpose: if the delete
   * fails afterwards the workspace holds visible duplicate rows, which the user can see and fix.
   * Deleting first and failing the write would destroy the old rows with nothing to replace them.
   */
  const handleImport = async (rows: NewTransaction[], replaceIds: string[]) => {
    if (replaceIds.length > 0) {
      const ok = await confirm({
        title: '取代匯入',
        message: `確定要刪除現有的 ${replaceIds.length} 筆買進 / 賣出，改成這份檔案的 ${rows.length} 筆嗎？\n\n股利紀錄不會被刪除，但這個動作無法復原。`,
        confirmLabel: '取代匯入',
        danger: true,
      })
      if (!ok) return false
    }
    await addTransactions(rows)
    if (replaceIds.length > 0) {
      try {
        await deleteTransactions(replaceIds)
      } catch {
        setNotice(
          `⚠️ 已寫入 ${rows.length} 筆，但舊紀錄刪除失敗，現在有重複的交易。請勾選舊的那批手動刪除，或重新執行一次取代匯入。`,
        )
        return true
      }
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of replaceIds) {
          next.delete(id)
        }
        return next
      })
      setNotice(
        `✅ 已用 ${rows.length} 筆交易取代原有的 ${replaceIds.length} 筆，Dashboard 與年度收益已同步更新。`,
      )
      return true
    }
    setNotice(`✅ 已匯入 ${rows.length} 筆交易，Dashboard 與年度收益已同步更新。`)
    return true
  }

  const handleExport = () => {
    const csv = transactionsToCsv(
      transactions
        .slice()
        .sort(compareTxOrder),
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
    const ok = await confirm({
      title: '刪除交易',
      message: `確定刪除這筆交易嗎？\n\n${tx.tx_date}　${tx.ticker} ${displayStockName(tx.market, tx.ticker, tx.name)}　${TX_TYPE_LABEL[tx.tx_type]} ${fmtQty(tx.qty)} 股\n\n刪除後 Dashboard 與年度收益會立即重算。`,
      confirmLabel: '刪除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteTransactions([tx.id])
    } catch {
      show('刪除失敗，請稍後再試', 'error')
      return
    }
    setSelected((prev) => {
      if (!prev.has(tx.id)) return prev
      const next = new Set(prev)
      next.delete(tx.id)
      return next
    })
    show('已刪除 1 筆交易')
  }

  const handleDeleteSelected = async () => {
    const visibleSelected = sorted.filter((tx) => selected.has(tx.id))
    const ids = visibleSelected.map((tx) => tx.id)
    if (ids.length === 0) return
    const ok = await confirm({
      title: '刪除交易',
      message: `確定刪除選取的 ${ids.length} 筆交易嗎？\n\n刪除後 Dashboard 與年度收益會立即重算，此動作無法復原。`,
      confirmLabel: '刪除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteTransactions(ids)
    } catch {
      show('刪除失敗，請稍後再試', 'error')
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        next.delete(id)
      }
      return next
    })
    show(`已刪除 ${ids.length} 筆交易`)
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
        <button
          type="button"
          className="btn tx-tools-trigger"
          aria-haspopup="dialog"
          onClick={() => setShowTools(true)}
        >
          <MoreHorizontal size={15} />
          工具
        </button>
        {isFiltering && (
          <span className="badge">
            顯示 {sorted.length} / {transactions.length} 筆
          </span>
        )}
        <div className="spacer" />
        <button
          className="btn tx-tool"
          title="股票分割或反向分割（併股）換算"
          onClick={() => setShowSplit(true)}
          disabled={transactions.every((tx) => tx.tx_type !== 'BUY')}
        >
          <Scissors size={15} />
          股票分割換算
        </button>
        <button
          className="btn tx-tool"
          title="依目前費率重算所有台股交易的手續費"
          onClick={() => setShowRecalc(true)}
          disabled={transactions.length === 0}
        >
          <Calculator size={15} />
          重算手續費
        </button>
        <button
          className="btn tx-tool"
          title="找出證交稅只收一半、卻沒標記成當沖的交易"
          onClick={() => setShowDayTrades(true)}
          disabled={transactions.length === 0}
        >
          <ArrowLeftRight size={15} />
          標記當沖
        </button>
        <button className="btn tx-tool" onClick={() => setShowImport(true)}>
          <Upload size={15} />
          匯入 CSV
        </button>
        <button className="btn tx-tool" onClick={handleExport} disabled={transactions.length === 0}>
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
              尚無交易紀錄。點上方的「新增交易」記下第一筆，或用「匯入 CSV」把舊試算表的資料搬過來。
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
            <table className="data-table tx-table">
              <thead>
                <tr>
                  <th scope="col">
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
                  <SortableTh label="現金收支" sortKey="flow" sort={sort} onSort={handleSort} numeric />
                  <th scope="col" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((tx) => {
                  const currency = marketCurrency(tx.market)
                  const flow = cashFlow(tx)
                  return (
                    <tr key={tx.id} className="tx-row">
                      <td data-c="sel">
                        <input
                          type="checkbox"
                          checked={selected.has(tx.id)}
                          aria-label={`選取 ${tx.tx_date} ${tx.ticker} 這筆交易`}
                          onChange={() => toggleOne(tx.id)}
                        />
                      </td>
                      <td data-c="date">{tx.tx_date}</td>
                      <td className="cell-muted" data-c="market">{MARKET_LABEL[tx.market]}</td>
                      <td data-c="ticker">{tx.ticker}</td>
                      <td
                        data-c="name"
                        className="cell-ellipsis"
                        title={displayStockName(tx.market, tx.ticker, tx.name)}
                      >
                        {displayStockName(tx.market, tx.ticker, tx.name)}
                      </td>
                      <td data-c="type">
                        <TxTypeCell tx={tx} />
                      </td>
                      <td className="num" data-c="price">{fmtPrice(tx.price, currency)}</td>
                      <td className="num" data-c="qty">{fmtQty(tx.qty)}</td>
                      <td className="num" data-c="fee">
                        {tx.fee_tax.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="num" data-c="flow">
                        {fmtSignedMoney(flow, currency, currency === 'TWD' ? 0 : 2)}
                      </td>
                      {/* Phone only (≤720px): the row folds into two lines and this cell carries
                          date, shares × price and fee under the name. Hidden on wider screens. */}
                      <td className="tx-m-meta" data-c="meta">
                        {`${tx.tx_date} · ${fmtQty(tx.qty)} 股 × ${fmtPrice(tx.price, currency)} · 費稅 ${tx.fee_tax.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                      </td>
                      <td className="num" data-c="act">
                        <div className="row-actions">
                          <button
                            className="btn btn-sm btn-icon btn-ghost"
                            title="編輯這筆交易"
                            aria-label="編輯這筆交易"
                            onClick={() => setEditTx(tx)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn btn-sm btn-icon btn-ghost btn-ghost-danger"
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
        <CsvImportModal onClose={() => setShowImport(false)} onImport={handleImport} existing={transactions} />
      )}

      {showRecalc && <RecalcFeesModal onClose={() => setShowRecalc(false)} />}

      {showDayTrades && <MarkDayTradesModal onClose={() => setShowDayTrades(false)} />}

      {showSplit && (
        <StockSplitModal
          onClose={() => setShowSplit(false)}
          onSuccess={(msg) => setNotice(msg)}
        />
      )}

      {showTools && (
        <Modal title="交易工具" onClose={() => setShowTools(false)}>
          <div className="tx-tools-sheet">
            <button
              type="button"
              className="btn tx-tools-item"
              disabled={transactions.every((tx) => tx.tx_type !== 'BUY')}
              onClick={() => {
                setShowTools(false)
                setShowSplit(true)
              }}
            >
              <Scissors size={15} />
              股票分割換算
            </button>
            <button
              type="button"
              className="btn tx-tools-item"
              disabled={transactions.length === 0}
              onClick={() => {
                setShowTools(false)
                setShowRecalc(true)
              }}
            >
              <Calculator size={15} />
              重算手續費
            </button>
            <button
              type="button"
              className="btn tx-tools-item"
              disabled={transactions.length === 0}
              onClick={() => {
                setShowTools(false)
                setShowDayTrades(true)
              }}
            >
              <ArrowLeftRight size={15} />
              標記當沖
            </button>
            <button
              type="button"
              className="btn tx-tools-item"
              onClick={() => {
                setShowTools(false)
                setShowImport(true)
              }}
            >
              <Upload size={15} />
              匯入 CSV
            </button>
            <button
              type="button"
              className="btn tx-tools-item"
              disabled={transactions.length === 0}
              onClick={() => {
                setShowTools(false)
                handleExport()
              }}
            >
              <Download size={15} />
              匯出 CSV
            </button>
          </div>
        </Modal>
      )}

      {editTx && (
        <Modal title="編輯交易紀錄" onClose={() => setEditTx(null)} disableBackdropClose>
          <TransactionForm
            key={editTx.id}
            initial={editTx}
            onSubmit={(tx) => updateTransaction(editTx.id, tx)}
            onDone={() => {
              setEditTx(null)
              show('交易已更新')
            }}
          />
        </Modal>
      )}
    </>
  )
}
