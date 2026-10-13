/**
 * Pure merge and completeness check for the `twlist` action.
 *
 * Kept free of Supabase/Deno imports so it can be unit tested with plain vitest —
 * see twList.test.ts.
 *
 * A half list is worse than no list: the client caches it for 30 minutes, and every stock
 * from the dead source then reads as "no such stock". A source that resolves with an empty
 * array is the same failure wearing a success code, so it counts as a failure too.
 */

export type TwListSource = PromiseSettledResult<Array<Record<string, unknown>>>

export interface TwListRow {
  symbol: string
  name: string
  close: number | null
}

export interface TwListFailure {
  source: 'TWSE' | 'TPEx'
  reason: string
}

export type TwListResult =
  | { ok: true; rows: TwListRow[] }
  | { ok: false; error: string; failures: TwListFailure[] }

function listNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function rejectionReason(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason)
  return text.slice(0, 200)
}

export function buildTwList(twse: TwListSource, tpex: TwListSource): TwListResult {
  const rows: TwListRow[] = []
  const seen = new Set<string>()

  /**
   * Adds one source's rows and returns how many of them were structurally usable.
   *
   * "Usable" is counted before the duplicate check on purpose. A non-empty response whose
   * rows all lack a code or a name is a dead source wearing a success code, and array length
   * alone cannot tell the two apart. A row that is merely a duplicate of one the other
   * exchange already supplied still proves this source answered, so it counts.
   */
  const collect = (
    raw: unknown,
    read: (row: Record<string, unknown>) => [unknown, unknown, unknown],
  ): number => {
    if (!Array.isArray(raw)) return 0
    let usable = 0
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const [symbol, name, close] = read(row as Record<string, unknown>)
      const s = String(symbol ?? '').trim()
      const n = String(name ?? '').trim()
      if (!s || !n) continue
      usable += 1
      if (seen.has(s)) continue
      seen.add(s)
      rows.push({ symbol: s, name: n, close: listNumber(close) })
    }
    return usable
  }

  const failures: TwListFailure[] = []

  if (twse.status === 'rejected') {
    failures.push({ source: 'TWSE', reason: rejectionReason(twse.reason) })
  } else if (!Array.isArray(twse.value)) {
    failures.push({ source: 'TWSE', reason: 'response is not an array' })
  } else {
    const usable = collect(twse.value, (r) => [r.Code, r.Name, r.ClosingPrice])
    if (usable === 0) {
      failures.push({ source: 'TWSE', reason: `0 usable rows of ${twse.value.length} returned` })
    }
  }

  if (tpex.status === 'rejected') {
    failures.push({ source: 'TPEx', reason: rejectionReason(tpex.reason) })
  } else if (!Array.isArray(tpex.value)) {
    failures.push({ source: 'TPEx', reason: 'response is not an array' })
  } else {
    const usable = collect(tpex.value, (r) => [
      r.SecuritiesCompanyCode ?? r.Code,
      r.CompanyName ?? r.Name,
      r.Close ?? r.ClosingPrice ?? r.LatestPrice,
    ])
    if (usable === 0) {
      failures.push({ source: 'TPEx', reason: `0 usable rows of ${tpex.value.length} returned` })
    }
  }

  if (failures.length > 0) {
    const error = `台股清單來源不完整：${failures.map((f) => `${f.source} ${f.reason}`).join('；')}`
    return { ok: false, error, failures }
  }
  return { ok: true, rows }
}

/**
 * Last good list, kept in the public `reports` bucket at `TWLIST_CACHE_PATH` (BUG-120).
 *
 * Before this every `twlist` call fetched both exchanges live, so one slow upstream reached the
 * user every time. The list is daily close data, so it is served from this copy for
 * `TWLIST_CACHE_TTL_MS`, and a failed refresh serves the copy of any age: a stale list only
 * carries an older close, while no list means search, add-to-watch and name lookups all fail.
 * The hour keeps the after-close update (today's close replacing yesterday's) within an hour.
 */
export const TWLIST_CACHE_PATH = 'twlist/latest.json'
export const TWLIST_CACHE_TTL_MS = 60 * 60 * 1000

export interface TwListCache {
  /** ISO time the rows were fetched. */
  at: string
  rows: TwListRow[]
}

/** A stored copy, or null if it is missing, malformed or empty — never trusted blindly. */
export function parseTwListCache(raw: unknown): TwListCache | null {
  if (!raw || typeof raw !== 'object') return null
  const { at, rows } = raw as { at?: unknown; rows?: unknown }
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null
  if (!Array.isArray(rows) || rows.length === 0) return null
  return { at, rows: rows as TwListRow[] }
}

export function isTwListCacheFresh(cache: TwListCache, now: Date): boolean {
  const age = now.getTime() - Date.parse(cache.at)
  return age >= 0 && age < TWLIST_CACHE_TTL_MS
}

/**
 * A live list under this share of the stored one is treated as truncated: kept out of storage and
 * not served while a copy exists. Per-exchange `usable > 0` (above) only catches an empty side; a
 * body cut to a handful of rows would otherwise replace the full copy for an hour and become the
 * fallback of any age (review finding on BUG-120).
 */
export const TWLIST_MIN_SHARE_OF_CACHE = 0.5

/**
 * With TPEx on the static snapshot, a stored copy younger than this wins over the live list (its
 * TPEx closes are newer than the snapshot's). Past it the live list wins, so the TWSE closes do not
 * freeze for as long as TPEx stays down — snapshot lists are never stored, so the copy cannot refresh.
 */
export const TWLIST_SNAPSHOT_PREFER_CACHE_MS = 24 * 60 * 60 * 1000

export type TwListDecision =
  | { kind: 'live'; rows: TwListRow[]; store: boolean }
  | { kind: 'cached'; cache: TwListCache; reason: 'refresh-failed' | 'truncated' | 'tpex-snapshot' }
  | { kind: 'error'; error: string; failures: TwListFailure[] }

/** What to answer once a live refresh has run; every `cached` answer is stale by construction. */
export function resolveTwList(
  live: TwListResult,
  usedTpexSnapshot: boolean,
  cache: TwListCache | null,
  now: Date,
): TwListDecision {
  if (!live.ok) {
    return cache
      ? { kind: 'cached', cache, reason: 'refresh-failed' }
      : { kind: 'error', error: live.error, failures: live.failures }
  }
  if (cache && live.rows.length < cache.rows.length * TWLIST_MIN_SHARE_OF_CACHE) {
    return { kind: 'cached', cache, reason: 'truncated' }
  }
  if (!usedTpexSnapshot) return { kind: 'live', rows: live.rows, store: true }
  if (cache && now.getTime() - Date.parse(cache.at) < TWLIST_SNAPSHOT_PREFER_CACHE_MS) {
    return { kind: 'cached', cache, reason: 'tpex-snapshot' }
  }
  return { kind: 'live', rows: live.rows, store: false }
}
