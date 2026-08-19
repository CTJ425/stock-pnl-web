/**
 * Inventory overview Dashboard:
 * - Taiwan stocks (TWD) / US stocks (USD) are counted separately, only active holdings are displayed
 * - The profit and loss caliber is aligned with the brokerage APP: only the "current position held" (unrealized profit and loss ÷ current position cost) is calculated,
 *   Do not mix into historical settled periods; please see the "Annual Income" page for historical performance
 * - Asynchronous loading of the current price background: the skeleton screen is displayed during loading; when the current price cannot be captured, the market value / unrealized profit and loss are left blank
 * - Unrealized gains and losses on Taiwan stocks are "net" values: withholding selling fees and securities taxes (estimateUnrealized)
 */
import { useMemo } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { buildHoldingRows, type HoldingRow } from '../../utils/holdingRows'
import type { Currency } from '../../types/models'
import {
  fmtMoney,
  fmtPrice,
  fmtQty,
  fmtSignedMoney,
  fmtSignedPercent,
  pnlClass,
} from '../../utils/formatters'
import { getFeeRate } from '../../utils/settings'
import { displayStockName } from '../../services/usStockNames'
import { HelpTh } from '../Common/HelpTh'
import { WatchSection } from './WatchSection'

/** Description of each field (shown by the "?" icon in the header). Written for people who are unfamiliar with stocks: short sentences, vernacular, no formulas.*/
const HELP = {
  ticker: '股票的編號。台股是數字（如 2330），美股是英文代號（如 AAPL）。',
  name: '股票名稱。台股來自證交所官方清單，常見的美股會顯示中文名。',
  price:
    '最新股價。紅色代表比昨天收盤高、綠色代表比昨天低。台股接近即時、每分鐘更新；美股最多延遲 20 分鐘。標示「快取」代表暫時抓不到新價格，顯示的是上一次抓到的。',
  qty: '你現在還持有的股數。已經全部賣光的股票不會出現在這裡。',
  avgCost:
    '每股平均買進的價格，含買進手續費，也就是每股實際付出的錢。下方「未含費」是不含手續費的價格。',
  cost: '你現在還投在這檔股票上的錢，含買進手續費。已經賣掉的部分不算在內。',
  breakEven: '賣在這個價格剛好不賺不賠（手續費和稅已經算進去）。賣得比它高才真的有賺。',
  mktVal: '這些股票現在值多少錢。抓不到股價時顯示「—」。',
  unrealized:
    '如果現在全部賣掉，大概會賺或賠多少。「淨」代表手續費和稅都已經算進去（美股不含賣出費用）。下方「未含費」是不扣任何費用的價差，會比實際好看一點。',
  roi: '這些持股目前賺賠的百分比。只看手上還有的部分；已經賣掉的請看「年度收益」頁。',
} as const

/**
 * Tooltip of the current price column: The color itself cannot tell "how much it has increased", nor can it tell which day the benchmark is.
 * If you can't catch yesterday's collection, the tooltip will not be displayed at all - displaying "no information" will only make people swipe the mouse one more time.
 *
 * 0.6.36 Add "which day": mark the trading day and "closing" after the closing price, and the cache price clearly states that it is not necessarily today's.
 * Before that, the cache price seen overnight would be described as "higher than yesterday's closing...", and that yesterday's closing was actually the day before yesterday.
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

function sumOrNull(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length > 0 ? known.reduce((s, v) => s + v, 0) : null
}

function HoldingsTable({ rows, currency }: { rows: HoldingRow[]; currency: Currency }) {
  return (
    <div className="glass table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <HelpTh label="代號" help={HELP.ticker} />
            <HelpTh label="名稱" help={HELP.name} />
            <HelpTh label="現價" help={HELP.price} numeric />
            <HelpTh label="持有股數" help={HELP.qty} numeric />
            <HelpTh label="投入成本" help={HELP.cost} numeric />
            <HelpTh label="平均買入成本" help={HELP.avgCost} numeric />
            <HelpTh label="保本賣出價" help={HELP.breakEven} numeric />
            <HelpTh label="目前市值" help={HELP.mktVal} numeric />
            <HelpTh label="未實現淨損益" help={HELP.unrealized} numeric />
            <HelpTh label="未實現報酬率" help={HELP.roi} numeric />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { holding: h, price, priceStale, dayChange, mktVal, unrealized, rawUnrealized, roi, breakEven } = row
            return (
            <tr key={h.key}>
              <td>{h.ticker}</td>
              <td>{displayStockName(h.market, h.ticker, h.name)}</td>
              <td className={`num ${pnlClass(dayChange)}`}>
                {price === null ? (
                  <span className="skeleton" aria-label="現價載入中" />
                ) : (
                  <>
                    {/*
                      0.6.34 reverted 0.6.20's larger bold type to the normal size and uses colour for today's
                      move instead (red up, green down, against yesterday's close). Colour is more precise than
                      size: size only says "this column matters", colour says "today it is up or down", and the
                      latter is what you actually want from a current price.
                      With no previous close (the TWSE OpenAPI fallback) it is flat-coloured, which does not
                      mean "unchanged today".
                    */}
                    <span title={dayChangeHint(row, currency)}>
                      {fmtPrice(price, currency)}
                    </span>
                    {priceStale && (
                      <span className="badge badge-warn" style={{ marginLeft: 6 }} title="暫時抓不到新價格，顯示上一次抓到的">
                        快取
                      </span>
                    )}
                    {/*
                      0.6.42 (AUDIT-01): during 08:30–09:00 and 13:25–13:30 this number is the trial-matching
                      estimate —— nothing traded at it, yet the 未實現淨損益 beside it is computed from it. The
                      quote card had said 「試撮中」 all along; the dashboard said nothing, which is the gap.
                    */}
                    {row.trial && (
                      <span
                        className="badge badge-warn"
                        style={{ marginLeft: 6 }}
                        title="這是開盤前 / 收盤前試撮的預估價，還沒有成交；右側的未實現損益也是用它算的"
                      >
                        試撮
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className="num">{fmtQty(h.qty)}</td>
              <td className="num">
                <div style={{ fontWeight: 600 }}>{fmtMoney(h.cost, currency)}</div>
                <div style={{ fontSize: 11, opacity: 0.65 }} title="不含買進手續費的金額">
                  未含費 {fmtMoney(h.rawCost, currency)}
                </div>
              </td>
              <td className="num">
                <div style={{ fontWeight: 600 }}>{fmtPrice(h.avgCost, currency)}</div>
                <div style={{ fontSize: 11, opacity: 0.65 }} title="不含手續費的價格">
                  未含費 {fmtPrice(h.rawAvgCost, currency)}
                </div>
              </td>
              <td
                className={`num ${price !== null ? pnlClass(price - breakEven) : ''}`}
                title="賣在這個價格剛好不賺不賠"
              >
                {fmtPrice(breakEven, currency)}
              </td>
              <td className="num">{mktVal === null ? '—' : fmtMoney(mktVal, currency)}</td>
              <td className={`num ${pnlClass(unrealized)}`}>
                {unrealized === null ? (
                  '—'
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>{fmtSignedMoney(unrealized, currency)}</div>
                    {rawUnrealized !== null && (
                      <div
                        style={{ fontSize: 11, opacity: 0.65, fontWeight: 400, color: 'var(--ink-muted)' }}
                        title="不扣任何手續費和稅的價差"
                      >
                        未含費 {fmtSignedMoney(rawUnrealized, currency)}
                      </div>
                    )}
                  </>
                )}
              </td>
              <td className={`num ${pnlClass(roi)}`}>{roi === null ? '—' : fmtSignedPercent(roi)}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DashboardPage({ onOpenAnalysis }: { onOpenAnalysis?: (ticker: string) => void } = {}) {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices, loading, refreshedAt, refresh } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)

  const rows = useMemo(
    () => buildHoldingRows(holdings, prices, feeRate, current?.id),
    [holdings, prices, feeRate, current?.id],
  )
  const twRows = rows.filter((r) => r.holding.currency === 'TWD')
  const usRows = rows.filter((r) => r.holding.currency === 'USD')

  const twMkt = sumOrNull(twRows.map((r) => r.mktVal))
  const twCost = sumOrNull(twRows.map((r) => r.holding.cost))
  const twRawCost = sumOrNull(twRows.map((r) => r.holding.rawCost))
  const twUnreal = sumOrNull(twRows.map((r) => r.unrealized))
  const twUnrealRaw = sumOrNull(twRows.map((r) => r.rawUnrealized))

  const usMkt = sumOrNull(usRows.map((r) => r.mktVal))
  const usCost = sumOrNull(usRows.map((r) => r.holding.cost))
  const usRawCost = sumOrNull(usRows.map((r) => r.holding.rawCost))
  const usUnreal = sumOrNull(usRows.map((r) => r.unrealized))
  const usUnrealRaw = sumOrNull(usRows.map((r) => r.rawUnrealized))

  return (
    <>
      {ledger.warnings.length > 0 && (
        <div className="notice notice-warn section" role="alert">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          發現 {ledger.warnings.length} 筆資料異常（如超賣），已以持有股數為上限計算：
          {ledger.warnings.slice(0, 3).map((w) => (
            <div key={w} style={{ marginTop: 4 }}>・{w}</div>
          ))}
          {ledger.warnings.length > 3 && <div style={{ marginTop: 4 }}>…（共 {ledger.warnings.length} 筆）</div>}
        </div>
      )}

      <div className="section market-grid">
        <div className="glass market-panel">
          <div className="panel-head">
            <h3>🇹🇼 台股</h3>
            <span className="ccy">TWD</span>
          </div>
          <div className="metric metric-hero">
            <div className="kpi-label">持倉市值</div>
            <div className="kpi-value">
              {twRows.length === 0
                ? fmtMoney(0, 'TWD')
                : twMkt === null
                  ? <span className="skeleton" style={{ width: 120, height: 22 }} />
                  : fmtMoney(twMkt, 'TWD')}
            </div>
          </div>
          <div className="metric-row">
            <div className="metric">
              <div className="kpi-label" title="包含買入時的手續費">
                投入總成本
              </div>
              <div className="kpi-value">
                {twRows.length === 0
                  ? fmtMoney(0, 'TWD')
                  : twCost === null
                    ? <span className="skeleton" style={{ width: 90, height: 22 }} />
                    : fmtMoney(twCost, 'TWD')}
              </div>
              <div className="kpi-sub" title="只算股價，不含買入手續費">
                未含費 {twRows.length === 0 ? fmtMoney(0, 'TWD') : twRawCost === null ? '—' : fmtMoney(twRawCost, 'TWD')}
              </div>
            </div>
            <div className="metric">
              <div className="kpi-label" title="手續費和證交稅都已經扣掉了">
                未實現淨損益
              </div>
              <div className={`kpi-value ${pnlClass(twUnreal)}`}>
                {twRows.length === 0
                  ? fmtMoney(0, 'TWD')
                  : twUnreal === null
                    ? <span className="skeleton" style={{ width: 90, height: 22 }} />
                    : fmtSignedMoney(twUnreal, 'TWD')}
              </div>
              <div className="kpi-sub" title="不扣任何手續費和稅的價差">
                未含費 {twRows.length === 0 ? fmtMoney(0, 'TWD') : twUnrealRaw === null ? '—' : fmtSignedMoney(twUnrealRaw, 'TWD')}
              </div>
            </div>
          </div>
        </div>

        <div className="glass market-panel">
          <div className="panel-head">
            <h3>🇺🇸 美股</h3>
            <span className="ccy">USD</span>
          </div>
          <div className="metric metric-hero">
            <div className="kpi-label">持倉市值</div>
            <div className="kpi-value">
              {usRows.length === 0
                ? fmtMoney(0, 'USD')
                : usMkt === null
                  ? <span className="skeleton" style={{ width: 120, height: 22 }} />
                  : fmtMoney(usMkt, 'USD', 2)}
            </div>
          </div>
          <div className="metric-row">
            <div className="metric">
              <div className="kpi-label" title="包含買入時的手續費">
                投入總成本
              </div>
              <div className="kpi-value">
                {usRows.length === 0
                  ? fmtMoney(0, 'USD')
                  : usCost === null
                    ? <span className="skeleton" style={{ width: 90, height: 22 }} />
                    : fmtMoney(usCost, 'USD', 2)}
              </div>
              <div className="kpi-sub" title="只算股價，不含買入手續費">
                未含費 {usRows.length === 0 ? fmtMoney(0, 'USD') : usRawCost === null ? '—' : fmtMoney(usRawCost, 'USD', 2)}
              </div>
            </div>
            <div className="metric">
              <div className="kpi-label" title="已扣買入手續費；美股沒有預扣賣出費用">
                未實現淨損益
              </div>
              <div className={`kpi-value ${pnlClass(usUnreal)}`}>
                {usRows.length === 0
                  ? fmtMoney(0, 'USD')
                  : usUnreal === null
                    ? <span className="skeleton" style={{ width: 90, height: 22 }} />
                    : fmtSignedMoney(usUnreal, 'USD')}
              </div>
              <div className="kpi-sub" title="不扣任何手續費的價差">
                未含費 {usRows.length === 0 ? fmtMoney(0, 'USD') : usUnrealRaw === null ? '—' : fmtSignedMoney(usUnrealRaw, 'USD')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          <h2>Active 持股</h2>
          <div className="toolbar">
            {refreshedAt && (
              <span className="hint">
                現價更新於 {refreshedAt.toLocaleTimeString('zh-TW', { hour12: false })}
              </span>
            )}
            <button className="btn btn-sm" onClick={refresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : undefined} />
              {loading ? '更新中…' : '重新整理現價'}
            </button>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div className="glass empty-state">
            <div className="empty-icon">
              <Inbox size={36} />
            </div>
            <div>目前沒有持股。到「交易紀錄」新增第一筆買入，或用 CSV 匯入舊資料。</div>
          </div>
        ) : (
          <>
            {twRows.length > 0 && (
              <div className="section" style={{ marginTop: 12 }}>
                <div className="section-title">
                  <h2 style={{ fontSize: 14 }}>🇹🇼 台股 (TWD)</h2>
                </div>
                <HoldingsTable rows={twRows} currency="TWD" />
              </div>
            )}
            {usRows.length > 0 && (
              <div className="section" style={{ marginTop: 12 }}>
                <div className="section-title">
                  <h2 style={{ fontSize: 14 }}>🇺🇸 美股 (USD)</h2>
                </div>
                <HoldingsTable rows={usRows} currency="USD" />
              </div>
            )}
          </>
        )}
      </div>

      <WatchSection onOpenAnalysis={onOpenAnalysis ?? (() => {})} />
    </>
  )
}
