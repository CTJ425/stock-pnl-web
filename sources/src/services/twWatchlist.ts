/**
 * Per-user Taiwan-stock watchlist for the "搜尋個股" analysis sub-tab.
 *
 * - Max 5 tickers; never includes current holdings (pruned client-side when ledger changes).
 * - Cloud: `tw_watchlist` table with RLS. Local / unauthenticated: localStorage fallback so the
 *   page still works in native mode.
 */
import { supabase } from './supabase'

export const WATCHLIST_MAX = 5

export interface WatchItem {
  ticker: string
  name: string
  /** ISO timestamp; optional for local-only rows */
  createdAt?: string
}

const LOCAL_KEY = 'stock-pnl-web/tw-watchlist'

function normalizeItem(raw: unknown): WatchItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ticker = String(o.ticker ?? '').trim()
  if (!/^[0-9A-Za-z]{2,8}$/.test(ticker)) return null
  const name = String(o.name ?? '').trim().slice(0, 40)
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : undefined
  return { ticker, name, createdAt }
}

/** Drop any ticker that is currently held (or duplicates). Order preserved. */
export function pruneWatchlist(items: WatchItem[], heldTickers: Iterable<string>): WatchItem[] {
  const held = new Set([...heldTickers].map((t) => t.trim()))
  const seen = new Set<string>()
  const out: WatchItem[] = []
  for (const item of items) {
    if (!item.ticker || held.has(item.ticker) || seen.has(item.ticker)) continue
    seen.add(item.ticker)
    out.push(item)
  }
  return out
}

export type AddWatchResult =
  | { ok: true; items: WatchItem[] }
  | { ok: false; reason: 'duplicate' | 'full' | 'held' | 'invalid' }

/** Pure add: enforces max, held-set, and de-dupe. Does not persist. */
export function addWatchItem(
  items: WatchItem[],
  candidate: { ticker: string; name: string },
  heldTickers: Iterable<string>,
): AddWatchResult {
  const ticker = String(candidate.ticker ?? '').trim()
  if (!/^[0-9A-Za-z]{2,8}$/.test(ticker)) return { ok: false, reason: 'invalid' }
  const held = new Set([...heldTickers].map((t) => t.trim()))
  if (held.has(ticker)) return { ok: false, reason: 'held' }
  const pruned = pruneWatchlist(items, held)
  if (pruned.some((i) => i.ticker === ticker)) return { ok: false, reason: 'duplicate' }
  if (pruned.length >= WATCHLIST_MAX) return { ok: false, reason: 'full' }
  const next: WatchItem[] = [
    ...pruned,
    { ticker, name: String(candidate.name ?? '').trim().slice(0, 40), createdAt: new Date().toISOString() },
  ]
  return { ok: true, items: next }
}

export function removeWatchItem(items: WatchItem[], ticker: string): WatchItem[] {
  return items.filter((i) => i.ticker !== ticker)
}

function readLocal(): WatchItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeItem).filter((x): x is WatchItem => x !== null).slice(0, WATCHLIST_MAX)
  } catch {
    return []
  }
}

function writeLocal(items: WatchItem[]): void {
  try {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify(items.slice(0, WATCHLIST_MAX).map((i) => ({ ticker: i.ticker, name: i.name, createdAt: i.createdAt }))),
    )
  } catch {
    // private mode / quota — UI still has in-memory state
  }
}

/**
 * Load the signed-in user's watchlist from Supabase, or localStorage when offline / native.
 * Does not prune holdings — caller passes ledger and runs `pruneWatchlist`.
 */
export async function loadWatchlist(): Promise<WatchItem[]> {
  if (!supabase) return readLocal()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) return readLocal()

  const { data, error } = await supabase
    .from('tw_watchlist')
    .select('ticker, name, created_at, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !data) {
    // Table missing on older envs, or network blip — fall back so the page still opens.
    return readLocal()
  }

  const items: WatchItem[] = []
  for (const row of data) {
    const item = normalizeItem({
      ticker: row.ticker,
      name: row.name,
      createdAt: row.created_at,
    })
    if (item) items.push(item)
  }
  return items.slice(0, WATCHLIST_MAX)
}

/**
 * Replace the full list (after prune / add / remove). Cloud + local mirror.
 * Uses delete-all + insert so order and removals stay consistent under RLS.
 */
export async function saveWatchlist(items: WatchItem[]): Promise<{ ok: boolean; error?: string }> {
  const capped = items.slice(0, WATCHLIST_MAX)
  writeLocal(capped)

  if (!supabase) return { ok: true }
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user?.id
  if (!userId) return { ok: true }

  const { error: delErr } = await supabase.from('tw_watchlist').delete().eq('user_id', userId)
  if (delErr) return { ok: false, error: delErr.message }

  if (capped.length === 0) return { ok: true }

  const rows = capped.map((item, idx) => ({
    user_id: userId,
    ticker: item.ticker,
    name: item.name,
    sort_order: idx,
  }))
  const { error: insErr } = await supabase.from('tw_watchlist').insert(rows)
  if (insErr) return { ok: false, error: insErr.message }
  return { ok: true }
}
