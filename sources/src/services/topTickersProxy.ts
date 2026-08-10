/**
 * TOP30 (trade-value rank, official TWSE codes, ETFs included).
 * 1) Read public `meta/top_tickers.json` (today + previous snapshot).
 * 2) If missing/empty, invoke Edge `ensure-top-tickers` (logged-in) to fetch last available
 *    STOCK_DAY_ALL ranking and write Storage so the UI is never stuck empty.
 */
import { downloadReportsJson } from './reportsBucket'
import { supabase } from './supabase'

export interface TopTickerRow {
  ticker: string
  name: string
  rank: number
  tradeValue: number
}

export interface TopTickersDayView {
  ymd: string
  sourceDate: string | null
  asOf: string
  tickers: TopTickerRow[]
}

export interface TopTickersData {
  days: TopTickersDayView[]
  /** Newest day (or only day). */
  latest: TopTickersDayView | null
  /** True when data came from ensure-top-tickers refresh this call. */
  fromEnsure?: boolean
}

function parseDay(raw: unknown): TopTickersDayView | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const ymd = String(d.ymd ?? '').trim()
  if (!/^\d{8}$/.test(ymd)) return null
  const tickersIn = Array.isArray(d.tickers) ? d.tickers : []
  const tickers: TopTickerRow[] = []
  for (const t of tickersIn) {
    if (!t || typeof t !== 'object') continue
    const row = t as Record<string, unknown>
    const ticker = String(row.ticker ?? '').trim()
    if (!ticker) continue
    tickers.push({
      ticker,
      name: String(row.name ?? '').trim(),
      rank: typeof row.rank === 'number' ? row.rank : tickers.length + 1,
      tradeValue: typeof row.tradeValue === 'number' ? row.tradeValue : 0,
    })
  }
  if (tickers.length === 0) return null
  return {
    ymd,
    sourceDate: d.sourceDate == null ? null : String(d.sourceDate),
    asOf: String(d.asOf ?? ''),
    tickers,
  }
}

function parseTopTickersPayload(raw: Record<string, unknown> | null | undefined): TopTickersData | null {
  if (!raw) return null

  if (Array.isArray(raw.days)) {
    const days: TopTickersDayView[] = []
    for (const d of raw.days) {
      const parsed = parseDay(d)
      if (parsed) days.push(parsed)
    }
    days.sort((a, b) => b.ymd.localeCompare(a.ymd))
    const slim = days.slice(0, 2)
    if (slim.length === 0) return null
    return { days: slim, latest: slim[0] ?? null }
  }

  // schema 1 fallback
  if (!Array.isArray(raw.tickers)) return null
  let ymd = '19700101'
  if (typeof raw.asOf === 'string' && raw.asOf) {
    try {
      const d = new Date(raw.asOf)
      const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
      const p = (n: number) => String(n).padStart(2, '0')
      ymd = `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`
    } catch {
      /* keep */
    }
  }
  const day = parseDay({
    ymd,
    sourceDate: raw.sourceDate,
    asOf: raw.asOf,
    tickers: raw.tickers,
  })
  if (!day) return null
  return { days: [day], latest: day }
}

/** Format YYYYMMDD → YYYY-MM-DD for UI. */
export function formatTopYmd(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

/** Trade value TWD → e.g. 579.5 億 */
export function formatTradeValueYi(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  const yi = v / 1e8
  if (yi >= 100) return `${yi.toFixed(0)} 億`
  if (yi >= 10) return `${yi.toFixed(1)} 億`
  return `${yi.toFixed(2)} 億`
}

async function readTopTickersFromStorage(): Promise<TopTickersData | null> {
  const raw = await downloadReportsJson<Record<string, unknown>>('meta/top_tickers.json')
  return parseTopTickersPayload(raw)
}

/** Logged-in Edge ensure: return archive; may pull TWSE when Storage empty. */
async function ensureTopTickersFromEdge(): Promise<TopTickersData | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'ensure-top-tickers' },
    })
    if (error || !data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>
    const file = d.file
    if (!file || typeof file !== 'object') return null
    const parsed = parseTopTickersPayload(file as Record<string, unknown>)
    if (!parsed) return null
    return { ...parsed, fromEnsure: d.refreshed === true }
  } catch {
    return null
  }
}

/**
 * Prefer Storage; if empty, ask Edge to pull the latest STOCK_DAY_ALL ranking (writes archive).
 * @param forceEnsure when true, try Edge first then fall back to Storage (never drop a good cache
 *   just because ensure failed — e.g. Edge not deployed / not logged in).
 */
export async function fetchTopTickers(opts?: { forceEnsure?: boolean }): Promise<TopTickersData | null> {
  if (opts?.forceEnsure === true) {
    const fromEdge = await ensureTopTickersFromEdge()
    if (fromEdge) return fromEdge
    return readTopTickersFromStorage()
  }

  const fromStorage = await readTopTickersFromStorage()
  if (fromStorage) return fromStorage
  return ensureTopTickersFromEdge()
}
