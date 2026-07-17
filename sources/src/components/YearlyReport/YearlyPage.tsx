/**
 * 年度收益總覽（已實現損益）：
 * - 頂部 4 大 KPI：台股歷史已實現 (TWD)、美股歷史已實現 (USD)、累計手續費、累計交易筆數
 * - 台股 / 美股上下分區，各自獨立年度表格，幣別完全分開（與 GAS 版同構）
 * - 年度列可展開該年度「有賣出交易」的個股明細
 */
import { useMemo, useState } from 'react'
import { CalendarRange, Minus, Plus } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { Currency } from '../../types/models'
import type { YearTickerDetail } from '../../utils/pnlEngine'
import { displayStockName } from '../../services/usStockNames'
import { fmtMoney, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import type { SortState } from '../Common/SortableTh'
import { SortableTh, nextSort } from '../Common/SortableTh'

type YearSortKey = 'year' | 'realized' | 'buyAmt' | 'sellAmt' | 'fees' | 'count'

interface YearRow {
  year: number
  realized: number
  buyAmt: number
  sellAmt: number
  fees: number
  count: number
  details: YearTickerDetail[]
}

function useSectionRows(currency: Currency): YearRow[] {
  const { ledger } = useWorkspace()
  return useMemo(() => {
    const rows: YearRow[] = []
    for (const year of ledger.years) {
      const y = ledger.yearly[year]
      const agg: YearRow = { year, realized: 0, buyAmt: 0, sellAmt: 0, fees: 0, count: 0, details: [] }
      for (const yt of Object.values(y.tickers)) {
        if (yt.currency !== currency) continue
        agg.realized += yt.realized
        agg.buyAmt += yt.buyAmt
        agg.sellAmt += yt.sellAmt
        agg.fees += yt.fees
        agg.count += yt.count
        // 只列出該年度有賣出的個股（含損益剛好打平為 0 者）；有買無賣者不列
        if (yt.sellAmt !== 0 || yt.realized !== 0) agg.details.push(yt)
      }
      if (agg.count === 0) continue
      agg.details.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))
      rows.push(agg)
    }
    return rows
  }, [ledger, currency])
}

function YearlySection({ title, currency }: { title: string; currency: Currency }) {
  const rows = useSectionRows(currency)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [sort, setSort] = useState<SortState<YearSortKey>>({ key: 'year', dir: 'asc' })

  const sortedRows = useMemo(() => {
    const sign = sort.dir === 'asc' ? 1 : -1
    return rows
      .slice()
      .sort((a, b) => sign * (a[sort.key] - b[sort.key]) || a.year - b.year)
  }, [rows, sort])

  const handleSort = (key: YearSortKey) =>
    setSort((prev) => nextSort(prev, key, key === 'year' ? 'asc' : 'desc'))

  const toggle = (year: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  return (
    <div className="section">
      <div className="section-title">
        <h2 style={{ fontSize: 14 }}>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="glass empty-state" style={{ padding: '26px 20px' }}>
          （尚無交易紀錄）
        </div>
      ) : (
        <div className="glass table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh label="年度" sortKey="year" sort={sort} onSort={handleSort} />
                <SortableTh label="已實現損益" sortKey="realized" sort={sort} onSort={handleSort} numeric />
                <SortableTh label="買入總額" sortKey="buyAmt" sort={sort} onSort={handleSort} numeric />
                <SortableTh label="賣出總額" sortKey="sellAmt" sort={sort} onSort={handleSort} numeric />
                <SortableTh label="手續費" sortKey="fees" sort={sort} onSort={handleSort} numeric />
                <SortableTh label="交易筆數" sortKey="count" sort={sort} onSort={handleSort} numeric />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isOpen = expanded.has(row.year)
                return (
                  <YearRows
                    key={row.year}
                    row={row}
                    currency={currency}
                    isOpen={isOpen}
                    onToggle={() => toggle(row.year)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function YearRows({
  row,
  currency,
  isOpen,
  onToggle,
}: {
  row: YearRow
  currency: Currency
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr style={{ fontWeight: 600 }}>
        <td>
          {row.details.length > 0 && (
            <button
              className="year-toggle"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? '收合' : '展開'} ${row.year} 年度個股明細`}
            >
              {isOpen ? <Minus size={13} /> : <Plus size={13} />}
            </button>
          )}
          {row.year}
        </td>
        <td className={`num ${pnlClass(row.realized)}`}>{fmtSignedMoney(row.realized, currency)}</td>
        <td className="num">{fmtMoney(row.buyAmt, currency)}</td>
        <td className="num">{fmtMoney(row.sellAmt, currency)}</td>
        <td className="num">{fmtMoney(row.fees, currency, 2)}</td>
        <td className="num">{fmtQty(row.count)}</td>
      </tr>
      {isOpen && (
        <tr className="detail-row">
          <td colSpan={6} className="detail-cell">
            {/* 固定高度可捲動：個股多時不拉長年度表格 */}
            <div className="detail-scroll">
              <table className="data-table detail-table">
                <tbody>
                  {row.details.map((yt) => (
                    <tr key={yt.key}>
                      <td style={{ paddingLeft: 46 }}>
                        {yt.ticker}（{displayStockName(yt.market, yt.ticker, yt.name)}）
                      </td>
                      <td className={`num ${pnlClass(yt.realized)}`}>
                        {fmtSignedMoney(yt.realized, currency)}
                      </td>
                      <td className="num">{fmtMoney(yt.buyAmt, currency)}</td>
                      <td className="num">{fmtMoney(yt.sellAmt, currency)}</td>
                      <td className="num">{fmtMoney(yt.fees, currency, 2)}</td>
                      <td className="num">{fmtQty(yt.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function YearlyPage() {
  const { ledger } = useWorkspace()
  const { summary } = ledger

  if (ledger.years.length === 0) {
    return (
      <div className="glass empty-state section">
        <div className="empty-icon">
          <CalendarRange size={36} />
        </div>
        <div>還沒有任何交易紀錄，年度收益總覽會在你新增交易後自動生成。</div>
      </div>
    )
  }

  return (
    <>
      <div className="section kpi-grid">
        <div className="glass kpi">
          <div className="kpi-label">🇹🇼 台股歷史已實現 (TWD)</div>
          <div className={`kpi-value ${pnlClass(summary.realizedTw)}`}>
            {fmtSignedMoney(summary.realizedTw, 'TWD')}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">🇺🇸 美股歷史累計已實現 (USD)</div>
          <div className={`kpi-value ${pnlClass(summary.realizedUs)}`}>
            {fmtSignedMoney(summary.realizedUs, 'USD')}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">歷史累計手續費</div>
          <div className="kpi-value">{summary.fees.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
          <div className="kpi-sub">台美股合計（各依原幣別金額加總）</div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">歷史累計交易筆數</div>
          <div className="kpi-value">{fmtQty(summary.count)}</div>
        </div>
      </div>

      <YearlySection title="🇹🇼 台股 (TWD)" currency="TWD" />
      <YearlySection title="🇺🇸 美股 (USD)" currency="USD" />
    </>
  )
}
