/**
 * Watchlist data access: talks to `tw_watchlist` directly (Supabase mode only).
 *
 * This is a plain module of exported functions, not a class, and it is deliberately NOT
 * part of the `DataProvider` interface in `dataProvider.ts` — local (non-Supabase) mode
 * does not support the watchlist.
 *
 * RLS on `tw_watchlist` is `auth.uid() = user_id` for ALL commands, so the client only ever
 * sees and touches its own rows; deletes do not need an extra user_id filter for correctness,
 * but writes still set user_id to satisfy the policy's WITH CHECK.
 *
 * There is no `reorderWatch`: it would need `.upsert()`, and PostgREST implements upsert as
 * `INSERT ... ON CONFLICT DO UPDATE`. Postgres fires row-level BEFORE INSERT triggers for every
 * candidate row before conflict resolution, so `tw_watchlist_enforce_max` would reject every
 * reorder once the list is at its cap. Do not re-add it as an upsert.
 */
import { supabase } from './supabase'

// Mirrors the `tw_watchlist_enforce_max` trigger in `sources/supabase/schema.sql`.
export const WATCHLIST_MAX = 30

export interface WatchItem {
  ticker: string
  name: string
  sortOrder: number
}

function client() {
  if (!supabase) throw new Error('Supabase 未設定')
  return supabase
}

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser()
  if (error || !data.user) throw new Error('尚未登入')
  return data.user.id
}

export async function listWatchlist(): Promise<WatchItem[]> {
  const { data, error } = await client()
    .from('tw_watchlist')
    .select('ticker, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`載入觀察清單失敗：${error.message}`)
  return (data ?? []).map((row: { ticker: string; name: string; sort_order: number }) => ({
    ticker: row.ticker,
    name: row.name,
    sortOrder: row.sort_order,
  }))
}

export async function addWatch(ticker: string, name: string): Promise<void> {
  if (!/^[0-9A-Za-z]{2,8}$/.test(ticker)) throw new Error('股票代號格式不正確')

  const userId = await currentUserId()
  const existing = await listWatchlist()
  if (existing.length >= WATCHLIST_MAX) throw new Error(`觀察清單最多只能有 ${WATCHLIST_MAX} 檔股票`)

  const { error } = await client()
    .from('tw_watchlist')
    .insert({ user_id: userId, ticker, name, sort_order: existing.length })
  if (error) {
    // TOCTOU: two tabs can both pass the client-side cap check above; the loser hits the
    // `tw_watchlist_enforce_max` trigger and gets its raw Postgres text back. Translate it so
    // that text never reaches the UI.
    if (error.message.includes('tw_watchlist limit')) {
      throw new Error(`觀察清單最多只能有 ${WATCHLIST_MAX} 檔股票`)
    }
    throw new Error(`加入觀察清單失敗：${error.message}`)
  }
}

export async function removeWatch(ticker: string): Promise<void> {
  const { error } = await client().from('tw_watchlist').delete().eq('ticker', ticker)
  if (error) throw new Error(`移除觀察標的失敗：${error.message}`)
}
