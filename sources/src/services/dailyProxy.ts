/**
 * Daily OHLCV: Read the post-market schedule and `daily/{ticker}.json` stored in the public `reports` bucket.
 *
 * There is no fallback for "click and buy". This is intentional: the daily line only serves the individual stock analysis page, and the drop-down menu on this page
 * Originally, only the user's Taiwan stock holdings were listed - those codes were the list that would be covered by the night batch `generate-all`.
 * Finding no files means that the batch has not been run yet, and the UI displays "it will be automatically added later" which is healthier than opening an additional public endpoint.
 *
 * This file is of type **Web Interface Contract** and must be consistent with sources/supabase/functions/stock-report/twDaily.ts
 * DailyFile alignment.
 */
import { downloadReportsJson } from './reportsBucket'
import { isSupabaseConfigured, supabase } from './supabase'

/** A daily line: [Trading day, opening, high, low, closing, volume]*/
export type DailyRow = [string, number, number, number, number, number]

export interface DailySeries {
  ticker: string
  /** The time we actually caught it ISO*/
  asOf: string
  /** The latest trading day YYYY-MM-DD*/
  lastDate: string
  /** From old to new*/
  rows: DailyRow[]
}

/**
 * The **lowest** daily structure version recognized by the front end.
 *
 * It must be ">=" instead of "===": the server will upgrade the schema every time it adds a field to the file, and adding new fields will affect the old front-end.
 * It's a harmless addition. If you use the equal sign, once the backend version is upgraded, all technical paging will be suspended on the spot——
 * This is exactly what happened with the chip reporting in 0.4.0 (see MIN_REPORT_SCHEMA in reportProxy.ts).
 */
export const MIN_DAILY_SCHEMA = 1

interface StoredDaily {
  schema?: number
  ticker?: string
  asOf?: string
  lastDate?: string
  rows?: unknown
}

function isValidRow(r: unknown): r is DailyRow {
  return (
    Array.isArray(r) &&
    r.length === 6 &&
    typeof r[0] === 'string' &&
    r.slice(1).every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function isSupported(d: unknown): d is Required<StoredDaily> {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredDaily
  return typeof f.schema === 'number' && f.schema >= MIN_DAILY_SCHEMA && Array.isArray(f.rows)
}

/** Read the daily series of a certain file; search for none / format does not match / no valid data and return null*/
export async function fetchDailySeries(ticker: string): Promise<DailySeries | null> {
  const stored = await downloadReportsJson<StoredDaily>(`daily/${ticker}.json`)
  if (!isSupported(stored)) return null

  const rows = (stored.rows as unknown[]).filter(isValidRow)
  if (rows.length === 0) return null

  return {
    ticker: typeof stored.ticker === 'string' ? stored.ticker : ticker,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    lastDate: typeof stored.lastDate === 'string' ? stored.lastDate : rows[rows.length - 1][0],
    rows,
  }
}

/**
 * Long-range daily/monthly bars for `近 5 年` / `全部` on the 技術 tab (Route A, 0.9.41).
 * These two ranges are not in daily/{ticker}.json and are fetched from the stock-price
 * Edge Function's `daily` action on demand. Cached in memory only (module-level, TTL
 * 5 minutes — this data changes once per trading day, unlike intraday's 60s).
 *
 * Assumption: the daily K chart serves Taiwan stocks only, because daily/{ticker}.json
 * is written by the Taiwan nightly batch.
 */
export type RemoteDailyRange = '5y' | 'max'

export interface RemoteDaily {
  rows: DailyRow[]
  granularity: '1d' | '1mo'
  /**
   * The ticker this batch belongs to and when it was actually captured (DT-01, optional so
   * the existing `{ rows, granularity }` fixtures elsewhere keep type-checking). Lets a
   * caller that re-uses this series across ticker switches (QuoteTab) verify it still
   * matches what is on screen, and show a 「快取於」badge for a hit served from
   * `remoteCache` instead of a fresh Edge call.
   */
  ticker?: string
  fetchedAt?: string
}

interface RemoteCacheEntry {
  daily: RemoteDaily
  at: number
}

const REMOTE_CACHE_TTL_MS = 300_000

/** PR-03: bound the in-memory cache so a long session paging many tickers/ranges cannot grow it without limit. */
const REMOTE_CACHE_MAX_ENTRIES = 200

const remoteCache = new Map<string, RemoteCacheEntry>()

/** Evict the oldest entry once the cache exceeds its bound (simple LRU, PR-03). */
function capRemoteCache(): void {
  while (remoteCache.size > REMOTE_CACHE_MAX_ENTRIES) {
    const oldest = remoteCache.keys().next().value
    if (oldest === undefined) break
    remoteCache.delete(oldest)
  }
}

interface EdgeDailyResponse {
  rows?: unknown
  granularity?: '1d' | '1mo'
}

export async function fetchRemoteDaily(
  ticker: string,
  range: RemoteDailyRange,
  market: 'TPE' | 'US' | 'IDX' = 'TPE',
): Promise<RemoteDaily | null> {
  const key = `${market}:${ticker}:${range}`
  const now = Date.now()
  const cached = remoteCache.get(key)
  if (cached && now - cached.at < REMOTE_CACHE_TTL_MS) {
    return { ...cached.daily, ticker, fetchedAt: new Date(cached.at).toISOString() }
  }

  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke<EdgeDailyResponse>('stock-price', {
      body: { action: 'daily', symbol: { market, ticker }, range },
      timeout: 15_000,
    })
    if (error || !data) return null

    const rows = Array.isArray(data.rows) ? data.rows.filter(isValidRow) : []
    if (rows.length === 0) return null

    // Only a success is cached. Caching the failure would lock the ticker out for the whole
    // TTL: a network blip would make every re-click of 近 5 年 replay the cached null for
    // five minutes without ever trying again, while the user is actively retrying.
    const daily: RemoteDaily = { rows, granularity: data.granularity ?? '1d' }
    remoteCache.set(key, { daily, at: now })
    capRemoteCache()
    return { ...daily, ticker, fetchedAt: new Date(now).toISOString() }
  } catch {
    return null
  }
}
