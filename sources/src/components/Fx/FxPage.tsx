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
import { fetchFx, type FxCurrency, type FxData } from '../../services/fxProxy'
import { fmtUpdatedAt } from '../StockDetail/chipFormat'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import {
  FX_RANGES,
  changePct,
  fmtChartLabel,
  formatAmount,
  formatRate,
  foreignToTwd,
  isStale,
  labelIndicesFor,
  parseAmount,
  rangeStats,
  sliceByRange,
  twdToForeign,
  type FxRange,
} from './fxConvert'

const SELECTED_KEY = 'fx.selectedCurrency'
const DEFAULT_TWD = '1000'

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

function CurrencyCard({
  cur,
  active,
  onSelect,
}: {
  cur: FxCurrency
  active: boolean
  onSelect: () => void
}) {
  const pct = changePct(cur.latest, cur.prevClose)
  return (
    <button
      type="button"
      className={`glass kpi fx-card${active ? ' is-active' : ''}`}
      onClick={onSelect}
      aria-pressed={active}
      title={`1 ${cur.code} = ${formatRate(cur.latest, cur.decimals)} TWD`}
    >
      <div className="kpi-label">
        {cur.name} {cur.code}
      </div>
      <div className="kpi-value">{formatRate(cur.latest, cur.decimals)}</div>
      <div className="kpi-sub">{pctText(pct)}</div>
      <div className="kpi-sub">{trendText(pct)}</div>
    </button>
  )
}

/**
 * 雙向換算器。
 *
 * 兩邊都是受控輸入，但**只有被編輯的那一邊保留使用者的原字串**，另一邊顯示換算結果。
 * 兩邊都存成數字再各自格式化的話，使用者打「1.」會立刻被改寫成「1.00」，游標也跳掉。
 */
function Converter({ cur }: { cur: FxCurrency }) {
  const [twdRaw, setTwdRaw] = useState(DEFAULT_TWD)
  const [foreignRaw, setForeignRaw] = useState('')
  // 哪一邊是使用者正在輸入的來源；另一邊是算出來的
  const [edge, setEdge] = useState<'twd' | 'foreign'>('twd')

  const rate = cur.latest
  const twdValue = edge === 'twd' ? parseAmount(twdRaw) : foreignToTwd(parseAmount(foreignRaw), rate)
  const foreignValue =
    edge === 'foreign' ? parseAmount(foreignRaw) : twdToForeign(parseAmount(twdRaw), rate)

  const twdShown = edge === 'twd' ? twdRaw : formatAmount(twdValue)
  const foreignShown = edge === 'foreign' ? foreignRaw : formatAmount(foreignValue)

  const perForeign = formatRate(rate, cur.decimals)
  const perTwd = formatRate(twdToForeign(1, rate), Math.max(cur.decimals, 4))

  return (
    <div className="section glass fx-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">
          台幣 ⇄ {cur.name}
        </h3>
        <span className="source-tag">
          1 {cur.code} = {perForeign} TWD ／ 1 TWD = {perTwd} {cur.code}
        </span>
      </div>

      <div className="fx-convert">
        <div className="field">
          <label htmlFor="fx-twd">新台幣 TWD</label>
          <input
            id="fx-twd"
            inputMode="decimal"
            autoComplete="off"
            value={twdShown}
            onChange={(e) => {
              setEdge('twd')
              setTwdRaw(e.target.value)
            }}
          />
        </div>

        <div className="fx-swap" aria-hidden="true">
          <ArrowRightLeft size={18} />
        </div>

        <div className="field">
          <label htmlFor="fx-foreign">
            {cur.name} {cur.code}
          </label>
          <input
            id="fx-foreign"
            inputMode="decimal"
            autoComplete="off"
            value={foreignShown}
            onChange={(e) => {
              setEdge('foreign')
              setForeignRaw(e.target.value)
            }}
          />
        </div>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        兩邊都可以輸入，另一邊會即時換算。
      </p>
    </div>
  )
}

function TrendChart({ cur }: { cur: FxCurrency }) {
  const [range, setRange] = useState<FxRange>('3m')

  const points = useMemo(() => sliceByRange(cur.points, range), [cur.points, range])
  const stats = useMemo(() => rangeStats(points), [points])

  const linePoints = points.map((p) => ({
    label: fmtChartLabel(p[0], range === '1y'),
    value: p[1],
  }))
  const labelIndices = labelIndicesFor(points.length)

  return (
    <div className="section glass fx-panel">
      <div className="rpt-section-head">
        <h3 className="head-tight">{cur.name}走勢</h3>
        <span className="source-tag">1 {cur.code} 可換的台幣</span>
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
        <>
          <LineSeriesChart
            points={linePoints}
            labelIndices={labelIndices}
            formatValue={(v) => formatRate(v, cur.decimals)}
            ariaLabel={`${cur.name}對台幣匯率走勢`}
          />
          {stats && (
            <p className="hint" style={{ marginTop: 8 }}>
              區間高 {formatRate(stats.high, cur.decimals)}（{stats.highDate}）　 區間低{' '}
              {formatRate(stats.low, cur.decimals)}（{stats.lowDate}）　 區間{' '}
              {pctText(stats.changePct)}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function FxPage() {
  const [fx, setFx] = useState<FxData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(readSelected)

  const load = useCallback(async () => {
    setLoading(true)
    const d = await fetchFx()
    setFx(d)
    setLoading(false)
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
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
        </div>

        <div className="kpi-grid" style={{ marginTop: 14 }}>
          {fx.currencies.map((c) => (
            <CurrencyCard
              key={c.code}
              cur={c}
              active={c.code === current.code}
              onSelect={() => select(c.code)}
            />
          ))}
        </div>

        <p className="hint" style={{ marginTop: 10 }}>
          數字為 1 單位外幣可換得的台幣。漲跌為與前一交易日相比。
        </p>
      </div>

      {/*
        key 讓切換幣別時整個重建（換算器的輸入、走勢圖的區間都回到預設）。
        ⚠️ 兩個 key **必須不同**：它們是同一層的兄弟節點，共用 `current.code`
        會撞成「同一層出現兩個相同 key」，React 會把兩者混在一起 ——
        實測結果是切到日圓後畫面上同時留著兩個美元換算器。
      */}
      <Converter key={`conv-${current.code}`} cur={current} />

      <TrendChart key={`trend-${current.code}`} cur={current} />

      <div className="section glass fx-panel">
        <p className="hint" style={{ margin: 0 }}>
          資料來源：Yahoo Finance 市場中價，每日更新兩次，<strong>非即時報價</strong>。
          這不是銀行牌告匯率，實際結匯請以往來銀行的現金／即期買賣價為準
          （兩者通常有 0.3%～1% 的價差）。
        </p>
      </div>
    </>
  )
}
