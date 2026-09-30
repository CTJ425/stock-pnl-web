/**
 * 區間收益 (Task 176): pick any window and see which stocks made or lost money in it.
 *
 * Sits between the charts and the yearly tables — lifetime totals, then year by year, then "a stretch
 * I chose myself", then the ledger. It counts only money already in the account: realized sells and
 * cash dividends. Shares still held never appear, so a stock bought inside the window and not sold is
 * absent by design; its paper gain belongs to 庫存總覽's "now", not to a date range.
 *
 * One currency at a time, like the charts above: TWD and USD never share a total (no FX here).
 * All the arithmetic lives in `rangeRows.ts`; this file only picks the window and prints the result.
 */
import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { Currency } from '../../types/models'
import type { Ledger } from '../../utils/pnlEngine'
import { displayStockName } from '../../services/usStockNames'
import { fmtMoney, fmtQty, fmtSignedMoney, pnlClass } from '../../utils/formatters'
import { taipeiDateKey } from '../../utils/taipeiDate'
import { AmountCell, DividendCell, MutedDashCell, RoiCell, TotalReturnCell } from './cells'
import { rawRealized, roiBasis } from './pnlMath'
import {
  ledgerSpan,
  rangeRoi,
  rangeRows,
  RANGE_PRESETS,
  resolveRange,
  type RangePreset,
  type RangeTickerRow,
} from './rangeRows'

const HEADS: ReadonlyArray<readonly [string, boolean]> = [
  ['股票', false],
  ['已實現損益', true],
  ['股利', true],
  ['總報酬', true],
  ['報酬率', true],
  ['賣出成本', true],
  ['賣出收入', true],
  ['賣出筆數', true],
]

function TickerRows({
  row,
  currency,
  isOpen,
  onToggle,
}: {
  row: RangeTickerRow
  currency: Currency
  isOpen: boolean
  onToggle: () => void
}) {
  const roi = roiBasis(row.sells)
  const dividendOnly = row.sells.length === 0
  return (
    <>
      <tr>
        <td>
          <div className="cell-tree">
            {row.sells.length > 0 ? (
              <button
                className="year-toggle"
                onClick={onToggle}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? '收合' : '展開'} ${row.ticker} 區間內的逐筆賣出`}
              >
                {isOpen ? <Minus size={13} /> : <Plus size={13} />}
              </button>
            ) : (
              <span className="toggle-slot" />
            )}
            {row.ticker}（{displayStockName(row.market, row.ticker, row.name)}）
            {dividendOnly && (
              <span className="badge" style={{ marginLeft: 6 }} title="這段期間只領到股利，沒有賣出">
                僅股利
              </span>
            )}
          </div>
        </td>
        <AmountCell value={row.realized} raw={rawRealized(row)} currency={currency} signed />
        <DividendCell value={row.dividends} currency={currency} />
        <TotalReturnCell realized={row.realized} dividends={row.dividends} currency={currency} />
        <RoiCell
          realized={roi.realized}
          costBasis={roi.costBasis}
          raw={roi.raw}
          rawCostBasis={roi.rawCostBasis}
        />
        <AmountCell value={row.costBasis} raw={row.rawCostBasis} currency={currency} />
        <AmountCell value={row.sellAmt} raw={row.sellGross} currency={currency} />
        {row.sells.length === 0 ? <MutedDashCell /> : <td className="num">{fmtQty(row.sells.length)}</td>}
      </tr>
      {isOpen &&
        row.sells.map((sell) => (
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
            <AmountCell value={sell.realized} raw={rawRealized(sell)} currency={currency} signed showRaw />
            <MutedDashCell />
            <MutedDashCell />
            <RoiCell
              realized={sell.realized}
              costBasis={sell.costBasis}
              raw={rawRealized(sell)}
              rawCostBasis={sell.rawCostBasis}
              showRaw
            />
            <AmountCell value={sell.costBasis} raw={sell.rawCostBasis} currency={currency} showRaw />
            <AmountCell value={sell.sellAmt} raw={sell.sellGross} currency={currency} showRaw />
            <MutedDashCell />
          </tr>
        ))}
    </>
  )
}

export function RangeSection({ ledger }: { ledger: Ledger }) {
  // The Taipei calendar date, read once per mount: the presets mean the real last month / last year,
  // so an empty table is the honest answer when nothing was sold in that stretch.
  const today = useMemo(() => taipeiDateKey(new Date()), [])
  const span = useMemo(() => ledgerSpan(ledger), [ledger])

  // 近 1 年 by default: the rolling window is what this section adds over the year-by-year table
  // right below it, and it always crosses a year boundary.
  const [preset, setPreset] = useState<RangePreset>('1y')
  const initial = useMemo(() => resolveRange('1y', today, span), [today, span])
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const hasTw = useMemo(() => hasCurrency(ledger, 'TWD'), [ledger])
  const hasUs = useMemo(() => hasCurrency(ledger, 'USD'), [ledger])
  const [currency, setCurrency] = useState<Currency>(hasTw ? 'TWD' : 'USD')
  const both = hasTw && hasUs

  // The custom fields cannot reach past today or past the last recorded leg, whichever is later.
  // Guarded for a null span because this runs before the early return below — hooks come first.
  const latest = span && span.to > today ? span.to : today
  const invalid = from > to
  const result = useMemo(
    () => (invalid ? null : rangeRows(ledger, currency, { from, to })),
    [ledger, currency, from, to, invalid],
  )
  const [openTickers, setOpenTickers] = useState<Set<string>>(new Set())

  // No sell and no dividend anywhere: the section has nothing it could ever show, so stay out of the
  // way instead of printing an empty frame. The yearly tables below still list the buys.
  if (!span) return null

  const pick = (id: RangePreset) => {
    setPreset(id)
    if (id === 'custom') return
    const next = resolveRange(id, today, span)
    setFrom(next.from)
    setTo(next.to)
  }

  const editFrom = (value: string) => {
    setPreset('custom')
    setFrom(value)
  }
  const editTo = (value: string) => {
    setPreset('custom')
    setTo(value)
  }

  const toggleTicker = (key: string) => {
    setOpenTickers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totals = result?.totals
  const totalRoi = result ? rangeRoi(result.rows) : null

  return (
    <div className="section yr-range">
      {/* `.yr-head` rather than `.section-title`: it wraps, so the note drops to its own line on a
          phone instead of being squeezed off the edge — the same head the charts above use. */}
      <div className="yr-head">
        <h2>區間收益</h2>
        <span className="yr-note">自己挑一段時間，看哪幾檔賺了多少</span>
      </div>

      {both && (
        <div className="yr-ccy seg" role="group" aria-label="區間收益幣別">
          {(['TWD', 'USD'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => {
                setCurrency(c)
                setOpenTickers(new Set())
              }}
            >
              {c === 'TWD' ? '台股' : '美股'}
            </button>
          ))}
        </div>
      )}

      <div className="glass yr-range-panel">
        <div className="m-range" role="group" aria-label="時間區間">
          {RANGE_PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => pick(p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="yr-range-dates">
          {/* Label and field stay glued: at phone width the row wraps between the pairs, never inside one. */}
          <span className="yr-range-date">
            <label htmlFor="yr-range-from">起</label>
            <input
              id="yr-range-from"
              type="date"
              value={from}
              min={span.from}
              max={latest}
              onChange={(e) => editFrom(e.target.value)}
            />
          </span>
          <span className="yr-range-date">
            <label htmlFor="yr-range-to">訖</label>
            <input
              id="yr-range-to"
              type="date"
              value={to}
              min={span.from}
              max={latest}
              onChange={(e) => editTo(e.target.value)}
            />
          </span>
          <span className="hint">起訖日都包含在內</span>
        </div>

        {invalid || !result || !totals || !totalRoi ? (
          <div className="empty-state" style={{ padding: '22px 4px' }}>
            起始日晚於結束日，請重新選一次。
          </div>
        ) : result.empty ? (
          <div className="empty-state" style={{ padding: '22px 4px' }}>
            這段期間沒有賣出，也沒有領到股利，所以還沒有落袋的賺賠。
          </div>
        ) : (
          <>
            <div className="yr-range-kpis">
              <div className="yr-range-kpi">
                <h3>區間總報酬</h3>
                <div className={`yr-range-fig ${pnlClass(totals.total)}`}>
                  {fmtSignedMoney(totals.total, currency)}
                </div>
                <span className="yr-range-sub">已實現損益＋股利</span>
              </div>
              <div className="yr-range-kpi">
                <h3>已實現損益</h3>
                <div className={`yr-range-fig ${pnlClass(totals.realized)}`}>
                  {fmtSignedMoney(totals.realized, currency)}
                </div>
                <span className="yr-range-sub">賣出 {fmtQty(totals.sellCount)} 筆</span>
              </div>
              <div className="yr-range-kpi">
                <h3>股利</h3>
                <div className="yr-range-fig">{fmtMoney(totals.dividends, currency)}</div>
                <span className="yr-range-sub">已扣掉二代健保等代扣費用</span>
              </div>
              <div className="yr-range-kpi">
                <h3>賺賠檔數</h3>
                <div className="yr-range-fig">
                  <span className="pnl-up">{totals.gainers}</span> / <span className="pnl-down">{totals.losers}</span>
                </div>
                <span className="yr-range-sub">賺的檔數 / 賠的檔數</span>
              </div>
            </div>

            <div className="table-scroll">
              <table className="data-table" aria-label={`${currency === 'TWD' ? '台股' : '美股'} ${from} 到 ${to} 的區間收益`}>
                <thead>
                  <tr>
                    {HEADS.map(([label, numeric]) => (
                      <th key={label} scope="col" className={numeric ? 'num' : undefined}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <TickerRows
                      key={row.key}
                      row={row}
                      currency={currency}
                      isOpen={openTickers.has(row.key)}
                      onToggle={() => toggleTicker(row.key)}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600 }}>
                    <td>合計（{result.rows.length} 檔）</td>
                    <AmountCell value={totals.realized} raw={rawRealized(totals)} currency={currency} signed />
                    <DividendCell value={totals.dividends} currency={currency} />
                    <TotalReturnCell realized={totals.realized} dividends={totals.dividends} currency={currency} />
                    <RoiCell
                      realized={totalRoi.realized}
                      costBasis={totalRoi.costBasis}
                      raw={totalRoi.raw}
                      rawCostBasis={totalRoi.rawCostBasis}
                    />
                    <AmountCell value={totals.costBasis} raw={totals.rawCostBasis} currency={currency} />
                    <AmountCell value={totals.sellAmt} raw={totals.sellGross} currency={currency} />
                    <td className="num">{fmtQty(totals.sellCount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="yr-range-foot">
              只算已經落袋的錢：這段期間的賣出（含融券回補）和領到的現金股利。還沒賣掉的庫存不算在內，
              要看帳面上的賺賠請到庫存總覽。區間如果切在年中，合計不會等於下面任何一年的數字。
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/** Does the ledger hold any sell or dividend leg in this currency? Decides whether the 台股／美股 switch appears. */
function hasCurrency(ledger: Ledger, currency: Currency): boolean {
  for (const year of ledger.years) {
    for (const yt of Object.values(ledger.yearly[year].tickers)) {
      if (yt.currency !== currency) continue
      if (yt.sells.length > 0 || yt.dividendLegs.length > 0) return true
    }
  }
  return false
}
