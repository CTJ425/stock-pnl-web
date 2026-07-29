/**
 * 「外幣匯率」頂層頁面：台幣對主要 8 種外幣的匯率、雙向換算與走勢圖。
 *
 * 資料來自 `fx/twd.json`（全域單檔，非 per-ticker），本元件**自己載入** ——
 * 頂層頁沒有父元件可以分發（同 MacroPage）。
 *
 * 三個刻意的設計決定：
 *
 * 1. **不套用損益的紅漲綠跌。** 「台幣貶值」對持有美股的人是好事、對出國的人是壞事，
 *    本身沒有好壞之分。沿用 MacroPage 對總經指標的同一個判斷：只陳述方向，
 *    用文字明說「台幣升值 / 貶值」，不呼叫 chipClass()。
 *
 * 2. **資料過期要主動說。** Storage 上的舊檔在畫面上與新檔長得一模一樣，
 *    而這頁的數字會被拿去換錢。這正是 0.6.4-dev.5 那次線上事故的性質
 *    （顯示的資料是錯的、使用者卻看不出來，見 services/reportsBucket.ts）。
 *
 * 3. **必須標示「非銀行牌告匯率」。** 資料是 Yahoo 的市場中價，不是台銀的
 *    現金／即期買賣價 —— 使用者拿去銀行換一定會有落差，不講清楚是誤導。
 *    （台銀的 CSV 端點已被人機驗證擋住，抓不到，見 fxRates.ts 的說明。）
 *
 * 方向陷阱：`rate` 一律是「1 單位外幣 = N 台幣」。反向一律現算，不另存。
 *
 * 手機版型不在 0.6.7 範圍（使用者決定等桌機功能驗證後再做）。
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
    // 無痕模式 / 停用儲存：記不住偏好不影響功能
  }
}

/** 日變動的方向敘述。台幣要換更多錢才買得到同樣的外幣 ＝ 台幣貶值 */
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
 * 卡片要顯示哪個數字。
 *
 * 優先用即時報價；拿不到（Edge Function 掛了、額度用盡、本機模式）就退回
 * 每日檔的最後收盤。**兩者一定要在畫面上分得出來** —— 差距不是小數點後幾位，
 * 實測同一時刻可以差 0.42%，使用者若以為看到的是即時價會被誤導。
 *
 * 日變動的基期兩種情況不同：
 * - 即時價：跟每日檔的**最後一根完整日線**比 → 「今天到目前為止的變化」
 * - 收盤價：跟**前一根**日線比 → 「昨天相對前天的變化」
 * 兩者都是「與前一個交易日相比」，口徑一致。
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
 * 單一方向的走勢圖。兩張圖共用同一組時間範圍，故 range 由父元件持有。
 *
 * `decimals` 由呼叫端決定：正向用幣別自帶的位數，反向用 `autoDecimals()`
 * 依量級現算（1 台幣可換的外幣從 0.03 到 45 都有）。
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
 * 走勢圖：同一段期間、兩個方向並排。
 *
 * **為什麼要兩張而不是一張**：使用者的問題有兩種問法 ——
 * 「我這 1000 台幣能換多少日圓」看的是台幣→日圓；
 * 「這件日本商品 3000 日圓等於多少台幣」看的是日圓→台幣。
 * 兩者互為倒數，但腦內換算很麻煩，尤其日圓那種 0.1972 的量級。
 *
 * ⚠️ 兩張圖**不是彼此的鏡像**：1/x 是非線性的，曲線形狀不同，
 * 而且高低點的日期會對調（正向的最高點＝反向的最低點）。這是對的，不是 bug。
 */
function TrendChart({ cur }: { cur: FxCurrency }) {
  const [range, setRange] = useState<FxRange>('3m')

  const points = useMemo(() => sliceByRange(cur.points, range), [cur.points, range])
  const inverted = useMemo(() => invertPoints(points), [points])
  // 反向的量級與正向差很多，位數依中位量級現算一次就好（同一張圖內要一致，不可逐點算）
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
   * 兩份資料一起載入，但**歷史檔決定畫面能不能顯示、報價只是加分**：
   * 報價拿不到時卡片退回收盤價（見 cardView），歷史拿不到才是空狀態。
   * 故報價的失敗不進 loading 判斷，也不擋畫面。
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
  // 任一幣別有即時報價就算取得成功（八個是同一次請求，不會只回一半）
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
        key 讓切換幣別時整個重建（換算器的輸入、走勢圖的區間都回到預設）。
        ⚠️ 兩個 key **必須不同**：它們是同一層的兄弟節點，共用 `current.code`
        會撞成「同一層出現兩個相同 key」，React 會把兩者混在一起 ——
        實測結果是切到日圓後畫面上同時留著兩個美元換算器。
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
