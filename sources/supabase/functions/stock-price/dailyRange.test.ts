import { describe, it, expect } from 'vitest'
import { dailyRangeInterval, extractMonthly } from './dailyRange'
import type { ChartResponse } from '../stock-report/twDaily.ts'

const TW_OFFSET = 28800

/** YYYY-MM-DD 的當地 00:00 → Yahoo 使用的 epoch 秒 */
function epochOf(ymd: string): number {
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 1000) - TW_OFFSET
}

interface Bar {
  date: string
  open?: number | null
  high?: number | null
  low?: number | null
  close?: number | null
  volume?: number | null
}

function makeResp(bars: Bar[], regularMarketTime?: number): ChartResponse {
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: TW_OFFSET, symbol: '2330.TW', regularMarketTime },
          timestamp: bars.map((b) => epochOf(b.date)),
          indicators: {
            quote: [
              {
                open: bars.map((b) => (b.open === undefined ? 10 : b.open)),
                high: bars.map((b) => (b.high === undefined ? 12 : b.high)),
                low: bars.map((b) => (b.low === undefined ? 9 : b.low)),
                close: bars.map((b) => (b.close === undefined ? 11 : b.close)),
                volume: bars.map((b) => (b.volume === undefined ? 100 : b.volume)),
              },
            ],
          },
        },
      ],
    },
  }
}

describe('dailyRangeInterval', () => {
  it('5y 取日線，max 取月線', () => {
    // 實測 2026-09-10：range=max 帶 interval=1d 時 Yahoo 仍回月線，
    // 所以這裡直接要月線，不要假裝拿得到日線。
    expect(dailyRangeInterval('5y')).toBe('1d')
    expect(dailyRangeInterval('max')).toBe('1mo')
  })
})

describe('extractMonthly', () => {
  it('月線時間戳必須加上 gmtoffset 才會落在月初', () => {
    // 不加 offset 會讀成上個月月底（實測 2000-02-01 會變成 2000-01-31），整條月線位移一格。
    const rows = extractMonthly(makeResp([{ date: '2026-07-01' }, { date: '2026-08-01' }]))
    expect(rows.map((r) => r[0])).toEqual(['2026-07-01', '2026-08-01'])
  })

  it('丟棄 OHLC 全為 null 的空格', () => {
    const rows = extractMonthly(
      makeResp([
        { date: '2026-06-01' },
        { date: '2026-07-01', open: null, high: null, low: null, close: null, volume: null },
        { date: '2026-08-01' },
      ]),
    )
    expect(rows.map((r) => r[0])).toEqual(['2026-06-01', '2026-08-01'])
  })

  it('丟棄與 regularMarketTime 相同的即時列，否則當月會出現兩根', () => {
    // 實測 range=max 會在 2026-09-01 這根月線後面再附加一根 2026-09-10 的即時列。
    const live = epochOf('2026-09-10')
    const rows = extractMonthly(
      makeResp(
        [{ date: '2026-08-01' }, { date: '2026-09-01' }, { date: '2026-09-10' }],
        live,
      ),
    )
    expect(rows.map((r) => r[0])).toEqual(['2026-08-01', '2026-09-01'])
  })

  it('沒有 regularMarketTime 時保留全部有效列', () => {
    const rows = extractMonthly(makeResp([{ date: '2026-08-01' }, { date: '2026-09-01' }]))
    expect(rows).toHaveLength(2)
  })

  it('輸出由舊到新排序', () => {
    const rows = extractMonthly(
      makeResp([{ date: '2026-09-01' }, { date: '2026-07-01' }, { date: '2026-08-01' }]),
    )
    expect(rows.map((r) => r[0])).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
  })

  it('列的形狀是 [date, open, high, low, close, volume]', () => {
    const rows = extractMonthly(
      makeResp([{ date: '2026-08-01', open: 1, high: 4, low: 0.5, close: 3, volume: 777 }]),
    )
    expect(rows[0]).toEqual(['2026-08-01', 1, 4, 0.5, 3, 777])
  })

  it('volume 為 null 時補 0', () => {
    const rows = extractMonthly(makeResp([{ date: '2026-08-01', volume: null }]))
    expect(rows[0][5]).toBe(0)
  })

  it('結構不符時回空陣列而不是丟例外', () => {
    expect(extractMonthly({} as ChartResponse)).toEqual([])
    expect(extractMonthly({ chart: { result: null } } as ChartResponse)).toEqual([])
    expect(extractMonthly({ chart: { result: [{}] } } as ChartResponse)).toEqual([])
  })
})
