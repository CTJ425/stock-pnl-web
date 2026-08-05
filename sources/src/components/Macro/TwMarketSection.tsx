/**
 * The volume of the entire Taiwan stock market can be compared with the trading volume of the three major legal persons (0.6.28).
 *
 * **Why put it on the general economic page instead of the annual income page**: The annual income answers "how much I earned" (all personal
 * Realized profit and loss), the answer here is "How is the market?" Put both on the same page. Readers must judge first every time they look at a number.
 * Is this your own or the market's? This page is originally a "common background unrelated to individual stocks", and market volume can belong here.
 *
 * Unit trap: The source is **yuan**, and the screen is converted into **billion yuan** (the market's single-day turnover is 885.5 billion,
 * In meta it is 885,506,043,091 - no one reads it that way). The unit of individual stock chips is "share", and the two are not comparable.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Minus, Plus, RefreshCw } from 'lucide-react'
import {
  fetchMarketDaily,
  type MarketData,
  type MarketDay,
  type MarketInstitutionalSide,
} from '../../services/marketProxy'
import { CandleChart } from '../Charts/CandleChart'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { CHART_COLORS } from '../Charts/chartColors'
import { SPARK_W, SparkCell } from '../Charts/SparkCell'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'

/** The trading amount and the market K-line show several trading days. After about one season, you can see the trend without crushing the X-axis.*/
const SHOWN_DAYS = 60

/**
 * The trading super of the three major legal persons only looks at the last 7 trading days (0.6.30).
 *
 * Consistent with the chip chart of individual stock analysis (where HISTORY_DAYS = 7) - the two charts ask the same question
 * "Is the legal person buying or selling these days?" If you look at one picture for a week and the other for a season, you will think that you are comparing different things.
 * Volume energy and index can last for one season: those two ask "where is the market?" and require a longer context.
 */
const INSTITUTIONAL_DAYS = 7

/** How many rows the daily turnover table shows before "顯示全部" —— same 7 as the institutional table it sits above */
const TURNOVER_ROWS_COLLAPSED = 7

/** Shares → 億股. The file stores raw shares, which run to eleven digits and are unreadable as-is */
function toBillionShares(shares: number | null | undefined): number | null {
  return typeof shares === 'number' && Number.isFinite(shares) ? shares / 1e8 : null
}

/** Transaction count → 萬筆 */
function toTenThousand(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n / 1e4 : null
}

/** Yuan → billion yuan. Returns null if the value is missing (do not pretend to be 0)*/
function toBillion(twd: number | null | undefined): number | null {
  return typeof twd === 'number' && Number.isFinite(twd) ? twd / 1e8 : null
}

/** 100 million yuan, one decimal place; with plus or minus sign (you need to be able to see the direction when buying and selling super)*/
function fmtBillionSigned(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} 億`
}

function fmtBillion(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} 億`
}

/** 'YYYY-MM-DD' → 'MM/DD' (the X-axis grid is only about 8px, so there is no need to fit the year)*/
function shortDate(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}/${m[2]}` : date
}

/**
 * The height of each of the three pictures stacked one on top of the other (0.6.34).
 *
 * The total height of the stacked elements is the sum of the three. Using the 220 when placed side by side will turn this section into a 700px wall.
 * The K line and the trend line are at the same height (they are two ways of drawing the same index), and the transaction amount is a bit lower -
 * It is a supporting role. It is more effective to describe the master-slave relationship in a high degree than to add a line to explain it.
 */
const STACK_CHART_H = 180
const STACK_VOLUME_H = 140

/**
 * Look at the trend line of the trend bar for a few days (0.6.32).
 *
 * Deliberately longer than the 7 columns of the table: if we only use those days in the table, there will be only one dot in the first column and no line can be drawn, and two dots in the second column.
 * Nothing can be seen. Taking 15 days allows each column to have enough context, at the cost of the lines in the oldest columns extending out of the table.
 * ——But that's exactly what "trend" should mean: it answers "what's the trend today", not "what's happening in the table."
 */
const TREND_DAYS = 15

/** The display order and column names of the six units. The table header, expansion details, and KPIs should all be included to avoid drifting due to writing each of the three places once.*/
const UNITS: ReadonlyArray<{ key: keyof MarketInstitutionalSide; label: string }> = [
  { key: 'foreignTwd', label: '外資' },
  { key: 'foreignDealerTwd', label: '外資自營商' },
  { key: 'trustTwd', label: '投信' },
  { key: 'dealerSelfTwd', label: '自營商（自行）' },
  { key: 'dealerHedgeTwd', label: '自營商（避險）' },
  { key: 'totalTwd', label: '合計' },
]

/**
 * The total buying and selling trend up to a certain day and the number of consecutive days in the same direction.
 *
 * `values` is from old to new and **only contains the days of the legal person amount** - leaving the days that have not been filled up in the sequence,
 * The trend line will have a breakpoint out of thin air, and the number of consecutive days will be interrupted by a "not yet made up" and reported low.
 */
function trendAt(values: number[], endIdx: number): { points: number[]; streak: number } {
  const points = values.slice(Math.max(0, endIdx - TREND_DAYS + 1), endIdx + 1)
  const last = values[endIdx]
  let streak = 0
  if (last !== undefined && last !== 0) {
    const sign = Math.sign(last)
    for (let i = endIdx; i >= 0 && Math.sign(values[i]) === sign; i--) streak++
  }
  return { points, streak }
}

/**
 * Trend and two consecutive grids (0.6.33 split by one grid).
 *
 * **Why it must be divided into two columns**: Originally, the trend line and "N consecutive days" were squeezed into the same grid on the right row.
 * The labeled columns will push the lines to the left, and the beginning and end of the lines in the entire column will not be aligned, making it look like the trend range of each column is different.
 * After the columns are divided, the lines have a fixed width and fixed position, so that the columns can be compared.
 *
 * The trend line uses **polar colors** (red for buying and green for selling, according to the direction of the last day); when the line cannot be drawn, `SparkCell` prints "—" by itself.
 */
function TrendCells({ points, streak }: { points: number[]; streak: number }) {
  const last = points[points.length - 1]
  if (last === undefined) {
    return (
      <>
        <td className="num">—</td>
        <td className="num">—</td>
      </>
    )
  }
  const color = last > 0 ? CHART_COLORS.up : last < 0 ? CHART_COLORS.down : CHART_COLORS.axis
  // 1 consecutive day is not a trend and will not be printed (at this time, the continuous column is given "—" instead of leaving it blank, which will be read as missing data)
  const label = streak >= 2 ? `連 ${streak} 日${last > 0 ? '買超' : '賣超'}` : null
  return (
    <>
      <td className="num" style={{ width: SPARK_W + 18 }}>
        <SparkCell
          points={points}
          color={color}
          ariaLabel={`近 ${points.length} 個交易日的三大法人合計買賣超走勢`}
        />
      </td>
      <td className={`num ${label ? chipClass(last) : ''}`} style={{ whiteSpace: 'nowrap' }}>
        {label ?? '—'}
      </td>
    </>
  )
}

/**
 * Expand the buy/sell details for a certain day.
 *
 * **The nested table is used here, which is contrary to the disposal of annual income**, and it is deliberate: the detail column over there is the same as the parent column
 * It’s the same set of fields (same amount, same caliber), and the column widths must be aligned to be readable; the details here are
 * "Six units × buy / sell / buy and sell over" is fundamentally different from the "six units in each column" of the parent column.
 * Forcing the same set of columns will just force a bunch of colSpan placeholders.
 */
function DayDetail({ day }: { day: MarketDay }) {
  const buy = day.institutional?.buy
  const sell = day.institutional?.sell
  return (
    <tr className="detail-row">
      {/* Date column + six units + trend + streak */}
      <td colSpan={UNITS.length + 3} style={{ padding: '4px 14px 10px 34px' }}>
        <table className="data-table" style={{ minWidth: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{day.date} 明細</th>
              <th className="num">買進</th>
              <th className="num">賣出</th>
              <th className="num">買賣超</th>
            </tr>
          </thead>
          <tbody>
            {UNITS.map((u) => {
              const b = toBillion(buy?.[u.key] ?? null)
              const s = toBillion(sell?.[u.key] ?? null)
              const n = toBillion(day.institutional?.[u.key] ?? null)
              return (
                <tr key={u.key}>
                  <td>{u.label}</td>
                  <td className="num">{fmtBillion(b)}</td>
                  <td className="num">{fmtBillion(s)}</td>
                  <td className={`num ${chipClass(n)}`}>{fmtBillionSigned(n)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

export function TwMarketSection() {
  const [market, setMarket] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /*
    A hover index shared by all three charts (0.6.34). It lives here rather than in each chart so that hovering
    a day highlights that same day on the candles, the index line and the turnover bars —— the user is asking
    "what happened that day", not "what was the index that day". The indices only line up because all three
    charts consume the same `days` (see candles below).
  */
  const [hover, setHover] = useState<number | null>(null)
  const [showAllTurnover, setShowAllTurnover] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setMarket(await fetchMarketDaily())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !market) {
    return (
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="empty-state" style={{ padding: 24 }}>
          <RefreshCw size={24} className="spin" />
          <div style={{ marginTop: 10 }}>正在讀取台股市場資料…</div>
        </div>
      </div>
    )
  }

  if (!market) {
    return (
      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3 className="head-tight">台股市場</h3>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          市場資料尚未產生，盤後排程完成後會自動補上。
        </p>
      </div>
    )
  }

  const days = market.days.slice(-SHOWN_DAYS)
  const instDays = market.days.slice(-INSTITUTIONAL_DAYS)
  /*
    Newest first, opposite to every chart on this card —— see the comment above the institutional table.

    The table reads the **whole file**, not the 60-day slice the charts use (0.6.43, AUDIT-08). `SHOWN_DAYS` exists
    to keep an X axis readable, which is a chart's problem; a table has no axis to crowd. Before this, 「顯示全部」
    could only ever reach 60 of the up-to-120 days on file, which is not what "全部" says.
  */
  const allTurnoverDays = [...market.days].reverse()
  const turnoverRows = showAllTurnover
    ? allTurnoverDays
    : allTurnoverDays.slice(0, TURNOVER_ROWS_COLLAPSED)
  /*
    A candle needs open/high/low/close; missing any one and it is not drawn —— open/high/low come from a
    different source than close, so the last day or two may have close only. **But that day's slot must stay**
    (0.6.34): the three stacked charts share one hover index, and filtering incomplete days out would make the
    Nth candle a different day from the Nth point of the others. Padding open/high/low with the close is no
    better: it draws a row of doji that look like a day with no movement at all.
  */
  const candles = days.map((d) => ({
    label: shortDate(d.date),
    open: d.taiexOpen,
    high: d.taiexHigh,
    low: d.taiexLow,
    close: d.taiex,
  }))
  const drawableCandles = candles.filter(
    (c) => c.open !== null && c.high !== null && c.low !== null && c.close !== null,
  ).length
  const latest = days[days.length - 1] ?? null
  /*
    Institutional amounts are backfilled day by day and the most recent days are often not filled yet (see the
    notes in marketProxy). The KPI takes "the latest day that has institutional amounts" rather than reading
    `latest` directly —— otherwise the whole row shows "—" for the hours right after the close and looks broken.
  */
  const latestInst = [...days].reverse().find((d) => d.institutional) ?? null

  /*
    Source for the trend column: every day among the 60 that has institutional amounts, oldest first.
    The table shows 7 rows but the trend needs 15 days —— so it cannot be built from instDays alone.
  */
  const trendDays = days.filter((d) => d.institutional?.totalTwd != null)
  const trendValues = trendDays.map((d) => d.institutional!.totalTwd!)
  const trendIdx = new Map(trendDays.map((d, i) => [d.date, i]))

  const toggle = (date: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })

  /*
    "Expand all" only counts rows that **can** expand (those with buy/sell detail). Counting older data days
    whose detail has not been backfilled would keep allOpen false forever and jam the button on "expand all" ——
    same as YearlyPage counting only stocks whose sells are non-empty.
  */
  const expandable = instDays.filter((d) => d.institutional?.buy).map((d) => d.date)
  const allOpen = expandable.length > 0 && expandable.every((d) => expanded.has(d))
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(expandable))

  // X-axis: 60 days each grid is about 8px, all labels will be mushy - one label every 10 days (six labels).
  // The three pictures have the same set of indexes and the same set of labels, so the X-axis can really match up.
  const labelIndices = days.map((_, i) => i).filter((i) => i % 10 === 0)

  return (
    <div className="section glass" style={{ padding: '18px 20px' }}>
      <div className="rpt-section-head">
        <h3 className="head-tight">台股市場</h3>
        {market.asOf && (
          <span className="source-tag section-stamp">
            資料更新於 {fmtUpdatedAt(market.asOf)}（共 {market.days.length} 個交易日）
          </span>
        )}
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      <div className="kpi-grid" style={{ marginTop: 14 }}>
        <div className="glass kpi">
          <div className="kpi-label">成交金額</div>
          <div className="kpi-value">{fmtBillion(toBillion(latest?.tradeValueTwd))}</div>
          <div className="kpi-sub">{latest ? `${latest.date}（最近交易日）` : '—'}</div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">加權指數</div>
          <div className="kpi-value">{latest?.taiex?.toLocaleString('en-US') ?? '—'}</div>
          <div className={`kpi-sub ${chipClass(latest?.changePoints ?? null)}`}>
            {latest?.changePoints === null || latest?.changePoints === undefined
              ? '—'
              : `${latest.changePoints > 0 ? '+' : ''}${latest.changePoints.toFixed(2)} 點`}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">三大法人買賣超</div>
          <div className={`kpi-value ${chipClass(latestInst?.institutional?.totalTwd ?? null)}`}>
            {fmtBillionSigned(toBillion(latestInst?.institutional?.totalTwd))}
          </div>
          <div className="kpi-sub">
            {latestInst ? `${latestInst.date} 全市場合計` : '尚未補到法人金額'}
          </div>
        </div>
        <div className="glass kpi">
          <div className="kpi-label">其中外資</div>
          <div className={`kpi-value ${chipClass(latestInst?.institutional?.foreignTwd ?? null)}`}>
            {fmtBillionSigned(toBillion(latestInst?.institutional?.foreignTwd))}
          </div>
          <div className="kpi-sub">
            投信 {fmtBillionSigned(toBillion(latestInst?.institutional?.trustTwd))}
          </div>
        </div>
      </div>

      {/*
        Three charts stacked top to bottom sharing one hover index (0.6.34; in 0.6.33 the candles and the index
        line sat side by side).

        The crosshair only lands on the same day across all three when they share width, X axis and index.
        Side by side, each is half as wide and the same pixel position means a different day in each.

        `hover` is held here and passed down, so the mouse over any one of them highlights all three, and each
        tooltip reports its own thing (candles: OHLC; line: the index; bars: hundred-million TWD).
      */}
      <div style={{ marginTop: 16 }}>
        <div className="chart-title">加權指數日 K（近 {drawableCandles} 個交易日）</div>
        {drawableCandles === 0 ? (
          <p className="hint">開高低尚未補到，暫時畫不出 K 線（收盤指數見上方 KPI）。</p>
        ) : (
          <CandleChart
            candles={candles}
            labelIndices={labelIndices}
            height={STACK_CHART_H}
            formatValue={(v) => v.toFixed(2)}
            ariaLabel={`近 ${drawableCandles} 個交易日的加權指數日 K 線`}
            hoverIndex={hover}
            onHover={setHover}
            crosshair
          />
        )}
      </div>

      <div className="chart-title" style={{ marginTop: 14 }}>
        加權指數走勢（收盤）
      </div>
      <LineSeriesChart
        points={days.map((d) => ({ label: shortDate(d.date), value: d.taiex }))}
        labelIndices={labelIndices}
        height={STACK_CHART_H}
        formatValue={(v) => v.toFixed(2)}
        ariaLabel={`近 ${days.length} 個交易日的加權指數收盤走勢`}
        hoverIndex={hover}
        onHover={setHover}
      />

      <div className="chart-title" style={{ marginTop: 14 }}>
        每日成交金額（億元）
      </div>
      <LineSeriesChart
        points={days.map((d) => ({ label: shortDate(d.date), value: toBillion(d.tradeValueTwd) }))}
        labelIndices={labelIndices}
        height={STACK_VOLUME_H}
        formatValue={(v) => `${v.toFixed(1)} 億`}
        ariaLabel={`近 ${days.length} 個交易日的台股成交金額`}
        hoverIndex={hover}
        onHover={setHover}
      />

      {/*
        Daily turnover table (0.6.38). It needs no backend change: `tradeVolumeShares` and `transactions` have been
        in market/daily.json all along and had simply never been shown —— the chart above only draws the amount.

        Shares and amount are both listed on purpose: they answer different questions. A day can trade fewer shares
        for more money (2026-07-29 vs 08-05 in the file: 170.5 億股 / 11,492 億 against 132.1 億股 / 12,002 億),
        which is what a shift towards higher-priced stocks looks like.
      */}
      <div className="rpt-section-head" style={{ marginTop: 18 }}>
        <div className="chart-title">每日成交量・近 {allTurnoverDays.length} 個交易日</div>
        {allTurnoverDays.length > TURNOVER_ROWS_COLLAPSED && (
          <button className="btn btn-sm" onClick={() => setShowAllTurnover((v) => !v)}>
            {showAllTurnover ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {showAllTurnover ? `只顯示近 ${TURNOVER_ROWS_COLLAPSED} 日` : `顯示全部 ${allTurnoverDays.length} 日`}
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table" aria-label="每日成交量">
          <thead>
            <tr>
              <th>日期</th>
              <th className="num">成交股數</th>
              <th className="num">成交金額</th>
              <th className="num">筆數</th>
              <th className="num">加權指數</th>
              <th className="num">漲跌</th>
            </tr>
          </thead>
          <tbody>
            {turnoverRows.map((d) => {
              const shares = toBillionShares(d.tradeVolumeShares)
              const txn = toTenThousand(d.transactions)
              return (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="num">{shares === null ? '—' : `${shares.toFixed(1)} 億股`}</td>
                  <td className="num">{fmtBillion(toBillion(d.tradeValueTwd))}</td>
                  <td className="num">{txn === null ? '—' : `${txn.toFixed(1)} 萬`}</td>
                  <td className="num">{d.taiex === null ? '—' : d.taiex.toFixed(2)}</td>
                  <td className={`num ${chipClass(d.changePoints)}`}>
                    {d.changePoints === null
                      ? '—'
                      : `${d.changePoints > 0 ? '+' : ''}${d.changePoints.toFixed(2)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        **The table is from new to old, and the trend chart is from old to new** - consistent with the treatment of monthly revenue and profitability:
        The left edge of a trend chart must be the earlier day, while the first row of the table must be the most
        recent one. The two directions are deliberately opposite; this is not a slip.

        There used to be an institutional net-buy bar chart here, removed in 0.6.33: the same numbers already have
        a table (showing the amounts) and a trend column (showing direction). A bar chart was a third telling of
        the same thing that only made the card taller.
      */}
      <div className="rpt-section-head" style={{ marginTop: 18 }}>
        <div className="chart-title">
          三大法人買賣超（億元）・近 {instDays.length} 個交易日
        </div>
        {expandable.length > 0 && (
          <button className="btn btn-sm" onClick={toggleAll}>
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {allOpen ? '全部收起' : '全部展開'}
          </button>
        )}
      </div>
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data-table" aria-label="三大法人買賣超">
          <thead>
            <tr>
              <th>日期</th>
              {UNITS.map((u) => (
                <th className="num" key={u.key}>
                  {u.label}
                </th>
              ))}
              <th className="num">趨勢</th>
              <th className="num">連續</th>
            </tr>
          </thead>
          <tbody>
            {[...instDays].reverse().map((d) => {
              const inst = d.institutional
              const idx = trendIdx.get(d.date)
              const { points, streak } = idx === undefined
                ? { points: [], streak: 0 }
                : trendAt(trendValues, idx)
              const isOpen = expanded.has(d.date)
              // Buying/selling was only saved in 0.6.32. The old data only has the difference - no expand button will be given without details.
              const canExpand = Boolean(inst?.buy)
              return (
                <Fragment key={d.date}>
                  <tr>
                    <td>
                      <div className="cell-tree">
                        {canExpand ? (
                          <button
                            className="year-toggle"
                            onClick={() => toggle(d.date)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? '收合' : '展開'} ${d.date} 的買進賣出明細`}
                          >
                            {isOpen ? <Minus size={13} /> : <Plus size={13} />}
                          </button>
                        ) : (
                          <span className="toggle-slot" />
                        )}
                        {d.date}
                      </div>
                    </td>
                    {/* When a day's institutional amounts are not filled yet the whole row is "—"; never fake it with 0 */}
                    {UNITS.map((u) => {
                      const b = toBillion(inst?.[u.key] ?? null)
                      return (
                        <td className={`num ${chipClass(b)}`} key={u.key}>
                          {fmtBillionSigned(b)}
                        </td>
                      )
                    })}
                    <TrendCells points={points} streak={streak} />
                  </tr>
                  {isOpen && <DayDetail day={d} />}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/*
        Cut from two long paragraphs to one sentence in 0.6.33. The fetch cycle used to be described here too,
        but that is a scheduling matter the user does not need while watching the market, and a frontend copy of
        the shift constants is bound to drift from pg_cron —— it did: this said "at most 5 days" while the
        backend was already on 15. The whole passage moved to the admin fetch-status page.
      */}
      <p className="hint" style={{ marginTop: 8 }}>
        買賣超＝買進金額−賣出金額，紅色為買超；「—」是那天還沒補到，不是沒有進出。
      </p>
    </div>
  )
}
