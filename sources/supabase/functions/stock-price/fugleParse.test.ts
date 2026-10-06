import { describe, expect, it } from 'vitest'
import { fugleIntraday1d, fugleIntraday5d, fugleMinutePoints, parseFugleQuote } from './fugleParse'

// Trimmed from the real 2330 `intraday/quote` answer, 2026-10-06 after the close.
const QUOTE = {
  date: '2026-10-06',
  market: 'TSE',
  symbol: '2330',
  previousClose: 2575,
  openPrice: 2575,
  highPrice: 2590,
  lowPrice: 2565,
  lastPrice: 2585,
  total: { tradeValue: 47300030000, tradeVolume: 18343 },
  isTrial: false,
  isClose: true,
  lastUpdated: 1791264600000000,
}

describe('parseFugleQuote', () => {
  it('maps to the MIS shape: 張, YYYYMMDD, HH:mm:ss Taipei', () => {
    expect(parseFugleQuote(QUOTE)).toEqual({
      price: 2585,
      prevClose: 2575,
      open: 2575,
      high: 2590,
      low: 2565,
      volume: 18343,
      tradeDate: '20261006',
      tradeTime: '13:30:00',
      trial: false,
    })
  })

  it('keeps the trial flag', () => {
    expect(parseFugleQuote({ ...QUOTE, isTrial: true })?.trial).toBe(true)
  })

  it('returns null with no trade price yet, so MIS answers', () => {
    expect(parseFugleQuote({ ...QUOTE, lastPrice: undefined })).toBeNull()
  })

  it('returns null outside TSE / OTC (other volume units)', () => {
    expect(parseFugleQuote({ ...QUOTE, market: 'ESB' })).toBeNull()
    expect(parseFugleQuote({ ...QUOTE, market: 'OTC' })).not.toBeNull()
  })

  it('returns null for a 404 body', () => {
    expect(parseFugleQuote({ message: 'Resource Not Found', statusCode: 404 })).toBeNull()
    expect(parseFugleQuote(null)).toBeNull()
  })
})

function bar(date: string, close: number, volume = 1) {
  return { date, open: close, high: close + 5, low: close - 5, close, volume }
}

describe('fugleMinutePoints', () => {
  it('turns 張 into shares and ISO times into epoch seconds', () => {
    const pts = fugleMinutePoints({ market: 'TSE', data: [bar('2026-10-06T09:00:00.000+08:00', 2580, 2401)] })
    expect(pts?.[0]).toMatchObject({ t: Date.parse('2026-10-06T01:00:00Z') / 1000, c: 2580, v: 2_401_000, day: '2026-10-06' })
  })
})

describe('fugleIntraday1d', () => {
  const candles = {
    market: 'TSE',
    data: [bar('2026-10-06T09:00:00.000+08:00', 2580), bar('2026-10-06T13:30:00.000+08:00', 2585)],
  }

  it('builds the Yahoo-shaped series with prevClose from the quote', () => {
    const s = fugleIntraday1d('2330', candles, QUOTE)
    expect(s).toMatchObject({ symbol: '2330.TW', range: '1d', interval: '1m', prevClose: 2575, dayOpen: 2580, dayHigh: 2590, dayLow: 2575 })
    expect(s?.points).toHaveLength(2)
  })

  it('uses .TWO for OTC', () => {
    expect(fugleIntraday1d('6488', { ...candles, market: 'OTC' }, { ...QUOTE, market: 'OTC' })?.symbol).toBe('6488.TWO')
  })

  it('returns null without the quote, since prevClose draws the limits', () => {
    expect(fugleIntraday1d('2330', candles, null)).toBeNull()
  })

  it('returns null with no bars (before the open)', () => {
    expect(fugleIntraday1d('2330', { market: 'TSE', data: [] }, QUOTE)).toBeNull()
  })
})

describe('fugleIntraday5d', () => {
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05']
  const candles = {
    market: 'TSE',
    data: days.flatMap((d, i) => [bar(`${d}T09:00:00.000+08:00`, 2000 + i), bar(`${d}T13:30:00.000+08:00`, 2100 + i)]),
  }

  it('keeps the last 5 days and takes prevClose from the close of the day before', () => {
    const s = fugleIntraday5d('2330', candles, null)
    expect(s?.points).toHaveLength(10)
    expect(s?.prevClose).toBe(2100)
    expect(s?.interval).toBe('5m')
  })

  it('gives way to Yahoo when today is in session but not in the history yet', () => {
    expect(fugleIntraday5d('2330', candles, '2026-10-06')).toBeNull()
    expect(fugleIntraday5d('2330', candles, '2026-10-05')).not.toBeNull()
  })

  it('gives way to Yahoo with fewer than 6 days (no prevClose)', () => {
    expect(fugleIntraday5d('2330', { market: 'TSE', data: candles.data.slice(2) }, null)).toBeNull()
  })
})
