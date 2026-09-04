/**
 * Obtain current stock price:
 * 0. TTL cache: The prices obtained within TTL (60 seconds for Taiwan stocks, 10 minutes for US stocks) are directly used without hitting the API.
 *    (Login/reorganization/multiple people using it at the same time will not duplicate the connection; manual reorganization can force a re-capture).
 *    asOf uses the actual price capture time returned by the Edge Function. The front-end TTL does not overlap with the server-side cache TTL.
 * 1. Main strategy: Supabase Edge Function `stock-price` (Server-side proxy capture: Taiwan stock TWSE MIS real-time quotations,
 *    US stock Yahoo Finance, bypassing CORS)
 * 2. Taiwan stock backup: TWSE / TPEx OpenAPI direct connection (official endpoint supporting CORS)
 * 3. Downgrade mechanism: When the API fails, the last cached price of localStorage (marked stale) is returned.
 *    If there is no data at all, it will be null - the UI will be left blank and will not mistakenly display a full loss (the same as the GAS version)
 */
import type { Market } from '../types/models'
import { positionKey } from '../types/models'
import { isSupabaseConfigured, supabase } from './supabase'
import { getTwStockList } from './twMarketData'
import { twIsAfterClose, twQuoteTtlMs } from '../../supabase/functions/stock-price/quoteWindow'

export interface PriceQuote {
  price: number
  /**
   * Yesterday's closing (0.6.34): The caller marked the current price as rising red or green accordingly.
   * The Taiwan stock backup (TWSE/TPEx daily closing list) does not have this field and is null when taking that path - the file displays flat color.
   */
  prevClose: number | null
  /**
   * Today's opening high and low and cumulative trading volume (tickets) (0.6.36): quotation card for individual stock analysis.
   * Like prevClose, it also comes from the response of the quotation itself, no additional request is required; the Taiwan stock backup path is always null.
   */
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  /** Trading day YYYYMMDD; only the path MIS has*/
  tradeDate: string | null
  /** The final matching time is HH:mm:ss; reaching 13:30:00 means the closing has been finalized*/
  tradeTime: string | null
  /** Whether the current price grab is in the trial trading stage (at this time, the price is the estimated trial trading price, not the transaction price)*/
  trial: boolean
  /** Official TWSE/TPEx industry name (e.g. '半導體業', '航運業') */
  industry?: string | null
  /** Get time (ISO)*/
  asOf: string
  source: 'edge' | 'twse' | 'cache'
  /** Whether it is an expired cache price*/
  stale: boolean
}

export interface PriceRequestItem {
  market: Market
  ticker: string
}

/** The key is positionKey(market, ticker), and the ticker without current price will not appear in the results.*/
export type PriceMap = Record<string, PriceQuote>

/** The closing will be finalized when the final matching time reaches 13:30*/
const CLOSE_TIME = '13:30:00'

/**
 * Is this quote the final closing value for that day?
 * The quotation card for individual stock analysis and the tooltip for the inventory overview must be expressed in other words accordingly ("closing price" rather than "current price").
 *
 * BUG-050: a matching time at or after 13:30 is sufficient but not necessary. The Yahoo fallback never
 * reports one, and a thin ticker's last match can predate 13:30 with no closing-auction trade — both
 * printed 「盤中」 all evening. When `market` is known (TW-only: US quotes never fall silent this way),
 * fall back to inferring the close from the quote's own fetch time on the Taipei clock.
 */
export function isClosed(quote: PriceQuote | null | undefined, market?: Market): boolean {
  if (!quote) return false
  if (quote.tradeTime !== null && quote.tradeTime >= CLOSE_TIME) return true
  if (market !== 'TPE') return false
  const at = Date.parse(quote.asOf)
  return Number.isFinite(at) && twIsAfterClose(new Date(at))
}

/** Trading day 'YYYYMMDD' → 'M/D'; returns null if the format does not match or does not exist (US stocks/recovery path)*/
export function tradeDateLabel(tradeDate: string | null | undefined): string | null {
  if (!tradeDate || !/^\d{8}$/.test(tradeDate)) return null
  return `${Number(tradeDate.slice(4, 6))}/${Number(tradeDate.slice(6, 8))}`
}

// v3 (0.6.36): Quote has added opening high and low volume and trading day/matching time. The reason is the same as v2 (0.6.34) when adding prevClose——
// If you continue to use the old key, the quotation card will be missing all the way until each level expires; change the key once and replace it.
const CACHE_KEY = 'stock-pnl-web/price-cache-v3'
/** US stock cache validity period (same as Edge Function DB cache); Taiwan stock changes are determined by time period, see quoteWindow.ts*/
const CACHE_TTL_US_MS = 10 * 60 * 1000

/**
 * Get the cache TTL of the market at this moment based on positionKey.
 * After the Taiwan stock market closes at 13:30, it will be locked all the way until 08:25 the next day before trial trading. During this period, all polling will hit the cache and no request will be sent (0.6.36).
 */
export function cacheTtlMs(key: string, quote?: PriceQuote): number {
  if (!key.startsWith('TPE:')) return CACHE_TTL_US_MS
  const fetchedAt = quote?.asOf ? new Date(quote.asOf) : null
  return twQuoteTtlMs(new Date(), quote?.tradeTime ?? null, fetchedAt && Number.isFinite(fetchedAt.getTime()) ? fetchedAt : null)
}

export function isFresh(key: string, quote: PriceQuote | undefined, now: number): quote is PriceQuote {
  if (!quote || quote.stale) return false
  const at = Date.parse(quote.asOf)
  return Number.isFinite(at) && now - at < cacheTtlMs(key, quote)
}

/** Read the quote cache (L1) of localStorage; fetchPrices in the same file uses it to determine TTL hits*/
export function readPriceCache(): PriceMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PriceMap
  } catch {
    return {}
  }
}

function writePriceCache(map: PriceMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    // Cache write failure does not affect functionality
  }
}

interface EdgeQuote {
  price: number
  prevClose?: number | null
  open?: number | null
  high?: number | null
  low?: number | null
  volume?: number | null
  tradeDate?: string | null
  tradeTime?: string | null
  trial?: boolean
  industry?: string | null
  asOf?: string
}

interface EdgePriceResponse {
  prices?: Record<string, EdgeQuote>
}

/** The numerical field returned by Edge: non-numeric or non-positive numbers will be treated as unavailable (0 is allowed for trading volume)*/
function edgeNum(value: unknown, allowZero = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return allowZero ? (value >= 0 ? value : null) : value > 0 ? value : null
}

function edgeText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

type ResolvedQuote = Omit<PriceQuote, 'asOf' | 'source' | 'stale'> & { asOf: string | null }

async function fetchFromEdge(items: PriceRequestItem[]): Promise<Map<string, ResolvedQuote>> {
  const resolved = new Map<string, ResolvedQuote>()
  if (!isSupabaseConfigured || !supabase || items.length === 0) return resolved
  try {
    const { data, error } = await supabase.functions.invoke<EdgePriceResponse>('stock-price', {
      body: { action: 'prices', symbols: items },
      timeout: 15_000,
    })
    if (error || !data?.prices) return resolved
    for (const [key, quote] of Object.entries(data.prices)) {
      if (Number.isFinite(quote?.price) && quote.price > 0) {
        // asOf is the actual price capture time (the DB cache hits earlier than now); the old version of Edge does not have this field, and it is left to the caller to fill in now
        const asOf = typeof quote.asOf === 'string' && Number.isFinite(Date.parse(quote.asOf))
          ? quote.asOf
          : null
        // Edge that has not yet deployed the corresponding version does not return these fields; the missing ones are null, and the quotation card displays "—", which is not an error.
        resolved.set(key, {
          price: quote.price,
          prevClose: edgeNum(quote.prevClose),
          open: edgeNum(quote.open),
          high: edgeNum(quote.high),
          low: edgeNum(quote.low),
          volume: edgeNum(quote.volume, true),
          tradeDate: edgeText(quote.tradeDate),
          tradeTime: edgeText(quote.tradeTime),
          trial: quote.trial === true,
          industry: edgeText(quote.industry),
          asOf,
        })
      }
    }
  } catch {
    // When the Edge Function is unavailable, it will be handled by the backup path.
  }
  return resolved
}

async function fetchTwFallback(items: PriceRequestItem[]): Promise<Map<string, number>> {
  const resolved = new Map<string, number>()
  const twItems = items.filter((i) => i.market === 'TPE')
  if (twItems.length === 0) return resolved
  try {
    const list = await getTwStockList()
    const bySymbol = new Map(list.map((r) => [r.symbol, r]))
    for (const item of twItems) {
      const row = bySymbol.get(item.ticker)
      if (row?.close) resolved.set(positionKey(item.market, item.ticker), row.close)
    }
  } catch {
    // When direct backup also fails, it will be downgraded to the cache.
  }
  return resolved
}

/**
 * Get the current price for the batch. The returned PriceMap contains the fresh price and (only when there is no fresh price) the cache price;
 * Symbols with neither are not in the map and the caller should leave Market Cap / Unrealized P&L blank.
 * @param options.force Ignore TTL cache and force re-fetch (for manual refresh)
 */
export async function fetchPrices(
  items: PriceRequestItem[],
  options?: { force?: boolean },
): Promise<PriceMap> {
  const result: PriceMap = {}
  if (items.length === 0) return result

  const cache = readPriceCache()
  const nowMs = Date.now()

  // The cache price in the TTL is used directly (the original acquisition time is retained), and only expired/missing codes are recaptured.
  let toFetch = items
  if (!options?.force) {
    toFetch = []
    for (const item of items) {
      const key = positionKey(item.market, item.ticker)
      const cached = cache[key]
      if (isFresh(key, cached, nowMs)) result[key] = cached
      else toFetch.push(item)
    }
  }

  const now = new Date().toISOString()
  const fromEdge = await fetchFromEdge(toFetch)

  const unresolved = toFetch.filter((i) => !fromEdge.has(positionKey(i.market, i.ticker)))
  const fromTw = await fetchTwFallback(unresolved)

  for (const [key, quote] of fromEdge) {
    result[key] = { ...quote, asOf: quote.asOf ?? now, source: 'edge', stale: false }
  }
  for (const [key, price] of fromTw) {
    // The daily closing list only has the closing price, and does not include yesterday’s closing price nor the opening of high and low volumes——
    // The code numbers that come to this backup line are all flat, and each box of the quotation card displays "—"
    result[key] = {
      price,
      prevClose: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      tradeDate: null,
      tradeTime: null,
      trial: false,
      industry: null,
      asOf: now,
      source: 'twse',
      stale: false,
    }
  }

  // Cache downgrade: If there is still no current price, the last successfully obtained price will be used (marked stale)
  for (const item of items) {
    const key = positionKey(item.market, item.ticker)
    if (!result[key] && cache[key]) {
      result[key] = { ...cache[key], source: 'cache', stale: true }
    }
  }

  // Only write "fresh price" back to cache
  const nextCache = { ...cache }
  for (const [key, quote] of Object.entries(result)) {
    if (!quote.stale) nextCache[key] = quote
  }
  writePriceCache(nextCache)

  return result
}
