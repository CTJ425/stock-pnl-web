/**
 * TWSE daily turnover ranking → Top N tickers for batch warm / preheat.
 *
 * Source: OpenAPI `exchangeReport/STOCK_DAY_ALL` (same-day list after the session).
 * Ranking key: TradeValue (成交金額, TWD). ETFs and special codes are **kept** when they
 * rank high — product rule 0.6.46+: do not strip 00xx / letter-suffix products.
 *
 * Pure helpers only (unit-tested). Fetch + Storage live in index.ts.
 */

export interface StockDayAllRow {
  Date?: string
  Code?: string
  Name?: string
  TradeVolume?: string
  TradeValue?: string
  [key: string]: unknown
}

export interface TopTicker {
  ticker: string
  name: string
  rank: number
  /** Trade value in TWD (integer). */
  tradeValue: number
}

/** Same envelope as index TICKER_RE — 2–8 alphanumerics. */
const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

export const TOP_TICKERS_DEFAULT_N = 30

export function parseTradeValue(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  const s = String(raw ?? '')
    .replace(/,/g, '')
    .trim()
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/**
 * Rank STOCK_DAY_ALL rows by TradeValue desc and take the first `n`.
 * Zero / invalid trade value rows sink to the bottom and are usually dropped by the slice.
 */
export function rankTopByTradeValue(
  rows: readonly StockDayAllRow[],
  n = TOP_TICKERS_DEFAULT_N,
): TopTicker[] {
  if (!Array.isArray(rows) || n <= 0) return []

  const parsed: Array<{ ticker: string; name: string; tradeValue: number }> = []
  for (const row of rows) {
    const ticker = String(row.Code ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    parsed.push({
      ticker,
      name: String(row.Name ?? '').trim(),
      tradeValue: parseTradeValue(row.TradeValue),
    })
  }

  parsed.sort((a, b) => {
    if (b.tradeValue !== a.tradeValue) return b.tradeValue - a.tradeValue
    return a.ticker.localeCompare(b.ticker)
  })

  return parsed.slice(0, n).map((r, i) => ({
    ticker: r.ticker,
    name: r.name,
    rank: i + 1,
    tradeValue: r.tradeValue,
  }))
}

/** Storage path for the latest ranked snapshot (written by the batch). */
export const TOP_TICKERS_STORAGE_PATH = 'meta/top_tickers.json'

export const TOP_TICKERS_SCHEMA = 1

export interface TopTickersFile {
  schema: typeof TOP_TICKERS_SCHEMA
  /** ROC or ISO-ish date string from the source row, if any. */
  sourceDate: string | null
  /** ISO timestamp when we wrote the file. */
  asOf: string
  n: number
  tickers: TopTicker[]
}

export function buildTopTickersFile(opts: {
  sourceDate: string | null
  asOf?: string
  tickers: TopTicker[]
}): TopTickersFile {
  return {
    schema: TOP_TICKERS_SCHEMA,
    sourceDate: opts.sourceDate,
    asOf: opts.asOf ?? new Date().toISOString(),
    n: opts.tickers.length,
    tickers: opts.tickers,
  }
}
