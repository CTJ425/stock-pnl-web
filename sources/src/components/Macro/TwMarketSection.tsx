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
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ChevronsDownUp, ChevronsUpDown, RefreshCw } from 'lucide-react'
import {
  fetchMarketDaily,
  type MarketData,
  type MarketDay,
  type MarketInstitutionalSide,
} from '../../services/marketProxy'
import { CandleChart } from '../Charts/CandleChart'
import { LineSeriesChart } from '../Charts/LineSeriesChart'
import { CHART_COLORS } from '../Charts/chartColors'
import { SparkCell } from '../Charts/SparkCell'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'

/** Spark for the institutional 走勢 column (0.7.6: one per unit row, was one per day). */
const DAY_SPARK_W = 100
const DAY_SPARK_H = 36

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
 * Which amount the matrix cells show (0.7.6).
 *
 * 買進／賣出 used to be two permanent columns out of five, but the number anyone reads is the net.
 * As a switch they cost one control instead of 40% of the table width, and the matrix keeps room for
 * seven day columns.
 */
type InstMetric = 'net' | 'buy' | 'sell'

const METRICS: ReadonlyArray<{ id: InstMetric; label: string }> = [
  { id: 'net', label: '買賣超' },
  { id: 'buy', label: '買進' },
  { id: 'sell', label: '賣出' },
]

/** One unit's amount on one day, in 億, for the chosen metric. `null` = that day is not filled in yet. */
function cellValue(day: MarketDay, key: keyof MarketInstitutionalSide, metric: InstMetric) {
  const inst = day.institutional
  if (!inst) return null
  if (metric === 'net') return toBillion(inst[key])
  // Old files (before 0.6.32) carry the net only —— buy/sell legs are absent, not zero.
  return toBillion(inst[metric]?.[key] ?? null)
}

/**
 * One unit's series over every day that carries its amount, oldest first, plus the same-direction
 * streak ending on the newest of them.
 *
 * Days without the amount are dropped rather than zero-filled: a gap would draw a break in the line out
 * of thin air, and a 「not yet filled in」 in the middle would cut the streak short and under-report it.
 *
 * Reads the whole 60-day slice, not the seven columns of the table —— seven points make a line that is
 * mostly table, and the streak regularly runs longer than a week (see TREND_DAYS).
 */
function unitTrend(
  days: MarketDay[],
  key: keyof MarketInstitutionalSide,
): { points: number[]; streak: number } {
  const values = days
    .map((d) => toBillion(d.institutional?.[key] ?? null))
    .filter((v): v is number => v !== null)
  const last = values[values.length - 1]
  let streak = 0
  if (last !== undefined && last !== 0) {
    const sign = Math.sign(last)
    for (let i = values.length - 1; i >= 0 && Math.sign(values[i]) === sign; i--) streak++
  }
  return { points: values.slice(-TREND_DAYS), streak }
}

/**
 * Cell tint by magnitude, **relative to the largest number in that row**.
 *
 * Row-relative on purpose: 外資 moves in hundreds of 億 and 外資自營商 in single digits. One table-wide
 * scale would leave every row but 外資 and 合計 flat, which says nothing about that unit's own big days ——
 * and "which day was big for this unit" is exactly what the row is for.
 */
function heatStyle(v: number | null, rowMax: number): CSSProperties | undefined {
  if (v === null || v === 0 || rowMax === 0) return undefined
  const pct = (6 + Math.min(1, Math.abs(v) / rowMax) * 30).toFixed(1)
  const color = v > 0 ? CHART_COLORS.up : CHART_COLORS.down
  return { background: `color-mix(in srgb, ${color} ${pct}%, transparent)` }
}

/** Sum of the days that have a number; `null` only when none of them do (≠ a real 0). */
function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

/**
 * 走勢 column: 「連 N 日買超／賣超」above the spark.
 * The streak describes the **unit**, which is why it sits on the unit's row (0.7.6) and no longer in the date cell.
 */
function UnitTrend({ points, streak }: { points: number[]; streak: number }) {
  const last = points[points.length - 1]
  if (last === undefined) {
    return <span className="hint">—</span>
  }
  const color = last > 0 ? CHART_COLORS.up : last < 0 ? CHART_COLORS.down : CHART_COLORS.axis
  // streak < 2 is not a trend — show "—" rather than "連 1 日"
  const label = streak >= 2 ? `連 ${streak} 日${last > 0 ? '買超' : '賣超'}` : null
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
      }}
    >
      <span
        className={label ? chipClass(last) : 'hint'}
        style={{ whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: label ? 600 : undefined }}
      >
        {label ?? '—'}
      </span>
      <SparkCell
        points={points}
        color={color}
        width={DAY_SPARK_W}
        height={DAY_SPARK_H}
        ariaLabel={`近 ${points.length} 個交易日的買賣超走勢`}
      />
    </div>
  )
}

export function TwMarketSection() {
  const [market, setMarket] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  /** Which amount the institutional matrix shows (0.7.6). */
  const [instMetric, setInstMetric] = useState<InstMetric>('net')
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
    const data = await fetchMarketDaily()
    setMarket(data)
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
    One row per unit (0.7.6). Everything a row needs is computed once here rather than inside the JSX:
    the seven cells, the row's own maximum (for the heat tint), the 7-day sum, and the trend, which reads
    the whole 60-day slice rather than the seven columns —— see unitTrend.
  */
  const instRows = UNITS.map((u) => {
    const values = instDays.map((d) => cellValue(d, u.key, instMetric))
    const rowMax = Math.max(0, ...values.map((v) => (v === null ? 0 : Math.abs(v))))
    return { ...u, values, rowMax, cum: sumOrNull(values), ...unitTrend(days, u.key) }
  })

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
        Institutional matrix (0.7.6). The predecessor was 日期×單位 with a per-day expand: seven expands and
        42 rows to answer 「外資這幾天在買還是在賣」, and with only the newest day open by default, 外資 and 投信 ——
        the two numbers anyone actually came for —— were hidden on the other six days.

        Transposing it fixes that by construction: 列＝單位, 欄＝日期, 6×7 all visible with no expand state at all.
        Days run oldest → newest left to right, the same direction as the three charts above; the old table ran
        newest-first and was the only thing on this card reading the other way.
      */}
      <div className="rpt-section-head" style={{ marginTop: 18 }}>
        <div className="chart-title">
          三大法人{METRICS.find((m) => m.id === instMetric)!.label}（億元）・近 {instDays.length}{' '}
          個交易日
        </div>
        <div className="mac-metric-seg" role="group" aria-label="切換金額口徑">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="btn btn-sm"
              aria-pressed={instMetric === m.id}
              onClick={() => setInstMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data-table mac-inst-matrix" aria-label="三大法人買賣超">
          <thead>
            <tr>
              <th>單位</th>
              {instDays.map((d) => (
                <th key={d.date} className="num">
                  {shortDate(d.date)}
                </th>
              ))}
              <th className="num">7 日累計</th>
              <th>近 {TREND_DAYS} 日走勢</th>
            </tr>
          </thead>
          <tbody>
            {instRows.map((r) => (
              <tr key={r.key} className={r.key === 'totalTwd' ? 'row-total' : undefined}>
                <td>{r.label}</td>
                {r.values.map((v, i) => (
                  <td
                    key={instDays[i].date}
                    /*
                      Only the net is signed and coloured. 買進／賣出 are gross amounts —— every one of them is
                      positive, so red/green there would be a colour that always says the same thing.
                    */
                    className={`num ${instMetric === 'net' ? chipClass(v) : ''}`}
                    style={instMetric === 'net' ? heatStyle(v, r.rowMax) : undefined}
                  >
                    {instMetric === 'net' ? fmtBillionSigned(v) : fmtBillion(v)}
                  </td>
                ))}
                <td className={`num mac-inst-cum ${instMetric === 'net' ? chipClass(r.cum) : ''}`}>
                  {instMetric === 'net' ? fmtBillionSigned(r.cum) : fmtBillion(r.cum)}
                </td>
                <td>
                  <UnitTrend points={r.points} streak={r.streak} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        買賣超＝買進金額−賣出金額，紅色為買超，底色深淺是該單位自己這 7 天的相對強度；「—」是那天還沒補到（或舊檔僅有差額），不是沒有進出。
        走勢欄讀的是近 {TREND_DAYS} 個交易日，比表格的 7 欄長，連續天數才不會被表格寬度截斷。
      </p>
    </div>
  )
}
