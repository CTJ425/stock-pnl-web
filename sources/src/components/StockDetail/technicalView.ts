/**
 * Technical data preparation: Calculate each indicator from the daily sequence, and then cut it into the interval to be displayed.
 *
 * **The order cannot be reversed**: The indicators are always calculated based on the complete sequence before being cut.
 * If you cut it first and then calculate it, when you cut to the "last 3 months" (60 bars), MA60 will only have a value on the last bar, and the KD retracement will also start from
 * Start again with an initial value of 50 and the entire line is wrong. This is the easiest place to write errors in this function, so it is separated into a pure function and tested.
 */
import type { DailyRow } from '../../services/dailyProxy'
import {
  bollinger,
  kd,
  lastValue,
  macd,
  maAlignment,
  rsi,
  sma,
  type Bar,
} from '../../utils/indicators'

export type RangeKey = '3m' | '6m' | '1y'

/** How many K bars are displayed in each interval (**Trading day**, non-calendar day; Taiwan stocks have approximately 20 trading days per month)*/
export const RANGE_BARS: Record<RangeKey, number> = {
  '3m': 60,
  '6m': 120,
  '1y': Number.MAX_SAFE_INTEGER,
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  '3m': '近 3 月',
  '6m': '近 6 月',
  '1y': '近 1 年',
}

type Series = Array<number | null>

export interface TechnicalView {
  /** Display X-axis labels within intervals (MM/DD)*/
  labels: string[]
  /** Display candles within a range*/
  candles: Array<{ label: string; open: number; high: number; low: number; close: number }>
  volumes: number[]
  ma5: Series
  ma20: Series
  ma60: Series
  /** Bollinger Bands (20, 2) */
  bbMid: Series
  bbUpper: Series
  bbLower: Series
  k: Series
  d: Series
  /** Which indexes should be marked on the X-axis (to avoid 244 full indexes)*/
  labelIndices: number[]
  /**
   * Rows for the volume table (0.6.38), **newest first** —— the opposite of every chart here, matching how the
   * institutional and monthly-revenue tables are read: a chart starts at the earlier date, a table starts at today.
   *
   * `volRatio` and `changePct` are computed from the **full** series, not the visible slice, so the oldest visible
   * row still has a real 20-day average and a real previous close behind it rather than a hole.
   */
  volumeRows: Array<{
    date: string
    volume: number
    volRatio: number | null
    close: number
    changePct: number | null
  }>
  /** Indicator summary of the latest bar (taken from the complete sequence, regardless of the display interval)*/
  latest: {
    date: string
    close: number
    open: number
    high: number
    low: number
    volume: number
    /** Increase or decrease from the previous trading day*/
    change: number | null
    changePct: number | null
    ma5: number | null
    ma20: number | null
    ma60: number | null
    alignment: ReturnType<typeof maAlignment>
    bbMid: number | null
    bbUpper: number | null
    bbLower: number | null
    k: number | null
    d: number | null
    rsi14: number | null
    macdHist: number | null
    /** The multiple of trading volume relative to the 20-day average volume*/
    volRatio: number | null
  }
}

/** Select about `want` equidistant indices (including head and tail) from the X-axis label*/
export function pickLabelIndices(count: number, want = 6): number[] {
  if (count <= want) return Array.from({ length: count }, (_, i) => i)
  const step = (count - 1) / (want - 1)
  const out = new Set<number>()
  for (let i = 0; i < want; i++) out.add(Math.round(i * step))
  return [...out].sort((a, b) => a - b)
}

/** YYYY-MM-DD → MM/DD */
function shortDate(date: string): string {
  return date.length >= 10 ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : date
}

export function buildTechnicalView(rows: DailyRow[], range: RangeKey): TechnicalView | null {
  if (rows.length === 0) return null

  // ---- 1. Calculate the indicator based on "complete sequence" ----
  const closes: Series = rows.map((r) => r[4])
  const volumes = rows.map((r) => r[5])
  const bars: Array<Bar | null> = rows.map((r) => ({ high: r[2], low: r[3], close: r[4] }))

  const ma5 = sma(closes, 5)
  const ma20 = sma(closes, 20)
  const ma60 = sma(closes, 60)
  const bb = bollinger(closes, 20, 2)
  const kdRes = kd(bars)
  const rsiRes = rsi(closes)
  const macdRes = macd(closes)
  const volMa20 = sma(volumes, 20)

  // ---- 2. Crop it into the display area ----
  const take = Math.min(RANGE_BARS[range], rows.length)
  const from = rows.length - take
  const slice = <T,>(arr: T[]): T[] => arr.slice(from)

  const viewRows = slice(rows)
  const labels = viewRows.map((r) => shortDate(r[0]))

  const lastIdx = rows.length - 1
  const last = rows[lastIdx]
  const prevClose = lastIdx > 0 ? rows[lastIdx - 1][4] : null
  const lastVolMa = lastValue(volMa20)

  return {
    labels,
    candles: viewRows.map((r) => ({
      label: shortDate(r[0]),
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
    })),
    volumes: slice(volumes),
    ma5: slice(ma5),
    ma20: slice(ma20),
    ma60: slice(ma60),
    bbMid: slice(bb.mid),
    bbUpper: slice(bb.upper),
    bbLower: slice(bb.lower),
    k: slice(kdRes.k),
    d: slice(kdRes.d),
    labelIndices: pickLabelIndices(viewRows.length),
    volumeRows: viewRows
      .map((r, i) => {
        const idx = from + i
        const ma = volMa20[idx]
        const prev = idx > 0 ? rows[idx - 1][4] : null
        return {
          date: r[0],
          volume: r[5],
          volRatio: ma === null || ma === 0 ? null : r[5] / ma,
          close: r[4],
          changePct: prev === null || prev === 0 ? null : (r[4] - prev) / prev,
        }
      })
      .reverse(),
    latest: {
      date: last[0],
      open: last[1],
      high: last[2],
      low: last[3],
      close: last[4],
      volume: last[5],
      change: prevClose === null ? null : last[4] - prevClose,
      changePct: prevClose === null || prevClose === 0 ? null : (last[4] - prevClose) / prevClose,
      ma5: ma5[lastIdx],
      ma20: ma20[lastIdx],
      ma60: ma60[lastIdx],
      alignment: maAlignment(ma5[lastIdx], ma20[lastIdx], ma60[lastIdx]),
      bbMid: bb.mid[lastIdx],
      bbUpper: bb.upper[lastIdx],
      bbLower: bb.lower[lastIdx],
      k: kdRes.k[lastIdx],
      d: kdRes.d[lastIdx],
      rsi14: rsiRes[lastIdx],
      macdHist: macdRes.hist[lastIdx],
      volRatio: lastVolMa === null || lastVolMa === 0 ? null : last[5] / lastVolMa,
    },
  }
}
