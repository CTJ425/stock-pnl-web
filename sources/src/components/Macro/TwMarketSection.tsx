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
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
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
import { chipClass, fmtUpdatedAt, heatStyle } from '../StockDetail/chipFormat'
import { fmtBillion, fmtBillionSigned, toBillion } from '../../utils/formatters'
import { ForeignTopSection } from './ForeignTopSection'
import { TwIndexToday } from './TwIndexToday'

/** Spark for the institutional and turnover 走勢 column (0.7.6: one per unit row, was one per day). */
const TFOOT_SPARK_W = 76
const TFOOT_SPARK_H = 20

/** The trading amount and the market K-line show several trading days. After about one season, you can see the trend without crushing the X-axis.*/
const SHOWN_DAYS = 60

/**
 * The turnover and institutional trading matrices show the last 7 trading days.
 *
 * Consistent with the chip chart of individual stock analysis (where HISTORY_DAYS = 7) - the charts ask the same question
 * "What happened in the market these days?" Volume energy and index can last for one season: those two ask "where is the market?" and require a longer context.
 */
const INSTITUTIONAL_DAYS = 7

/** Shares → 億股. The file stores raw shares, which run to eleven digits and are unreadable as-is */
function toBillionShares(shares: number | null | undefined): number | null {
  return typeof shares === 'number' && Number.isFinite(shares) ? shares / 1e8 : null
}

/** Transaction count → 萬筆 */
function toTenThousand(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n / 1e4 : null
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

/** Sum of the days that have a number; `null` only when none of them do (≠ a real 0). */
function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0)
}

/** Average of the days that have a number; `null` only when none do. */
function calcAvgOrNull(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length
}


function metricTrendStreak(
  points: number[],
  upNoun: string = '增量',
  downNoun: string = '縮量',
): { label: string | null; color: string } {
  if (points.length < 2) return { label: null, color: CHART_COLORS.axis }
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  if (last === prev) return { label: null, color: CHART_COLORS.axis }
  const isUp = last > prev
  let streak = 0
  for (let i = points.length - 1; i >= 1; i--) {
    if (isUp && points[i] > points[i - 1]) streak++
    else if (!isUp && points[i] < points[i - 1]) streak++
    else break
  }
  const label = streak >= 2 ? `連 ${streak} 日${isUp ? upNoun : downNoun}` : null
  const color = isUp ? CHART_COLORS.up : CHART_COLORS.down
  return { label, color }
}

function taiexTrendStreak(days: MarketDay[]): { label: string | null; color: string } {
  const points = days.map((d) => d.taiex).filter((v): v is number => v !== null)
  if (points.length < 2) return { label: null, color: CHART_COLORS.axis }
  const changes = days
    .map((d) => d.changePoints)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const lastChange = changes[changes.length - 1]
  if (lastChange === undefined || lastChange === 0) return { label: null, color: CHART_COLORS.axis }
  const isUp = lastChange > 0
  let streak = 0
  for (let i = changes.length - 1; i >= 0; i--) {
    if (isUp && changes[i] > 0) streak++
    else if (!isUp && changes[i] < 0) streak++
    else break
  }
  const label = streak >= 2 ? `連 ${streak} 日${isUp ? '上漲' : '下跌'}` : null
  const color = isUp ? CHART_COLORS.up : CHART_COLORS.down
  return { label, color }
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
  const turnoverDays = instDays
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

  // Market turnover matrix data (5 metrics)
  const turnoverAmountVals = turnoverDays.map((d) => toBillion(d.tradeValueTwd))
  const turnoverAmountAvg = calcAvgOrNull(turnoverAmountVals)
  const turnoverAmountPoints = days
    .map((d) => toBillion(d.tradeValueTwd))
    .filter((v): v is number => v !== null)
  const turnoverAmountTrend = metricTrendStreak(turnoverAmountPoints, '增量', '縮量')

  const turnoverSharesVals = turnoverDays.map((d) => toBillionShares(d.tradeVolumeShares))
  const turnoverSharesAvg = calcAvgOrNull(turnoverSharesVals)
  const turnoverSharesPoints = days
    .map((d) => toBillionShares(d.tradeVolumeShares))
    .filter((v): v is number => v !== null)
  const turnoverSharesTrend = metricTrendStreak(turnoverSharesPoints, '增量', '縮量')

  const turnoverTxnVals = turnoverDays.map((d) => toTenThousand(d.transactions))
  const turnoverTxnAvg = calcAvgOrNull(turnoverTxnVals)
  const turnoverTxnPoints = days
    .map((d) => toTenThousand(d.transactions))
    .filter((v): v is number => v !== null)
  const turnoverTxnTrend = metricTrendStreak(turnoverTxnPoints, '增筆', '減筆')

  const taiexVals = turnoverDays.map((d) => d.taiex)
  const taiexAvg = calcAvgOrNull(taiexVals)
  const taiexPoints = days.map((d) => d.taiex).filter((v): v is number => v !== null)
  const taiexTrend = taiexTrendStreak(days)

  const changeVals = turnoverDays.map((d) => d.changePoints)
  const changeSum = sumOrNull(changeVals)
  const changePointsList = days
    .map((d) => d.changePoints)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const maxAbsChange = Math.max(0, ...changeVals.map((v) => (v === null ? 0 : Math.abs(v))))

  // Market turnover Day-over-Day differences and max relative deltas (for heat styling)
  const turnoverDiffs = turnoverDays.map((d) => {
    const dIdx = days.findIndex((item) => item.date === d.date)
    const prevD = dIdx > 0 ? days[dIdx - 1] : null

    const amount = toBillion(d.tradeValueTwd)
    const prevAmount = prevD ? toBillion(prevD.tradeValueTwd) : null
    const amountDiff = amount !== null && prevAmount !== null ? amount - prevAmount : null

    const shares = toBillionShares(d.tradeVolumeShares)
    const prevShares = prevD ? toBillionShares(prevD.tradeVolumeShares) : null
    const sharesDiff = shares !== null && prevShares !== null ? shares - prevShares : null

    const txns = toTenThousand(d.transactions)
    const prevTxns = prevD ? toTenThousand(prevD.transactions) : null
    const txnsDiff = txns !== null && prevTxns !== null ? txns - prevTxns : null

    const taiexDiff =
      d.changePoints ??
      (d.taiex !== null && prevD?.taiex !== null && prevD?.taiex !== undefined
        ? d.taiex - prevD.taiex
        : null)

    return {
      date: d.date,
      amount,
      amountDiff,
      shares,
      sharesDiff,
      txns,
      txnsDiff,
      taiex: d.taiex,
      taiexDiff,
      changePoints: d.changePoints,
    }
  })

  const maxAbsAmountDiff = Math.max(
    0,
    ...turnoverDiffs.map((r) => (r.amountDiff === null ? 0 : Math.abs(r.amountDiff))),
  )
  const maxAbsSharesDiff = Math.max(
    0,
    ...turnoverDiffs.map((r) => (r.sharesDiff === null ? 0 : Math.abs(r.sharesDiff))),
  )
  const maxAbsTxnDiff = Math.max(
    0,
    ...turnoverDiffs.map((r) => (r.txnsDiff === null ? 0 : Math.abs(r.txnsDiff))),
  )
  const maxAbsTaiexDiff = Math.max(
    0,
    ...turnoverDiffs.map((r) => (r.taiexDiff === null ? 0 : Math.abs(r.taiexDiff))),
  )

  // X-axis: 60 days each grid is about 8px, all labels will be mushy - one label every 10 days (six labels).
  // The three pictures have the same set of indexes and the same set of labels, so the X-axis can really match up.
  const labelIndices = days.map((_, i) => i).filter((i) => i % 10 === 0)

  const recentInstDays = (market?.days ?? [])
    .filter((d) => d.institutional !== null && d.institutional !== undefined)
    .slice(-2)
    .reverse()
    .map((d) => {
      const self = d.institutional?.dealerSelfTwd ?? null
      const hedge = d.institutional?.dealerHedgeTwd ?? null
      return {
        date: d.date,
        totalTwd: d.institutional?.totalTwd ?? null,
        foreignTwd: d.institutional?.foreignTwd ?? null,
        trustTwd: d.institutional?.trustTwd ?? null,
        dealerTwd: self !== null && hedge !== null ? self + hedge : null,
      }
    })

  return (
    <>
      <TwIndexToday
        closeStats={
          latest === null
            ? null
            : {
                date: latest.date,
                tradeValueTwd: latest.tradeValueTwd,
                instDate: latestInst?.date ?? null,
                instTotalTwd: latestInst?.institutional?.totalTwd ?? null,
                instForeignTwd: latestInst?.institutional?.foreignTwd ?? null,
                instTrustTwd: latestInst?.institutional?.trustTwd ?? null,
              }
        }
        recentInstDays={recentInstDays}
        onRefresh={() => void load()}
      />

      <div className="section glass" style={{ padding: '18px 20px' }}>
        <div className="rpt-section-head">
          <h3 className="head-tight">台股市場歷史走勢與成交量</h3>
          {market.asOf && (
            <span className="source-tag section-stamp">
              資料更新於 {fmtUpdatedAt(market.asOf)}（共 {market.days.length} 個交易日）
            </span>
          )}
          <button
            className="btn btn-sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="重新整理台股市場歷史資料"
          >
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
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
          Daily turnover table (single table layout):
          Left column: date (newest first, sticky).
          Columns: 5 metrics.
          Footer: 7-day statistical summary with per-column streak badge and 15-day SparkCell trendline.
        */}
        <div className="rpt-section-head" style={{ marginTop: 18 }}>
          <div className="chart-title">每日成交量・近 {turnoverDays.length} 個交易日</div>
        </div>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table inst-matrix" aria-label="每日成交量">
            <thead>
              <tr>
                <th>日期</th>
                <th className="num">成交金額（億元）</th>
                <th className="num">成交股數（億股）</th>
                <th className="num">成交筆數（萬筆）</th>
                <th className="num">加權指數</th>
                <th className="num">指數漲跌</th>
              </tr>
            </thead>
            <tbody>
              {[...turnoverDiffs].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{shortDate(d.date)}</td>
                  <td
                    className={`num ${chipClass(d.amountDiff)}`}
                    style={heatStyle(d.amountDiff, maxAbsAmountDiff)}
                  >
                    {fmtBillion(d.amount)}
                  </td>
                  <td
                    className={`num ${chipClass(d.sharesDiff)}`}
                    style={heatStyle(d.sharesDiff, maxAbsSharesDiff)}
                  >
                    {d.shares === null ? '—' : `${d.shares.toFixed(1)} 億股`}
                  </td>
                  <td
                    className={`num ${chipClass(d.txnsDiff)}`}
                    style={heatStyle(d.txnsDiff, maxAbsTxnDiff)}
                  >
                    {d.txns === null ? '—' : `${d.txns.toFixed(1)} 萬`}
                  </td>
                  <td
                    className={`num ${chipClass(d.taiexDiff)}`}
                    style={heatStyle(d.taiexDiff, maxAbsTaiexDiff)}
                  >
                    {d.taiex === null ? '—' : d.taiex.toFixed(2)}
                  </td>
                  <td
                    className={`num ${chipClass(d.changePoints)}`}
                    style={heatStyle(d.changePoints, maxAbsChange)}
                  >
                    {d.changePoints === null
                      ? '—'
                      : `${d.changePoints > 0 ? '+' : ''}${d.changePoints.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tfoot-summary">
                <td>{turnoverDays.length} 日統計</td>
                <td className="num inst-matrix-cum">
                  <div>{fmtBillion(turnoverAmountAvg)}</div>
                  <div className="tfoot-cum-trend">
                    <span
                      className={
                        turnoverAmountTrend.label
                          ? chipClass(turnoverAmountTrend.color === CHART_COLORS.up ? 1 : -1)
                          : 'hint'
                      }
                      style={{
                        fontSize: 11,
                        fontWeight: turnoverAmountTrend.label ? 600 : undefined,
                      }}
                    >
                      {turnoverAmountTrend.label ?? '—'}
                    </span>
                    <SparkCell
                      points={turnoverAmountPoints.slice(-TREND_DAYS)}
                      color={turnoverAmountTrend.color}
                      width={TFOOT_SPARK_W}
                      height={TFOOT_SPARK_H}
                      ariaLabel="近 15 個交易日成交金額走勢"
                    />
                  </div>
                </td>
                <td className="num inst-matrix-cum">
                  <div>
                    {turnoverSharesAvg === null ? '—' : `${turnoverSharesAvg.toFixed(1)} 億股`}
                  </div>
                  <div className="tfoot-cum-trend">
                    <span
                      className={
                        turnoverSharesTrend.label
                          ? chipClass(turnoverSharesTrend.color === CHART_COLORS.up ? 1 : -1)
                          : 'hint'
                      }
                      style={{
                        fontSize: 11,
                        fontWeight: turnoverSharesTrend.label ? 600 : undefined,
                      }}
                    >
                      {turnoverSharesTrend.label ?? '—'}
                    </span>
                    <SparkCell
                      points={turnoverSharesPoints.slice(-TREND_DAYS)}
                      color={turnoverSharesTrend.color}
                      width={TFOOT_SPARK_W}
                      height={TFOOT_SPARK_H}
                      ariaLabel="近 15 個交易日成交股數走勢"
                    />
                  </div>
                </td>
                <td className="num inst-matrix-cum">
                  <div>
                    {turnoverTxnAvg === null ? '—' : `${turnoverTxnAvg.toFixed(1)} 萬`}
                  </div>
                  <div className="tfoot-cum-trend">
                    <span
                      className={
                        turnoverTxnTrend.label
                          ? chipClass(turnoverTxnTrend.color === CHART_COLORS.up ? 1 : -1)
                          : 'hint'
                      }
                      style={{
                        fontSize: 11,
                        fontWeight: turnoverTxnTrend.label ? 600 : undefined,
                      }}
                    >
                      {turnoverTxnTrend.label ?? '—'}
                    </span>
                    <SparkCell
                      points={turnoverTxnPoints.slice(-TREND_DAYS)}
                      color={turnoverTxnTrend.color}
                      width={TFOOT_SPARK_W}
                      height={TFOOT_SPARK_H}
                      ariaLabel="近 15 個交易日成交筆數走勢"
                    />
                  </div>
                </td>
                <td className="num inst-matrix-cum">
                  <div>{taiexAvg === null ? '—' : taiexAvg.toFixed(2)}</div>
                  <div className="tfoot-cum-trend">
                    <span
                      className={
                        taiexTrend.label
                          ? chipClass(taiexTrend.color === CHART_COLORS.up ? 1 : -1)
                          : 'hint'
                      }
                      style={{ fontSize: 11, fontWeight: taiexTrend.label ? 600 : undefined }}
                    >
                      {taiexTrend.label ?? '—'}
                    </span>
                    <SparkCell
                      points={taiexPoints.slice(-TREND_DAYS)}
                      color={taiexTrend.color}
                      width={TFOOT_SPARK_W}
                      height={TFOOT_SPARK_H}
                      ariaLabel="近 15 個交易日加權指數走勢"
                    />
                  </div>
                </td>
                <td className={`num inst-matrix-cum ${chipClass(changeSum)}`}>
                  <div>
                    {changeSum === null ? '—' : `${changeSum > 0 ? '+' : ''}${changeSum.toFixed(2)}`}
                  </div>
                  <div className="tfoot-cum-trend">
                    <span
                      className={chipClass(changeSum)}
                      style={{ fontSize: 11, fontWeight: changeSum !== null ? 600 : undefined }}
                    >
                      {changeSum !== null
                        ? `7日累計${changeSum > 0 ? '漲 ' : changeSum < 0 ? '跌 ' : ''}${Math.abs(changeSum).toFixed(2)}`
                        : '—'}
                    </span>
                    <SparkCell
                      points={changePointsList.slice(-TREND_DAYS)}
                      color={
                        changePointsList.length > 0
                          ? changePointsList[changePointsList.length - 1] > 0
                            ? CHART_COLORS.up
                            : changePointsList[changePointsList.length - 1] < 0
                              ? CHART_COLORS.down
                              : CHART_COLORS.axis
                          : CHART_COLORS.axis
                      }
                      width={TFOOT_SPARK_W}
                      height={TFOOT_SPARK_H}
                      ariaLabel="近 15 個交易日指數漲跌走勢"
                    />
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 8 }}>
          底色深淺為各項目相較前一交易日增減之相對強度（紅色為增量／上漲，綠色為縮量／下跌）；成交金額、股數與筆數之統計欄為 7 日日均值，指數漲跌之統計欄為 7 日累計淨漲跌。走勢圖讀取近 {TREND_DAYS} 個交易日。
        </p>

        {/*
          Institutional matrix (single table layout):
          Left column: date (newest first, sticky).
          Columns: 6 units (including Total).
          Rightmost column: 15-day trend sparkline & streak stack (via rowspan on single table).
          Footer: 7-day cumulative sum.
        */}
        <div className="rpt-section-head" style={{ marginTop: 18 }}>
          <div className="chart-title">
            三大法人{METRICS.find((m) => m.id === instMetric)!.label}（億元）・近 {instDays.length}{' '}
            個交易日
          </div>
          <div className="inst-metric-seg" role="group" aria-label="切換金額口徑">
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
          <table className="data-table inst-matrix" aria-label="三大法人買賣超">
            <thead>
              <tr>
                <th>日期</th>
                {UNITS.map((u) => (
                  <th
                    key={u.key}
                    className={`num ${u.key === 'totalTwd' ? 'col-total' : ''}`}
                  >
                    {u.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...instDays].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{shortDate(d.date)}</td>
                  {UNITS.map((u) => {
                    const v = cellValue(d, u.key, instMetric)
                    const unitRow = instRows.find((r) => r.key === u.key)
                    return (
                      <td
                        key={u.key}
                        className={`num ${instMetric === 'net' ? chipClass(v) : ''} ${
                          u.key === 'totalTwd' ? 'col-total' : ''
                        }`}
                        style={instMetric === 'net' ? heatStyle(v, unitRow?.rowMax ?? 0) : undefined}
                      >
                        {instMetric === 'net' ? fmtBillionSigned(v) : fmtBillion(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tfoot-summary">
                <td>{instDays.length} 日累計</td>
                {UNITS.map((u) => {
                  const unitRow = instRows.find((r) => r.key === u.key)
                  const cum = unitRow?.cum ?? null
                  const s = unitRow?.streak ?? 0
                  const isBuy = s > 0
                  const label = Math.abs(s) >= 2 ? `連 ${Math.abs(s)} ${isBuy ? '買' : '賣'}` : null
                  const sparkPoints = unitRow?.points.slice(-TREND_DAYS) ?? []
                  const lastNet = sparkPoints.length > 0 ? sparkPoints[sparkPoints.length - 1] : null
                  const sparkColor =
                    lastNet !== null && lastNet !== undefined
                      ? lastNet > 0
                        ? CHART_COLORS.up
                        : lastNet < 0
                          ? CHART_COLORS.down
                          : CHART_COLORS.axis
                      : CHART_COLORS.axis
                  return (
                    <td
                      key={u.key}
                      className={`num inst-matrix-cum ${instMetric === 'net' ? chipClass(cum) : ''} ${
                        u.key === 'totalTwd' ? 'col-total' : ''
                      }`}
                    >
                      <div>{instMetric === 'net' ? fmtBillionSigned(cum) : fmtBillion(cum)}</div>
                      <div className="tfoot-cum-trend">
                        <span
                          className={label ? chipClass(s) : 'hint'}
                          style={{ fontSize: 11, fontWeight: label ? 600 : undefined }}
                        >
                          {label ?? '—'}
                        </span>
                        <SparkCell
                          points={sparkPoints}
                          color={sparkColor}
                          width={TFOOT_SPARK_W}
                          height={TFOOT_SPARK_H}
                          ariaLabel={`近 ${sparkPoints.length} 個交易日${u.label}買賣超走勢`}
                        />
                      </div>
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="hint" style={{ marginTop: 8 }}>
          買賣超＝買進金額−賣出金額，紅色為買超，底色深淺是該單位自己這 7 天的相對強度；「—」是那天還沒補到（或舊檔僅有差額），不是沒有進出。
          走勢欄讀的是近 {TREND_DAYS} 個交易日，比表格的 7 欄長，連續天數才不會被表格寬度截斷。
        </p>
      </div>
    <ForeignTopSection />
    </>
  )
}
