/**
 * TWSE daily turnover ranking → Top N tickers for batch warm / preheat.
 *
 * Source: OpenAPI `exchangeReport/STOCK_DAY_ALL` (same-day list after the session).
 * Ranking key: TradeValue (成交金額, TWD). ETFs and special codes are **kept** when they
 * rank high — product rule 0.6.46+: do not strip 00xx / letter-suffix products.
 *
 * Retention (0.6.46-dev.8): at most **two** calendar snapshots (today + previous), so Monday
 * before a new rank still shows Friday. Pure helpers only — fetch + Storage live in index.ts.
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

/** Keep newest + previous only (e.g. Mon before refresh → Fri still present). */
export const TOP_TICKERS_MAX_DAYS = 2

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

/** Storage path for the ranked snapshot (written by the batch). */
export const TOP_TICKERS_STORAGE_PATH = 'meta/top_tickers.json'

export const TOP_TICKERS_SCHEMA = 2

export interface TopTickersDay {
  /** Taipei calendar day we wrote this snapshot (YYYYMMDD). */
  ymd: string
  /** ROC or ISO-ish date string from the source row, if any. */
  sourceDate: string | null
  /** ISO timestamp when we wrote this day. */
  asOf: string
  tickers: TopTicker[]
}

export interface TopTickersFile {
  schema: typeof TOP_TICKERS_SCHEMA
  /** Newest first; length ≤ TOP_TICKERS_MAX_DAYS. */
  days: TopTickersDay[]
}

/** Legacy v1 single-snapshot file (pre-archive). */
interface TopTickersFileV1 {
  schema?: 1
  sourceDate?: string | null
  asOf?: string
  n?: number
  tickers?: TopTicker[]
}

export function buildTopTickersDay(opts: {
  ymd: string
  sourceDate: string | null
  asOf?: string
  tickers: TopTicker[]
}): TopTickersDay {
  return {
    ymd: opts.ymd,
    sourceDate: opts.sourceDate,
    asOf: opts.asOf ?? new Date().toISOString(),
    tickers: opts.tickers,
  }
}

/**
 * Insert or replace a day snapshot; keep only the newest TOP_TICKERS_MAX_DAYS days.
 * Same `ymd` replaces that day in place (re-rank same Taipei day).
 */
export function mergeTopTickersArchive(
  existing: TopTickersFile | null,
  day: TopTickersDay,
  maxDays = TOP_TICKERS_MAX_DAYS,
): TopTickersFile {
  const prev = existing?.days ?? []
  const without = prev.filter((d) => d.ymd !== day.ymd)
  const days = [day, ...without]
    .sort((a, b) => b.ymd.localeCompare(a.ymd))
    .slice(0, Math.max(1, maxDays))
  return { schema: TOP_TICKERS_SCHEMA, days }
}

/** Accept v1 or v2 on-disk shapes. */
export function normalizeTopTickersFile(raw: unknown): TopTickersFile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as TopTickersFile & TopTickersFileV1
  if (Array.isArray(o.days) && o.days.length > 0) {
    const days: TopTickersDay[] = []
    for (const d of o.days) {
      if (!d || typeof d !== 'object') continue
      const ymd = String((d as TopTickersDay).ymd ?? '').trim()
      const tickers = Array.isArray((d as TopTickersDay).tickers)
        ? (d as TopTickersDay).tickers
        : []
      if (!/^\d{8}$/.test(ymd) || tickers.length === 0) continue
      days.push({
        ymd,
        sourceDate:
          (d as TopTickersDay).sourceDate == null
            ? null
            : String((d as TopTickersDay).sourceDate),
        asOf: String((d as TopTickersDay).asOf ?? ''),
        tickers,
      })
    }
    if (days.length === 0) return null
    days.sort((a, b) => b.ymd.localeCompare(a.ymd))
    return { schema: TOP_TICKERS_SCHEMA, days: days.slice(0, TOP_TICKERS_MAX_DAYS) }
  }
  // v1: single list → one synthetic day from asOf if possible
  if (Array.isArray(o.tickers) && o.tickers.length > 0) {
    let ymd = ''
    if (typeof o.asOf === 'string' && o.asOf) {
      try {
        const d = new Date(o.asOf)
        const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
        const p = (n: number) => String(n).padStart(2, '0')
        ymd = `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`
      } catch {
        ymd = ''
      }
    }
    if (!/^\d{8}$/.test(ymd)) ymd = '19700101'
    return {
      schema: TOP_TICKERS_SCHEMA,
      days: [
        {
          ymd,
          sourceDate: o.sourceDate ?? null,
          asOf: o.asOf ?? '',
          tickers: o.tickers,
        },
      ],
    }
  }
  return null
}

export function latestTopTickers(file: TopTickersFile | null): TopTicker[] {
  return file?.days?.[0]?.tickers ?? []
}
