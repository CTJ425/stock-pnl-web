/**
 * "Foreign Currency Exchange Rate" top page: exchange rates, two-way conversions and trend charts of the Taiwan dollar against eight major foreign currencies.
 *
 * The data comes from `fx/twd.json` (global single file, not per-ticker), this component **loads itself** ——
 * Top-level pages have no parent components to distribute (same as MacroPage).
 *
 * Three deliberate design decisions:
 *
 * 1. **Do not apply the red rise and green fall of profit and loss. ** "The depreciation of the Taiwan dollar" is a good thing for those who hold U.S. stocks, and a bad thing for those who go abroad.
 *    There is nothing inherently good or bad about it. Follow the same judgment of MacroPage on the general economic indicator: only state the direction,
 *    Use text to clearly state "Taiwan dollar appreciation/depreciation" and do not call chipClass().
 *
 * 2. **Please take the initiative to tell us if your information is expired. ** The old files on Storage look exactly the same as the new files on the screen.
 *    The numbers on this page will be exchanged for money. This is exactly the nature of the online incident in 0.6.4-dev.5
 *    (The displayed data is wrong, but the user cannot see it, see services/reportsBucket.ts).
 *
 * 3. **Must indicate "non-bank quoted exchange rate". **The information is Yahoo’s market median price, not the Bank of Taiwan’s
 *    Cash/spot buying and selling price - there will definitely be a difference when the user takes it to the bank to exchange. Failure to explain clearly is misleading.
 *    (Taiwan Bank’s CSV endpoint has been blocked by human-machine verification and cannot be captured. See the instructions of fxRates.ts.)
 *
 * Direction trap: `rate` is always "1 unit of foreign currency = N Taiwan dollars". The reverse direction will be calculated immediately and will not be saved separately.
 *
 * The mobile version is not in the 0.6.7 range (the user decided to wait for the desktop function to be verified).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, RefreshCw } from 'lucide-react'
import { fetchFx, type FxCurrency, type FxData, type FxPoint } from '../../services/fxProxy'
import { fetchFxQuotes, type FxQuote, type FxQuoteMap } from '../../services/fxQuoteProxy'
import { fmtUpdatedAt } from '../StockDetail/chipFormat'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import {
  FX_RANGES,
  autoDecimals,
  changePct,
  fmtChartLabel,
  invertPoints,
  formatRate,
  isStale,
  labelIndicesFor,
  rangeStats,
  sliceByRange,
  type FxRange,
} from './fxConvert'

const SELECTED_KEY = 'fx.selectedCurrency'

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

function writeSelected(code: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, code)
  } catch {
    // Incognito mode/disable storage: unable to remember preferences does not affect functionality
  }
}

/** Description of the direction of daily changes. The Taiwan dollar needs to be exchanged for more money to buy the same foreign currency = the Taiwan dollar depreciates.*/
function trendText(pct: number | null): string {
  if (pct === null) return '—'
  if (Math.abs(pct) < 0.005) return '與前一日持平'
  return pct > 0 ? '台幣貶值' : '台幣升值'
}

function pctText(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct > 0 ? '▲' : pct < 0 ? '▼' : ''} ${Math.abs(pct).toFixed(2)}%`
}

/**
 * Which number should the card display.
 *
 * Give priority to real-time quotation; if you can’t get it (Edge Function hangs up, quota is exhausted, local mode), it will be returned.
 * The last closing price of the daily session. **The two must be distinguished on the screen** - the difference is not a few decimal places,
 * The actual measured difference can be 0.42% at the same time. Users will be misled if they think they are seeing real-time prices.
 *
 * There are two different situations for the base period of daily changes:
 * - Real-time price: compared with the **last complete daily bar** of the daily session → "Changes so far today"
 * - Closing price: compared with the **previous** daily line → "Yesterday's change relative to the day before yesterday"
 * Both are "compared to the previous trading day" and have the same caliber.
 */
function cardView(cur: FxCurrency, quote: FxQuote | undefined) {
  if (quote) {
    return {
      price: quote.price,
      pct: changePct(quote.price, cur.latest),
      live: true,
      asOf: quote.asOf,
    }
  }
  return { price: cur.latest, pct: changePct(cur.latest, cur.prevClose), live: false, asOf: '' }
}

function CurrencyCard({
  cur,
  quote,
  active,
  onSelect,
}: {
  cur: FxCurrency
  quote: FxQuote | undefined
  active: boolean
  onSelect: () => void
}) {
  const v = cardView(cur, quote)
  return (
    <button
      type="button"
      className={`glass kpi fx-card${active ? ' is-active' : ''}`}
      onClick={onSelect}
      aria-pressed={active}
      title={`1 ${cur.code} = ${formatRate(v.price, cur.decimals)} TWD${
        v.live ? `（即時，${fmtUpdatedAt(v.asOf)}）` : '（前一交易日收盤）'
      }`}
    >
      <div className="kpi-label">
        {cur.name} {cur.code}
      </div>
      <div className="kpi-value">{formatRate(v.price, cur.decimals)}</div>
      <div className="kpi-sub">{pctText(v.pct)}</div>
      <div className="kpi-sub">{trendText(v.pct)}</div>
    </button>
  )
}

/**
 * Single direction trend chart. The two charts share the same set of time ranges, so the range is held by the parent component.
 *
 * `decimals` is determined by the caller: forward direction uses the number of digits provided by the currency, reverse direction uses `autoDecimals()`
 * Calculate according to the magnitude (the foreign currencies that can be exchanged for 1 Taiwan dollar range from 0.03 to 45).
 */
function DirectionChart({
  title,
  caption,
  points,
  decimals,
  withYear,
  ariaLabel,
}: {
  title: string
  caption: string
  points: FxPoint[]
  decimals: number
  withYear: boolean
  ariaLabel: string
}) {
  const stats = useMemo(() => rangeStats(points), [points])
  const linePoints = points.map((p) => ({ label: fmtChartLabel(p[0], withYear), value: p[1] }))

  return (
    <div className="fx-chart">
      <div className="fx-chart-head">
        <h4>{title}</h4>
        <span className="source-tag">{caption}</span>
      </div>
      <LineSeriesChart
        points={linePoints}
        labelIndices={labelIndicesFor(points.length)}
        formatValue={(v) => formatRate(v, decimals)}
        ariaLabel={ariaLabel}
      />
      {stats && (
        <p className="hint" style={{ marginTop: 6 }}>
          高 {formatRate(stats.high, decimals)}（{stats.highDate}）　低{' '}
          {formatRate(stats.low, decimals)}（{stats.lowDate}）　區間 {pctText(stats.changePct)}
        </p>
      )}
    </div>
  )
}

/**
 * Trend chart: Same period, two directions side by side.
 *
 * **Why two instead of one**: There are two ways to ask the user's question -
 * "How much Japanese yen can I exchange for my NT$1,000?" looks at Taiwan dollar → Japanese yen;
 * "How many Taiwan dollars is 3,000 yen for this Japanese product?" It looks at Japanese yen → Taiwan dollars.
 * The two are reciprocal to each other, but it is very troublesome to convert in the mind, especially the Japanese yen, which is of the order of 0.1972.
 *
 * ⚠️ The two graphs are not mirror images of each other: 1/x is non-linear and the curve shapes are different,
 * Moreover, the dates of the high and low points will be adjusted (the highest point in the forward direction = the lowest point in the reverse direction). This is correct, not a bug.
 */
function TrendChart({ cur }: { cur: FxCurrency }) {
  const [range, setRange] = useState<FxRange>('3m')

  const points = useMemo(() => sliceByRange(cur.points, range), [cur.points, range])
  const inverted = useMemo(() => invertPoints(points), [points])
  // The magnitude of the reverse direction is much different from that of the forward direction. Just calculate the digits once according to the median magnitude (it must be consistent in the same picture and cannot be calculated point by point).
  const invDecimals = useMemo(
    () => autoDecimals(inverted.length ? inverted[inverted.length - 1][1] : null),
    [inverted],
  )

  return (
    <div className="section glass fx-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">{cur.name}走勢</h3>
        <span className="source-tag">兩個方向互為倒數，高低點日期會對調</span>
      </div>

      <div className="subtabs" role="tablist" aria-label="時間範圍">
        {FX_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={range === r.id}
            className={`subtab${range === r.id ? ' active' : ''}`}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="hint">這個區間沒有資料。</p>
      ) : (
        <div className="fx-chart-pair">
          <DirectionChart
            title={`新臺幣 / ${cur.name}`}
            caption={`1 TWD 可換的${cur.name}`}
            points={inverted}
            decimals={invDecimals}
            withYear={range === '1y'}
            ariaLabel={`新臺幣對${cur.name}匯率走勢，數值為 1 新臺幣可換得的${cur.name}`}
          />
          <DirectionChart
            title={`${cur.name} / 新臺幣`}
            caption={`1 ${cur.code} 可換的台幣`}
            points={points}
            decimals={cur.decimals}
            withYear={range === '1y'}
            ariaLabel={`${cur.name}對新臺幣匯率走勢，數值為 1 ${cur.code} 可換得的新臺幣`}
          />
        </div>
      )}
    </div>
  )
}

export function FxPage() {
  const [fx, setFx] = useState<FxData | null>(null)
  const [quotes, setQuotes] = useState<FxQuoteMap>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(readSelected)

  /**
   * The two data are loaded together, but the historical file determines whether the screen can be displayed and the quotation is just a bonus**:
   * When the quotation cannot be obtained, the card will return the trading price (see cardView). If the history cannot be obtained, the card will be in an empty state.
   * Therefore, the failure of the quotation does not enter the loading judgment and does not block the screen.
   */
  const load = useCallback(async (force = false) => {
    setLoading(true)
    const d = await fetchFx()
    setFx(d)
    setLoading(false)
    if (d) setQuotes(await fetchFxQuotes(d.currencies.map((c) => c.code), force))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current =
    fx?.currencies.find((c) => c.code === selected) ?? fx?.currencies[0] ?? null

  const select = (code: string) => {
    setSelected(code)
    writeSelected(code)
  }

  if (loading) {
    return (
      <div className="glass empty-state section">
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在讀取匯率資料…</div>
      </div>
    )
  }

  if (!fx || !current) {
    return (
      <div className="glass empty-state section">
        <div className="empty-icon">
          <ArrowRightLeft size={36} />
        </div>
        <div>匯率資料尚未產生。</div>
        <div className="hint" style={{ marginTop: 6 }}>
          每日排程完成後會自動補上，稍後再回來看看。
        </div>
      </div>
    )
  }

  const stale = isStale(fx.asOf, new Date())
  // If there is a real-time quote for any currency, it will be considered successful (eight are the same request, and only half will be returned)
  const liveAt = fx.currencies.map((c) => quotes[c.code]?.asOf).find(Boolean) ?? ''

  return (
    <>
      {stale && (
        <div className="notice notice-warn section">
          匯率資料停留在 {fmtUpdatedAt(fx.asOf)}，已超過 3 天未更新。
          下方數字可能不是最新的，換匯前請再確認。
        </div>
      )}

      <div className="section glass fx-panel">
        <div className="rpt-section-head">
          <h3 className="head-tight">外幣匯率</h3>
          {fx.asOf && (
            <span className="source-tag section-stamp">資料更新於 {fmtUpdatedAt(fx.asOf)}</span>
          )}
          <button className="btn btn-sm" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
        </div>

        <div className="kpi-grid" style={{ marginTop: 14 }}>
          {fx.currencies.map((c) => (
            <CurrencyCard
              key={c.code}
              cur={c}
              quote={quotes[c.code]}
              active={c.code === current.code}
              onSelect={() => select(c.code)}
            />
          ))}
        </div>

        <p className="hint" style={{ marginTop: 10 }}>
          數字為 1 單位外幣可換得的台幣，漲跌為與前一交易日相比。
          {liveAt
            ? `卡片為市場即時中價（${fmtUpdatedAt(liveAt)}，最多延遲 10 分鐘）；下方走勢圖為每日收盤。`
            : '目前取不到即時報價，卡片顯示的是前一交易日收盤價。'}
        </p>
      </div>

      {/*
        The key rebuilds everything when the currency changes (converter input and chart range return to default).
        ⚠️ The two keys **must differ**: they are siblings at the same level, and sharing `current.code` collides
        into "two identical keys at one level", after which React merges them —— measured result: switching to JPY
        left two USD converters on screen at once.
      */}
      <TrendChart key={`trend-${current.code}`} cur={current} />

      <div className="section glass fx-panel">
        <p className="hint" style={{ margin: 0 }}>
          資料來源：Yahoo Finance 市場中價。幣別卡為即時報價（最多延遲 10 分鐘），
          走勢圖為每日收盤、由排程每天更新。
          <strong>這不是銀行牌告匯率</strong>，實際結匯請以往來銀行的現金／即期買賣價為準
          （兩者通常有 0.3%～1% 的價差）。
        </p>
      </div>
    </>
  )
}
