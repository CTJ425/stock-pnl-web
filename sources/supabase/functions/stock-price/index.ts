/**
 * Supabase Edge Function: stock-price (current price/search agent)
 *
 * The server side requests external APIs such as TWSE MIS / Yahoo Finance on behalf of the server to solve browser CORS limitations.
 * Current price source: For Taiwan stocks, go to the stock exchange's MIS real-time quotes (second-level delay), if failed, go to Yahoo; for US stocks, go to Yahoo.
 * Current price with DB shared cache (price_cache information table, see sources/supabase/schema.sql):
 * The entire site within TTL shares the same quote (for Taiwan stocks, please see the time period rules of quoteWindow.ts, and for US stocks, 10 minutes).
 * The same stock does not make repeated requests to external APIs.
 * Deployment method (need to install Supabase CLI and log in):
 *   supabase functions deploy stock-price
 *   Keep the default verify_jwt=true: the front end calls this with an anon JWT.
 *   Deploying with --no-verify-jwt turns the quote endpoint into a public one that
 *   anybody can call (Edge Function quota abuse). Only stock-report uses
 *   --no-verify-jwt, because pg_cron calls it with x-cron-secret and no JWT.
 *
 * interface:
 *   POST { action: 'prices', symbols: [{ market: 'TPE'|'US', ticker: string }] }
 *     → { prices: { 'TPE:2330': { price, prevClose, open, high, low, volume,
 *                                 tradeDate, tradeTime, trial, asOf }, ... },
 *         truncated: string[] }
 *       truncated (EP-03/EP-04) lists the `${market}:${ticker}` keys that did not make it
 *       into `prices`: symbols past the 50-symbol cap, plus any still in flight when the
 *       Yahoo-fallback batch deadline fired. The front end does not read this field yet
 *       (see priceProxy.ts) — it is dropped silently today.
 *       asOf is the actual acquisition time (ISO) of the quotation, which is used for front-end TTL judgment to avoid overlapping with DB cache TTL.
 *       prevClose is yesterday's closing price, and the front-end will mark the current price as rising red or green accordingly (0.6.34; null if not available)
 *       open/high/low/volume/tradeDate/tradeTime/trial quotation card for individual stock analysis (0.6.36),
 *       All come from the same data that will be returned by the quotation, no additional requests (only OHLCV for US stocks, no trial)
 *   POST { action: 'search', query: string }
 *     → { results: [{ symbol, name, market }] }
 *   POST { action: 'fx', codes: ['USD','JPY', …] }
 *       → { quotes: { USD: { price, asOf }, … } } The real-time median price of Taiwan dollars against foreign currencies (1 foreign currency = N Taiwan dollars)
 *         The history of the trend chart is written into Storage every day by sync-fx of stock-report, and only "how much is now" is returned here.
 *   POST { action: 'twlist' }
 *     → { rows: [{ symbol, name, close }], tpexFallbackAgeDays?: number } (Full list of Taiwan stocks; TWSE/TPEx is not open to CORS,
 *       The official environment is provided by this agent for front-end Chinese search/code reverse check/current price backup.
 *       tpexFallbackAgeDays (EP-05) is present only when the TPEx leg used the static
 *       tpexFallback.ts snapshot instead of the live endpoint; it is that snapshot's age in
 *       days as of this response, and gets one extra `logEvent` warning when it exceeds 90.)
 *   POST { action: 'intraday', symbol: { market: 'TPE'|'US'|'IDX', ticker: string }, range?: '1d'|'5d' }
 *     → { series: IntradaySeries | null } (Yahoo chart v8 intraday bars; range defaults to '1d'.
 *       Tries each yahooSymbols() candidate in turn and returns the first that parses;
 *       null series on a 200 when every candidate fails — an unknown ticker is not an error.
 *       No price_cache write: the series is large and per-range, caching is the client's job.
 *       'IDX' (e.g. ^TWII) needs no special handling: yahooSymbols() returns the ticker
 *       verbatim for any market other than 'TPE', and IntradaySeries carries dayOpen/dayHigh/
 *       dayLow — read from the OHLC arrays, not meta — for the panel in 總體經濟 > 台股, 0.9.19.)
 *   POST { action: 'daily', symbol: { market, ticker }, range: '5y'|'max' }
 *     → { rows: DailyRow[], granularity: '1d'|'1mo' } (long-range daily K bars for the
 *       `近 5 年` / `全部` ranges on the individual stock analysis page's 技術 tab, Route A:
 *       these two ranges are not in the nightly daily/{ticker}.json batch and are fetched
 *       from Yahoo on demand. `5y` reuses extractDaily(); `max` returns monthly bars via
 *       extractMonthly(). Tries each yahooSymbols() candidate in turn and returns the first
 *       that yields a non-empty row array; empty rows on every candidate failing is a normal
 *       "no data" answer, not an error, 0.9.41.)
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { logEvent } from '../_shared/log.ts'
import { buildMisChannels, parseMisResponse } from './misParse.ts'
import { intradayInterval, parseYahooChart, type IntradayRange } from './intradayParse.ts'
import { twMaxTtlMs, twQuoteTtlMs } from './quoteWindow.ts'
import { dailyRangeInterval, extractMonthly, type DailyRangeKey } from './dailyRange.ts'
import { extractDaily } from '../stock-report/twDaily.ts'
import { buildTwList } from './twList.ts'
import { TPEX_FALLBACK_GENERATED_AT, TPEX_FALLBACK_ROWS } from './tpexFallback.ts'

interface SymbolItem {
  market: 'TPE' | 'US' | 'IDX'
  ticker: string
}

/**
 * First price quote. `prevClose` is **yesterday's closing**, which is used by the front-end to determine whether the current price is red or green.
 *
 * Both sources originally put yesterday in the same response (MIS's `y`, Yahoo's `chartPreviousClose`),
 * Get it without hitting the API more than once. **Deliberately not using this opening**: MIS has `o`, but Yahoo’s chart meta does not have a corresponding field.
 * The two markets will have different calibers - yesterday's closing price is the only benchmark that is available to both Taiwan and the United States and is consistent with the definition of "up and down" in the market-reading software.
 * If you can't get it, it's null. If you don't take the current price, you can pretend to be yourself (that will make every level a flat color).
 */
interface Quote {
  price: number
  prevClose: number | null
  /** The following is the quotation card field (0.6.36): it is obtained in vain in the same source response. If it cannot be obtained, it is null. */
  open: number | null
  high: number | null
  low: number | null
  /** Cumulative trading volume, unit "sheet" (Yahoo returns the number of shares, divided by 1000 and then aligned with the MIS caliber) */
  volume: number | null
  /**Trading day YYYYMMDD (only provided by MIS) */
  tradeDate: string | null
  /**Last matching time HH:mm:ss (only provided by MIS); reaching 13:30:00 means the closing has been finalized */
  tradeTime: string | null
  /** Whether it is in the trial stage (only provided by MIS) */
  trial: boolean
  /** Industry category name (TWSE MIS) */
  industry: string | null
}

/** US stock DB cache validity period; Taiwan stock change is determined by quoteWindow.ts based on time period (locked to 08:25 the next day after closing) */
const CACHE_TTL_US_MS = 10 * 60 * 1000

/** Foreign index DB cache validity period (task 162): a 60 s poll must not read a value up to 10 minutes old. */
const CACHE_TTL_IDX_MS = 60 * 1000

/**
 * Hard wall-clock cap on the Yahoo-fallback step of `handlePrices` (EP-04). Each candidate
 * fetch already has its own 10 s timeout, but a large batch with no overall deadline can
 * still walk the function up to the platform's own timeout during a MIS/Yahoo outage.
 * Symbols still unresolved when this fires are skipped and reported back in `truncated`.
 */
const PRICES_YAHOO_DEADLINE_MS = 20_000

/** The cache validity period of this key at this moment. Taiwan stocks will last for more than ten hours after the market closes, and the lower bound for coarse screening must follow it. */
function cacheTtlMsFor(key: string, now: Date, tradeTime: string | null, fetchedAt: Date | null): number {
  if (key.startsWith('TPE:')) return twQuoteTtlMs(now, tradeTime, fetchedAt)
  if (key.startsWith('IDX:')) return CACHE_TTL_IDX_MS
  return CACHE_TTL_US_MS
}

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatically injected by the Supabase execution environment;
// service role is not restricted by RLS and is the only way to write to price_cache
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Taiwan stock code transfer to Yahoo format: listing .TW; if there is no search, the caller will try again .TWO (listing) */
function yahooSymbols(item: SymbolItem): string[] {
  if (item.market === 'TPE') return [`${item.ticker}.TW`, `${item.ticker}.TWO`]
  return [item.ticker]
}

/**
 * Tries each Yahoo symbol candidate in turn and returns the first one whose `fetchOne`
 * resolves to a non-null result (EP-06: this ".TW then .TWO" loop was hand-written three
 * times — the price fallback below, `handleIntraday`, and `handleDailyRange`).
 *
 * `fetchOne` resolving to `null` is a normal "try the next candidate" step — an unknown
 * ticker on that exchange is not an error, and every candidate failing this way is a
 * plain "no data" answer. `fetchOne` *throwing* is different: a network failure (including
 * the per-request `AbortSignal.timeout`) or a response body that failed to parse as JSON.
 * That case was previously swallowed silently (EP-07); here it gets one `logEvent` call
 * before moving on to the next candidate.
 */
async function tryYahooCandidates<T>(
  action: string,
  candidates: string[],
  fetchOne: (symbol: string) => Promise<T | null>,
): Promise<T | null> {
  for (const symbol of candidates) {
    try {
      const result = await fetchOne(symbol)
      if (result !== null) return result
    } catch (err) {
      await logEvent(db, {
        level: 'warn',
        action,
        message: err instanceof Error ? err.message : String(err),
        detail: { ticker: symbol, name: err instanceof Error ? err.name : undefined },
      })
    }
  }
  return null
}

/**
 * Yesterday's collection: Prioritize `chartPreviousClose` (must exist when `range=1d`), and return `previousClose`.
 * If it cannot be obtained, null will be returned - the front end will display the current price of the file in a neutral color without guessing a benchmark.
 */
function yahooPrevClose(meta: Record<string, unknown> | undefined): number | null {
  for (const key of ['chartPreviousClose', 'previousClose']) {
    const v = Number(meta?.[key])
    if (Number.isFinite(v) && v > 0) return v
  }
  return null
}

function yahooNum(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Fetches one Yahoo symbol candidate. A network failure or malformed JSON body is left to
 * throw — the caller is `tryYahooCandidates`, which logs it (EP-07) and tries the next
 * candidate. Returning `null` here is reserved for a well-formed response with no usable
 * price (unknown ticker on this exchange), which is not an error.
 */
async function fetchYahooPrice(symbol: string): Promise<Quote | null> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) return null
  const data = await res.json()
  const result = data?.chart?.result?.[0]
  const meta = result?.meta
  const price = Number(meta?.regularMarketPrice)
  if (!Number.isFinite(price) || price <= 0) return null
  // The opening price is not in meta (the measured regularMarketOpen / open are both undefined),
  // To be taken from a single daily line of indicators; when range=1d, the sequence has only one element
  const series = result?.indicators?.quote?.[0]
  const volumeShares = yahooNum(meta?.regularMarketVolume)
  return {
    price,
    prevClose: yahooPrevClose(meta),
    open: yahooNum(series?.open?.[0]),
    high: yahooNum(meta?.regularMarketDayHigh),
    low: yahooNum(meta?.regularMarketDayLow),
    // The number of shares given by Yahoo and the number of sheets given by MIS are unified into sheets. The two paths feed the quotation card with the same caliber.
    volume: volumeShares === null ? null : Math.round(volumeShares / 1000),
    // The trading day/matching time/trial matching flags are only available in MIS; this path in Yahoo should always be left blank.
    tradeDate: null,
    tradeTime: null,
    trial: false,
    industry: null,
  }
}

/** Taiwan stock real-time quotation (TWSE MIS): return ticker → quotation; when the whole batch fails, return to empty Map and hand it over to Yahoo fallback */
async function fetchMisPrices(tickers: string[]): Promise<Map<string, Quote>> {
  const resolved = new Map<string, Quote>()
  for (const channels of buildMisChannels(tickers)) {
    try {
      const res = await fetch(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${channels.join('|')}&json=1&delay=0&_=${Date.now()}`,
        {
          headers: {
            'User-Agent': UA,
            Accept: 'application/json',
            Referer: 'https://mis.twse.com.tw/stock/index.jsp',
          },
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const quote of parseMisResponse(data)) {
        if (!resolved.has(quote.ticker)) {
          const { ticker: _ticker, ...rest } = quote
          resolved.set(quote.ticker, rest)
        }
      }
    } catch {
      // MIS is an unofficial documented endpoint and is silently handed over to Yahoo fallback on failure.
    }
  }
  return resolved
}

/** The DB cache field returns the value of Quote; NULL / bad values ​​​​are returned to null */
function cachedNum(value: unknown, allowZero = false): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return allowZero ? (n >= 0 ? n : null) : n > 0 ? n : null
}

function cachedText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

async function handlePrices(symbols: SymbolItem[]): Promise<Response> {
  const items = symbols.slice(0, 50)
  // EP-03: symbols dropped by the 50-symbol cap are reported here so the caller can tell a
  // truncated batch from a batch that simply had no prices. Step 3 below appends any symbol
  // still unresolved when the batch deadline (EP-04) fires.
  const truncated = symbols.slice(50).map((s) => `${s.market}:${s.ticker}`)
  const prices: Record<string, Quote & { asOf: string }> = {}
  const now = new Date()
  const nowMs = now.getTime()

  // 1) First check the DB shared cache: the quotation within the TTL of the market is directly returned (asOf = actual price capture time)
  //    The lower bound of the coarse screen is the larger of the two markets - the TTL after the closing of the Taiwan stock market is more than ten hours.
  //    Using the fixed value will filter out the final price captured at yesterday's closing price, and capture it all night long (0.6.36)
  const freshAfter = new Date(nowMs - Math.max(twMaxTtlMs(now), CACHE_TTL_US_MS)).toISOString()
  try {
    const { data } = await db
      .from('price_cache')
      .select(
        'key, price, prev_close, open, high, low, volume, trade_date, trade_time, trial, updated_at',
      )
      .in('key', items.map((i) => `${i.market}:${i.ticker}`))
      .gte('updated_at', freshAfter)
    for (const row of data ?? []) {
      const key = String(row.key)
      const price = Number(row.price)
      const at = Date.parse(String(row.updated_at))
      const tradeTime = cachedText(row.trade_time)
      const ttl = cacheTtlMsFor(key, now, tradeTime, Number.isFinite(at) ? new Date(at) : null)
      if (!Number.isFinite(price) || price <= 0) continue
      if (!Number.isFinite(at) || nowMs - at >= ttl) continue
      prices[key] = {
        price,
        prevClose: cachedNum(row.prev_close),
        open: cachedNum(row.open),
        high: cachedNum(row.high),
        low: cachedNum(row.low),
        volume: cachedNum(row.volume, true),
        tradeDate: cachedText(row.trade_date),
        tradeTime,
        trial: row.trial === true,
        industry: null,
        asOf: new Date(at).toISOString(),
      }
    }
  } catch {
    // When the cache table is unavailable (for example, the table has not been created yet), all external APIs are used directly.
  }

  // 2) Those with missing information on Taiwan stocks should go to MIS real-time quotes first (asOf = the time confirmed by the source, not the last transaction time,
  //    To avoid treating the cache as expired and making repeated requests after the market opens)
  const missing = items.filter((i) => !prices[`${i.market}:${i.ticker}`])
  const fromMis = await fetchMisPrices(
    missing.filter((i) => i.market === 'TPE').map((i) => i.ticker),
  )
  for (const [ticker, quote] of fromMis) {
    prices[`TPE:${ticker}`] = { ...quote, asOf: new Date().toISOString() }
  }

  // 3) Those who are still missing (including all US stocks and Taiwanese stocks that failed MIS) go to Yahoo,
  //    bounded by an overall batch deadline (EP-04) — each item already races its own candidates
  //    through tryYahooCandidates (EP-06), but a big batch with no outer bound could still walk
  //    the function up to the platform's own timeout during an upstream outage.
  const unresolved = missing.filter((i) => !prices[`${i.market}:${i.ticker}`])
  const yahooResults = new Map<string, Quote & { asOf: string }>()
  const settled = new Set<string>()
  const fetchAll = Promise.all(
    unresolved.map(async (item) => {
      const key = `${item.market}:${item.ticker}`
      const quote = await tryYahooCandidates('prices', yahooSymbols(item), fetchYahooPrice)
      settled.add(key)
      if (quote !== null) yahooResults.set(key, { ...quote, asOf: new Date().toISOString() })
    }),
  )
  await Promise.race([
    fetchAll,
    new Promise<void>((resolve) => setTimeout(resolve, PRICES_YAHOO_DEADLINE_MS)),
  ])
  for (const item of unresolved) {
    const key = `${item.market}:${item.ticker}`
    // Not yet settled when the deadline fired: skipped, not "tried and failed" — report it
    // instead of silently answering as if the ticker had no price.
    if (!settled.has(key)) truncated.push(key)
  }
  for (const [key, quote] of yahooResults) {
    prices[key] = quote
  }

  // 4) The newly captured price is written back to the cache for sharing by the entire site (updated_at records the actual quotation time, and TTL is calculated from this point)
  const fetchedKeys = [
    ...[...fromMis.keys()].map((t) => `TPE:${t}`),
    ...yahooResults.keys(),
  ]
  if (fetchedKeys.length > 0) {
    try {
      await db.from('price_cache').upsert(
        fetchedKeys.map((key) => ({
          key,
          price: prices[key].price,
          prev_close: prices[key].prevClose,
          open: prices[key].open,
          high: prices[key].high,
          low: prices[key].low,
          volume: prices[key].volume,
          trade_date: prices[key].tradeDate,
          trade_time: prices[key].tradeTime,
          trial: prices[key].trial,
          updated_at: prices[key].asOf,
        })),
      )
    } catch {
      // Failure to write back does not affect this response
    }
  }

  return json({ prices, truncated })
}

interface SearchResult {
  symbol: string
  name: string
  market: string
}

/** Code-type query (such as AAPL, 2330): the name that has been resolved is directly answered by the DB cache, and Yahoo is no longer requested. */
async function lookupCachedNames(query: string): Promise<SearchResult[]> {
  if (!/^[A-Z0-9.-]{1,10}$/.test(query)) return []
  try {
    const { data } = await db
      .from('stock_names')
      .select('key, name')
      .in('key', [`US:${query}`, `TPE:${query}`])
    return (data ?? []).flatMap((row: { key: unknown; name: unknown }) => {
      const sep = String(row.key).indexOf(':')
      if (sep < 0 || !row.name) return []
      return [
        {
          market: String(row.key).slice(0, sep),
          symbol: String(row.key).slice(sep + 1),
          name: String(row.name),
        },
      ]
    })
  } catch {
    return []
  }
}

/** Successfully parsed "code ↔ name" will be written back to the shared cache, and all subsequent users will be able to query without hitting Yahoo */
async function persistNames(results: SearchResult[]): Promise<void> {
  if (results.length === 0) return
  try {
    await db.from('stock_names').upsert(
      results.map((r) => ({
        key: `${r.market}:${r.symbol}`,
        name: r.name,
        updated_at: new Date().toISOString(),
      })),
    )
  } catch {
    // Failure to write back does not affect this response
  }
}

async function handleSearch(query: string): Promise<Response> {
  const cached = await lookupCachedNames(query.toUpperCase())
  if (cached.length > 0) return json({ results: cached })

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return json({ results: [] })
    const data = await res.json()
    const quotes: Array<Record<string, unknown>> = Array.isArray(data?.quotes) ? data.quotes : []
    const results: SearchResult[] = quotes
      .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
      .map((q) => {
        let symbol = String(q.symbol)
        let market = 'US'
        if (symbol.endsWith('.TW') || symbol.endsWith('.TWO')) {
          symbol = symbol.replace(/\.TWO?$/, '')
          market = 'TPE'
        }
        return {
          symbol,
          name: String(q.shortname ?? q.longname ?? symbol),
          market,
        }
      })
      .slice(0, 10)
    // Only write back US stocks: Yahoo’s Taiwan stock names are in English, and the Chinese names of Taiwan stocks are based on twlist (TWSE/TPEx).
    await persistNames(results.filter((r) => r.market === 'US'))
    return json({ results })
  } catch {
    return json({ results: [] })
  }
}

/** Days between `TPEX_FALLBACK_GENERATED_AT` and `now` (EP-05): the static snapshot's age. */
function tpexFallbackAgeDays(now: Date): number {
  const generated = Date.parse(`${TPEX_FALLBACK_GENERATED_AT}T00:00:00Z`)
  return Math.floor((now.getTime() - generated) / (24 * 60 * 60 * 1000))
}

/** Full list of Taiwan stocks (listed on TWSE + listed on TPEx), the fields are simplified to symbol/name/close to shorten the response */
async function handleTwList(): Promise<Response> {
  const fetchJson = async (url: string): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as Array<Record<string, unknown>>
  }

  let usedFallback = false
  let fallbackReason: string | null = null

  const fetchTpex = async (): Promise<Array<Record<string, unknown>>> => {
    try {
      const rows = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes')
      if (Array.isArray(rows) && rows.length > 0) return rows
      usedFallback = true
      fallbackReason = `TPEx 傳回空陣列 (${rows ? rows.length : 0} 筆)`
    } catch (err) {
      usedFallback = true
      fallbackReason = err instanceof Error ? err.message : String(err)
      console.warn('TPEx live fetch failed, using fallback:', fallbackReason)
    }
    return TPEX_FALLBACK_ROWS
  }

  const [twse, tpex] = await Promise.allSettled([
    fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'),
    fetchTpex(),
  ])

  let fallbackAgeDays: number | null = null
  if (usedFallback) {
    fallbackAgeDays = tpexFallbackAgeDays(new Date())
    await logEvent(db, {
      level: 'warn',
      action: 'twlist',
      message: 'TPEx 即時端點無法連線，使用靜態備援清單',
      detail: { reason: fallbackReason },
    })
    // EP-05: the snapshot has no expiry of its own, so a stale one would otherwise go
    // unnoticed indefinitely. One extra warning, only past the 90-day mark, not every call.
    if (fallbackAgeDays > 90) {
      await logEvent(db, {
        level: 'warn',
        action: 'twlist',
        message: `TPEx 備援清單已逾 90 天未更新（產生於 ${TPEX_FALLBACK_GENERATED_AT}）`,
        detail: { count: fallbackAgeDays },
      })
    }
  }

  const result = buildTwList(twse, tpex)
  if (!result.ok) {
    await logEvent(db, {
      level: 'error',
      action: 'twlist',
      message: result.error,
      detail: { failures: result.failures },
    })
    return json({ error: result.error, failures: result.failures }, 502)
  }
  return json({
    rows: result.rows,
    ...(usedFallback ? { tpexFallbackAgeDays: fallbackAgeDays } : {}),
  })
}


/**
 * Real-time quotes on exchange rates (0.6.7).
 *
 * **Why is this action**: The daily schedule of the historical trend of the trend chart is written into Storage's `fx/twd.json`
 * (sync-fx of stock-report), but the last entry in that file is "the latest **complete** daily line"——
 * Today's daily line will not be established until the London Day has passed, so the entire trading day will remain at yesterday's closing price.
 * Actual measurement 2026-07-29 Taipei 11:00: The file shows 32.302, the market actual is 32.435, a difference of 0.42%.
 *
 * The update rhythms of the two types of data are inherently different: the 259-day history changes once a day, and the quotes on the cards need to be new.
 * So take it apart - go through the history of Storage daily schedule, go here for quotations, and compare the three-tier cache with the current price.
 * (L1 front-end localStorage / L2 price_cache / L3 external API), users will not crawl if they do not open the page.
 *
 * **Use range-wise `chart?range=1d` instead of spark**: spark can get it all at once (1.4KB / 0.11 seconds)
 * Seems like a good deal, but its `close` is the same as `regularMarketPrice` **rounded to 3 significant figures** -
 * The Korean Won would become `0.0225` when it was actually `0.022462`. That's an error of 0.25%, and moving the mantissa one step is 0.44%,
 * The card shows 5 decimal places, which is pretending to be accurate. The immediate column of the chart gives full floating point numbers.
 * The price is very small: the measured total of 8 parallel files is 9.3KB, and the sequence run only takes 1.0 seconds, not to mention there is a 10-minute cache outside.
 *
 * **For currency pairs, always use `XXXTWD=X`** with "foreign currency first". The reverse (TWD in front) side has poor flow,
 * The real-time quotation is different from your own daily line - after conversion of the real-time price of the measured RMB `TWDCNY=X`
 * It was 4.47% higher than the day's daily line, while the other seven currencies only moved 0.4% on the same day.
 * (History is just the opposite: `CNYTWD=X` has no history, only `TWDCNY=X` has it. Both sides draw on their own strengths,
 * See FxSpec.symbols in stock-report/fxRates.ts. )
 */
const FX_CACHE_TTL_MS = 10 * 60 * 1000
/** Up to several currencies at a time. This is a public endpoint. The upper limit is used to prevent people from using it as modern tools. */
const FX_MAX_CODES = 12

interface ChartQuoteResp {
  chart?: {
    result?: Array<{
      meta?: { regularMarketTime?: number }
      timestamp?: number[]
      indicators?: { quote?: Array<{ close?: Array<number | null> }> }
    }> | null
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Get the "current quote" from the chart response.
 *
 * Prioritize the immediate column appended to the end by Yahoo (`timestamp` is equal to `meta.regularMarketTime`)——
 * It is a full precision floating point number. That column may not exist after the market closes, and the last valuable daily line is returned.
 */
function extractLiveQuote(
  resp: ChartQuoteResp,
): { price: number; asOf: string } | null {
  const r = resp?.chart?.result?.[0]
  const ts = r?.timestamp
  const cl = r?.indicators?.quote?.[0]?.close
  if (!Array.isArray(ts) || !Array.isArray(cl)) return null

  const live = num(r?.meta?.regularMarketTime)
  if (live !== null) {
    const i = ts.lastIndexOf(live)
    const c = i >= 0 ? num(cl[i]) : null
    if (c !== null && c > 0) return { price: c, asOf: new Date(live * 1000).toISOString() }
  }
  for (let i = cl.length - 1; i >= 0; i--) {
    const c = num(cl[i])
    if (c !== null && c > 0) return { price: c, asOf: new Date(ts[i] * 1000).toISOString() }
  }
  return null
}

async function handleFx(codes: unknown): Promise<Response> {
  // The currency code is passed in from the front end (it reads the list from fx/twd.json), and only the format and quantity are checked here——
  // Maintain a currency list in two independently deployed functions. Sooner or later, one side will miss the change.
  const wanted = Array.isArray(codes)
    ? [...new Set(codes.filter((c): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c)))]
        .slice(0, FX_MAX_CODES)
    : []
  if (wanted.length === 0) return json({ error: 'codes 需為 3 碼大寫幣別代號陣列' }, 400)

  const nowMs = Date.now()
  const quotes: Record<string, { price: number; asOf: string }> = {}

  // 1) First check the DB shared cache
  const freshAfter = new Date(nowMs - FX_CACHE_TTL_MS).toISOString()
  try {
    const { data } = await db
      .from('price_cache')
      .select('key, price, updated_at')
      .in('key', wanted.map((c) => `FX:${c}`))
      .gte('updated_at', freshAfter)
    for (const row of data ?? []) {
      const code = String(row.key).slice(3)
      const price = num(Number(row.price))
      if (price !== null && price > 0) quotes[code] = { price, asOf: row.updated_at }
    }
  } catch {
    // If the cache fails to read, it will be treated as a miss and the cache will be fetched as usual.
  }

  const missing = wanted.filter((c) => !quotes[c])

  // 2) Parallel capture of misses. Failure of a single currency does not affect the other seven (following syncMacro's guidelines)
  if (missing.length > 0) {
    const got = await Promise.all(
      missing.map(async (code) => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${code}TWD=X`)}?interval=1d&range=1d`,
            {
              headers: { Accept: 'application/json', 'User-Agent': UA },
              signal: AbortSignal.timeout(10_000),
            },
          )
          if (!res.ok) return null
          const q = extractLiveQuote(await res.json())
          return q ? ([code, q] as const) : null
        } catch {
          return null
        }
      }),
    )
    for (const entry of got) {
      if (entry) quotes[entry[0]] = entry[1]
    }
  }

  // 3) Newly captured write-back shared cache
  const fresh = missing.filter((c) => quotes[c])
  if (fresh.length > 0) {
    try {
      await db.from('price_cache').upsert(
        fresh.map((c) => ({ key: `FX:${c}`, price: quotes[c].price, updated_at: quotes[c].asOf })),
      )
    } catch {
      // Failure to write back does not affect this response
    }
  }

  return json({ quotes })
}

/**
 * Intraday chart bars for one symbol (Yahoo chart v8). No price_cache write — the series
 * is large and per-range, caching is the client's job (see intradayProxy.ts).
 */
async function handleIntraday(symbol: SymbolItem, range: IntradayRange): Promise<Response> {
  const interval = intradayInterval(range)
  const series = await tryYahooCandidates('intraday', yahooSymbols(symbol), async (yahooSymbol) => {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return null
    const data = await res.json()
    return parseYahooChart(data, range)
  })
  return json({ series })
}

/**
 * Long-range daily/monthly bars for `近 5 年` / `全部` on the 技術 tab (Route A, 0.9.41).
 * No price_cache write, same reasoning as handleIntraday: the series is per-range and
 * caching is the client's job (see dailyProxy.ts).
 */
async function handleDailyRange(symbol: SymbolItem, range: DailyRangeKey): Promise<Response> {
  const interval = dailyRangeInterval(range)
  const granularity = interval
  const rows = await tryYahooCandidates('daily', yahooSymbols(symbol), async (yahooSymbol) => {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const parsed = range === '5y' ? extractDaily(data) : extractMonthly(data)
    return parsed.length > 0 ? parsed : null
  })
  return json({ rows: rows ?? [], granularity })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // EP-02: defence in depth, not the primary gate. The platform's verify_jwt=true deploy
  // flag (see header comment) is what normally rejects an unauthenticated caller before this
  // code ever runs; this check only matters if the function is ever redeployed with
  // --no-verify-jwt by mistake. Token *contents* are the platform's job — only presence of a
  // bearer token is checked here, before any upstream fetch.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) {
    return json({ error: 'Missing bearer token' }, 401)
  }

  let body: {
    action?: string
    symbols?: SymbolItem[]
    query?: string
    codes?: string[]
    symbol?: SymbolItem
    range?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // A body of the literal JSON value `null` parses cleanly, so the catch above never sees it.
  // Without this gate `body.action` throws, and the outermost catch below throws a second time
  // reading the same `body.action` — that throw escapes Deno.serve and no response is sent at all.
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  try {
    if (body.action === 'prices' && Array.isArray(body.symbols)) {
      return await handlePrices(body.symbols)
    }
    if (body.action === 'search' && typeof body.query === 'string' && body.query.trim()) {
      return await handleSearch(body.query.trim())
    }
    // Real-time exchange rate quotation: The history of the trend chart is still written into Storage by the daily schedule of stock-report, and only "how much is now" is returned here.
    if (body.action === 'fx') {
      return await handleFx(body.codes)
    }

    if (body.action === 'twlist') {
      return await handleTwList()
    }
    if (body.action === 'intraday' && body.symbol && typeof body.symbol === 'object') {
      const range = body.range ?? '1d'
      if (range !== '1d' && range !== '5d') return json({ error: 'range 需為 1d 或 5d' }, 400)
      return await handleIntraday(body.symbol, range)
    }
    if (body.action === 'daily' && body.symbol && typeof body.symbol === 'object') {
      const range = body.range
      if (range !== '5y' && range !== 'max') return json({ error: 'range 需為 5y 或 max' }, 400)
      return await handleDailyRange(body.symbol, range)
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    await logEvent(db, {
      level: 'error',
      action: typeof body.action === 'string' ? body.action : 'stock-price',
      message: err instanceof Error ? err.message : String(err),
      detail: { stack: err instanceof Error ? err.stack : undefined },
    })
    return json({ error: 'Internal error' }, 500)
  }
})
