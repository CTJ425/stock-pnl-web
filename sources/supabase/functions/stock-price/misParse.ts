/**
 * TWSE MIS real-time quotes (mis.twse.com.tw/stock/api/getStockInfo.jsp) is purely analytical logic.
 * Independent of the Deno execution environment, used by index.ts and directly unit tested by the front-end Vitest
 * (see src/services/misParse.test.ts).
 *
 * MIS is the unofficial documented endpoint behind the stock exchange's market viewing website. The response format is:
 *   { rtcode: '0000', msgArray: [{ c, z, y, b, ... }] }
 *   c: code; z: latest transaction price; y: yesterday's closing price; b: best five buying prices (separated by '_');
 *   o/h/l: Today’s opening/highest/lowest; v: Accumulated trading volume (tickets);
 *   d: Trading day (YYYYMMDD); t: Last matching time (HH:mm:ss); ip: Trial matching is '1'.
 *   Yesterday's closing price is already in the same response, and it will be used as the benchmark for ups and downs coloring by hitting API (0.6.34) one more time.
 *   0.6.36 In the same way, get o/h/l/v/d/t/ip quotation card for individual stock analysis - same response, zero additional requests.
 *   After the market closes, these fields will still be the finalized values ​​for that day (actual measurement at 15:23 will still return d=that day, t=13:30:00),
 *   The TWSE OpenAPI is still at the previous trading day at this time, so "today's close" will always be based on this endpoint.
 *   Invalid values ​​are represented by '-'.
 */

export interface MisQuote {
  ticker: string
  price: number
  /** Yesterday's collection (`y`); if invalid, it is null. The front-end determines the rise and fall of the current price based on this.*/
  prevClose: number | null
  /** Open today (`o`)*/
  open: number | null
  /** Today’s highest (`h`)*/
  high: number | null
  /** Today’s lowest (`l`)*/
  low: number | null
  /** Cumulative trading volume (`v`, unit: Zhang); when there is no transaction, it is 0, which is different from null for "cannot get"*/
  volume: number | null
  /** Trading day (`d`, YYYYMMDD) - the quotation card indicates which day this set of numbers belongs to.*/
  tradeDate: string | null
  /** The final matching time (`t`, HH:mm:ss); reaching 13:30:00 means the closing has been finalized*/
  tradeTime: string | null
  /** Whether it is the trial trading stage (`ip` === '1'): At this time, z is the estimated trial trading price, not the transaction price*/
  trial: boolean
}

/** Each file attempts to list (tse_) and over-the-counter (otc_) channels at the same time, MIS will automatically ignore the invalid ones.*/
const CHANNELS_PER_TICKER = 2
/** MIS channel upper limit for a single request (conservative value to avoid URLs that are too long or rejected)*/
const MAX_CHANNELS_PER_REQUEST = 50

/**
 * Group Taiwan stock codes into MIS query channel groups. Each group should not exceed the single request limit.
 * And tse/otc channels with the same codename are guaranteed to fall into the same group.
 */
export function buildMisChannels(tickers: string[]): string[][] {
  const tickersPerGroup = Math.floor(MAX_CHANNELS_PER_REQUEST / CHANNELS_PER_TICKER)
  const groups: string[][] = []
  for (let i = 0; i < tickers.length; i += tickersPerGroup) {
    groups.push(
      tickers.slice(i, i + tickersPerGroup).flatMap((t) => [`tse_${t}.tw`, `otc_${t}.tw`]),
    )
  }
  return groups
}

function toPrice(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The effective range of trading volume and price is different: 0 lots means "no transactions have been made today", which is a true value and cannot be regarded as unavailable.
 * Just because 0 is valid, an empty string cannot be passed to Number() - it will return 0, making "there is no such field"
 * It becomes "Volume 0 contracts". Any missing columns will be blocked in front first.
 */
function toCount(value: unknown): number | null {
  const s = String(value ?? '').replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Trading day `d`: only recognizes 8 digits (YYYYMMDD), the rest will be treated as unavailable*/
function toTradeDate(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return /^\d{8}$/.test(s) ? s : null
}

/** Last matching time `t`: only recognize HH:mm:ss*/
function toTradeTime(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return /^\d{2}:\d{2}:\d{2}$/.test(s) ? s : null
}

/**
 * The transaction price is reduced: z (transaction) → b first level (buy one) → y (yesterday’s closing, including after-hours / no transaction yet).
 *
 * The measured z is often '-' (the snapshot of this endpoint does not necessarily have the last traded price), so buying one price is the norm rather than the exception.
 * The step back to buy one (rather than sell one or mid-price) is deliberate: the market value / unrealized profit and loss semantics on this page are
 * "How much can you get back if you sell them all now?" Buying one is the actual selling price that can be transacted. The estimate is conservative rather than optimistic.
 */
function pickPrice(row: Record<string, unknown>): number | null {
  const last = toPrice(row.z)
  if (last !== null) return last
  const firstBid = toPrice(String(row.b ?? '').split('_')[0])
  if (firstBid !== null) return firstBid
  return toPrice(row.y)
}

/**
 * Parse the MIS response as a quotation list; columns that cannot be parsed are simply ignored.
 * When the same code number appears in multiple columns (theoretically, tse/otc will not be valid at the same time), the first column is taken.
 */
export function parseMisResponse(data: unknown): MisQuote[] {
  const body = data as { msgArray?: unknown } | null | undefined
  if (!body || !Array.isArray(body.msgArray)) return []

  const quotes: MisQuote[] = []
  const seen = new Set<string>()
  for (const item of body.msgArray) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const ticker = String(row.c ?? '').trim()
    if (!ticker || seen.has(ticker)) continue
    const price = pickPrice(row)
    if (price === null) continue
    seen.add(ticker)
    quotes.push({
      ticker,
      price,
      prevClose: toPrice(row.y),
      open: toPrice(row.o),
      high: toPrice(row.h),
      low: toPrice(row.l),
      volume: toCount(row.v),
      tradeDate: toTradeDate(row.d),
      tradeTime: toTradeTime(row.t),
      trial: String(row.ip ?? '').trim() === '1',
    })
  }
  return quotes
}
