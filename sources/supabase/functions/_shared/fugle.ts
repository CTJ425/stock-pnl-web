/**
 * Fugle MarketData REST client (Task 195). Taiwan stocks only; every caller treats a failure as
 * "use today's path" (MIS / Yahoo), so this never throws.
 *
 * The key is read from the `FUGLE_API_KEY` secret and sent only in the `X-API-KEY` header. It
 * must never appear in a URL, a log line or a thrown message — this repo is public.
 *
 * Rate limits (measured 2026-10-06 on the free plan): every response carries
 * `x-ratelimit-limit: 60` / `x-ratelimit-remaining` / `retry-after` (seconds, fractional). A 429
 * means "wait for the window to reset", so a 429 parks that endpoint family in this isolate until then
 * instead of spending 60 more requests on certain refusals. 401/403 (missing key, plan without the
 * endpoint) park it for longer: they will not fix themselves inside a minute.
 */

export const FUGLE_BASE = 'https://api.fugle.tw/marketdata/v1.0/stock'

const DEFAULT_TIMEOUT_MS = 6_000
const AUTH_COOLDOWN_MS = 10 * 60 * 1000
const MAX_RATE_COOLDOWN_MS = 60 * 1000

export type FugleResult<T> =
  | { ok: true; data: T }
  /** `status` is the HTTP status, or null for no key / cooldown / network failure. 404 = no data. */
  | { ok: false; status: number | null; reason: 'no-key' | 'cooldown' | 'http' | 'network' }

/** Per endpoint family (`intraday`, `historical`, …): each family has its own minute limit. */
const cooldownUntil = new Map<string, number>()

function apiKey(): string {
  return Deno.env.get('FUGLE_API_KEY')?.trim() ?? ''
}

function park(family: string, ms: number): void {
  cooldownUntil.set(family, Math.max(cooldownUntil.get(family) ?? 0, Date.now() + ms))
}

export function fugleConfigured(): boolean {
  return apiKey() !== ''
}

/** GET `${FUGLE_BASE}/${path}`. `path` carries the query string; it never carries the key. */
export async function fugleGet<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FugleResult<T>> {
  const key = apiKey()
  if (!key) return { ok: false, status: null, reason: 'no-key' }
  const family = path.split('/')[0]
  if (Date.now() < (cooldownUntil.get(family) ?? 0)) return { ok: false, status: null, reason: 'cooldown' }
  let res: Response
  try {
    res = await fetch(`${FUGLE_BASE}/${path}`, {
      headers: { 'X-API-KEY': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, status: null, reason: 'network' }
  }
  if (!res.ok) {
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, MAX_RATE_COOLDOWN_MS) : MAX_RATE_COOLDOWN_MS
      park(family, waitMs)
    } else if (res.status === 401 || res.status === 403) {
      park(family, AUTH_COOLDOWN_MS)
    }
    await res.body?.cancel()
    return { ok: false, status: res.status, reason: 'http' }
  }
  try {
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, status: res.status, reason: 'network' }
  }
}
