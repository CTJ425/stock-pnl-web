/**
 * 庫存總覽 Dashboard：
 * - 台股 (TWD) / 美股 (USD) 分開統計，只顯示 active 持股
 * - 損益口徑對齊券商 APP：僅計算「當前持有部位」（未實現損益 ÷ 當前部位成本），
 *   不混入歷史已結清週期；歷史績效請看「年度收益」頁
 * - 現價背景非同步載入：載入中顯示骨架屏；抓不到現價時市值 / 未實現損益留空
 * - 台股未實現損益為「淨」值：預扣賣出手續費與證交稅（estimateUnrealized）
 */
import { useMemo } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import type { Holding } from '../../utils/pnlEngine'
import { estimateUnrealized } from '../../utils/pnlEngine'
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
import type { PriceMap } from '../../services/priceProxy'
import { displayStockName } from '../../services/usStockNames'

interface HoldingRow {
  holding: Holding
  price: number | null
  priceStale: boolean
  mktVal: number | null
  unrealized: number | null
  /** 未實現報酬率（未實現 ÷ 當前部位成本）；無現價時為 null */
  roi: number | null
}

function buildRows(holdings: Holding[], prices: PriceMap, feeRate: number): HoldingRow[] {
  return holdings.map((h) => {
    const quote = prices[h.key]
    const price = quote?.price ?? null
    const mktVal = price !== null ? price * h.qty : null
    const unrealized = price !== null ? estimateUnrealized(h, price, feeRate) : null
    // 僅當前部位（與券商 APP 同口徑）：分母為現有持股的移動平均成本
    const roi = unrealized !== null && h.cost !== 0 ? unrealized / h.cost : null
    return { holding: h, price, priceStale: quote?.stale ?? false, mktVal, unrealized, roi }
  })
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
            <th>代號</th>
            <th>名稱</th>
            <th className="num">現價</th>
            <th className="num">持有股數</th>
            <th className="num">平均買入成本</th>
            <th className="num">目前市值</th>
            <th className="num">未實現損益</th>
            <th className="num">未實現報酬率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ holding: h, price, priceStale, mktVal, unrealized, roi }) => (
            <tr key={h.key}>
              <td>{h.ticker}</td>
              <td>{displayStockName(h.market, h.ticker, h.name)}</td>
              <td className="num">
                {price === null ? (
                  <span className="skeleton" aria-label="現價載入中" />
                ) : (
                  <>
                    {fmtPrice(price, currency)}
                    {priceStale && (
                      <span className="badge badge-warn" style={{ marginLeft: 6 }} title="外部報價暫時無法取得，顯示上次快取價">
                        快取
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className="num">{fmtQty(h.qty)}</td>
              <td className="num">{fmtPrice(h.avgCost, currency)}</td>
              <td className="num">{mktVal === null ? '—' : fmtMoney(mktVal, currency)}</td>
              <td className={`num ${pnlClass(unrealized)}`}>
                {unrealized === null ? '—' : fmtSignedMoney(unrealized, currency)}
              </td>
              <td className={`num ${pnlClass(roi)}`}>{roi === null ? '—' : fmtSignedPercent(roi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DashboardPage() {
  const { ledger, current } = useWorkspace()
  const { prices, loading, refreshedAt, refresh } = useStockPrices(ledger.holdings)
  const feeRate = getFeeRate(current?.id)

  const rows = useMemo(
    () => buildRows(ledger.holdings, prices, feeRate),
    [ledger.holdings, prices, feeRate],
  )
  const twRows = rows.filter((r) => r.holding.currency === 'TWD')
  const usRows = rows.filter((r) => r.holding.currency === 'USD')

  const twMkt = sumOrNull(twRows.map((r) => r.mktVal))
  const twUnreal = sumOrNull(twRows.map((r) => r.unrealized))
  const usMkt = sumOrNull(usRows.map((r) => r.mktVal))
  const usUnreal = sumOrNull(usRows.map((r) => r.unrealized))

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

      <div className="section kpi-grid">
        <div className="glass kpi">
          <div className="kpi-label">🇹🇼 台股持倉市值 (TWD)</div>
          <div className="kpi-value">
            {twRows.length === 0 ? fmtMoney(0, 'TWD') : twMkt === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtMoney(twMkt, 'TWD')}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">台股未實現損益</div>
          <div className={`kpi-value ${pnlClass(twUnreal)}`}>
            {twRows.length === 0 ? fmtMoney(0, 'TWD') : twUnreal === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtSignedMoney(twUnreal, 'TWD')}
          </div>
          <div className="kpi-sub">已預扣賣出手續費與證交稅</div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">🇺🇸 美股持倉市值 (USD)</div>
          <div className="kpi-value">
            {usRows.length === 0 ? fmtMoney(0, 'USD') : usMkt === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtMoney(usMkt, 'USD', 2)}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">美股未實現損益</div>
          <div className={`kpi-value ${pnlClass(usUnreal)}`}>
            {usRows.length === 0 ? fmtMoney(0, 'USD') : usUnreal === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtSignedMoney(usUnreal, 'USD')}
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

        {ledger.holdings.length === 0 ? (
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
    </>
  )
}
