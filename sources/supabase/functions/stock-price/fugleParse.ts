/**
 * Fugle `intraday/quote`, `intraday/candles` and minute `historical/candles` → the shapes the
 * MIS / Yahoo paths already return (Task 195). Pure; unit tested by Vitest.
 *
 * Units, measured 2026-10-06 on 2330:
 * - `intraday/quote` `total.tradeVolume` is in 張 (18,343 with tradeValue NT$47.3 bn at ~2,579),
 *   although the docs say shares. Times (`lastUpdated`, `lastTrade.time`) are epoch **microseconds**.
 * - Minute candles (`intraday/candles`, minute `historical/candles`) report volume in 張 for board
 *   lots; Yahoo reports shares, and `IntradayPoint.v` is shares, so it is multiplied by 1000.
 *   Other markets (興櫃 / indices) use other units, so only `TSE` / `OTC` are accepted.
 * - `lastPrice` includes trial matches; `isTrial` says when it is one, like MIS.
 */
import type { IntradayPoint, IntradayRange, IntradaySeries } from './intradayParse.ts'

export interface FugleQuoteResult {
  price: number
  prevClose: number | null
  open: number | null
  high: number | null
  low: number | null
  /** 張, the MIS unit */
  volume: number | null
  /** YYYYMMDD, the MIS format */
  tradeDate: string | null
  /** HH:mm:ss Taipei, the MIS format */
  tradeTime: string | null
  trial: boolean
}

interface FugleQuoteJson {
  date?: unknown
  market?: unknown
  previousClose?: unknown
  openPrice?: unknown
  highPrice?: unknown
  lowPrice?: unknown
  lastPrice?: unknown
  total?: { tradeVolume?: unknown }
  isTrial?: unknown
  lastUpdated?: unknown
}

interface FugleMinuteJson {
  market?: unknown
  data?: Array<{ date?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown }>
}

const BOARD_LOT_MARKETS = new Set(['TSE', 'OTC'])

function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/** Epoch microseconds → HH:mm:ss Taipei. */
function taipeiTime(micros: unknown): string | null {
  if (typeof micros !== 'number' || !Number.isFinite(micros) || micros <= 0) return null
  return new Date(Math.floor(micros / 1000) + 8 * 3600_000).toISOString().slice(11, 19)
}

/** Yahoo-style symbol, so the chart title reads the same whichever source answered. */
export function yahooStyleSymbol(ticker: string, market: unknown): string {
  return `${ticker}.${market === 'OTC' ? 'TWO' : 'TW'}`
}

/**
 * Null when there is no trade (or trial) price yet: MIS would fall back to the bid there, and the
 * BUG-045 rule about bids after the close is MIS's to apply, so the caller leaves it to MIS.
 */
export function parseFugleQuote(json: unknown): FugleQuoteResult | null {
  if (typeof json !== 'object' || json === null) return null
  const q = json as FugleQuoteJson
  if (!BOARD_LOT_MARKETS.has(q.market as string)) return null
  const price = positive(q.lastPrice)
  if (price === null) return null
  const volume = q.total?.tradeVolume
  return {
    price,
    prevClose: positive(q.previousClose),
    open: positive(q.openPrice),
    high: positive(q.highPrice),
    low: positive(q.lowPrice),
    volume: typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 ? volume : null,
    tradeDate: typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date.replaceAll('-', '') : null,
    tradeTime: taipeiTime(q.lastUpdated),
    trial: q.isTrial === true,
  }
}

/** Minute bars, oldest first, with each bar's Taipei date. Null when the market is not a board-lot one. */
export function fugleMinutePoints(json: unknown): Array<IntradayPoint & { day: string; o: number; h: number; l: number }> | null {
  if (typeof json !== 'object' || json === null) return null
  const body = json as FugleMinuteJson
  if (!BOARD_LOT_MARKETS.has(body.market as string)) return null
  const out: Array<IntradayPoint & { day: string; o: number; h: number; l: number }> = []
  for (const bar of body.data ?? []) {
    if (typeof bar.date !== 'string') continue
    const ms = Date.parse(bar.date)
    const c = positive(bar.close)
    if (!Number.isFinite(ms) || c === null) continue
    const v = typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume * 1000 : 0
    out.push({
      t: Math.floor(ms / 1000),
      c,
      v,
      day: new Date(ms + 8 * 3600_000).toISOString().slice(0, 10),
      o: positive(bar.open) ?? c,
      h: positive(bar.high) ?? c,
      l: positive(bar.low) ?? c,
    })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

function series(
  ticker: string,
  market: unknown,
  range: IntradayRange,
  prevClose: number | null,
  bars: Array<IntradayPoint & { o: number; h: number; l: number }>,
): IntradaySeries {
  return {
    symbol: yahooStyleSymbol(ticker, market),
    range,
    interval: range === '1d' ? '1m' : '5m',
    prevClose,
    points: bars.map(({ t, c, v }) => ({ t, c, v })),
    dayOpen: bars[0].o,
    dayHigh: Math.max(...bars.map((b) => b.h)),
    dayLow: Math.min(...bars.map((b) => b.l)),
  }
}

/** `intraday/candles?timeframe=1` + `intraday/quote` → the 1d series. Needs both: prevClose draws the 昨收 line and limits. */
export function fugleIntraday1d(ticker: string, candles: unknown, quote: unknown): IntradaySeries | null {
  const bars = fugleMinutePoints(candles)
  const q = parseFugleQuote(quote)
  if (!bars || bars.length === 0 || !q || q.prevClose === null) return null
  return series(ticker, (candles as FugleMinuteJson).market, '1d', q.prevClose, bars)
}

/**
 * Minute `historical/candles?timeframe=5` over ~3 weeks → the last 5 trading days, with prevClose =
 * the close of the day before them (Yahoo's `chartPreviousClose` for `range=5d`).
 *
 * `todayYmd` is set only while today's session should be in the data (a trading day after 09:00);
 * if the newest bar is older, the history has not caught up and Yahoo answers instead.
 */
export function fugleIntraday5d(ticker: string, candles: unknown, todayYmd: string | null): IntradaySeries | null {
  const bars = fugleMinutePoints(candles)
  if (!bars || bars.length === 0) return null
  const days = [...new Set(bars.map((b) => b.day))]
  if (todayYmd !== null && days[days.length - 1] !== todayYmd) return null
  if (days.length < 6) return null
  const keep = new Set(days.slice(-5))
  const before = bars.filter((b) => b.day === days[days.length - 6])
  const kept = bars.filter((b) => keep.has(b.day))
  return series(ticker, (candles as FugleMinuteJson).market, '5d', before[before.length - 1].c, kept)
}
