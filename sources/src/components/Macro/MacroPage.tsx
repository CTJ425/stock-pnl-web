/**
 * "General Economy" top page: Five general economic indicators in the United States.
 *
 * In 0.6.5-dev.1, this was a page under individual stock analysis, and dev.2 was promoted to the top page——
 * **This information has nothing to do with individual stocks** and is shared by the entire market. Hanging under individual stock analysis will force users to
 * After selecting a stock first, you can see a piece of information that has nothing to do with that stock, and you have to print a special line
 * "It has nothing to do with the stock you are looking at" to remedy the situation. That sentence is unnecessary after mentioning the top layer.
 *
 * The data comes from `macro/us.json` (global single file, not per-ticker), this component **loads itself** ——
 * It no longer has a parent component to distribute (`AiTab` needs to grab the same data by itself, see the description of this file).
 *
 * Unit Trap: The three price indicators are **%** (annual growth rate), non-agriculture is **thousand people** (increase or decrease from the previous month),
 * Consumer confidence is an **index value**. Always read the `unit` that comes with the information, and don’t write it down here.
 */
import { useCallback, useEffect, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Globe, Minus, Plus, RefreshCw } from 'lucide-react'
import { fetchMacro, type MacroData, type MacroIndicator, type MacroPoint } from '../../services/macroProxy'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'
import { CHART_COLORS } from '../Charts/chartColors'
import { SPARK_W, SparkCell } from '../Charts/SparkCell'
import { latestPeriod, periodsBehind } from './macroPeriod'
import { TwMarketSection } from './TwMarketSection'

/** Whether the two ISO times fall on the same local calendar day. Bad values ​​are always considered to be on different days (prefer to display one more row)*/
function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return da.toDateString() === db.toDateString()
}

/** 'YYYY-MM' → 'YYYY year MM month'*/
function fmtPeriod(period: string | undefined): string {
  if (!period) return '—'
  const m = period.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]} 年 ${m[2]} 月` : period
}

/** Value with unit. Return "-" if missing value (do not pretend to be 0)*/
function fmtValue(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (unit === '指數') return v.toFixed(1)
  if (unit === '千人') return `${v > 0 ? '+' : ''}${v.toLocaleString('en-US')} 千人`
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

/** The difference from the previous period; both periods must have value to be calculated (if one period is missing, null will be returned, and 0 will not be used to pretend to be "flat")*/
function delta(latest: MacroPoint | null, previous: MacroPoint | null): number | null {
  const a = latest?.value
  const b = previous?.value
  if (typeof a !== 'number' || typeof b !== 'number') return null
  return a - b
}

/** A signed delta. The unit follows the indicator (thousands of people do not take decimals, the remaining two digits)*/
function fmtDelta(d: number | null, unit: string): string {
  if (d === null) return '—'
  if (Math.abs(d) < 0.005) return '持平'
  const shown = unit === '千人' ? Math.abs(d).toLocaleString('en-US') : Math.abs(d).toFixed(2)
  return `${d > 0 ? '+' : '−'}${shown}`
}

/**
 * The difference between each period and the previous period, from old to new, has the same length as `points` (the first period has no previous period, so it is null).
 * The color of the table, the direction of the trend line, and the continuous judgment are all derived from this one to avoid drifting due to counting each of the three places once.
 */
function deltaSeries(points: MacroPoint[]): Array<number | null> {
  return points.map((p, i) => (i === 0 ? null : delta(p, points[i - 1])))
}

/**
 * The number of consecutive periods in the same direction (0.6.34), imitating the "continuous" column of the Taiwan stock legal person table.
 *
 * **But the judgment is different and cannot be used directly. `trendAt`**: Legal person trading depends on the positive and negative sign of the amount.
 * (Overbuying/overselling has its own direction), and the annual growth rate of CPI is always positive, and the plus and minus signs are meaningless——
 * What you look at here is the increase or decrease compared to the previous period.
 *
 * `points` from oldest to newest. A missing period will break the calculation: treating it as "same as the previous period" will cause the two periods to
 * A continuation of unrelated uptrends is worse than underreporting by one period.
 */
function risingStreak(points: MacroPoint[]): { direction: 1 | -1; periods: number } | null {
  const values: number[] = []
  for (const p of points) {
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) values.length = 0
    else values.push(p.value)
  }
  if (values.length < 3) return null
  const direction = Math.sign(values[values.length - 1] - values[values.length - 2])
  if (direction === 0) return null
  let periods = 0
  for (let i = values.length - 1; i > 0; i--) {
    if (Math.sign(values[i] - values[i - 1]) !== direction) break
    periods++
  }
  // 1 period in a row is not a trend, it is just "this period is higher than the previous period", and the line above that sentence has already been said
  return periods >= 2 ? { direction: direction as 1 | -1, periods } : null
}

/**
 * The reduced indicator chip (0.6.35 replaces the original five KPI cards).
 *
 * Only the name and latest value are left: period, compared to the previous period, trend, continuity, and description are all in the table below.
 * The card version is equivalent to saying the same number twice. The purpose of this line is just a quick look at "what % is now".
 */
function IndicatorChip({ ind }: { ind: MacroIndicator }) {
  return (
    <div className="mac-chip">
      <span className="mac-chip-label">{ind.label}</span>
      <span className="mac-chip-value">{fmtValue(ind.latest?.value ?? null, ind.unit)}</span>
    </div>
  )
}

/**
 * Expand the period-by-period details of an indicator (0.6.35).
 *
 * The writing method of the nested table is consistent with the `DayDetail` of the Taiwan stock legal person table: the detail is "period × value / compared to the previous period",
 * Unlike the column shape of the parent column, forcing the same set of columns will just force a bunch of colSpan placeholders.
 * From new to old, contrary to the parent table - if the first column of the table is the most recent period, the trend line will go from old to new.
 */
function IndicatorDetail({ ind }: { ind: MacroIndicator }) {
  const deltas = deltaSeries(ind.points)
  const rows = ind.points.map((p, i) => ({ point: p, d: deltas[i] })).reverse()
  return (
    <tr className="detail-row">
      {/* 指標欄 + 最新 + 較上期 + 趨勢 + 連續 */}
      <td colSpan={5} style={{ padding: '4px 14px 10px 34px' }}>
        <table className="data-table" style={{ minWidth: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{ind.label} 明細</th>
              <th className="num">數值</th>
              <th className="num">較上期</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ point, d }) => (
              <tr key={point.period}>
                <td>{fmtPeriod(point.period)}</td>
                <td className={`num ${chipClass(d)}`}>{fmtValue(point.value, ind.unit)}</td>
                <td className={`num ${chipClass(d)}`}>{fmtDelta(d, ind.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

/**
 * Indicator column: one indicator per column, with its own trend line and consecutive periods (0.6.35) hanging on the right.
 *
 * ⚠️ **The color rule is "red = higher than the previous issue, green = lower than the previous issue", red does not mean good. **
 * 0.6.34 Previously, non-agricultural employment was colored according to the positive and negative values ​​(increase in employment = red). After changing it to be consistent across the table
 * It follows the rise and fall - so "+57 thousand but 72 less than last period" is now green. There cannot be multiple grids in the same table
 * Red means "the value is positive", and some means "it is higher than the previous period". The coexistence of two sets of rules is more difficult to read than one set of rules.
 * The hint below the table is to explain this and cannot be deleted.
 *
 * The trend line draws **the indicator's own 12-period value** (not the increase or decrease): what the user wants to see is
 * "Where is this indicator going?" If you draw the increase or decrease, it will become a line jumping above and below 0, and the water level cannot be seen.
 */
function IndicatorRow({
  ind,
  behind,
  open,
  onToggle,
}: {
  ind: MacroIndicator
  behind: number
  open: boolean
  onToggle: () => void
}) {
  const d = delta(ind.latest, ind.previous)
  const streak = risingStreak(ind.points)
  const canExpand = ind.points.length > 0
  return (
    <>
      <tr>
        <td>
          <div className="cell-tree">
            {canExpand ? (
              <button
                className="year-toggle"
                onClick={onToggle}
                aria-expanded={open}
                aria-label={`${open ? '收合' : '展開'} ${ind.label} 的逐期明細`}
              >
                {open ? <Minus size={13} /> : <Plus size={13} />}
              </button>
            ) : (
              <span className="toggle-slot" />
            )}
            <div>
              <div className="mac-row-label">
                {ind.label}
                {/* 只有落後時才掛徽章：五列都掛「最新」等於沒有訊號 */}
                {behind > 0 && <span className="badge badge-warn">落後 {behind} 期</span>}
              </div>
              <div className="mac-row-note">{ind.note}</div>
            </div>
          </div>
        </td>
        <td className={`num ${chipClass(d)}`}>
          <div>{fmtValue(ind.latest?.value ?? null, ind.unit)}</div>
          <div className="mac-row-period">{fmtPeriod(ind.latest?.period)}</div>
        </td>
        <td className={`num ${chipClass(d)}`}>{fmtDelta(d, ind.unit)}</td>
        <td className="num" style={{ width: SPARK_W + 18 }}>
          <SparkCell
            points={ind.points.map((p) => p.value)}
            color={d === null ? CHART_COLORS.axis : d > 0 ? CHART_COLORS.up : CHART_COLORS.down}
            ariaLabel={`${ind.label}近 ${ind.points.length} 期走勢`}
          />
        </td>
        <td
          className={`num ${streak ? chipClass(streak.direction) : ''}`}
          style={{ whiteSpace: 'nowrap' }}
        >
          {streak ? (
            <>
              連 {streak.periods} 期{streak.direction > 0 ? '上升' : '下降'}
              {/* 落後中的指標，那個「連續」的末端不是現在，不講清楚會被讀成當前趨勢 */}
              {behind > 0 && <div className="mac-row-period">截至該期</div>}
            </>
          ) : (
            '—'
          )}
        </td>
      </tr>
      {open && <IndicatorDetail ind={ind} />}
    </>
  )
}

export function MacroPage() {
  const [macro, setMacro] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const m = await fetchMacro()
    setMacro(m)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /*
    美國那份的載入中／查無狀態底下仍然掛著台股市場（0.6.28）：
    兩塊資料各自載入、各自失敗，美國 FRED 抓不到不該讓整頁只剩一句「尚未產生」。
  */
  if (loading) {
    return (
      <>
        <div className="glass empty-state section">
          <RefreshCw size={28} className="spin" />
          <div style={{ marginTop: 10 }}>正在讀取總體經濟資料…</div>
        </div>
        <TwMarketSection />
      </>
    )
  }

  if (!macro) {
    return (
      <>
        <div className="glass empty-state section">
          <div className="empty-icon">
            <Globe size={36} />
          </div>
          <div>總體經濟資料尚未產生。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            每日排程完成後會自動補上，稍後再回來看看。
          </div>
        </div>
        <TwMarketSection />
      </>
    )
  }

  // The benchmark for lagging behind is "which period is the latest for other indicators in the same group", without checking the release calendar (see macroPeriod.ts)
  const peerLatest = latestPeriod(macro.indicators.map((i) => i.latest?.period))

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /*
    「全部展開」只認展得開的列（有 points 的）——若把沒有資料的指標也算進來，
    allOpen 永遠是 false，按鈕會卡在「全部展開」按不動（同法人表與年度收益頁的處置）。
  */
  const expandable = macro.indicators.filter((i) => i.points.length > 0).map((i) => i.id)
  const allOpen = expandable.length > 0 && expandable.every((id) => expanded.has(id))
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(expandable))

  return (
    <>
      {/*
        頂層頁沒有 .detail-body 包著（那是個股分析的容器，padding 在 index.css），
        故自己包 .section + .glass，否則內容會貼齊視窗邊緣。
      */}
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3 className="head-tight">{macro.region}總體經濟</h3>
          {macro.asOf && (
            <span className="source-tag section-stamp">
              資料更新於 {fmtUpdatedAt(macro.asOf)}
              {/*
                0.6.11 起 asOf 只在資料真的變動時才跳，月度數據一個月才動一次 ——
                單看它會像是壞掉了。同日的檢查時間沒有資訊量（就是 asOf 本身），
                只在不同日時才補上，讓「這個月還沒發布」與「排程掛了」分得開。
              */}
              {macro.checkedAt && !isSameDay(macro.checkedAt, macro.asOf) && (
                <>（最後檢查 {fmtUpdatedAt(macro.checkedAt)}）</>
              )}
            </span>
          )}
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
        </div>

        {/* 瘦身成一行（0.6.35）：細節全在下方的表，卡片版等於把同一份數字說兩次 */}
        <div className="mac-chip-row">
          {macro.indicators.map((ind) => (
            <IndicatorChip key={ind.id} ind={ind} />
          ))}
        </div>

        {/*
          一列一個指標（0.6.35，原本是一列一個月份）。

          **Why transpose**: The "trend/continuation" of the legal person table describes the sequence of "total".
          而五個總經指標沒有合計可言（單位是 %、千人、指數，加總沒有意義）。
          轉成一列一個指標之後，趨勢與連續描述的就是該指標自己的 12 期 —— 語意才成立，
          而且對回法人表「一列一個東西 ＋ 它自己的趨勢與連續」的形狀。

          代價是「同一個月五個指標」要橫著看，這是刻意接受的取捨。

          Since 0.6.38 this shares **one card** with the chip row above: both are the same set of indicators read
          two ways (what it is now / how it moved over 12 periods). Split across two cards, the "資料更新於" stamp
          and the refresh button looked as if they only governed the upper one.
        */}
        <div className="rpt-section-head" style={{ marginTop: 18 }}>
          <div className="chart-title">近期走勢・近 12 期</div>
          {expandable.length > 0 && (
            <button className="btn btn-sm" onClick={toggleAll}>
              {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              {allOpen ? '全部收起' : '全部展開'}
            </button>
          )}
        </div>

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>指標</th>
                <th className="num">最新</th>
                <th className="num">較上期</th>
                <th className="num">趨勢</th>
                <th className="num">連續</th>
              </tr>
            </thead>
            <tbody>
              {macro.indicators.map((ind) => (
                <IndicatorRow
                  key={ind.id}
                  ind={ind}
                  behind={periodsBehind(ind.latest?.period ?? null, peerLatest)}
                  open={expanded.has(ind.id)}
                  onToggle={() => toggle(ind.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/*
          這句不可刪：全表改用升降色之後，非農就業的紅綠不再代表「就業增加 / 減少」，
          而是「比上期高 / 低」。沒有這句，紅色會被讀成「好消息」。
        */}
        <p className="hint" style={{ marginTop: 8 }}>
          紅色代表比上期高、綠色代表比上期低；升降本身沒有好壞之分。
          點左側的「＋」看該指標逐期的數字。資料來源：美國聖路易聯準銀行 FRED。
        </p>
      </div>

      {/*
        台股市場擺在美國總經之後：這一頁的主軸是「與個股無關的市場背景」，
        兩塊都屬於它。自己載入自己的資料（同本頁的做法），互不影響 ——
        美國那份抓不到時，台股這段照樣看得到。
      */}
      <TwMarketSection />
    </>
  )
}
