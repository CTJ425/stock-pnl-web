/**
 * TOP20 volume rank (TWSE MI_INDEX20 / mi-stock20.html).
 * 1) Read public `meta/top_tickers.json` (today + previous snapshot).
 * 2) If missing/empty, invoke Edge `ensure-top-tickers` (logged-in) to fetch MI_INDEX20.
 * `tradeValue` on rows holds **share volume** (股) after 0.6.51.
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
    // Collapse write-clock vs trading-day keys that share the same TWSE session.
    const byTrade = new Map<string, TopTickersDayView>()
    for (const d of raw.days) {
      const parsed = parseDay(d)
      if (!parsed) continue
      const key = displayTopDayYmd(parsed)
      const prev = byTrade.get(key)
      if (!prev || (parsed.asOf || '') >= (prev.asOf || '')) {
        byTrade.set(key, { ...parsed, ymd: key })
      }
    }
    const days = [...byTrade.values()].sort((a, b) => b.ymd.localeCompare(a.ymd)).slice(0, 2)
    if (days.length === 0) return null
    return { days, latest: days[0] ?? null }
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

/**
 * Trading-session day for display: prefer TWSE sourceDate (ROC 7-digit or AD),
 * else archive ymd. Keeps 「資料日」 aligned with the ranking session even if an
 * older snapshot stored write-clock ymd.
 */
export function displayTopDayYmd(day: Pick<TopTickersDayView, 'ymd' | 'sourceDate'>): string {
  const src = String(day.sourceDate ?? '').trim()
  if (/^\d{7}$/.test(src)) {
    const year = Number(src.slice(0, 3)) + 1911
    return `${year}${src.slice(3, 5)}${src.slice(5, 7)}`
  }
  if (/^\d{8}$/.test(src)) return src
  if (/^\d{4}-\d{2}-\d{2}$/.test(src)) return src.replace(/-/g, '')
  return day.ymd
}

/** Legacy trade value TWD → e.g. 579.5 億 (pre–MI_INDEX20). */
export function formatTradeValueYi(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  const yi = v / 1e8
  if (yi >= 100) return `${yi.toFixed(0)} 億`
  if (yi >= 10) return `${yi.toFixed(1)} 億`
  return `${yi.toFixed(2)} 億`
}

/** Share volume (股) → 張 for TOP20 list (MI_INDEX20 TradeVolume). */
export function formatVolumeLots(shares: number): string {
  if (!Number.isFinite(shares) || shares <= 0) return '—'
  const lots = Math.round(shares / 1000)
  return `${lots.toLocaleString('en-US')} 張`
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
 * Prefer Storage; if empty, ask Edge to pull the latest MI_INDEX20 ranking (writes archive).
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
