/**
 * Shared retry wrapper for upstream fetches (Task 166 ER-04). Every upstream fetch in
 * stock-report/index.ts used to be single-shot: one dropped packet or one 429 mid-batch was a
 * silent miss for the whole night, indistinguishable from "no data yet". This wraps `fetch` with
 * a per-attempt timeout and up to two retries with exponential backoff, retried only for the
 * failure modes worth retrying (network error, 429, 5xx) — a 4xx other than 429 means the request
 * itself is wrong, and retrying it just burns the timeout budget for nothing.
 *
 * **Wall-clock budget (Task 166 batch 3, BLOCKER review finding)**: three full-length attempts
 * used to cost up to `retries + 1` full timeouts plus backoff — e.g. a 20s `timeoutMs` could take
 * 3 * 20_000 + 1_600 = 61.6s on its own, longer than the 60s `timeout_milliseconds` every cron job
 * in schema.sql runs under (see e.g. `history-daily`, ~60s, which also runs other work in the same
 * phase before it ever reaches a call using this helper). `totalBudgetMs` bounds that: once the
 * remaining budget cannot cover another full-length attempt (or the backoff sleep before one), this
 * returns the last failure instead of starting it. Callers whose phase shares the 60s window with
 * other work should pass an explicit `totalBudgetMs` sized to leave room for the rest of the phase,
 * not rely on the default.
 */

export type FetchRetryResult =
  | { ok: true; res: Response }
  | { ok: false; kind: 'timeout' | 'network' | 'http'; status?: number; message: string }

export interface FetchRetryOptions {
  /** Per-attempt timeout in ms (same value the call site used to pass to `AbortSignal.timeout`). */
  timeoutMs: number
  /** Extra attempts after the first try. Default 2 (three attempts total). */
  retries?: number
  /** Backoff delay in ms before each retry, indexed by attempt number. Default [400, 1200]. */
  backoffMs?: number[]
  /**
   * Overall wall-clock budget across every attempt and backoff sleep combined, in ms. Default
   * `timeoutMs * 1.6` — room for one full attempt plus a short backoff pause, but not for a second
   * full-length attempt. The first attempt always runs; a later attempt or sleep is skipped once
   * the remaining budget cannot cover it, and the last failure is returned instead. See the module
   * header for why this exists and how to size it against a cron job's `timeout_milliseconds`.
   */
  totalBudgetMs?: number
}

/** Upper bound on how long a 429's `Retry-After` may make us wait, regardless of what it asks for. */
const MAX_RETRY_AFTER_WAIT_MS = 5_000

/**
 * Classifies an error caught from a fetch call into the same discriminated `kind` this module
 * uses, for callers that catch their own single-shot fetch (e.g. the source-probe sites, which
 * stay single-shot on purpose — retrying them would change what a "probe" measures) but still
 * want to log what kind of failure it was (Task 166 ER-09).
 */
export function classifyFetchError(err: unknown): {
  kind: 'timeout' | 'network' | 'http'
  status?: number
  message: string
} {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return { kind: 'timeout', message: err.message }
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { kind: 'timeout', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  const httpMatch = /^HTTP (\d+)/.exec(message)
  if (httpMatch) return { kind: 'http', status: Number(httpMatch[1]), message }
  return { kind: 'network', message }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** `Retry-After` may be seconds (`"120"`) or an HTTP date; unrecognised values are ignored. */
function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const dateMs = Date.parse(header)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null
}

/**
 * Fetch with a bounded timeout, retried up to `opts.retries` times (default 2) with exponential
 * backoff. Honours `Retry-After` on a 429. Returns a discriminated result instead of throwing, so
 * the caller decides how to log/react instead of unwinding through a catch.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchRetryOptions,
): Promise<FetchRetryResult> {
  const retries = opts.retries ?? 2
  const backoff = opts.backoffMs ?? [400, 1200]
  const totalBudgetMs = opts.totalBudgetMs ?? opts.timeoutMs * 1.6
  const startedAt = Date.now()
  const remainingBudgetMs = () => totalBudgetMs - (Date.now() - startedAt)

  let lastFailure: FetchRetryResult = { ok: false, kind: 'network', message: 'fetchWithRetry: no attempt made' }

  for (let attempt = 0; attempt <= retries; attempt++) {
    // The first attempt always runs — there is nothing to fall back to yet. A retry only starts
    // once the remaining budget can still cover a full worst-case attempt; otherwise it would run
    // past the budget the caller sized against its cron job's wall-clock timeout.
    if (attempt > 0 && remainingBudgetMs() < opts.timeoutMs) return lastFailure
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) })
      if (res.ok) return { ok: true, res }
      const retryable = res.status === 429 || res.status >= 500
      lastFailure = { ok: false, kind: 'http', status: res.status, message: `HTTP ${res.status}` }
      if (!retryable || attempt >= retries) return lastFailure
      const rawWait =
        res.status === 429
          ? (retryAfterMs(res.headers.get('Retry-After')) ?? backoff[attempt] ?? backoff[backoff.length - 1] ?? 1000)
          : (backoff[attempt] ?? backoff[backoff.length - 1] ?? 1000)
      // A 429's Retry-After is upstream-controlled and can ask for far longer than is reasonable
      // to wait on a cron budget — clamp it same as any other sleep, but to a tighter cap too.
      const cap = res.status === 429 ? MAX_RETRY_AFTER_WAIT_MS : Infinity
      await sleep(Math.max(0, Math.min(rawWait, cap, remainingBudgetMs())))
    } catch (err) {
      const c = classifyFetchError(err)
      lastFailure = { ok: false, kind: c.kind === 'http' ? 'network' : c.kind, status: c.status, message: c.message }
      if (attempt >= retries) return lastFailure
      const rawWait = backoff[attempt] ?? backoff[backoff.length - 1] ?? 1000
      await sleep(Math.max(0, Math.min(rawWait, remainingBudgetMs())))
    }
  }
  return lastFailure
}
