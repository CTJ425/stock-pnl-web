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
// Peer lag badges live on Admin only — on this page they read as "stale data" to end users.
import { TwMarketSection } from './TwMarketSection'

/** Whether the two ISO times fall on the same local calendar day. Bad values ​​are always considered to be on different days (prefer to display one more row)*/
function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return da.toDateString() === db.toDateString()
}

/** 'YYYY-MM' → calendar month; 'YYYY-MM-DD' → statement / step date */
function fmtPeriod(period: string | undefined): string {
  if (!period) return '—'
  const day = period.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (day) return `${day[1]} 年 ${Number(day[2])} 月 ${Number(day[3])} 日`
  const m = period.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]} 年 ${m[2]} 月` : period
}

/**
 * Value with unit. Return "-" if missing value (do not pretend to be 0).
 * `rate` shows the target range when `valueLow` is present (no leading + — it is a level, not a growth rate).
 */
function fmtValue(
  v: number | null | undefined,
  unit: string,
  kind?: MacroIndicator['kind'],
  valueLow?: number | null,
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (kind === 'rate') {
    if (typeof valueLow === 'number' && Number.isFinite(valueLow)) {
      return `${valueLow.toFixed(2)}–${v.toFixed(2)}%`
    }
    return `${v.toFixed(2)}%`
  }
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
function fmtDelta(d: number | null, unit: string, kind?: MacroIndicator['kind']): string {
  if (d === null) return '—'
  if (Math.abs(d) < 0.005) return '持平'
  if (kind === 'rate') {
    // Percentage-point change of the upper bound (e.g. −0.25)
    return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`
  }
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
      <span className="mac-chip-value">
        {fmtValue(ind.latest?.value ?? null, ind.unit, ind.kind, ind.latest?.valueLow)}
      </span>
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
      {/* Indicator column + latest + vs previous + trend + streak */}
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
                <td className={`num ${chipClass(d)}`}>
                  {fmtValue(point.value, ind.unit, ind.kind, point.valueLow)}
                </td>
                <td className={`num ${chipClass(d)}`}>{fmtDelta(d, ind.unit, ind.kind)}</td>
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
  open,
  onToggle,
}: {
  ind: MacroIndicator
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
              <div className="mac-row-label">{ind.label}</div>
              <div className="mac-row-note">{ind.note}</div>
            </div>
          </div>
        </td>
        <td className={`num ${chipClass(d)}`}>
          <div>
            {fmtValue(ind.latest?.value ?? null, ind.unit, ind.kind, ind.latest?.valueLow)}
          </div>
          <div className="mac-row-period">{fmtPeriod(ind.latest?.period)}</div>
        </td>
        <td className={`num ${chipClass(d)}`}>{fmtDelta(d, ind.unit, ind.kind)}</td>
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
    The Taiwan market block stays mounted underneath the US loading / empty states (0.6.28):
    the two blocks load and fail independently, and a FRED outage must not reduce the whole page to one line.
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /*
    "Expand all" only counts rows that can expand (those with points) —— counting indicators without data would
    keep allOpen false forever, jamming the button on "expand all" (same handling as the institutional and yearly tables).
  */
  const expandable = macro.indicators.filter((i) => i.points.length > 0).map((i) => i.id)
  const allOpen = expandable.length > 0 && expandable.every((id) => expanded.has(id))
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(expandable))

  return (
    <>
      {/*
        A top-level page has no .detail-body around it (that is the individual-stock container, padded in index.css),
        so it wraps itself in .section + .glass —— without that the content sits flush against the window edge.
      */}
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3 className="head-tight">{macro.region}總體經濟</h3>
          {macro.asOf && (
            <span className="source-tag section-stamp">
              資料更新於 {fmtUpdatedAt(macro.asOf)}
              {/*
                Since 0.6.11 asOf only moves when the data really changed, and monthly series move once a month ——
                on its own that looks broken. A check time on the same day carries no information (it is asOf itself),
                so it is only appended on a different day, which separates "not published yet" from "the schedule died".
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

        {/* Slimmed to one line (0.6.35): the detail is all in the table below, so cards said the same numbers twice */}
        <div className="mac-chip-row">
          {macro.indicators.map((ind) => (
            <IndicatorChip key={ind.id} ind={ind} />
          ))}
        </div>

        {/*
          One row per indicator (0.6.35; it used to be one row per month).

          **Why transpose**: The "trend/continuation" of the legal person table describes the sequence of "total".
          The five macro indicators have no such total (their units are %, thousands of people, index points ——
          adding them means nothing). One row per indicator makes trend and streak describe that indicator's own
          12 periods, so the semantics hold, and it matches the institutional table's shape: one row per thing,
          plus that thing's own trend and streak.

          The cost is that "five indicators in the same month" must be read across. That trade-off is deliberate.

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
                  open={expanded.has(ind.id)}
                  onToggle={() => toggle(ind.id)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/*
          Do not delete this sentence: once the whole table switched to rise/fall colouring, red and green on
          non-farm payrolls stopped meaning "jobs added / lost" and started meaning "higher / lower than last
          period". Without it, red reads as good news.
        */}
        <p className="hint" style={{ marginTop: 8 }}>
          紅色代表比上期高、綠色代表比上期低；升降本身沒有好壞之分。
          點左側的「＋」看該指標逐期的數字。資料來源：美國聖路易聯準銀行 FRED。
        </p>
      </div>

      {/*
        The Taiwan market goes after the US macro block: this page is about market background unrelated to any
        one stock, and both belong to that. It loads its own data the same way this page does, independently ——
        when the US side cannot be fetched, this section still shows.
      */}
      <TwMarketSection />
    </>
  )
}
