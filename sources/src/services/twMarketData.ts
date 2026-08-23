/**
 * Full list of Taiwan stocks (listed + OTC): code, name and latest closing price.
 *
 * Data source (the official OpenAPI does not open CORS and cannot be directly connected by the browser):
 * - Listing: TWSE openapi STOCK_DAY_AVG_ALL (daily closing price)
 * - Listing: TPEx openapi tpex_mainboard_quotes (same source as the original GAS version getOtcList_)
 *
 * Development mode: Proxy via Vite dev server (/api/twse, /api/tpex of vite.config.ts).
 * Formal environment: First pass the twlist action proxy of Supabase Edge Function `stock-price`
 * (The official endpoint does not open CORS, and direct connection will fail). Direct connection will be attempted only when Edge is unavailable.
 *
 * The list is cached in localStorage (TTL 30 minutes), and is also available for "name fuzzy search/code reverse search"
 * Use with "Taiwan Stock Current Price Reserve".
 */
import { isSupabaseConfigured, supabase } from './supabase'

const DEV = import.meta.env.DEV
const TWSE_URL = DEV
  ? '/api/twse/v1/exchangeReport/STOCK_DAY_AVG_ALL'
  : 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'
const TPEX_URL = DEV
  ? '/api/tpex/openapi/v1/tpex_mainboard_quotes'
  : 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

export interface TwStockRow {
  symbol: string
  name: string
  /** Most recent closing price; null if source is missing*/
  close: number | null
}

const CACHE_KEY = 'stock-pnl-web/tw-list-v1'
const CACHE_TTL_MS = 30 * 60 * 1000

interface CacheShape {
  at: number
  rows: TwStockRow[]
}

function readCache(): TwStockRow[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheShape
    if (!Array.isArray(parsed.rows) || Date.now() - parsed.at > CACHE_TTL_MS) return null
    return parsed.rows
  } catch {
    return null
  }
}

function writeCache(rows: TwStockRow[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows } satisfies CacheShape))
  } catch {
    // If the capacity exceeds the capacity, the cache will be abandoned directly, and the functions will not be affected.
  }
}

function toNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function fetchTwse(): Promise<TwStockRow[]> {
  const res = await fetch(TWSE_URL, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`)
  const arr = (await res.json()) as Array<Record<string, unknown>>
  return arr
    .map((r) => ({
      symbol: String(r.Code ?? '').trim(),
      name: String(r.Name ?? '').trim(),
      close: toNumber(r.ClosingPrice),
    }))
    .filter((r) => r.symbol && r.name)
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

/** Direct connection (development mode via dev proxy; formal environment mostly fails due to CORS)*/
async function fetchDirect(): Promise<TwStockRow[]> {
  const results = await Promise.allSettled([fetchTwse(), fetchTpex()])
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
}

/** Proxy via Supabase Edge Function (main path to the official environment)*/
async function fetchViaEdge(): Promise<TwStockRow[]> {
  if (!isSupabaseConfigured || !supabase) return []
  try {
    const { data, error } = await supabase.functions.invoke<EdgeTwListResponse>('stock-price', {
      body: { action: 'twlist' },
      timeout: 20_000,
    })
    if (error || !Array.isArray(data?.rows)) return []
    return data.rows
      .map((r) => ({
        symbol: String(r.symbol ?? '').trim(),
        name: String(r.name ?? '').trim(),
        close: typeof r.close === 'number' && r.close > 0 ? r.close : null,
      }))
      .filter((r) => r.symbol && r.name)
  } catch {
    return []
  }
}

let inflight: Promise<TwStockRow[]> | null = null

/** Get the full list of Taiwan stocks (memory deduplication + localStorage cache; try multiple sources in sequence)*/
export async function getTwStockList(): Promise<TwStockRow[]> {
  const cached = readCache()
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async () => {
    // In development mode, use dev proxy to connect directly; in formal environment, use Edge Function first, and only try direct connection if it fails.
    let rows = DEV ? await fetchDirect() : await fetchViaEdge()
    if (rows.length === 0) {
      rows = DEV ? await fetchViaEdge() : await fetchDirect()
    }
    if (rows.length === 0) {
      throw new Error('台股清單載入失敗（Edge Function 與官方端點皆無回應）')
    }
    writeCache(rows)
    return rows
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
