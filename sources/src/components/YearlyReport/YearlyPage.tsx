/**
 * Annual income overview (realized gains and losses):
 * - Top 4 KPIs: Taiwan Stock Historical Realization (TWD), U.S. Stock Historical Realization (USD), Accumulated Handling Fees, Accumulated Number of Transactions
 * - Taiwan stocks/U.S. stocks are divided into upper and lower divisions, with separate annual tables, and currencies are completely separated (the same as the GAS version)
 * - The amount field adopts double rows of "fee included/fee not included" (the same as the average cost of the inventory overview):
 *   The main figure is the actual money paid and received, and the side figure is simply the transaction price.
 * - The year column can be expanded with individual stock details (including those that were only bought but not sold during the year)
 *
 * Only the selling side (selling cost / selling income / realized profit and loss) is displayed, and the purchase amount of the year is deliberately not displayed:
 * Buying includes positions that have not yet been sold in the current year. The three columns of selling in the same column are not the same batch of stocks. The juxtaposition will make people confused.
 * Mistakenly thinking that they can add and subtract from each other. The engine still has buyAmt / buyGross and can be taken back if needed.
 */
import { useMemo, useState, Fragment } from 'react'
import { CalendarRange, ChevronsDownUp, ChevronsUpDown, Minus, Plus, Search, X } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { Currency } from '../../types/models'
import type { YearTickerDetail } from '../../utils/pnlEngine'
import { displayStockName } from '../../services/usStockNames'
import { fmtMoney, fmtQty, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'
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
  feesTax: number
  count: number
  details: YearTickerDetail[]
}

/** Price difference without any fees: Transaction price − Cost without fees, for comparison by the deputy bank*/
function rawRealized(d: { sellGross: number; rawCostBasis: number }): number {
  return d.sellGross - d.rawCostBasis
}

/**
 * Does this stock match the search box? Same rule as the transactions page (`filterTransactions`):
 * code, original name, or the Chinese display name (AAPL → 蘋果), case-insensitive substring.
 */
function matchesQuery(yt: YearTickerDetail, q: string): boolean {
  if (!q) return true
  return (
    yt.ticker.toLowerCase().includes(q) ||
    yt.name.toLowerCase().includes(q) ||
    displayStockName(yt.market, yt.ticker, yt.name).toLowerCase().includes(q)
  )
}

/**
 * @param query Filters **which stocks are aggregated**, not just which rows are visible.
 *   Hiding the detail rows while leaving the year totals untouched would show a year whose total
 *   does not add up to anything on screen. Recomputing means the table reads as "this stock, by year",
 *   which is the question a search box is asked.
 */
function useSectionRows(currency: Currency, query: string): YearRow[] {
  const { ledger } = useWorkspace()
  return useMemo(() => {
    const q = query.trim().toLowerCase()
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
        feesTax: 0,
        count: 0,
        details: [],
      }
      for (const yt of Object.values(y.tickers)) {
        if (yt.currency !== currency) continue
        if (!matchesQuery(yt, q)) continue
        agg.realized += yt.realized
        agg.costBasis += yt.costBasis
        agg.rawCostBasis += yt.rawCostBasis
        agg.sellAmt += yt.sellAmt
        agg.sellGross += yt.sellGross
        agg.fees += yt.fees
        agg.feesTax += yt.feesTax
        agg.count += yt.count
        agg.details.push(yt)
      }
      if (agg.count === 0) continue
      // Those who have sold are ranked first (those who actually incurred profits and losses in the year), and the rest are listed according to code numbers.
      agg.details.sort(
        (a, b) =>
          Number(b.sellAmt !== 0) - Number(a.sellAmt !== 0) ||
          (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
      )
      rows.push(agg)
    }
    return rows
  }, [ledger, currency, query])
}

/** Amount cell: main number (including fees and taxes) + side row (excluding fees), isomorphic to the average cost of the inventory overview*/
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
  // When there is no corresponding entry or exit in the year (such as the three sell columns of "Buy Only" stocks), the whole box displays "—":
  // This is true only if both the fee-inclusive and the non-inclusive fees are 0 at the same time. A truly even sale will still have an uninclusive amount due to the fee difference, so there will be no misjudgment.
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

/**
 * Return rate cell: realized profit and loss ÷ selling cost, the main row includes fees and the sub-row does not include fees (the same format as the three columns on the left).
 *
 * When the denominator is 0, give null instead of counting: the cost and profit and loss of "only buy" stocks are both 0 (0/0 = NaN),
 * "Oversold" means the cost is calculated at 0 but there is profit and loss (x/0 = Infinity) - neither of which is a percentage that can be displayed.
 */
function RoiCell({
  realized,
  costBasis,
  raw,
  rawCostBasis,
}: {
  realized: number
  costBasis: number
  raw: number
  rawCostBasis: number
}) {
  const roi = costBasis !== 0 ? realized / costBasis : null
  const rawRoi = rawCostBasis !== 0 ? raw / rawCostBasis : null
  if (roi === null && rawRoi === null) {
    return <td className="num" style={{ color: 'var(--ink-muted)', opacity: 0.5 }}>—</td>
  }
  return (
    <td className={`num ${pnlClass(roi)}`}>
      <div style={{ fontWeight: 600 }}>{roi === null ? '—' : fmtSignedPercent(roi)}</div>
      <div style={{ fontSize: 11, opacity: 0.65, fontWeight: 400, color: 'var(--ink-muted)' }}>
        未含費 {rawRoi === null ? '—' : fmtSignedPercent(rawRoi)}
      </div>
    </td>
  )
}

/** Handling fee storage cell: The main number is the total of fees and taxes, and the sub-line is "handling fee | transaction tax"; the sub-line is not displayed when there is no tax (US stocks/buying only)*/
function FeeCell({ fees, feesTax, currency }: { fees: number; feesTax: number; currency: Currency }) {
  return (
    <td className="num">
      <div>{fmtMoney(fees, currency, 2)}</div>
      {feesTax > 0 && (
        <div style={{ fontSize: 11, opacity: 0.65, fontWeight: 400, color: 'var(--ink-muted)' }}>
          手續費 {fmtMoney(fees - feesTax, currency, 2)} ｜ 交易稅 {fmtMoney(feesTax, currency, 2)}
        </div>
      )}
    </td>
  )
}

function YearlySection({ title, currency, query }: { title: string; currency: Currency; query: string }) {
  const rows = useSectionRows(currency, query)
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
          {/* Two different nothings: an empty ledger is not the same as "your search matched nothing" */}
          {query.trim() ? `找不到符合「${query.trim()}」的股票` : '（尚無交易紀錄）'}
        </div>
      ) : (
        <div className="glass table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <HelpTh label="年度" help={YEAR_HELP.year} />
                <HelpTh label="賣出成本" help={YEAR_HELP.costBasis} numeric />
                <HelpTh label="賣出收入" help={YEAR_HELP.sellAmt} numeric />
                <HelpTh label="已實現損益" help={YEAR_HELP.realized} numeric />
                <HelpTh label="報酬率" help={YEAR_HELP.roi} numeric />
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
        <RoiCell
          realized={row.realized}
          costBasis={row.costBasis}
          raw={rawRealized(row)}
          rawCostBasis={row.rawCostBasis}
        />
        <FeeCell fees={row.fees} feesTax={row.feesTax} currency={currency} />
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
                        title="這一年只有買進、沒有賣出，所以還沒有賺賠"
                      >
                        僅買進
                      </span>
                    )}
                  </div>
                </td>
                <AmountCell value={yt.costBasis} raw={yt.rawCostBasis} currency={currency} />
                <AmountCell value={yt.sellAmt} raw={yt.sellGross} currency={currency} />
                <AmountCell value={yt.realized} raw={rawRealized(yt)} currency={currency} signed />
                <RoiCell
                  realized={yt.realized}
                  costBasis={yt.costBasis}
                  raw={rawRealized(yt)}
                  rawCostBasis={yt.rawCostBasis}
                />
                <FeeCell fees={yt.fees} feesTax={yt.feesTax} currency={currency} />
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
                          <span className="badge" style={{ marginLeft: 6 }} title="賣出股數超過持有股數，超出的部分成本以 0 計算">
                            超賣
                          </span>
                        )}
                      </div>
                    </td>
                    <AmountCell value={sell.costBasis} raw={sell.rawCostBasis} currency={currency} />
                    <AmountCell value={sell.sellAmt} raw={sell.sellGross} currency={currency} />
                    <AmountCell value={sell.realized} raw={rawRealized(sell)} currency={currency} signed />
                    <RoiCell
                      realized={sell.realized}
                      costBasis={sell.costBasis}
                      raw={rawRealized(sell)}
                      rawCostBasis={sell.rawCostBasis}
                    />
                    <FeeCell fees={sell.fees} feesTax={sell.feesTax} currency={currency} />
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
  const [query, setQuery] = useState('')

  if (ledger.years.length === 0) {
    return (
      <div className="glass empty-state section">
        <div className="empty-icon">
          <CalendarRange size={36} />
        </div>
        <div>還沒有任何交易紀錄，新增交易後這裡就會自動出現。</div>
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
          <div className="kpi-label">歷史累計手續費 (台美股合計)</div>
          <div className="kpi-value">{summary.fees.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
          <div className="kpi-sub" title="交易稅是依稅率（一般 0.3%、ETF 0.1%、債券 ETF 0%）回推的估計值">
            手續費 {summary.feesBrokerage.toLocaleString('en-US', { maximumFractionDigits: 2 })} ｜ 交易稅 {summary.feesTax.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">歷史累計交易筆數 (台美股合計)</div>
          <div className="kpi-value">{fmtQty(summary.count)}</div>
          <div className="kpi-sub">買入 {fmtQty(summary.buyCount)} ｜ 賣出 {fmtQty(summary.sellCount)}</div>
        </div>
      </div>

      {/*
        The box sits below the KPIs on purpose: the KPIs are lifetime totals over every trade and are
        **not** filtered, so putting the search above them would read as if it narrowed them too.
      */}
      <div className="section" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋代號或名稱"
            aria-label="搜尋年度收益的股票"
            className="search-input"
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="清除搜尋"
              onClick={() => setQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {query.trim() && <span className="hint">上方四張卡是全部交易的累計，不受搜尋影響。</span>}
      </div>

      <YearlySection title="🇹🇼 台股 (TWD)" currency="TWD" query={query} />
      <YearlySection title="🇺🇸 美股 (USD)" currency="USD" query={query} />
    </>
  )
}
