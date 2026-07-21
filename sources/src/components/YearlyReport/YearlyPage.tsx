/**
 * 年度收益總覽（已實現損益）：
 * - 頂部 4 大 KPI：台股歷史已實現 (TWD)、美股歷史已實現 (USD)、累計手續費、累計交易筆數
 * - 台股 / 美股上下分區，各自獨立年度表格，幣別完全分開（與 GAS 版同構）
 * - 金額欄位採「含費 / 未含費」雙行（與庫存總覽的平均成本同構）：
 *   主數字為實際付出與收到的錢，副行為單純成交價金
 * - 年度列可展開個股明細（含當年只買進、尚未賣出者）
 *
 * 只呈現賣出側（賣出成本 / 賣出收入 / 已實現損益），刻意不顯示當年買進金額：
 * 買進含當年尚未賣出的部位，與同一列的賣出三欄不是同一批股票，並列會讓人
 * 誤以為可以互相加減。engine 仍保有 buyAmt / buyGross，需要時可再接回。
 */
import { useMemo, useState, Fragment } from 'react'
import { CalendarRange, ChevronsDownUp, ChevronsUpDown, Minus, Plus } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { Currency } from '../../types/models'
import type { YearTickerDetail } from '../../utils/pnlEngine'
import { displayStockName } from '../../services/usStockNames'
import { fmtMoney, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import { HelpTh } from '../Common/HelpTh'
import { YEAR_HELP } from './columnHelp'

interface YearRow {
  year: number
  realized: number
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
  // 該年沒有對應進出（如「僅買進」個股的賣出三欄）時整格顯示「—」：
  // 含費與未含費同時為 0 才成立，真正打平的賣出因費用差仍會有未含費金額，不會誤判
  const hasActivity = value !== 0 || raw !== 0
  if (!hasActivity) {
    return <td className="num" style={{ color: 'var(--ink-muted)', opacity: 0.5 }}>—</td>
  }
  return (
    <td className={signed ? `num ${pnlClass(value)}` : 'num'}>
      <div style={{ fontWeight: signed ? 600 : undefined }}>
        {signed ? fmtSignedMoney(value, currency) : fmtMoney(value, currency)}
      </div>
      <div style={{ fontSize: 11, opacity: 0.65, fontWeight: 400, color: 'var(--ink-muted)' }}>
        {rawLabel} {signed ? fmtSignedMoney(raw, currency) : fmtMoney(raw, currency)}
      </div>
    </td>
  )
}

function YearlySection({ title, currency }: { title: string; currency: Currency }) {
  const rows = useSectionRows(currency)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(new Set())

  const allTickerKeys = rows.flatMap((r) =>
    r.details.filter((yt) => yt.sells.length > 0).map((yt) => `${r.year}|${yt.key}`),
  )
  const allOpen =
    rows.length > 0 &&
    rows.every((r) => expanded.has(r.year)) &&
    allTickerKeys.every((k) => expandedTickers.has(k))

  const toggleAll = () => {
    if (allOpen) {
      setExpanded(new Set())
      setExpandedTickers(new Set())
    } else {
      setExpanded(new Set(rows.map((r) => r.year)))
      setExpandedTickers(new Set(allTickerKeys))
    }
  }

  const toggle = (year: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  const toggleTicker = (key: string) => {
    setExpandedTickers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="section">
      <div className="section-title">
        <h2 style={{ fontSize: 14 }}>{title}</h2>
        {rows.length > 0 && (
          <button className="btn btn-sm" onClick={toggleAll}>
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {allOpen ? '全部收起' : '全部展開'}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="glass empty-state" style={{ padding: '26px 20px' }}>
          （尚無交易紀錄）
        </div>
      ) : (
        <div className="glass table-scroll table-scroll-y">
          <table className="data-table">
            <thead>
              <tr>
                <HelpTh label="年度" help={YEAR_HELP.year} />
                <HelpTh label="賣出成本" help={YEAR_HELP.costBasis} numeric />
                <HelpTh label="賣出收入" help={YEAR_HELP.sellAmt} numeric />
                <HelpTh label="已實現損益" help={YEAR_HELP.realized} numeric />
                <HelpTh label="手續費 / 稅金" help={YEAR_HELP.fees} numeric />
                <HelpTh label="交易筆數" help={YEAR_HELP.count} numeric />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOpen = expanded.has(row.year)
                return (
                  <YearRows
                    key={row.year}
                    row={row}
                    currency={currency}
                    isOpen={isOpen}
                    onToggle={() => toggle(row.year)}
                    expandedTickers={expandedTickers}
                    onToggleTicker={toggleTicker}
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
  expandedTickers,
  onToggleTicker,
}: {
  row: YearRow
  currency: Currency
  isOpen: boolean
  onToggle: () => void
  expandedTickers: Set<string>
  onToggleTicker: (key: string) => void
}) {
  return (
    <>
      <tr style={{ fontWeight: 600 }}>
        <td>
          <div className="cell-tree">
            {row.details.length > 0 ? (
              <button
                className="year-toggle"
                onClick={onToggle}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? '收合' : '展開'} ${row.year} 年度個股明細`}
              >
                {isOpen ? <Minus size={13} /> : <Plus size={13} />}
              </button>
            ) : (
              <span className="toggle-slot" />
            )}
            {row.year}
          </div>
        </td>
        <AmountCell value={row.costBasis} raw={row.rawCostBasis} currency={currency} />
        <AmountCell value={row.sellAmt} raw={row.sellGross} currency={currency} />
        <AmountCell value={row.realized} raw={rawRealized(row)} currency={currency} signed />
        <td className="num">{fmtMoney(row.fees, currency, 2)}</td>
        <td className="num">{fmtQty(row.count)}</td>
      </tr>
      {/* 明細列直接放在同一個表格內：巢狀表格的欄寬各自計算，數字會對不到上方欄位 */}
      {isOpen &&
        row.details.map((yt) => {
          const tickerKey = `${row.year}|${yt.key}`
          const isTickerOpen = expandedTickers.has(tickerKey)
          return (
            <Fragment key={yt.key}>
              <tr className="detail-row">
                <td>
                  {/* 圖示與年度列同一直欄（無鈕以空槽補位），層級由列底色與字重呈現 */}
                  <div className="cell-tree">
                    {yt.sells.length > 0 ? (
                      <button
                        className="year-toggle"
                        onClick={() => onToggleTicker(tickerKey)}
                        aria-expanded={isTickerOpen}
                        aria-label={`${isTickerOpen ? '收合' : '展開'} ${yt.ticker} 逐筆賣出明細`}
                      >
                        {isTickerOpen ? <Minus size={13} /> : <Plus size={13} />}
                      </button>
                    ) : (
                      <span className="toggle-slot" />
                    )}
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
                  </div>
                </td>
                <AmountCell value={yt.costBasis} raw={yt.rawCostBasis} currency={currency} />
                <AmountCell value={yt.sellAmt} raw={yt.sellGross} currency={currency} />
                <AmountCell value={yt.realized} raw={rawRealized(yt)} currency={currency} signed />
                <td className="num">{fmtMoney(yt.fees, currency, 2)}</td>
                <td className="num">{fmtQty(yt.count)}</td>
              </tr>
              {isTickerOpen &&
                yt.sells.map((sell) => (
                  <tr key={sell.txId} className="detail-row sell-row">
                    <td title={`當時平均成本 ${sell.avgCost.toFixed(2)}`}>
                      {/* 貼齊父層個股文字起點（32 = 圖示 22 + 間距 10） */}
                      <div className="cell-tree" style={{ paddingLeft: 32 }}>
                        {sell.date}　賣出 {fmtQty(sell.qty)} 股 ｜ {sell.price}
                        {sell.oversold && (
                          <span className="badge" style={{ marginLeft: 6 }} title="超賣：超賣部分成本以 0 計算">
                            超賣
                          </span>
                        )}
                      </div>
                    </td>
                    <AmountCell value={sell.costBasis} raw={sell.rawCostBasis} currency={currency} />
                    <AmountCell value={sell.sellAmt} raw={sell.sellGross} currency={currency} />
                    <AmountCell value={sell.realized} raw={rawRealized(sell)} currency={currency} signed />
                    <td className="num">{fmtMoney(sell.fees, currency, 2)}</td>
                    <td className="num" style={{ color: 'var(--ink-muted)', opacity: 0.5 }}>—</td>
                  </tr>
                ))}
            </Fragment>
          )
        })}
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
          <div className="kpi-sub">買入 {fmtQty(summary.buyCount)} ｜ 賣出 {fmtQty(summary.sellCount)}</div>
        </div>
      </div>

      <YearlySection title="🇹🇼 台股 (TWD)" currency="TWD" />
      <YearlySection title="🇺🇸 美股 (USD)" currency="USD" />
    </>
  )
}
