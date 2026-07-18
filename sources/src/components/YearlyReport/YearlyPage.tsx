/**
 * 年度收益總覽（已實現損益）：
 * - 頂部 4 大 KPI：台股歷史已實現 (TWD)、美股歷史已實現 (USD)、累計手續費、累計交易筆數
 * - 台股 / 美股上下分區，各自獨立年度表格，幣別完全分開（與 GAS 版同構）
 * - 金額欄位採「含費 / 未含費」雙行（與庫存總覽的平均成本同構）：
 *   主數字為實際付出與收到的錢，副行為單純成交價金
 * - 年度列可展開個股明細（含當年只買進、尚未賣出者）
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
import { YEAR_HELP } from './columnHelp'

type YearSortKey =
  | 'year'
  | 'realized'
  | 'buyAmt'
  | 'costBasis'
  | 'sellAmt'
  | 'fees'
  | 'count'

interface YearRow {
  year: number
  realized: number
  buyAmt: number
  buyGross: number
  costBasis: number
  rawCostBasis: number
  sellAmt: number
  sellGross: number
  fees: number
  count: number
  details: YearTickerDetail[]
}

/** 未含任何費用的價差：成交價金 − 未含費成本，供副行對照 */
function rawRealized(d: { sellGross: number; rawCostBasis: number }): number {
  return d.sellGross - d.rawCostBasis
}

function useSectionRows(currency: Currency): YearRow[] {
  const { ledger } = useWorkspace()
  return useMemo(() => {
    const rows: YearRow[] = []
    for (const year of ledger.years) {
      const y = ledger.yearly[year]
      const agg: YearRow = {
        year,
        realized: 0,
        buyAmt: 0,
        buyGross: 0,
        costBasis: 0,
        rawCostBasis: 0,
        sellAmt: 0,
        sellGross: 0,
        fees: 0,
        count: 0,
        details: [],
      }
      for (const yt of Object.values(y.tickers)) {
        if (yt.currency !== currency) continue
        agg.realized += yt.realized
        agg.buyAmt += yt.buyAmt
        agg.buyGross += yt.buyGross
        agg.costBasis += yt.costBasis
        agg.rawCostBasis += yt.rawCostBasis
        agg.sellAmt += yt.sellAmt
        agg.sellGross += yt.sellGross
        agg.fees += yt.fees
        agg.count += yt.count
        agg.details.push(yt)
      }
      if (agg.count === 0) continue
      // 有賣出的排前面（該年真正產生損益者），其餘依代號
      agg.details.sort(
        (a, b) =>
          Number(b.sellAmt !== 0) - Number(a.sellAmt !== 0) ||
          (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
      )
      rows.push(agg)
    }
    return rows
  }, [ledger, currency])
}

/** 金額儲存格：主數字（含費稅）＋副行（未含費），與庫存總覽的平均成本同構 */
function AmountCell({
  value,
  raw,
  currency,
  signed,
  rawLabel = '未含費',
}: {
  value: number
  raw: number
  currency: Currency
  signed?: boolean
  rawLabel?: string
}) {
  // 該年沒有對應進出時（如只買沒賣的年度賣出欄）不顯示副行，避免整排 0 的雜訊
  const showRaw = value !== 0 || raw !== 0
  return (
    <td className={signed ? `num ${pnlClass(value)}` : 'num'}>
      <div style={{ fontWeight: signed ? 600 : undefined }}>
        {signed ? fmtSignedMoney(value, currency) : fmtMoney(value, currency)}
      </div>
      {showRaw && (
        <div style={{ fontSize: 11, opacity: 0.65, fontWeight: 400, color: 'var(--ink-muted)' }}>
          {rawLabel} {signed ? fmtSignedMoney(raw, currency) : fmtMoney(raw, currency)}
        </div>
      )}
    </td>
  )
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
                <SortableTh label="年度" sortKey="year" sort={sort} onSort={handleSort} help={YEAR_HELP.year} />
                <SortableTh label="買進總支出" sortKey="buyAmt" sort={sort} onSort={handleSort} numeric help={YEAR_HELP.buyAmt} />
                <SortableTh label="賣出成本" sortKey="costBasis" sort={sort} onSort={handleSort} numeric help={YEAR_HELP.costBasis} />
                <SortableTh label="賣出收入" sortKey="sellAmt" sort={sort} onSort={handleSort} numeric help={YEAR_HELP.sellAmt} />
                <SortableTh label="已實現損益" sortKey="realized" sort={sort} onSort={handleSort} numeric help={YEAR_HELP.realized} />
                <SortableTh label="手續費 / 稅金" sortKey="fees" sort={sort} onSort={handleSort} numeric help={YEAR_HELP.fees} />
                <SortableTh label="交易筆數" sortKey="count" sort={sort} onSort={handleSort} numeric help={YEAR_HELP.count} />
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
        <AmountCell value={row.buyAmt} raw={row.buyGross} currency={currency} />
        <AmountCell value={row.costBasis} raw={row.rawCostBasis} currency={currency} />
        <AmountCell value={row.sellAmt} raw={row.sellGross} currency={currency} />
        <AmountCell value={row.realized} raw={rawRealized(row)} currency={currency} signed />
        <td className="num">{fmtMoney(row.fees, currency, 2)}</td>
        <td className="num">{fmtQty(row.count)}</td>
      </tr>
      {/* 明細列直接放在同一個表格內：巢狀表格的欄寬各自計算，數字會對不到上方欄位 */}
      {isOpen &&
        row.details.map((yt) => (
          <tr key={yt.key} className="detail-row">
            <td style={{ paddingLeft: 46 }}>
              {yt.ticker}（{displayStockName(yt.market, yt.ticker, yt.name)}）
              {yt.sellAmt === 0 && (
                <span
                  className="badge"
                  style={{ marginLeft: 6 }}
                  title="這一年只有買進、沒有賣出，因此不產生已實現損益"
                >
                  僅買進
                </span>
              )}
            </td>
            <AmountCell value={yt.buyAmt} raw={yt.buyGross} currency={currency} />
            <AmountCell value={yt.costBasis} raw={yt.rawCostBasis} currency={currency} />
            <AmountCell value={yt.sellAmt} raw={yt.sellGross} currency={currency} />
            <AmountCell value={yt.realized} raw={rawRealized(yt)} currency={currency} signed />
            <td className="num">{fmtMoney(yt.fees, currency, 2)}</td>
            <td className="num">{fmtQty(yt.count)}</td>
          </tr>
        ))}
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
