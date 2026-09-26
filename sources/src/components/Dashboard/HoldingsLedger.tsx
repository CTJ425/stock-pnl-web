/**
 * The holdings statement (2026-09-26 redesign): one printed line per holding, grouped by market
 * with a subtotal, seven columns on desktop and a three-line entry on phones.
 *
 * Each row carries one number per cell. Everything that used to sit on a second line (未含費,
 * 券商, 淨收, cost, break-even) opens under the row: the holding's own sub-ledger, with the three
 * ways broker apps compute unrealized P&L side by side and the trades that built the position.
 */
import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, LineChart } from 'lucide-react'
import type { Currency, Transaction } from '../../types/models'
import { TX_TYPE_LABEL } from '../../types/models'
import type { HoldingRow } from '../../utils/holdingRows'
import type { Ledger } from '../../utils/pnlEngine'
import { DEFAULT_FEE_RATE } from '../../utils/fees'
import { formatFeeRatePct, rowRoi, rowUnrealized, type PnlBasis } from '../../utils/pnlBasis'
import {
  fmtMoney,
  fmtPrice,
  fmtQty,
  fmtSignedMoney,
  fmtSignedPercent,
  pnlClass,
} from '../../utils/formatters'
import { displayStockName } from '../../services/usStockNames'
import { rowToday, type MarketSums } from './dashboardSums'

export type LedgerSort = 'today' | 'mktVal' | 'ticker'

const COLS = 7
/** Trades shown per holding before the list points to 交易紀錄. */
const STOPS_SHOWN = 6

/**
 * The current price's tooltip: colour alone cannot say how much it moved or against which day.
 * No tooltip at all when yesterday's close is unknown.
 */
function dayChangeHint(row: HoldingRow, currency: Currency): string | undefined {
  const { dayChange, price, tradeDay, closed, priceStale } = row
  if (dayChange === null || price === null) return undefined
  const prevClose = price - dayChange
  const pct = prevClose === 0 ? null : (dayChange / prevClose) * 100
  const sign = dayChange > 0 ? '+' : ''
  const pctText = pct === null ? '' : `（${sign}${pct.toFixed(2)}%）`
  const move =
    dayChange === 0
      ? `與昨收持平（昨收 ${fmtPrice(prevClose, currency)}）`
      : `較昨收 ${sign}${fmtPrice(dayChange, currency)}${pctText}・昨收 ${fmtPrice(prevClose, currency)}`
  const head = closed && tradeDay ? `${tradeDay} 收盤・` : ''
  const tail = priceStale ? '・這是上次抓到的價格，不一定是今天的' : ''
  return `${head}${move}${tail}`
}

function dayChangePct(row: HoldingRow): number | null {
  if (row.dayChange === null || row.price === null) return null
  const prev = row.price - row.dayChange
  return prev === 0 ? null : row.dayChange / prev
}

function sortRows(rows: HoldingRow[], sort: LedgerSort): HoldingRow[] {
  const byNull = (v: number | null) => (v === null ? -Infinity : v)
  const out = [...rows]
  if (sort === 'ticker') out.sort((a, b) => a.holding.ticker.localeCompare(b.holding.ticker))
  else if (sort === 'mktVal') out.sort((a, b) => byNull(b.mktVal) - byNull(a.mktVal))
  else out.sort((a, b) => byNull(rowToday(b)) - byNull(rowToday(a)))
  return out
}

/** Sell legs' realized P&L by transaction id, for the trade list under a row. */
function realizedByTx(ledger: Ledger): Map<string, number> {
  const map = new Map<string, number>()
  for (const year of Object.values(ledger.yearly)) {
    for (const detail of Object.values(year.tickers)) {
      for (const sell of detail.sells) map.set(sell.txId, (map.get(sell.txId) ?? 0) + sell.realized)
    }
  }
  return map
}

function Skeleton({ label }: { label: string }) {
  return <span className="skeleton" aria-label={label} />
}

function RowDetail({
  row,
  currency,
  basis,
  feeRate,
  trades,
  realized,
  onSelectTicker,
  onGoToTransactions,
}: {
  row: HoldingRow
  currency: Currency
  basis: PnlBasis
  feeRate: number
  trades: Transaction[]
  realized: Map<string, number>
  onSelectTicker?: (ticker: string, name: string) => void
  onGoToTransactions?: () => void
}) {
  const h = row.holding
  const isShort = row.direction === 'SHORT'
  const name = displayStockName(h.market, h.ticker, h.name)
  const used: PnlBasis = row.brokerNotApplicable ? 'net' : basis
  const netLabel = currency === 'USD' ? '實際手續費' : feeRate >= DEFAULT_FEE_RATE ? `你的費率 ${formatFeeRatePct(feeRate)}` : `折扣後 ${formatFeeRatePct(feeRate)}`
  const rawRoi = row.rawUnrealized === null ? null : row.rawUnrealized / (isShort ? h.shortRawProceeds : h.rawCost)
  const methods = [
    { key: 'net' as const, label: netLabel, value: row.unrealized, roi: row.roi },
    {
      key: 'list' as const,
      label: `牌告 ${formatFeeRatePct(DEFAULT_FEE_RATE)}`,
      value: row.brokerNotApplicable ? undefined : row.brokerUnrealized,
      roi: row.brokerNotApplicable ? undefined : row.brokerRoi,
    },
    { key: 'raw' as const, label: '不含費用', value: row.rawUnrealized, roi: rawRoi },
  ]
  const shown = trades.slice(-STOPS_SHOWN)

  return (
    <div className="hl-detail-body">
      <div className="hl-detail-block">
        <h4>{isShort ? '空單' : '成本'}</h4>
        <dl className="hl-kv">
          {isShort ? (
            <>
              <dt>賣出實收</dt>
              <dd title="融券賣出實際收到的錢（已扣手續費、證交稅與借券費）">
                {fmtMoney(h.shortProceeds, currency)}
                <small>賣出・未含費 {fmtMoney(h.shortRawProceeds, currency)}</small>
              </dd>
              <dt>建倉均價</dt>
              <dd>
                {fmtPrice(h.shortQty > 0 ? h.shortProceeds / h.shortQty : 0, currency)}
                <small>賣出・未含費 {fmtPrice(h.shortQty > 0 ? h.shortRawProceeds / h.shortQty : 0, currency)}</small>
              </dd>
              <dt>回補保本價</dt>
              <dd className={row.price !== null && row.breakEven !== null ? pnlClass(row.breakEven - row.price) : ''}>
                {fmtPrice(row.breakEven, currency)}
              </dd>
            </>
          ) : (
            <>
              <dt>投入成本</dt>
              <dd>
                {fmtMoney(h.cost, currency)}
                <small>未含費 {fmtMoney(h.rawCost, currency)}</small>
              </dd>
              <dt>平均成本</dt>
              <dd>
                {fmtPrice(h.avgCost, currency)}
                <small>未含費 {fmtPrice(h.rawAvgCost, currency)}</small>
              </dd>
              <dt>保本賣出價</dt>
              <dd
                className={row.price !== null && row.breakEven !== null ? pnlClass(row.price - row.breakEven) : ''}
                title={currency === 'TWD' ? '賣在這個價格剛好不賺不賠（含手續費與證交稅）' : '賣在這個價格剛好不賺不賠（含手續費）'}
              >
                {fmtPrice(row.breakEven, currency)}
              </dd>
              {row.netMktVal !== null && (
                <>
                  <dt>全部賣出約可拿回</dt>
                  <dd>{fmtMoney(row.netMktVal, currency)}</dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>

      <div className="hl-detail-block">
        <h4>未實現損益的三種算法</h4>
        <table className="hl-methods">
          <thead>
            <tr>
              <th scope="col">算法</th>
              <th scope="col">未實現損益</th>
              <th scope="col">報酬率</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.key} className={m.key === used ? 'is-used' : undefined} data-testid={`method-${m.key}`}>
                <th scope="row">
                  {m.label}
                  {m.key === used && <span className="hl-tag">目前採用</span>}
                </th>
                {m.value === undefined ? (
                  <>
                    <td className="hl-na">不適用</td>
                    <td className="hl-na">—</td>
                  </>
                ) : (
                  <>
                    <td className={pnlClass(m.value)}>{fmtSignedMoney(m.value, currency)}</td>
                    <td className={pnlClass(m.roi)}>{fmtSignedPercent(m.roi)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hl-detail-block">
        <h4>這檔股票的交易</h4>
        <ul className="hl-stops">
          {shown.map((t) => {
            const r = realized.get(t.id)
            return (
              <li key={t.id}>
                <span>{t.tx_date.replace(/-/g, '/')}</span>
                <b>{t.tx_nature === 'SHORT' ? (t.tx_type === 'SELL' ? '融券賣出' : '融券回補') : TX_TYPE_LABEL[t.tx_type]}</b>
                <span>
                  {fmtQty(t.qty)} 股 @ {fmtPrice(t.price, currency).replace(/^(NT|US)\$/, '')}
                </span>
                {r !== undefined && <span className={`hl-stop-realized ${pnlClass(r)}`}>已實現 {fmtSignedMoney(r, currency)}</span>}
              </li>
            )
          })}
        </ul>
        {trades.length > STOPS_SHOWN && (
          <p className="hl-more">
            只列最近 {STOPS_SHOWN} 筆，共 {trades.length} 筆
            {onGoToTransactions && (
              <>
                ・
                <button type="button" className="hl-link" onClick={onGoToTransactions}>
                  到交易紀錄看全部
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {currency === 'TWD' && onSelectTicker && (
        <div className="hl-actions">
          <button type="button" className="btn btn-sm" onClick={() => onSelectTicker(h.ticker, name)}>
            <LineChart size={16} aria-hidden="true" />
            個股分析
          </button>
        </div>
      )}
    </div>
  )
}

function MarketGroup({
  sums,
  label,
  basis,
  feeRate,
  sort,
  loading,
  open,
  onToggle,
  tradesByKey,
  realized,
  onRetry,
  onSelectTicker,
  onGoToTransactions,
}: {
  sums: MarketSums
  label: string
  basis: PnlBasis
  feeRate: number
  sort: LedgerSort
  loading: boolean
  open: Set<string>
  onToggle: (key: string) => void
  tradesByKey: Map<string, Transaction[]>
  realized: Map<string, number>
  onRetry: () => void
  onSelectTicker?: (ticker: string, name: string) => void
  onGoToTransactions?: () => void
}) {
  const { currency, rows, hasShort } = sums
  const prefix = currency === 'TWD' ? 'tw' : 'us'
  const longRows = sortRows(rows.filter((r) => r.direction === 'LONG'), sort)
  const shortRows = sortRows(rows.filter((r) => r.direction === 'SHORT'), sort)

  const renderRow = (row: HoldingRow) => {
    const h = row.holding
    const isShort = row.direction === 'SHORT'
    const name = displayStockName(h.market, h.ticker, h.name)
    const detailId = `hl-${row.rowKey.replace(/[^A-Za-z0-9_-]/g, '-')}`
    const isOpen = open.has(row.rowKey)
    const today = rowToday(row)
    const pct = dayChangePct(row)
    const unreal = rowUnrealized(row, basis)
    const roi = rowRoi(row, basis)
    // A cached quote's move must not read with the same emphasis as a live one.
    const moveClass = row.priceStale ? 'pnl-flat' : pnlClass(row.dayChange)
    const missing = row.price === null
    return (
      <Fragment key={row.rowKey}>
        <tr
          className={`hl-row${isShort ? ' row-short' : ''}`}
          data-open={isOpen}
          data-testid={isShort ? `holding-row-${h.ticker}-SHORT` : `holding-row-${h.ticker}`}
          onClick={() => onToggle(row.rowKey)}
        >
          <td data-c="stock">
            <button
              type="button"
              className="hl-toggle"
              aria-expanded={isOpen}
              aria-controls={detailId}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(row.rowKey)
              }}
            >
              <ChevronRight size={14} className="hl-chev" aria-hidden="true" />
              <span className="hl-code">{h.ticker}</span>
              <span className="hl-name">{name}</span>
              {isShort && <span className="hl-tag hl-tag-short">空單</span>}
            </button>
          </td>
          <td className="num" data-c="qty">
            {fmtQty(row.rowQty)}
          </td>
          <td className="num" data-c="px">
            <span className="hl-m-only">{fmtQty(Math.abs(row.rowQty))} 股 · </span>
            {missing ? (
              loading ? <Skeleton label="現價載入中" /> : '—'
            ) : (
              <>
                <span title={dayChangeHint(row, currency)}>{fmtPrice(row.price, currency)}</span>
                {row.priceStale && (
                  <span className="badge badge-warn hl-badge" title="暫時抓不到新價格，顯示上一次抓到的">
                    快取
                  </span>
                )}
                {/* The trial-matching estimate: nothing traded at it, yet the P&L beside it uses it. */}
                {row.trial && (
                  <span
                    className="badge badge-warn hl-badge"
                    title="這是開盤前 / 收盤前試撮的預估價，還沒有成交；右側的損益也是用它算的"
                  >
                    試撮
                  </span>
                )}
              </>
            )}
          </td>
          <td className={`num ${moveClass}`} data-c="chg">
            {fmtSignedPercent(pct)}
          </td>
          <td className={`num hl-strong ${pnlClass(today)}`} data-c="today">
            {missing && loading ? <Skeleton label="今日損益載入中" /> : fmtSignedMoney(today, currency)}
          </td>
          <td className="num" data-c="mv">
            {missing && loading ? <Skeleton label="市值載入中" /> : fmtMoney(row.mktVal, currency)}
          </td>
          <td className={`num ${pnlClass(unreal)}`} data-c="unr">
            <span className="hl-m-only hl-m-label">未實現淨損益</span>
            {missing && loading ? (
              <Skeleton label="損益載入中" />
            ) : (
              <span className="hl-unr">
                <span>{fmtSignedMoney(unreal, currency)}</span>
                {roi !== null && <span>({fmtSignedPercent(roi)})</span>}
              </span>
            )}
          </td>
        </tr>
        {isOpen && (
          <tr className="hl-detail" id={detailId}>
            <td colSpan={COLS}>
              <RowDetail
                row={row}
                currency={currency}
                basis={basis}
                feeRate={feeRate}
                trades={tradesByKey.get(h.key) ?? []}
                realized={realized}
                onSelectTicker={onSelectTicker}
                onGoToTransactions={onGoToTransactions}
              />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <tbody className="hl-group" data-testid={`holding-market-${prefix}`}>
      <tr className="hl-group-head">
        <th colSpan={COLS} scope="rowgroup">
          <span className="hl-group-name">{label}</span>
          <span className="hl-group-meta">
            {currency === 'TWD' ? '新台幣' : '美元'} · {rows.length} 檔
            {' · '}投入成本{' '}
            <span data-testid={`${prefix}-cost`}>
              {sums.cost === null ? <Skeleton label="成本載入中" /> : fmtMoney(sums.cost, currency)}
            </span>
          </span>
          {sums.quoteMissing && (
            <span className="hl-missing">
              目前取不到{currency === 'TWD' ? '台股' : '美股'}報價
              <button type="button" className="btn btn-sm" onClick={onRetry}>
                重試
              </button>
            </span>
          )}
        </th>
      </tr>
      {hasShort ? (
        <>
          {longRows.length > 0 && (
            <>
              <tr className="hl-subgroup" data-testid="holding-group-LONG">
                <td colSpan={COLS}>多單・{longRows.length} 檔</td>
              </tr>
              {longRows.map(renderRow)}
            </>
          )}
          <tr className="hl-subgroup" data-testid="holding-group-SHORT">
            <td colSpan={COLS}>空單・{shortRows.length} 檔</td>
          </tr>
          {shortRows.map(renderRow)}
        </>
      ) : (
        longRows.map(renderRow)
      )}
      <tr className="hl-subtotal" data-testid={`${prefix}-subtotal`}>
        <td data-c="stock">{label}小計</td>
        <td data-c="qty" />
        <td data-c="px" />
        <td data-c="chg" />
        <td className={`num ${pnlClass(sums.today)}`} data-c="today">
          {fmtSignedMoney(sums.today, currency)}
        </td>
        <td className="num" data-c="mv">
          {fmtMoney(sums.netMkt, currency)}
        </td>
        <td className={`num ${pnlClass(sums.unrealized)}`} data-c="unr">
          <span className="hl-m-only hl-m-label">未實現淨損益</span>
          {fmtSignedMoney(sums.unrealized, currency)}
        </td>
      </tr>
    </tbody>
  )
}

export function HoldingsLedger({
  markets,
  basis,
  feeRate,
  loading,
  ledger,
  transactions,
  onRetry,
  onSelectTicker,
  onGoToTransactions,
}: {
  markets: Array<{ sums: MarketSums; label: string }>
  basis: PnlBasis
  feeRate: number
  loading: boolean
  ledger: Ledger
  transactions: Transaction[]
  onRetry: () => void
  onSelectTicker?: (ticker: string, name: string) => void
  onGoToTransactions?: () => void
}) {
  const [sort, setSort] = useState<LedgerSort>('today')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const tradesByKey = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    const sorted = [...transactions].sort((a, b) => a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at))
    for (const t of sorted) {
      const key = `${t.market}:${t.ticker}`
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
    return map
  }, [transactions])
  const realized = useMemo(() => realizedByTx(ledger), [ledger])
  const count = markets.reduce((n, m) => n + m.sums.rows.length, 0)

  return (
    <>
      <div className="hl-head">
        <h2>持股明細</h2>
        <span className="hl-count">{count} 檔</span>
        <div className="hl-sort" role="group" aria-label="排序">
          {(
            [
              ['today', '今日損益'],
              ['mktVal', '市值'],
              ['ticker', '代號'],
            ] as const
          ).map(([key, text]) => (
            <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>
              {text}
            </button>
          ))}
        </div>
      </div>
      <div className="hl-scroll">
        <table className="hl-table">
          <thead>
            <tr>
              <th scope="col">股票</th>
              <th scope="col" className="num">股數</th>
              <th scope="col" className="num">
                現價<sup>1</sup>
              </th>
              <th scope="col" className="num">漲跌幅</th>
              <th scope="col" className="num">
                今日損益<sup>2</sup>
              </th>
              <th scope="col" className="num">市值</th>
              <th scope="col" className="num">
                未實現淨損益<sup>3</sup>
              </th>
            </tr>
          </thead>
          {markets.map(({ sums, label }) => (
            <MarketGroup
              key={sums.currency}
              sums={sums}
              label={label}
              basis={basis}
              feeRate={feeRate}
              sort={sort}
              loading={loading}
              open={open}
              onToggle={toggle}
              tradesByKey={tradesByKey}
              realized={realized}
              onRetry={onRetry}
              onSelectTicker={onSelectTicker}
              onGoToTransactions={onGoToTransactions}
            />
          ))}
        </table>
      </div>
    </>
  )
}
