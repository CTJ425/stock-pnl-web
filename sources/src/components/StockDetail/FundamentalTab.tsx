/**
 * Fundamentals page: three valuation indicators (price-to-earnings ratio/yield rate/price-to-book value ratio) and monthly revenue in the past 12 months.
 * The data comes from fundamental/{ticker}.json, which is pre-produced in batches after the market opens. This component is only responsible for rendering and does not load it by itself.
 * ——The same data is also fed to the industry badge and AI analysis of the title column, so it is loaded and distributed by StockDetailPage.
 *
 * Unit trap: The monthly revenue is **thousand yuan**, and the profit rate and increase/decrease rate are **%**. Table headers and column names must be marked.
 * You can't just know it in the program (follow the principle of "stock/ticket" in chip tab).
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { FundamentalData, ProfitQuarter } from '../../services/fundamentalProxy'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { MultiLineChart } from '../Charts/MultiLineChart'
import { ChartLegend } from '../Charts/ChartLegend'
import { CATEGORICAL_COLORS } from '../Charts/chartColors'
import { chipClass, fmtInt, fmtUpdatedAt } from './chipFormat'

interface FundamentalTabProps {
  fundamental: FundamentalData | null
  loading: boolean
}

/**
 * The four ratios of profitability: the same dimension and the same vertical axis, so categorical colors are used to express "who is this"?
 * Sequentially assigned non-cyclical (same as TechnicalTab's moving average). The order is the order of the income statement from top to bottom.
 * The legend and table fields are all in this order, and the three places cannot be arranged separately.
 */
const MARGIN_SERIES: Array<{
  name: string
  color: string
  value: (q: ProfitQuarter) => number | null
}> = [
  { name: '毛利率', color: CATEGORICAL_COLORS[0], value: (q) => q.grossMarginPercent },
  { name: '營益率', color: CATEGORICAL_COLORS[1], value: (q) => q.operatingMarginPercent },
  { name: '稅前純益率', color: CATEGORICAL_COLORS[2], value: (q) => q.pretaxMarginPercent },
  { name: '稅後純益率', color: CATEGORICAL_COLORS[3], value: (q) => q.netMarginPercent },
]

/** Two decimal places; if there is no data, return "-" (do not use 0 to pretend to be a missing value)*/
function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

/** signed percentage*/
function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

/**
 * Earnings per share: two decimal places with "yuan".
 *
 * Separate from `fmtPercent` but not shared: EPS **without positive sign** (+4.71 yuan reads like an increase or decrease),
 * But the negative sign of the loss must remain.
 */
function fmtEps(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)} 元`
}

/** 'YYYY-MM' → 'YYYY year MM month'*/
function fmtYearMonth(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]} 年 ${m[2]} 月` : ym
}

/**
 * Short month labels for charts.
 *
 * Cannot use `fmtYearMonth`: "June 2026" is about 100px wide at 11px font level,
 * The 12-month chart, on the other hand, is only about 39px per grid – the labels will be stacked on top of each other.
 * **The year cannot be omitted** (if only "06" is left, the two boxes crossing the new year will not be able to tell which year it is), so `2026/06` is used.
 */
function fmtChartMonth(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}/${m[2]}` : ym
}

/**
 * Short quarter labels for trend charts: '2026-Q1' → '26Q1'.
 *
 * The "2026 Quarter 1" used in the table is about 84px wide at the 11px font size, while the 12-season image is only about 41px per box.
 * **You cannot omit the entire year** (12 seasons span three years, leaving only "Q1" will make it impossible to tell which year it is), so the last two digits are left.
 */
function fmtChartQuarter(yq: string): string {
  const m = yq.match(/^(\d{2})(\d{2})-Q(\d)$/)
  return m ? `${m[2]}Q${m[3]}` : yq
}

/**
 * Profitability chart. The four lines are coaxial. Click on the legend to turn off one of them.
 *
 * The turned off sequence is moved entirely out of `series`** instead of being drawn transparent - the value range of `MultiLineChart` is given by
 * The series passed in is currently calculated. After it is removed, the Y-axis will be recalculated only based on the remaining lines.
 * This is exactly the point of "only looking at a single item": when viewed alone, the after-tax net income ratio will fill the entire vertical axis.
 * Rather than being held down by the scale of gross profit margin.
 *
 * It is split into independent components because it is the only thing on this page that needs to record its own status;
 * Putting it into FundamentalTab will force the one (currently pure presentation, with two early returns at the beginning) to declare the hook first.
 */
function MarginTrendChart({
  quarters,
  labelIndices,
}: {
  quarters: ProfitQuarter[]
  labelIndices: number[]
}) {
  const [hidden, setHidden] = useState<string[]>([])
  const visible = MARGIN_SERIES.filter((s) => !hidden.includes(s.name))

  return (
    <>
      <div className="chart-title" style={{ marginTop: 12 }}>
        四項比率走勢（%）
      </div>
      <div className="chart-with-legend">
        <MultiLineChart
          labels={quarters.map((q) => fmtChartQuarter(q.yearQuarter))}
          series={visible.map((s) => ({
            name: s.name,
            color: s.color,
            values: quarters.map(s.value),
          }))}
          labelIndices={labelIndices}
          formatValue={(v) => `${v.toFixed(2)}%`}
          ariaLabel={`近 ${quarters.length} 季獲利能力走勢`}
        />
        <div className="chart-legend-side">
          <ChartLegend
            items={MARGIN_SERIES.map((s) => ({
              label: s.name,
              color: s.color,
              hidden: hidden.includes(s.name),
              // The last one is not turned off: turning them all off will only leave an empty coordinate axis, which looks broken.
              toggleLocked: visible.length === 1 && visible[0].name === s.name,
              onToggle: () =>
                setHidden((prev) =>
                  prev.includes(s.name) ? prev.filter((n) => n !== s.name) : [...prev, s.name],
                ),
            }))}
          />
          <div className="chart-legend-foot">
            點圖例可以把那條線關掉，只留想看的。金融業沒有毛利率，該條線會斷開。
          </div>
        </div>
      </div>
    </>
  )
}

export function FundamentalTab({ fundamental, loading }: FundamentalTabProps) {
  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <RefreshCw size={28} className="spin" />
        <div style={{ marginTop: 10 }}>正在讀取基本面…</div>
      </div>
    )
  }

  if (!fundamental) {
    return (
      <div className="empty-state" style={{ padding: 32 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>基本面資料尚未產生</div>
        <div className="hint" style={{ marginTop: 6 }}>
          盤後批次完成後會自動補上，稍後再回來看看。
        </div>
      </div>
    )
  }

  const { valuation, revenueMonths, profitQuarters, notes } = fundamental
  // Presented from new to old (the files are presented from old to new to facilitate batch merging)
  const months = [...revenueMonths].reverse()

  /*
    12 months means about 39px per slot, while "2026/06" needs about 48px —— labelling every one overlaps.
    Label every other one (12 → 6 labels, about 78px apart); under 8 months the slots are wide enough for all.
  */
  const revenueLabelIndices = revenueMonths
    .map((_, i) => i)
    .filter((i) => revenueMonths.length <= 8 || i % 2 === 0)
  const quarters = [...profitQuarters].reverse()
  const latestQuarter = quarters[0] ?? null
  /*
    EPS and the ratios come from different sources (ratios refresh nightly, EPS only arrives when a quarterly
    report is backfilled), so the newest quarter often has ratios but no EPS yet. Take "the most recent quarter
    that has an EPS" instead of reading latestQuarter directly —— otherwise the screen shows "—" for the few days
    after a quarterly release, which looks broken.
  */
  const latestEps = quarters.find((q) => q.epsTwd !== null) ?? null
  const epsQuarters = profitQuarters.filter((q) => q.epsTwd !== null)

  /* Each grid of 12 quarters is about 41px, while "26Q1" is about 30px - all the labels will be pasted together, so they are separated by one according to the monthly revenue.*/
  const profitLabelIndices = profitQuarters
    .map((_, i) => i)
    .filter((i) => profitQuarters.length <= 8 || i % 2 === 0)

  return (
    <div>
      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>估值指標</h3>
          {valuation?.dataDate && <span className="source-tag">資料日 {valuation.dataDate}</span>}
        </div>

        {valuation ? (
          <div className="kpi-grid">
            <div className="glass kpi">
              <div className="kpi-label">本益比 (PER)</div>
              <div className="kpi-value">{fmtRatio(valuation.peRatio)}</div>
              <div className="kpi-sub">股價 ÷ 每股盈餘；虧損公司不適用</div>
            </div>
            <div className="glass kpi">
              <div className="kpi-label">殖利率</div>
              <div className="kpi-value">
                {valuation.dividendYieldPercent === null
                  ? '—'
                  : `${valuation.dividendYieldPercent.toFixed(2)}%`}
              </div>
              <div className="kpi-sub">近一年現金股利相對現價的比率</div>
            </div>
            <div className="glass kpi">
              <div className="kpi-label">股價淨值比 (PBR)</div>
              <div className="kpi-value">{fmtRatio(valuation.pbRatio)}</div>
              <div className="kpi-sub">股價相對每股淨值的倍數</div>
            </div>
          </div>
        ) : (
          <p className="hint">查無估值資料。</p>
        )}
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3 className="head-tight">獲利能力</h3>
          {latestQuarter && (
            <span className="source-tag section-stamp">
              {latestQuarter.yearQuarter.replace('-Q', ' 年第 ')} 季
              {quarters.length > 1 && `（已累積 ${quarters.length} 季）`}
            </span>
          )}
          <span className="source-tag">比率單位：%；每股盈餘單位：元</span>
        </div>

        {latestQuarter ? (
          <>
            <div className="kpi-grid">
              {/*
                EPS comes before the four ratios: it is "how much did one share earn", the number that lines up
                with the P/E, and the one users look at first. The ratios answer a different question (how well).
              */}
              <div className="glass kpi">
                <div className="kpi-label">每股盈餘 (EPS)</div>
                <div className="kpi-value">{fmtEps(latestEps?.epsTwd)}</div>
                <div className="kpi-sub">
                  {latestEps
                    ? latestEps.yearQuarter === latestQuarter.yearQuarter
                      ? '這一股在這一季替你賺到的錢'
                      : `最近有數字的是 ${latestEps.yearQuarter.replace('-Q', ' 年第 ')} 季`
                    : '季報公布後補上（來源與比率不同）'}
                </div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">毛利率</div>
                <div className="kpi-value">{fmtPercent(latestQuarter.grossMarginPercent)}</div>
                <div className="kpi-sub">賣一百元的東西，扣掉成本後還剩多少</div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">營益率</div>
                <div className="kpi-value">{fmtPercent(latestQuarter.operatingMarginPercent)}</div>
                <div className="kpi-sub">再扣掉管銷與研發後，本業還賺多少</div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">稅前純益率</div>
                <div className="kpi-value">{fmtPercent(latestQuarter.pretaxMarginPercent)}</div>
                <div className="kpi-sub">加計業外損益、還沒繳稅前的獲利比率</div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">稅後純益率</div>
                <div className="kpi-value">{fmtPercent(latestQuarter.netMarginPercent)}</div>
                <div className="kpi-sub">繳完稅真正落袋的比率</div>
              </div>
            </div>

            {/*
              The chart uses profitQuarters (oldest first), not the `quarters` above —— that one was reversed to
              newest-first for the table. Getting it wrong flips the whole line **and still looks plausible**;
              it is the same trap as monthly revenue (see the FundamentalTab test that pins direction by y coordinate).

              Chart above table, following the layout monthly revenue already uses. Not drawn for a single quarter:
              `lineSegments` needs two points to connect anything, so one quarter would leave an empty axis ——
              hence the same `> 1` guard the table uses.
            */}
            {quarters.length > 1 && (
              <MarginTrendChart quarters={profitQuarters} labelIndices={profitLabelIndices} />
            )}

            {/*
              EPS gets its own chart and **must not go into the shared-axis one above**: its unit is TWD while the
              ratios are %, and on one vertical axis 59 (%) and 13 (TWD) would be compared as if they were the
              same kind of quantity, which means nothing.

              Only the quarters that have an EPS (`epsQuarters`) are drawn, rather than padding the range with
              nulls: EPS is backfilled quarter by quarter so gaps are normal, and a broken line would read as
              "those quarters earned nothing".
            */}
            {epsQuarters.length > 1 && (
              <>
                <div className="chart-title" style={{ marginTop: 12 }}>
                  每股盈餘（元）
                </div>
                <LineSeriesChart
                  points={epsQuarters.map((q) => ({
                    label: fmtChartQuarter(q.yearQuarter),
                    value: q.epsTwd,
                  }))}
                  labelIndices={epsQuarters
                    .map((_, i) => i)
                    .filter((i) => epsQuarters.length <= 8 || i % 2 === 0)}
                  formatValue={(v) => `${v.toFixed(2)} 元`}
                  ariaLabel={`近 ${epsQuarters.length} 季每股盈餘走勢`}
                />
              </>
            )}

            {quarters.length > 1 && (
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>季別</th>
                      <th className="num">營收（百萬元）</th>
                      <th className="num">每股盈餘（元）</th>
                      <th className="num">毛利率</th>
                      <th className="num">營益率</th>
                      <th className="num">稅前純益率</th>
                      <th className="num">稅後純益率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarters.map((q) => (
                      <tr key={q.yearQuarter}>
                        <td>{q.yearQuarter.replace('-Q', ' 年第 ')} 季</td>
                        <td className="num">{fmtInt(q.revenueMillionTwd)}</td>
                        <td className="num">{fmtEps(q.epsTwd)}</td>
                        <td className="num">{fmtPercent(q.grossMarginPercent)}</td>
                        <td className="num">{fmtPercent(q.operatingMarginPercent)}</td>
                        <td className="num">{fmtPercent(q.pretaxMarginPercent)}</td>
                        <td className="num">{fmtPercent(q.netMarginPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="hint">查無獲利能力資料。</p>
        )}
        {/*
          Saying "one row per quarter, accumulated over time" out loud is deliberate —— the source only returns the
          newest quarter, so a single row on screen reads as broken when it just has not accumulated yet.
        */}
        <p className="hint" style={{ marginTop: 8 }}>
          季度比率由證交所彙總計算，每季財報公布後更新；序列逐季累積，最多保留 12 季。
          每股盈餘來自季報，比比率晚幾天才補上，最新一季可能先顯示「—」。
        </p>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          {/*
            The stamp sits right next to the title because it answers "is the table I am looking at current?" ——
            below the table nobody notices it (0.6.4-dev.4, actually happened: 11 months were missing from the
            screen and the answer was two lines further down the same page, still unseen).
            This is "when we wrote the file", a different thing from the 資料日 on the valuation side. Do not merge them.
          */}
          <h3 className="head-tight">月營收</h3>
          {fundamental.asOf && (
            <span className="source-tag section-stamp">
              資料更新於 {fmtUpdatedAt(fundamental.asOf)}（共 {revenueMonths.length} 個月）
            </span>
          )}
          <span className="source-tag">單位：千元</span>
        </div>

        {months.length === 0 ? (
          <p className="hint">查無月營收資料。</p>
        ) : (
          <>
            {/*
              The chart uses revenueMonths (oldest first), not the `months` above —— that one was reversed to
              newest-first for the table. The left edge of a trend chart must be the earlier month; getting it
              wrong flips the line **and still looks plausible** (the trend reads exactly backwards), which is the
              hardest kind of mistake to spot.
            */}
            <div className="chart-title" style={{ marginTop: 4 }}>
              當月營收（千元）
            </div>
            <LineSeriesChart
              points={revenueMonths.map((m) => ({
                label: fmtChartMonth(m.yearMonth),
                value: m.revenueThousandTwd,
              }))}
              labelIndices={revenueLabelIndices}
              formatValue={(v) => `${fmtInt(v)} 千元`}
              ariaLabel="近 12 個月月營收走勢"
            />

            <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th className="num">當月營收（千元）</th>
                  <th className="num">月增</th>
                  <th className="num">年增</th>
                  <th className="num">累計年增</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.yearMonth}>
                    <td>{fmtYearMonth(m.yearMonth)}</td>
                    <td className="num">{fmtInt(m.revenueThousandTwd)}</td>
                    <td className={`num ${chipClass(m.momPercent)}`}>{fmtPercent(m.momPercent)}</td>
                    <td className={`num ${chipClass(m.yoyPercent)}`}>{fmtPercent(m.yoyPercent)}</td>
                    <td className={`num ${chipClass(m.cumulativeYoyPercent)}`}>
                      {fmtPercent(m.cumulativeYoyPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          月營收由公司每月 10 日前自結公布，與季報的認列基礎不同，僅供趨勢參考。
          月營收有明顯的季節性（例如年底旺季），單看絕對金額的高低起伏未必代表營運轉折，
          表格的年增率比較適合判斷方向。
        </p>
      </section>

      {notes.length > 0 && (
        <section className="rpt-section">
          {notes.map((n) => (
            <p className="hint" key={n}>
              {n}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}
