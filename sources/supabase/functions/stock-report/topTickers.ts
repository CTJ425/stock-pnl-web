/**
 * TWSE daily volume ranking → Top N tickers for batch warm / preheat.
 *
 * Source (0.6.51): OpenAPI `exchangeReport/MI_INDEX20` — same table as the official
 * page「每日成交量前二十名證券」(mi-stock20.html, data-api `/afterTrading/MI_INDEX20`).
 * Ranking key: **TradeVolume** (成交股數). Official Rank field is preferred when present.
 * ETFs / leveraged products are kept when they appear (no strip of 00xx / letter codes).
 *
 * Retention: at most **two** snapshots (today + previous). Pure helpers — fetch + Storage in index.ts.
 */

/** MI_INDEX20 row (OpenAPI). Also accepts legacy STOCK_DAY_ALL field names for tests. */
export interface StockDayAllRow {
  Date?: string
  Rank?: string
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
  /**
   * Metric shown in the list: for MI_INDEX20 this is **share volume** (股).
   * Field name kept for Storage / UI compatibility with older top_tickers.json.
   */
  tradeValue: number
}

/** Same envelope as index TICKER_RE — 2–8 alphanumerics. */
const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

/** Official MI_INDEX20 list length. */
export const TOP_TICKERS_DEFAULT_N = 20

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
 * TWSE STOCK_DAY_ALL `Date` is usually ROC 7-digit (`1150807` → calendar `20260807`).
 * Also accepts `YYYYMMDD` / `YYYY-MM-DD`. Returns null when unparseable.
 * Snapshot `ymd` must be this trading day — not the Taipei write clock — so UI
 * 「資料日」 matches the ranking session and never looks like “Mon write of Fri bars”.
 */
export function tradingYmdFromSource(sourceDate: string | null | undefined): string | null {
  const s = String(sourceDate ?? '').trim()
  if (!s) return null
  if (/^\d{7}$/.test(s)) {
    const year = Number(s.slice(0, 3)) + 1911
    const mm = s.slice(3, 5)
    const dd = s.slice(5, 7)
    if (year < 1912 || year > 2100) return null
    return `${year}${mm}${dd}`
  }
  if (/^\d{8}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '')
  return null
}

/**
 * Rank rows by **share volume** (TradeVolume). Prefer official `Rank` when present
 * (MI_INDEX20). Falls back to sorting by volume desc (legacy STOCK_DAY_ALL-shaped rows
 * that only had TradeValue still work if you pass that field via parseTradeValue on volume).
 */
export function rankTopByTradeValue(
  rows: readonly StockDayAllRow[],
  n = TOP_TICKERS_DEFAULT_N,
): TopTicker[] {
  if (!Array.isArray(rows) || n <= 0) return []

  const parsed: Array<{
    ticker: string
    name: string
    tradeValue: number
    officialRank: number | null
  }> = []
  for (const row of rows) {
    const ticker = String(row.Code ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    // MI_INDEX20: TradeVolume (shares). Legacy fallback: TradeValue if volume missing.
    const volume = parseTradeValue(row.TradeVolume)
    const metric = volume > 0 ? volume : parseTradeValue(row.TradeValue)
    const rankRaw = Number(String(row.Rank ?? '').replace(/,/g, '').trim())
    parsed.push({
      ticker,
      name: String(row.Name ?? '').trim(),
      tradeValue: metric,
      officialRank: Number.isFinite(rankRaw) && rankRaw > 0 ? rankRaw : null,
    })
  }

  parsed.sort((a, b) => {
    if (a.officialRank != null && b.officialRank != null && a.officialRank !== b.officialRank) {
      return a.officialRank - b.officialRank
    }
    if (b.tradeValue !== a.tradeValue) return b.tradeValue - a.tradeValue
    return a.ticker.localeCompare(b.ticker)
  })

  return parsed.slice(0, n).map((r, i) => ({
    ticker: r.ticker,
    name: r.name,
    rank: r.officialRank ?? i + 1,
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

/**
 * Re-key each day by TWSE session (sourceDate) so a write-clock ymd cannot sit
 * beside the same ranking as a "newer" snapshot (e.g. Mon write of Fri bars).
 */
export function rekeyTopTickersArchive(file: TopTickersFile | null): TopTickersFile | null {
  if (!file?.days?.length) return file
  let acc: TopTickersFile | null = null
  // Oldest first (asOf, then ymd) so the newest write of the same trading day wins.
  const ordered = [...file.days].sort((a, b) => {
    const aa = a.asOf || ''
    const bb = b.asOf || ''
    if (aa && bb && aa !== bb) return aa.localeCompare(bb)
    return a.ymd.localeCompare(b.ymd)
  })
  for (const d of ordered) {
    const ymd = tradingYmdFromSource(d.sourceDate) ?? d.ymd
    acc = mergeTopTickersArchive(acc, { ...d, ymd })
  }
  return acc
}

/** Accept v1 or v2 on-disk shapes. */
export function normalizeTopTickersFile(raw: unknown): TopTickersFile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as TopTickersFile & TopTickersFileV1
  if (Array.isArray(o.days) && o.days.length > 0) {
    const days: TopTickersDay[] = []
    for (const d of o.days) {
      if (!d || typeof d !== 'object') continue
      const ymdRaw = String((d as TopTickersDay).ymd ?? '').trim()
      const sourceDate =
        (d as TopTickersDay).sourceDate == null
          ? null
          : String((d as TopTickersDay).sourceDate)
      const ymd = tradingYmdFromSource(sourceDate) ?? ymdRaw
      const tickers = Array.isArray((d as TopTickersDay).tickers)
        ? (d as TopTickersDay).tickers
        : []
      if (!/^\d{8}$/.test(ymd) || tickers.length === 0) continue
      days.push({
        ymd,
        sourceDate,
        asOf: String((d as TopTickersDay).asOf ?? ''),
        tickers,
      })
    }
    if (days.length === 0) return null
    // Collapse same trading-day keys (write-clock vs source).
    return rekeyTopTickersArchive({ schema: TOP_TICKERS_SCHEMA, days })
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
