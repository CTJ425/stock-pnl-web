/** Pure number helpers for the 當日走勢 chart, kept apart from `IntradayChart.tsx` so that file only exports components. */
import type { IntradayPoint } from '../../../supabase/functions/stock-price/intradayParse'

export function fmt2(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(change: number, base: number): string {
  const p = (change / base) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

/**
 * AUDIT-14: `prevClose` can arrive as 0 from a MIS response, and dividing by it prints
 * 「漲跌 +123.00 (Infinity%)」in the tooltip. Null and 0 both mean "no usable baseline".
 */
export function changeLabel(close: number, prevClose: number | null): string | null {
  if (prevClose === null || prevClose === 0) return null
  const change = close - prevClose
  return `漲跌 ${change >= 0 ? '+' : ''}${fmt2(change)} (${pct(change, prevClose)})`
}

/** Cumulative VWAP (均價): running sum(c·v) / running sum(v); null until the first traded bar. */
export function vwapSeries(points: IntradayPoint[]): Array<number | null> {
  let pv = 0
  let vol = 0
  return points.map((p) => {
    pv += p.c * p.v
    vol += p.v
    return vol > 0 ? pv / vol : null
  })
}

/**
 * The 均價 the session ends at — the same number the chart's 均價 line terminates on. Shared with
 * `QuoteTab`'s statistics grid and 成交金額 cell so the VWAP is computed once, not twice.
 */
export function finalVwap(points: IntradayPoint[]): number | null {
  if (points.length === 0) return null
  const series = vwapSeries(points)
  return series[series.length - 1]
}
