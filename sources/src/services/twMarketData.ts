/**
 * Full list of Taiwan stocks (listed + OTC): code, name and latest closing price.
 *
 * Data source (the official endpoints do not open CORS and cannot be directly connected by the browser):
 * - Listing: TWSE STOCK_DAY_ALL open_data CSV (daily closing price; BUG-120, see _shared/twseList.ts)
 * - Listing: TPEx openapi tpex_mainboard_quotes (same source as the original GAS version getOtcList_)
 *
 * Development mode: Proxy via Vite dev server (/api/twse-www, /api/tpex of vite.config.ts), Edge second.
 * Formal environment: the twlist action of Supabase Edge Function `stock-price` only. A direct
 * fetch there always failed on CORS (every app_log entry was `TypeError: Failed to fetch`), so
 * it is no longer tried (BUG-120).
 *
 * The list is cached in localStorage (TTL 30 minutes), and is also available for "name fuzzy search/code reverse search"
 * Use with "Taiwan Stock Current Price Reserve". When every source fails, the cached list of any
 * age is used rather than none (BUG-120).
 */
import { isSupabaseConfigured, supabase } from './supabase'
import { logClient } from './appLog'
import { parseStockDayAllCsv, TWSE_STOCK_DAY_ALL_URL } from '../../supabase/functions/_shared/twseList.ts'

const DEV = import.meta.env.DEV
// Direct fetches run in development only, through the Vite proxy.
const TWSE_URL = TWSE_STOCK_DAY_ALL_URL.replace('https://www.twse.com.tw', '/api/twse-www')
const TPEX_URL = '/api/tpex/openapi/v1/tpex_mainboard_quotes'

export interface TwStockRow {
  symbol: string
  name: string
  /** Most recent closing price; null if source is missing*/
  close: number | null
}

const CACHE_KEY = 'stock-pnl-web/tw-list-v2'
const CACHE_TTL_MS = 30 * 60 * 1000

interface CacheShape {
  at: number
  rows: TwStockRow[]
}

/** `allowStale` skips the TTL: the last-resort read when every source failed (BUG-120). */
function readCache(allowStale = false): TwStockRow[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheShape
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null
    if (!allowStale && Date.now() - parsed.at > CACHE_TTL_MS) return null
    return parsed.rows
  } catch (err) {
    logClient('warn', 'readCache', err instanceof Error ? err.message : String(err), {})
    return null
  }
}

function writeCache(rows: TwStockRow[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows } satisfies CacheShape))
  } catch (err) {
    logClient('warn', 'writeCache', err instanceof Error ? err.message : String(err), {})
    // If the capacity exceeds the capacity, the cache will be abandoned directly, and the functions will not be affected.
  }
}

/**
 * Official short names (symbol → name) from the last full list seen (BUG-109). A holding used to be
 * labelled with the newest transaction's name, so a broker export's spelling (玉山's 「台灣５０」 for
 * 0050) or an older name replaced the stock's real name whenever its row became the newest. Labels
 * now come from this map, and the transaction's own name is only the fallback for a code the list
 * does not carry (興櫃, delisted). Seeded from the cached list even past its TTL: a name outlives the
 * 30-minute price freshness the TTL is for.
 */
let officialNames: Map<string, string> = seedOfficialNames()
let namesVersion = 0
const nameListeners = new Set<() => void>()

function seedOfficialNames(): Map<string, string> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CACHE_KEY)
    const rows = raw ? (JSON.parse(raw) as CacheShape).rows : null
    return Array.isArray(rows) ? new Map(rows.map((r) => [r.symbol, r.name])) : new Map()
  } catch (err) {
    logClient('warn', 'seedOfficialNames', err instanceof Error ? err.message : String(err), {})
    return new Map()
  }
}

/** Replaces the official names and tells subscribers; called with every freshly fetched list. */
export function rememberTwNames(rows: TwStockRow[]): void {
  officialNames = new Map(rows.map((r) => [r.symbol, r.name]))
  namesVersion += 1
  for (const listener of nameListeners) listener()
}

/** The exchange's short name for a TW code, or undefined when the list does not carry it. */
export function twOfficialName(ticker: string): string | undefined {
  return officialNames.get(ticker.trim().toUpperCase())
}

/** `useSyncExternalStore` pair: a component re-renders once the names arrive. */
export function subscribeTwNames(listener: () => void): () => void {
  nameListeners.add(listener)
  return () => {
    nameListeners.delete(listener)
  }
}

export function twNamesVersion(): number {
  return namesVersion
}

function toNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function fetchTwse(): Promise<TwStockRow[]> {
  const res = await fetch(TWSE_URL, {
    headers: { Accept: 'text/csv' },
  })
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`)
  return parseStockDayAllCsv(await res.text()).map((r) => ({
    symbol: r.Code,
    name: r.Name,
    close: toNumber(r.ClosingPrice),
  }))
}

async function fetchTpex(): Promise<TwStockRow[]> {
  const res = await fetch(TPEX_URL, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`TPEx HTTP ${res.status}`)
  const arr = (await res.json()) as Array<Record<string, unknown>>
  return arr
    .map((r) => ({
      symbol: String(r.SecuritiesCompanyCode ?? r.Code ?? '').trim(),
      name: String(r.CompanyName ?? r.Name ?? '').trim(),
      close: toNumber(r.Close ?? r.ClosingPrice ?? r.LatestPrice),
    }))
    .filter((r) => r.symbol && r.name)
}

/** Direct connection (development mode via dev proxy only; the formal environment fails on CORS)*/
async function fetchDirect(): Promise<TwStockRow[]> {
  const results = await Promise.allSettled([fetchTwse(), fetchTpex()])
  // A half list is worse than none: it caches for 30 minutes, and every stock from the dead
  // source then reads as "no such stock". Fail the attempt so the fallback chain runs instead.
  // An HTTP 200 carrying an empty array is the same failure wearing a success code.
  const failure = results.find((r) => r.status === 'rejected' || r.value.length === 0)
  if (failure) {
    const reason = failure.status === 'rejected' ? String(failure.reason) : 'source returned an empty list'
    logClient('error', 'fetchDirect', reason, {})
    return []
  }
  const rows: TwStockRow[] = []
  const seen = new Set<string>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const row of r.value) {
      if (seen.has(row.symbol)) continue
      seen.add(row.symbol)
      rows.push(row)
    }
  }
  return rows
}

interface EdgeTwListResponse {
  rows?: Array<{ symbol?: unknown; name?: unknown; close?: unknown }>
  /** Set by the Edge when a live refresh failed and it served its stored copy (BUG-120). */
  stale?: boolean
}

/** A loaded list; `stale` means it is older than its TTL and its `close` is not today's price. */
interface ListLoad {
  rows: TwStockRow[]
  stale: boolean
}

/** Proxy via Supabase Edge Function (main path to the official environment); null on failure */
async function fetchViaEdge(): Promise<ListLoad | null> {
  if (!isSupabaseConfigured || !supabase) return null
  try {
    const { data, error, response } = await supabase.functions.invoke<EdgeTwListResponse>(
      'stock-price',
      {
        body: { action: 'twlist' },
        // BUG-120: a cache miss can spend 3 s on Storage, 8 s on STOCK_DAY_ALL and 12 s on the OpenAPI.
        timeout: 30_000,
      },
    )
    if (error || !Array.isArray(data?.rows)) {
      // Read the body only while it is still there. functions-js already consumed it on a 2xx,
      // and a second read throws. No inner try/catch: a throw falls to the catch below, which
      // logs too, and this file's every catch must record (see catchLogging.test.ts).
      const body = response && !response.bodyUsed ? (await response.text()).slice(0, 300) : ''
      const head = error ? (error instanceof Error ? error.message : String(error)) : 'rows 非陣列'
      const parts = [head, response ? `HTTP ${response.status}` : '', body]
      logClient('error', 'fetchViaEdge', parts.filter((p) => p).join(' · '), {})
      return null
    }
    const rows = data.rows
      .map((r) => ({
        symbol: String(r.symbol ?? '').trim(),
        name: String(r.name ?? '').trim(),
        close: typeof r.close === 'number' && r.close > 0 ? r.close : null,
      }))
      .filter((r) => r.symbol && r.name)
    return rows.length > 0 ? { rows, stale: data.stale === true } : null
  } catch (err) {
    logClient('error', 'fetchViaEdge', err instanceof Error ? err.message : String(err), {})
    return null
  }
}

/**
 * An outdated list served after a failed load is held this long, so a dead network costs one slow
 * attempt (up to the 30 s invoke timeout) per window instead of one per search keystroke.
 */
const STALE_HOLD_MS = 5 * 60 * 1000
let staleHeld: { rows: TwStockRow[]; until: number } | null = null

let inflight: Promise<ListLoad> | null = null

function holdStale(rows: TwStockRow[]): ListLoad {
  staleHeld = { rows, until: Date.now() + STALE_HOLD_MS }
  return { rows, stale: true }
}

async function loadTwStockList(): Promise<ListLoad> {
  const cached = readCache()
  if (cached) return { rows: cached, stale: false }
  if (staleHeld && Date.now() < staleHeld.until) return { rows: staleHeld.rows, stale: true }
  if (inflight) return inflight

  inflight = (async (): Promise<ListLoad> => {
    // Development: dev proxy first, Edge second. Formal environment: Edge only (BUG-120).
    let load: ListLoad | null = null
    if (DEV) {
      const rows = await fetchDirect()
      if (rows.length > 0) load = { rows, stale: false }
    }
    load ??= await fetchViaEdge()
    if (load && !load.stale) {
      staleHeld = null
      writeCache(load.rows)
      rememberTwNames(load.rows)
      return load
    }
    // The Edge's stored copy: usable for names and search, but never written to localStorage —
    // that would re-stamp an old list as fresh for 30 minutes.
    if (load) {
      rememberTwNames(load.rows)
      return holdStale(load.rows)
    }
    const local = readCache(true)
    if (local) {
      logClient('warn', 'getTwStockList', '台股清單即時載入失敗，改用過期的本機快取', { count: local.length })
      return holdStale(local)
    }
    throw new Error('台股清單載入失敗（Edge Function 無回應，且沒有本機快取）')
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export interface TwStockListOptions {
  /**
   * `false` rejects instead of returning an outdated list (BUG-120). Set it wherever `close` is used
   * as a current price: an outdated close must fall to the caller's own stale handling, not pass as fresh.
   */
  allowStale?: boolean
}

/** Get the full list of Taiwan stocks (memory deduplication + localStorage cache; outdated list as the last resort)*/
export async function getTwStockList(opts: TwStockListOptions = {}): Promise<TwStockRow[]> {
  const { rows, stale } = await loadTwStockList()
  if (stale && opts.allowStale === false) throw new Error('台股清單只有過期資料，不能當作現價')
  return rows
}
