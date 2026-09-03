/**
 * Inventory overview Dashboard:
 * - Taiwan stocks (TWD) / US stocks (USD) are counted separately, only active holdings are displayed
 * - The profit and loss caliber is aligned with the brokerage APP: only the "current position held" (unrealized profit and loss ÷ current position cost) is calculated,
 *   Do not mix into historical settled periods; please see the "Annual Income" page for historical performance
 * - Asynchronous loading of the current price background: the skeleton screen is displayed during loading; when the current price cannot be captured, the market value / unrealized profit and loss are left blank
 * - Unrealized gains and losses on Taiwan stocks are "net" values: withholding selling fees and securities taxes (estimateUnrealized)
 */
import { useMemo, useState } from 'react'
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
  breakEven:
    '賣在這個價格剛好不賺不賠（含手續費與法定證交稅：個股 0.3%、ETF 0.1%）。賣得比它高才真的有賺。',
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

function HoldingsTable({
  rows,
  currency,
  onSelectTicker,
}: {
  rows: HoldingRow[]
  currency: Currency
  onSelectTicker?: (ticker: string, name: string) => void
}) {
  const longRows = rows.filter((r) => r.direction === 'LONG')
  const shortRows = rows.filter((r) => r.direction === 'SHORT')
  const hasShort = shortRows.length > 0
  const longMkt = sumOrNull(longRows.map((r) => r.mktVal))
  const shortMkt = sumOrNull(shortRows.map((r) => r.mktVal))
  const longUnreal = sumOrNull(longRows.map((r) => r.unrealized))
  const shortUnreal = sumOrNull(shortRows.map((r) => r.unrealized))

  const renderRow = (row: HoldingRow) => {
    const { holding: h, direction, rowQty, price, priceStale, dayChange, mktVal, unrealized, rawUnrealized, roi, breakEven } = row
    const isShort = direction === 'SHORT'
    const isClickable = currency === 'TWD' && typeof onSelectTicker === 'function'
    const stockName = displayStockName(h.market, h.ticker, h.name)
    return (
            <tr
              key={row.rowKey}
              data-testid={isShort ? `holding-row-${h.ticker}-SHORT` : `holding-row-${h.ticker}`}
              className={isShort ? 'row-short' : undefined}
              onClick={isClickable ? () => onSelectTicker(h.ticker, stockName) : undefined}
              style={isClickable ? { cursor: 'pointer' } : undefined}
              title={isClickable ? '點擊查看個股分析' : undefined}
            >
              <td>{h.ticker}</td>
              <td>{stockName}</td>
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
              <td className={`num ${isShort ? pnlClass(rowQty) : ''}`}>{fmtQty(rowQty)}</td>
              <td className="num">
                {/*
                  空單沒有「投入成本」，它的對應項是建倉時收到的錢。原本印「—」，等於看不到
                  自己在幾塊放空、收了多少，而那正是判斷要不要回補時唯一需要的數字。
                */}
                {isShort ? (
                  <>
                    <div style={{ fontWeight: 600 }} title="融券賣出實際收到的錢（已扣手續費、證交稅與借券費）">
                      {fmtMoney(h.shortProceeds, currency)}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.65 }} title="不扣任何費用的賣出價金">
                      賣出・未含費 {fmtMoney(h.shortRawProceeds, currency)}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>{fmtMoney(h.cost, currency)}</div>
                    <div style={{ fontSize: 11, opacity: 0.65 }} title="不含買進手續費的金額">
                      未含費 {fmtMoney(h.rawCost, currency)}
                    </div>
                  </>
                )}
              </td>
              <td className="num">
                {isShort ? (
                  <>
                    <div style={{ fontWeight: 600 }} title="建倉時的平均賣出價，已扣手續費、證交稅與借券費">
                      {fmtPrice(h.shortQty > 0 ? h.shortProceeds / h.shortQty : 0, currency)}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.65 }} title="不扣任何費用的成交均價">
                      賣出・未含費{' '}
                      {fmtPrice(h.shortQty > 0 ? h.shortRawProceeds / h.shortQty : 0, currency)}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>{fmtPrice(h.avgCost, currency)}</div>
                    <div style={{ fontSize: 11, opacity: 0.65 }} title="不含手續費的價格">
                      未含費 {fmtPrice(h.rawAvgCost, currency)}
                    </div>
                  </>
                )}
              </td>
              <td
                className={`num ${price !== null ? pnlClass(price - breakEven) : ''}`}
                title={
                  isShort
                    ? '低於此價才獲利'
                    : '賣在這個價格剛好不賺不賠（含手續費與法定證交稅：個股 0.3%、ETF 0.1%）'
                }
              >
                {fmtPrice(breakEven, currency)}
              </td>
              <td className="num">
                {mktVal === null ? (
                  '—'
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>{fmtMoney(mktVal, currency)}</div>
                    {row.netMktVal !== null && (
                      <div
                        style={{ fontSize: 11, opacity: 0.65, color: 'var(--ink-muted)' }}
                        title="若以現價全數賣出，扣除手續費與證交稅後的預估實收金額"
                      >
                        淨收 {fmtMoney(row.netMktVal, currency)}
                      </div>
                    )}
                  </>
                )}
              </td>
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
  }

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
          {hasShort ? (
            <>
              {longRows.length > 0 && (
                <>
                  <tr className="holding-group holding-group-long" data-testid="holding-group-LONG">
                    <td colSpan={7}>
                      <span className="holding-group-label">多單・{longRows.length} 檔</span>
                    </td>
                    <td className="num" data-testid="holding-group-LONG-mktval">
                      {fmtMoney(longMkt, currency)}
                    </td>
                    <td className={`num ${pnlClass(longUnreal)}`}>
                      {longUnreal === null ? '—' : fmtSignedMoney(longUnreal, currency)}
                    </td>
                    <td></td>
                  </tr>
                  {longRows.map(renderRow)}
                </>
              )}
              {shortRows.length > 0 && (
                <>
                  <tr className="holding-group holding-group-short" data-testid="holding-group-SHORT">
                    <td colSpan={7}>
                      <span className="holding-group-label">空單・{shortRows.length} 檔</span>
                    </td>
                    <td className="num" data-testid="holding-group-SHORT-mktval">
                      {fmtMoney(shortMkt, currency)}
                    </td>
                    <td className={`num ${pnlClass(shortUnreal)}`}>
                      {shortUnreal === null ? '—' : fmtSignedMoney(shortUnreal, currency)}
                    </td>
                    <td></td>
                  </tr>
                  {shortRows.map(renderRow)}
                </>
              )}
            </>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>
    </div>
  )
}

function MarketPanel({
  flag,
  title,
  currency,
  testPrefix,
  rows,
  shortRows,
  longMkt,
  shortMkt,
  cost,
  rawCost,
  unreal,
  unrealRaw,
}: {
  flag: string
  title: string
  currency: Currency
  testPrefix: 'tw' | 'us'
  rows: HoldingRow[]
  shortRows: HoldingRow[]
  longMkt: number | null
  shortMkt: number | null
  cost: number | null
  rawCost: number | null
  unreal: number | null
  unrealRaw: number | null
}) {
  const hasShort = shortRows.length > 0
  // 兩條腿都要有值，淨額才成立。把未載入的一腿當成 0 會印出一個看起來合理但錯誤的淨額，
  // 而且會讓曝險條變成 100/0 的單段條 — spec C2 的負向條件明文禁止。任一腿未知就整組不顯示。
  const legsKnown = longMkt !== null && shortMkt !== null
  const netMkt = hasShort ? (legsKnown ? longMkt - shortMkt : null) : longMkt
  /*
   * 曝險尺永遠顯示，沒有空單時空方段為 0（使用者要求）。唯一的例外是「有空單但整條腿抓不到
   * 報價」—— 那時候 0 是未知不是零，畫出來的比例會是假的。
   */
  const showExposure = hasShort ? legsKnown : longMkt !== null
  const heroLabel = hasShort ? '淨額市值' : '持倉市值'

  return (
    <div className="glass market-panel">
      <div className="panel-head">
        <h3>
          {flag} {title}
        </h3>
        <span className="ccy">{currency}</span>
        <span className="kpi-label">{heroLabel}</span>
      </div>
      <div className="metric metric-hero">
        <div className="kpi-value" data-testid={`${testPrefix}-mktval`}>
          {rows.length === 0 ? (
            fmtMoney(0, currency)
          ) : netMkt === null ? (
            <span className="skeleton" style={{ width: 120, height: 22 }} />
          ) : hasShort ? (
            // 淨額是多空相減，可能為負，所以帶正負號；沒有空單時是單純的持倉市值，不帶號。
            fmtSignedMoney(netMkt, currency)
          ) : (
            fmtMoney(netMkt, currency)
          )}
        </div>
      </div>
      {showExposure && (
        <>
          <div className="exposure-bar" data-testid={`${testPrefix}-exposure`}>
            <div className="exposure-seg-long" style={{ flexGrow: longMkt ?? 0, flexBasis: 0 }} />
            <div className="exposure-seg-short" style={{ flexGrow: shortMkt ?? 0, flexBasis: 0 }} />
          </div>
          <div className="exposure-key">
            {/* 色塊、標籤與數字必須成組，否則色塊在視覺上不屬於它的標籤。 */}
            <span className="exposure-legend">
              <span className="exposure-sw exposure-sw-long" />
              多單
              <span data-testid={`${testPrefix}-long-mktval`}>{fmtMoney(longMkt, currency)}</span>
            </span>
            <span className="exposure-legend">
              <span className="exposure-sw exposure-sw-short" />
              空單
              <span data-testid={`${testPrefix}-short-mktval`}>
                {fmtMoney(hasShort ? shortMkt : 0, currency)}
              </span>
            </span>
          </div>
        </>
      )}
      {!hasShort && rows.length > 0 && !showExposure && (
        <div className="market-note">{rows.length} 檔 · 全部多單</div>
      )}
      <div className="metric-row market-foot">
        <div className="metric">
          <div className="kpi-label" title="包含買入時的手續費">
            投入總成本
          </div>
          <div className="kpi-value" data-testid={`${testPrefix}-cost`}>
            {rows.length === 0 ? (
              fmtMoney(0, currency)
            ) : cost === null ? (
              <span className="skeleton" style={{ width: 90, height: 22 }} />
            ) : (
              fmtMoney(cost, currency)
            )}
          </div>
          <div className="kpi-sub" title="只算股價，不含買入手續費">
            未含費 {rows.length === 0 ? fmtMoney(0, currency) : rawCost === null ? '—' : fmtMoney(rawCost, currency)}
          </div>
        </div>
        <div className="metric">
          <div
            className="kpi-label"
            title={currency === 'TWD' ? '手續費和證交稅都已經扣掉了' : '已扣買入手續費；美股沒有預扣賣出費用'}
          >
            未實現淨損益
          </div>
          <div className={`kpi-value ${pnlClass(unreal)}`}>
            {rows.length === 0 ? (
              fmtMoney(0, currency)
            ) : unreal === null ? (
              <span className="skeleton" style={{ width: 90, height: 22 }} />
            ) : (
              fmtSignedMoney(unreal, currency)
            )}
          </div>
          <div className="kpi-sub" title={currency === 'TWD' ? '不扣任何手續費和稅的價差' : '不扣任何手續費的價差'}>
            未含費 {rows.length === 0 ? fmtMoney(0, currency) : unrealRaw === null ? '—' : fmtSignedMoney(unrealRaw, currency)}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardPage({
  onSelectTicker,
}: {
  onSelectTicker?: (ticker: string, name: string) => void
} = {}) {
  const { ledger, current } = useWorkspace()
  const holdings = ledger.holdings
  const { prices, loading, refreshedAt, refresh } = useStockPrices(holdings)
  const [refreshKey, setRefreshKey] = useState(0)
  const feeRate = getFeeRate(current?.id)

  const handleRefresh = () => {
    refresh()
    setRefreshKey((k) => k + 1)
  }

  const rows = useMemo(
    () => buildHoldingRows(holdings, prices, feeRate, current?.id),
    [holdings, prices, feeRate, current?.id],
  )
  const twRows = rows.filter((r) => r.holding.currency === 'TWD')
  const usRows = rows.filter((r) => r.holding.currency === 'USD')

  // 持倉市值與投入成本只算多頭列。一個 Holding 若同時有波段持股與融券空單會產出兩列，
  // 兩列共用同一個 holding 物件：逐列加總 holding.cost 會把同一檔的成本算兩次，而把空單的
  // 買回成本加進持倉市值則是把資產與負債相加。未實現損益相反，多空兩列相加才是總損益。
  const twLongRows = twRows.filter((r) => r.direction === 'LONG')
  const usLongRows = usRows.filter((r) => r.direction === 'LONG')
  const twShortRows = twRows.filter((r) => r.direction === 'SHORT')
  const usShortRows = usRows.filter((r) => r.direction === 'SHORT')

  // 沒有多單時多方腿是 0，不是未知。sumOrNull 對空陣列回傳 null，而 null 在
  // MarketPanel 裡代表「報價還沒到」——只有空單的面板因此整組畫成骨架條，主數字、
  // 曝險尺與成本全部不顯示。零與未知必須在這裡就分開。
  const twMkt = twLongRows.length === 0 ? 0 : sumOrNull(twLongRows.map((r) => r.mktVal))
  const twShortMkt = twShortRows.length === 0 ? null : sumOrNull(twShortRows.map((r) => r.mktVal))
  const twCost = twLongRows.length === 0 ? 0 : sumOrNull(twLongRows.map((r) => r.holding.cost))
  const twRawCost = twLongRows.length === 0 ? 0 : sumOrNull(twLongRows.map((r) => r.holding.rawCost))
  const twUnreal = sumOrNull(twRows.map((r) => r.unrealized))
  const twUnrealRaw = sumOrNull(twRows.map((r) => r.rawUnrealized))

  const usMkt = usLongRows.length === 0 ? 0 : sumOrNull(usLongRows.map((r) => r.mktVal))
  const usShortMkt = usShortRows.length === 0 ? null : sumOrNull(usShortRows.map((r) => r.mktVal))
  const usCost = usLongRows.length === 0 ? 0 : sumOrNull(usLongRows.map((r) => r.holding.cost))
  const usRawCost = usLongRows.length === 0 ? 0 : sumOrNull(usLongRows.map((r) => r.holding.rawCost))
  const usUnreal = sumOrNull(usRows.map((r) => r.unrealized))
  const usUnrealRaw = sumOrNull(usRows.map((r) => r.rawUnrealized))

  return (
    <>
      {ledger.warnings.length > 0 && (
        <div className="notice notice-warn section" role="alert">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          發現 {ledger.warnings.length} 筆資料異常（如超賣、超額回補）：
          {ledger.warnings.slice(0, 3).map((w) => (
            <div key={w} style={{ marginTop: 4 }}>・{w}</div>
          ))}
          {ledger.warnings.length > 3 && <div style={{ marginTop: 4 }}>…（共 {ledger.warnings.length} 筆）</div>}
        </div>
      )}

      <div className="section market-grid">
        <MarketPanel
          flag="🇹🇼"
          title="台股"
          currency="TWD"
          testPrefix="tw"
          rows={twRows}
          shortRows={twShortRows}
          longMkt={twMkt}
          shortMkt={twShortMkt}
          cost={twCost}
          rawCost={twRawCost}
          unreal={twUnreal}
          unrealRaw={twUnrealRaw}
        />
        <MarketPanel
          flag="🇺🇸"
          title="美股"
          currency="USD"
          testPrefix="us"
          rows={usRows}
          shortRows={usShortRows}
          longMkt={usMkt}
          shortMkt={usShortMkt}
          cost={usCost}
          rawCost={usRawCost}
          unreal={usUnreal}
          unrealRaw={usUnrealRaw}
        />
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
            <button className="btn btn-sm" onClick={handleRefresh} disabled={loading}>
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
                <HoldingsTable rows={twRows} currency="TWD" onSelectTicker={onSelectTicker} />
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

      <WatchSection refreshTrigger={refreshKey} onSelectTicker={onSelectTicker ?? (() => {})} />
    </>
  )
}
