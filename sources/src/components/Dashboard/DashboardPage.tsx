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

/** 各欄位說明（表頭「?」圖示顯示）。寫給不熟股票的人看：短句、白話、不放公式。 */
const HELP = {
  ticker: '股票的編號。台股是數字（如 2330），美股是英文代號（如 AAPL）。',
  name: '股票名稱。台股來自證交所官方清單，常見的美股會顯示中文名。',
  price:
    '最新股價。台股接近即時、每分鐘更新；美股最多延遲 20 分鐘。標示「快取」代表暫時抓不到新價格，顯示的是上一次抓到的。',
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

interface HoldingRow {
  holding: Holding
  price: number | null
  priceStale: boolean
  mktVal: number | null
  unrealized: number | null
  /** 未含任何費用的純價差：市值 − 未含費成本，與年度收益的 rawRealized 同構 */
  rawUnrealized: number | null
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
    const rawUnrealized = mktVal !== null ? mktVal - h.rawCost : null
    // 僅當前部位（與券商 APP 同口徑）：分母為現有持股的移動平均成本
    const roi = unrealized !== null && h.cost !== 0 ? unrealized / h.cost : null
    const breakEven = breakEvenPrice(h, feeRate, minFee)
    return {
      holding: h,
      price,
      priceStale: quote?.stale ?? false,
      mktVal,
      unrealized,
      rawUnrealized,
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
            <HelpTh label="未實現淨損益" help={HELP.unrealized} numeric />
            <HelpTh label="未實現報酬率" help={HELP.roi} numeric />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ holding: h, price, priceStale, mktVal, unrealized, rawUnrealized, roi, breakEven }) => (
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
                      <span className="badge badge-warn" style={{ marginLeft: 6 }} title="暫時抓不到新價格，顯示上一次抓到的">
                        快取
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
  const twUnrealRaw = sumOrNull(twRows.map((r) => r.rawUnrealized))
  const usMkt = sumOrNull(usRows.map((r) => r.mktVal))
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

      <div className="section kpi-grid">
        <div className="glass kpi">
          <div className="kpi-label">🇹🇼 台股持倉市值 (TWD)</div>
          <div className="kpi-value">
            {twRows.length === 0 ? fmtMoney(0, 'TWD') : twMkt === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtMoney(twMkt, 'TWD')}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label" title="手續費和證交稅都已經扣掉了">
            台股未實現淨損益
          </div>
          <div className={`kpi-value ${pnlClass(twUnreal)}`}>
            {twRows.length === 0 ? fmtMoney(0, 'TWD') : twUnreal === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtSignedMoney(twUnreal, 'TWD')}
          </div>
          <div className="kpi-sub" title="不扣任何手續費和稅的價差">
            未含費 {twRows.length === 0 ? fmtMoney(0, 'TWD') : twUnrealRaw === null ? '—' : fmtSignedMoney(twUnrealRaw, 'TWD')}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">🇺🇸 美股持倉市值 (USD)</div>
          <div className="kpi-value">
            {usRows.length === 0 ? fmtMoney(0, 'USD') : usMkt === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtMoney(usMkt, 'USD', 2)}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label" title="已扣買入手續費；美股沒有預扣賣出費用">
            美股未實現淨損益
          </div>
          <div className={`kpi-value ${pnlClass(usUnreal)}`}>
            {usRows.length === 0 ? fmtMoney(0, 'USD') : usUnreal === null ? <span className="skeleton" style={{ width: 120, height: 22 }} /> : fmtSignedMoney(usUnreal, 'USD')}
          </div>
          <div className="kpi-sub" title="不扣任何手續費的價差">
            未含費 {usRows.length === 0 ? fmtMoney(0, 'USD') : usUnrealRaw === null ? '—' : fmtSignedMoney(usUnrealRaw, 'USD')}
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
