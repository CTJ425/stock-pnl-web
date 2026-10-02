/**
 * Annual income overview (realized gains and losses):
 * - Statement totals (2026-09-27): 台股 / 美股 lifetime realized P&L, fees and trade counts, then the
 *   charts (YearlyOverview), then the ledger.
 * - Taiwan stocks/U.S. stocks are divided into upper and lower divisions, with separate annual tables, and currencies are completely separated (the same as the GAS version)
 * - One number per cell: the fee-inclusive figure (actual money paid and received). The fee-exclusive
 *   「未含費」 line only appears on the individual sell rows, the deepest expansion — the same rule as
 *   庫存總覽, where it lives in the row's detail. 手續費 and 交易稅 are separate columns on every row.
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
import type { SellDetail, YearTickerDetail } from '../../utils/pnlEngine'
import { displayStockName } from '../../services/usStockNames'
import { fmtMoney, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import {
  AmountCell,
  DividendCell,
  FeeCells,
  MutedDashCell,
  RoiCell,
  TotalReturnCell,
} from './cells'
import { YEAR_HELP } from './columnHelp'
import { rawRealized, roiBasis } from './pnlMath'
import { DividendSection } from './DividendSection'
import { RangeSection } from './RangeSection'
import { YearlyOverview } from './YearlyOverview'

// Task 166 EN-01: kept local rather than added to columnHelp.ts — that file is column-help text
// for the pre-dividend report and isn't part of this task's file list.
const DIVIDEND_HELP = '這一年（或這檔股票）收到的股利淨額，已經扣掉二代健保、匯費等代扣費用。股票股利只影響股數和成本，不會出現在這裡。'
const TOTAL_RETURN_HELP = '已實現損益加上股利，這一年真正到手的總報酬（僅在年度小計顯示，個股與逐筆明細顯示「—」）。'

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
  /** Net cash dividends for this currency section this year (DA/EN-01) */
  dividends: number
  /** Every sell leg aggregated into this row, kept only to feed `roiBasis` (DA-07) */
  sells: SellDetail[]
  details: YearTickerDetail[]
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
        dividends: 0,
        sells: [],
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
        agg.dividends += yt.dividends
        agg.sells.push(...yt.sells)
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

  // A search asks for one stock's sells, and those only live inside the collapsed year and ticker
  // rows — so open everything the search matched, and fold back to the default when it is cleared.
  // Adjusted during render (not in an effect) so the first frame of a new query is already open.
  const q = query.trim()
  const [openedFor, setOpenedFor] = useState('')
  if (q !== openedFor) {
    setOpenedFor(q)
    setExpanded(new Set(q ? rows.map((r) => r.year) : []))
    setExpandedTickers(new Set(q ? allTickerKeys : []))
  }

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
                {HEADS.map(([label, , numeric], i) => (
                  <th key={label} scope="col" className={numeric ? 'num' : undefined}>
                    {label}
                    <sup>{i + 1}</sup>
                  </th>
                ))}
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

/** Column heads with their footnotes, printed under the tables instead of behind 「?」 icons. */
const HEADS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['年度', YEAR_HELP.year, false],
  ['賣出成本', YEAR_HELP.costBasis, true],
  ['賣出收入', YEAR_HELP.sellAmt, true],
  ['已實現損益', YEAR_HELP.realized, true],
  ['報酬率', YEAR_HELP.roi, true],
  ['股利', DIVIDEND_HELP, true],
  ['總報酬', TOTAL_RETURN_HELP, true],
  ['手續費', YEAR_HELP.brokerage, true],
  ['交易稅', YEAR_HELP.tax, true],
  ['交易筆數', YEAR_HELP.count, true],
]

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
  const yearRoi = roiBasis(row.sells)
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
          realized={yearRoi.realized}
          costBasis={yearRoi.costBasis}
          raw={yearRoi.raw}
          rawCostBasis={yearRoi.rawCostBasis}
        />
        <DividendCell value={row.dividends} currency={currency} />
        <TotalReturnCell realized={row.realized} dividends={row.dividends} currency={currency} />
        <FeeCells fees={row.fees} feesTax={row.feesTax} currency={currency} />
        <td className="num">{fmtQty(row.count)}</td>
      </tr>
      {/* Detail rows live inside the same table: a nested table computes its own column widths and the numbers stop lining up with the header above */}
      {isOpen &&
        row.details.map((yt) => {
          const tickerKey = `${row.year}|${yt.key}`
          const isTickerOpen = expandedTickers.has(tickerKey)
          const tickerRoi = roiBasis(yt.sells)
          return (
            <Fragment key={yt.key}>
              <tr className="detail-row">
                <td>
                  {/* Icon shares the year row's column (an empty slot where there is no button); hierarchy is carried by row background and weight */}
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
                    {/* buyAmt !== 0 excludes a dividend-only ticker-year (Task 166 EN-01): a
                        DIVIDEND row never touches buyAmt, so "僅買進" would otherwise mislabel it. */}
                    {yt.sellAmt === 0 && yt.buyAmt !== 0 && (
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
                  realized={tickerRoi.realized}
                  costBasis={tickerRoi.costBasis}
                  raw={tickerRoi.raw}
                  rawCostBasis={tickerRoi.rawCostBasis}
                />
                <DividendCell value={yt.dividends} currency={currency} />
                <MutedDashCell />
                <FeeCells fees={yt.fees} feesTax={yt.feesTax} currency={currency} />
                <td className="num">{fmtQty(yt.count)}</td>
              </tr>
              {isTickerOpen &&
                yt.sells.map((sell) => (
                  <tr key={sell.legId} className="detail-row sell-row">
                    <td title={`當時平均成本 ${sell.avgCost.toFixed(2)}`}>
                      {/* Aligned to where the parent's ticker text starts (32 = 22px icon + 10px gap) */}
                      <div className="cell-tree" style={{ paddingLeft: 32 }}>
                        {sell.date}　{sell.kind === 'SHORT_COVER' ? '回補' : '賣出'} {fmtQty(sell.qty)} 股 ｜ {sell.price}
                        {sell.oversold && (
                          <span className="badge" style={{ marginLeft: 6 }} title="賣出股數超過持有股數，超出的部分成本以 0 計算">
                            超賣
                          </span>
                        )}
                      </div>
                    </td>
                    <AmountCell value={sell.costBasis} raw={sell.rawCostBasis} currency={currency} showRaw />
                    <AmountCell value={sell.sellAmt} raw={sell.sellGross} currency={currency} showRaw />
                    <AmountCell value={sell.realized} raw={rawRealized(sell)} currency={currency} signed showRaw />
                    <RoiCell
                      realized={sell.realized}
                      costBasis={sell.costBasis}
                      raw={rawRealized(sell)}
                      rawCostBasis={sell.rawCostBasis}
                      showRaw
                    />
                    <MutedDashCell />
                    <MutedDashCell />
                    <FeeCells fees={sell.fees} feesTax={sell.feesTax} currency={currency} />
                    <MutedDashCell />
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
  // BUG-104: `summary.fees` is mixed-currency on purpose (it mirrors the old GAS KPI and the Edge
  // copy of the engine), so this card cannot print it. Sum the per-ticker figures instead: each
  // ticker carries its own currency, and these are the same numbers the two sections below add up.
  const feesByCurrency = useMemo(() => {
    const acc: Record<Currency, { fees: number; tax: number }> = { TWD: { fees: 0, tax: 0 }, USD: { fees: 0, tax: 0 } }
    for (const year of ledger.years) {
      for (const yt of Object.values(ledger.yearly[year].tickers)) {
        acc[yt.currency].fees += yt.fees
        acc[yt.currency].tax += yt.feesTax
      }
    }
    return acc
  }, [ledger])

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

  const fmtPlain = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  // Borrow fees exist only on TW 融券 sells (`splitFeeTax`), so the whole of it belongs to the TW line.
  const { TWD: tw, USD: us } = feesByCurrency
  return (
    <>
      {/* Lifetime totals over every trade: not filtered by the search below. */}
      <section className="stmt-totals yr-totals" aria-label="歷年合計">
        <div className="stmt-tot stmt-tot-lead">
          <h2>
            台股歷史已實現 (TWD)<span className="stmt-asof">歷年合計，含費</span>
          </h2>
          <div className={`stmt-fig stmt-fig-hero ${pnlClass(summary.realizedTw)}`}>
            {fmtSignedMoney(summary.realizedTw, 'TWD')}
          </div>
          <div className="stmt-sub">
            <span>
              股利 <b>{fmtMoney(summary.dividendsTw, 'TWD')}</b>
            </span>
          </div>
        </div>
        <div className="stmt-tot">
          <h2>
            美股歷史累計已實現 (USD)<span className="stmt-asof">歷年合計</span>
          </h2>
          <div className={`stmt-fig ${pnlClass(summary.realizedUs)}`}>{fmtSignedMoney(summary.realizedUs, 'USD')}</div>
          <div className="stmt-sub">
            <span>
              股利 <b>{fmtMoney(summary.dividendsUs, 'USD')}</b>
            </span>
          </div>
        </div>
        <div className="stmt-tot">
          <h2>歷史累計交易筆數 (台美股合計)</h2>
          <div className="stmt-fig">{fmtQty(summary.count)}</div>
          <div className="stmt-sub stmt-sub-lines">
            <span>
              買入 {fmtQty(summary.buyCount)}・賣出 {fmtQty(summary.sellCount)}
              {summary.dividendCount > 0 && <>・股利 {fmtQty(summary.dividendCount)}</>}
            </span>
            <span title="交易稅是依稅率（一般 0.3%、ETF 0.1%、債券 ETF 0%）回推的估計值">
              台股手續費與稅 {fmtMoney(tw.fees, 'TWD')}（手續費 {fmtPlain(tw.fees - tw.tax - summary.feesBorrow)}・交易稅{' '}
              {fmtPlain(tw.tax)}
              {summary.feesBorrow > 0 && <>・借券費 {fmtPlain(summary.feesBorrow)}</>}）
            </span>
            {us.fees > 0 && <span>美股手續費 {fmtMoney(us.fees, 'USD')}</span>}
          </div>
        </div>
      </section>

      <YearlyOverview ledger={ledger} />

      {/* Between the year-by-year picture and the year-by-year ledger: a window the user picks. */}
      <RangeSection ledger={ledger} />

      {/*
        股利 (Task 183). Above the search for the same reason as the KPIs: it is a whole year's
        dividends, not a filtered slice. One section per market — no FX rate is known here.
      */}
      <DividendSection title="台股 (TWD)" currency="TWD" />
      <DividendSection title="美股 (USD)" currency="USD" />

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
        {query.trim() && <span className="hint">最上方的合計與圖表是全部交易的累計，不受搜尋影響。</span>}
      </div>

      <YearlySection title="台股 (TWD)" currency="TWD" query={query} />
      <YearlySection title="美股 (USD)" currency="USD" query={query} />
      <ol className="stmt-notes">
        {HEADS.map(([label, help]) => (
          <li key={label}>
            {label}：{help}
          </li>
        ))}
      </ol>
    </>
  )
}
