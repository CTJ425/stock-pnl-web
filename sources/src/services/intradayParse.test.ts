import { describe, expect, it } from 'vitest'
import {
  intradayInterval,
  parseYahooChart,
  type IntradaySeries,
} from '../../supabase/functions/stock-price/intradayParse.ts'

/**
 * Yahoo chart v8 (`query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1m&range=1d`)
 * is the only source that hands back a whole trading day of bars in one request —
 * the TWSE MIS endpoint the price path already uses returns just the latest tick,
 * and `getDailyTradeInfo.jsp` does not exist (it redirects to an HTML error page).
 *
 * The shape below is taken from a real 2330.TW response captured on 2026-08-25:
 *   { chart: { result: [{ meta: { symbol, chartPreviousClose, ... },
 *                          timestamp: [...], indicators: { quote: [{ close, volume, ... }] } }],
 *              error: null } }
 * Yahoo pads the session with null closes — both before the first trade and at any
 * minute with no match — so carry-forward behaviour is the part worth pinning down.
 */

/** 09:00 Asia/Taipei on 2026-08-25, epoch seconds — the session's first bar. */
const T0 = 1787616000

const chart = (result: unknown[], error: unknown = null) => ({ chart: { result, error } })

const day = (opts: {
  close: Array<number | null>
  volume?: Array<number | null>
  meta?: Record<string, unknown>
  timestamp?: Array<number | null>
}) => {
  const n = opts.close.length
  return chart([
    {
      meta: { symbol: '2330.TW', chartPreviousClose: 2375, ...opts.meta },
      timestamp: opts.timestamp ?? Array.from({ length: n }, (_, i) => T0 + i * 60),
      indicators: {
        quote: [
          {
            close: opts.close,
            volume: opts.volume ?? Array.from({ length: n }, () => 1000),
          },
        ],
      },
    },
  ])
}

describe('intradayInterval', () => {
  it('picks the bar size each range is served at', () => {
    expect(intradayInterval('1d')).toBe('1m')
    expect(intradayInterval('5d')).toBe('5m')
  })
})

describe('parseYahooChart', () => {
  it('reads a full session into ordered points', () => {
    const series = parseYahooChart(
      day({ close: [2360, 2365, 2370], volume: [123000, 50000, 87000] }),
      '1d',
    ) as IntradaySeries

    expect(series).not.toBeNull()
    expect(series.symbol).toBe('2330.TW')
    expect(series.range).toBe('1d')
    expect(series.interval).toBe('1m')
    expect(series.prevClose).toBe(2375)
    expect(series.points).toEqual([
      { t: T0, c: 2360, v: 123000 },
      { t: T0 + 60, c: 2365, v: 50000 },
      { t: T0 + 120, c: 2370, v: 87000 },
    ])
  })

  it('drops the leading null bars Yahoo pads before the first trade', () => {
    const series = parseYahooChart(day({ close: [null, null, 2360] }), '1d') as IntradaySeries

    expect(series.points).toHaveLength(1)
    expect(series.points[0]).toEqual({ t: T0 + 120, c: 2360, v: 1000 })
  })

  it('carries a mid-session null close forward instead of breaking the line', () => {
    const series = parseYahooChart(day({ close: [2360, null, 2370] }), '1d') as IntradaySeries

    expect(series.points.map((p) => p.c)).toEqual([2360, 2360, 2370])
  })

  it('treats a null volume as a bar with no trade, not a missing bar', () => {
    const series = parseYahooChart(
      day({ close: [2360, 2365], volume: [null, 50000] }),
      '1d',
    ) as IntradaySeries

    expect(series.points).toEqual([
      { t: T0, c: 2360, v: 0 },
      { t: T0 + 60, c: 2365, v: 50000 },
    ])
  })

  it('drops a bar whose timestamp is not a number', () => {
    const series = parseYahooChart(
      day({ close: [2360, 2365], timestamp: [null, T0 + 60] }),
      '1d',
    ) as IntradaySeries

    expect(series.points).toEqual([{ t: T0 + 60, c: 2365, v: 1000 }])
  })

  it('falls back to previousClose when chartPreviousClose is absent', () => {
    const series = parseYahooChart(
      day({ close: [2360], meta: { chartPreviousClose: undefined, previousClose: 2350 } }),
      '1d',
    ) as IntradaySeries

    expect(series.prevClose).toBe(2350)
  })

  it('still returns the points when neither prev-close key is usable', () => {
    const series = parseYahooChart(
      day({ close: [2360], meta: { chartPreviousClose: null, previousClose: '-' } }),
      '1d',
    ) as IntradaySeries

    expect(series.prevClose).toBeNull()
    expect(series.points).toHaveLength(1)
  })

  it('reports an empty symbol rather than failing when meta.symbol is missing', () => {
    const series = parseYahooChart(
      day({ close: [2360], meta: { symbol: undefined } }),
      '1d',
    ) as IntradaySeries

    expect(series.symbol).toBe('')
  })

  it('keeps the requested range and interval for a five-day request', () => {
    const series = parseYahooChart(day({ close: [2360, 2365] }), '5d') as IntradaySeries

    expect(series.range).toBe('5d')
    expect(series.interval).toBe('5m')
  })

  it('returns null when Yahoo reports an error — an unknown ticker is not a crash', () => {
    expect(parseYahooChart(chart([], { code: 'Not Found' }), '1d')).toBeNull()
  })

  it('returns null when the result list is empty', () => {
    expect(parseYahooChart(chart([]), '1d')).toBeNull()
  })

  it('returns null when the payload has no timestamps', () => {
    expect(parseYahooChart(chart([{ meta: {}, indicators: { quote: [{ close: [] }] } }]), '1d'))
      .toBeNull()
  })

  it('returns null when the quote block is missing', () => {
    expect(parseYahooChart(chart([{ meta: {}, timestamp: [T0], indicators: {} }]), '1d')).toBeNull()
  })

  it('returns null when every bar is dropped', () => {
    expect(parseYahooChart(day({ close: [null, null] }), '1d')).toBeNull()
  })

  it('never throws on junk input', () => {
    expect(parseYahooChart(null, '1d')).toBeNull()
    expect(parseYahooChart('nope', '1d')).toBeNull()
    expect(parseYahooChart({}, '1d')).toBeNull()
  })
})
