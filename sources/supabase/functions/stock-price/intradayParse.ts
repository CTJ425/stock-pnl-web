/**
 * Yahoo chart v8 (query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d)
 * is purely analytical logic. Independent of the Deno execution environment, used by
 * index.ts and directly unit tested by the front-end Vitest
 * (see src/services/intradayParse.test.ts).
 *
 * Response shape:
 *   { chart: { result: [{ meta: { symbol, chartPreviousClose, previousClose, ... },
 *                          timestamp: [...], indicators: { quote: [{ close, volume, ... }] } }],
 *              error: null | { code, description } } }
 *
 * Yahoo pads the session with null closes — both before the first trade and at any
 * minute with no match — so bars are carried forward from the last emitted close;
 * leading null bars (no close emitted yet) are dropped.
 */

export type IntradayRange = '1d' | '5d'
export type IntradayInterval = '1m' | '5m'

export interface IntradayPoint {
  /** Yahoo bar timestamp, epoch seconds */
  t: number
  /** Bar close. A null close is carried forward from the previous bar. */
  c: number
  /** Bar volume in shares as Yahoo reports it; 0 when the bar had no trade. */
  v: number
}

export interface IntradaySeries {
  /** `meta.symbol`, e.g. '2330.TW'; '' when absent */
  symbol: string
  range: IntradayRange
  interval: IntradayInterval
  /** `meta.chartPreviousClose`, else `meta.previousClose`, else null */
  prevClose: number | null
  points: IntradayPoint[]
  /** First non-null `quote.open`; null when the array is absent or all null. */
  dayOpen?: number | null
  /** Max of non-null `quote.high`; null when absent. */
  dayHigh?: number | null
  /** Min of non-null `quote.low`; null when absent. */
  dayLow?: number | null
}

export function intradayInterval(range: IntradayRange): IntradayInterval {
  return range === '1d' ? '1m' : '5m'
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseYahooChart(json: unknown, range: IntradayRange): IntradaySeries | null {
  if (typeof json !== 'object' || json === null) return null
  const chart = (json as { chart?: unknown }).chart as
    | { result?: unknown; error?: unknown }
    | undefined
  if (!chart || typeof chart !== 'object') return null
  if (chart.error !== null && chart.error !== undefined) return null
  if (!Array.isArray(chart.result) || chart.result.length === 0) return null

  const result = chart.result[0] as
    | {
        meta?: Record<string, unknown>
        timestamp?: unknown
        indicators?: { quote?: unknown[] }
      }
    | undefined
  if (!result || typeof result !== 'object') return null

  if (!Array.isArray(result.timestamp)) return null
  const quote = result.indicators?.quote?.[0] as
    | { close?: unknown[]; volume?: unknown[]; open?: unknown[]; high?: unknown[]; low?: unknown[] }
    | undefined
  if (!quote || typeof quote !== 'object') return null

  const timestamps = result.timestamp as unknown[]
  const closes = Array.isArray(quote.close) ? quote.close : []
  const volumes = Array.isArray(quote.volume) ? quote.volume : []

  const points: IntradayPoint[] = []
  let lastClose: number | null = null
  for (let i = 0; i < timestamps.length; i++) {
    const t = toFiniteNumber(timestamps[i])
    if (t === null) continue
    const rawClose = toFiniteNumber(closes[i])
    const c: number | null = rawClose !== null ? rawClose : lastClose
    if (c === null) continue
    lastClose = c
    const rawVolume = volumes[i]
    const v =
      typeof rawVolume === 'number' && Number.isFinite(rawVolume) && rawVolume >= 0
        ? rawVolume
        : 0
    points.push({ t, c, v })
  }

  if (points.length === 0) return null

  const meta = result.meta ?? {}
  const chartPrevClose = toFiniteNumber(meta.chartPreviousClose)
  const prevClose = chartPrevClose !== null ? chartPrevClose : toFiniteNumber(meta.previousClose)

  const symbol = typeof meta.symbol === 'string' && meta.symbol !== '' ? meta.symbol : ''

  const opens = Array.isArray(quote.open) ? quote.open : []
  const highs = Array.isArray(quote.high) ? quote.high : []
  const lows = Array.isArray(quote.low) ? quote.low : []

  let dayOpen: number | null = null
  for (const raw of opens) {
    const v = toFiniteNumber(raw)
    if (v !== null) {
      dayOpen = v
      break
    }
  }

  let dayHigh: number | null = null
  for (const raw of highs) {
    const v = toFiniteNumber(raw)
    if (v !== null) dayHigh = dayHigh === null ? v : Math.max(dayHigh, v)
  }

  let dayLow: number | null = null
  for (const raw of lows) {
    const v = toFiniteNumber(raw)
    if (v !== null) dayLow = dayLow === null ? v : Math.min(dayLow, v)
  }

  return {
    symbol,
    range,
    interval: intradayInterval(range),
    prevClose,
    points,
    dayOpen,
    dayHigh,
    dayLow,
  }
}
