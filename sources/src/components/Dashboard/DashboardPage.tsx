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
import { breakEvenPrice } from '../../utils/fees'
import type { Currency } from '../../types/models'
import {
  fmtMoney,
  fmtPrice,
  fmtQty,
  fmtSignedMoney,
  fmtSignedPercent,
  pnlClass,
} from '../../utils/formatters'
import { getFeeRate, getMinFee } from '../../utils/settings'
import type { PriceMap } from '../../services/priceProxy'
import { displayStockName } from '../../services/usStockNames'
import { HelpTh } from '../Common/HelpTh'

/** 各欄位說明（表頭「?」圖示顯示） */
const HELP = {
  ticker: '股票代號。台股不含「TPE:」前綴（如 2330），美股為交易所代號（如 AAPL）。',
  name: '股票名稱。台股取自證交所 / 櫃買中心官方清單，常見美股顯示中文譯名。',
  price:
    '台股取自證交所即時行情（近即時），畫面每分鐘自動更新；美股報價來源最長延遲 20 分鐘、每 10 分鐘更新一次。按右上角「重新整理現價」可略過快取強制重抓（但無法消除來源本身的延遲）。標示「快取」代表目前抓不到新報價，顯示的是上次成功取得的價格。',
  qty: '目前仍持有的股數（累計買進 − 累計賣出）。已全部賣光的股票不會出現在這裡。',
  avgCost:
    '移動平均成本法。主數字含買進手續費，也就是每股實際付出的錢；下方「未含費」是單純的成交均價。賣出時依當時均價扣減，不影響剩餘部位的每股成本。',
  cost:
    '目前這些持股當初買進投入的錢（平均買入成本 × 持有股數，含買進手續費）。已經賣掉的部分不算在內，因此這是「現在還壓在裡面」的金額。下方「未含費」為未計手續費的版本。',
  breakEven:
    '以此價格把手上持股全部賣出，扣掉賣出手續費與證交稅後恰好不賺不賠的最低價格。高於此價賣出才真正獲利。',
  mktVal: '現價 × 持有股數。尚未取得現價時顯示「—」。',
  unrealized:
    '若以現價全部賣出的預估損益。台股已預先扣除賣出手續費與證交稅，美股不預扣（各券商收費結構差異大）。實際成交價與此估算會有落差。',
  roi: '未實現損益 ÷ 目前部位成本。只計算手上還持有的部位，與券商 APP 同口徑；已經賣掉結清的歷史績效請看「年度收益」頁。',
} as const

interface HoldingRow {
  holding: Holding
  price: number | null
  priceStale: boolean
  mktVal: number | null
  unrealized: number | null
  /** 未實現報酬率（未實現 ÷ 當前部位成本）；無現價時為 null */
  roi: number | null
  /** 保本賣出價：以此價全數賣出（扣手續費 / 證交稅）恰好不虧 */
  breakEven: number
}

function buildRows(
  holdings: Holding[],
  prices: PriceMap,
  feeRate: number,
  workspaceId?: string,
): HoldingRow[] {
  return holdings.map((h) => {
    const quote = prices[h.key]
    const price = quote?.price ?? null
    const mktVal = price !== null ? price * h.qty : null
    // 台股依持股規模套用整股 / 零股最低手續費；美股無下限
    const minFee =
      h.currency === 'TWD' ? getMinFee(h.qty >= 1000 ? 'whole' : 'odd', workspaceId) : undefined
    const unrealized = price !== null ? estimateUnrealized(h, price, feeRate, minFee) : null
    // 僅當前部位（與券商 APP 同口徑）：分母為現有持股的移動平均成本
    const roi = unrealized !== null && h.cost !== 0 ? unrealized / h.cost : null
    const breakEven = breakEvenPrice(h, feeRate, minFee)
    return {
      holding: h,
      price,
      priceStale: quote?.stale ?? false,
      mktVal,
      unrealized,
      roi,
      breakEven,
    }
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
            <HelpTh label="代號" help={HELP.ticker} />
            <HelpTh label="名稱" help={HELP.name} />
            <HelpTh label="現價" help={HELP.price} numeric />
            <HelpTh label="持有股數" help={HELP.qty} numeric />
            <HelpTh label="投入成本" help={HELP.cost} numeric />
            <HelpTh label="平均買入成本" help={HELP.avgCost} numeric />
            <HelpTh label="保本賣出價" help={HELP.breakEven} numeric />
            <HelpTh label="目前市值" help={HELP.mktVal} numeric />
            <HelpTh label="未實現損益" help={HELP.unrealized} numeric />
            <HelpTh label="未實現報酬率" help={HELP.roi} numeric />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ holding: h, price, priceStale, mktVal, unrealized, roi, breakEven }) => (
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
              <td className="num">
                <div style={{ fontWeight: 600 }}>{fmtMoney(h.cost, currency)}</div>
                <div style={{ fontSize: 11, opacity: 0.65 }} title="未含買進手續費的成交價金">
                  未含費 {fmtMoney(h.rawCost, currency)}
                </div>
              </td>
              <td className="num">
                <div style={{ fontWeight: 600 }}>{fmtPrice(h.avgCost, currency)}</div>
                <div style={{ fontSize: 11, opacity: 0.65 }} title="未含手續費的成交均價">
                  未含費 {fmtPrice(h.rawAvgCost, currency)}
                </div>
              </td>
              <td
                className={`num ${price !== null ? pnlClass(price - breakEven) : ''}`}
                title="以此價全數賣出（扣手續費與證交稅）恰好不虧"
              >
                {fmtPrice(breakEven, currency)}
              </td>
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
  const holdings = ledger.holdings
  const { prices, loading, refreshedAt, refresh } = useStockPrices(holdings)
  const feeRate = getFeeRate(current?.id)

  const rows = useMemo(
    () => buildRows(holdings, prices, feeRate, current?.id),
    [holdings, prices, feeRate, current?.id],
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
    </>
  )
}
