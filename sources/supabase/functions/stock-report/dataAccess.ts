/** Service-role reads shared by the batch actions and the admin console: Storage JSON, paged table scans, run state. */
import { netOpenTickers } from './batchTickers.ts'
import type { T86State } from './pollPlan.ts'
import { db } from './runtime.ts'

/** The status left by the last execution today; if found (the first run, or the table does not exist), null will be returned*/
export interface LastRun {
  runsToday: number
  t86: T86State | null
  runSig: string | null
  /** 今天最後一次記到的借券日期。`decideSkip` 用它判斷借券翻日了沒（BUG-026）。 */
  borrowDataDate: string | null
}

export const REPORTS_BUCKET = 'reports'

/**
 * The Taiwan stock code of every user's open position (service role scan transactions;
 * cross-user deduplication). The open/closed rule, and why it counts a 融券 short, live with
 * `netOpenTickers` in batchTickers.ts so they can be unit-tested.
 */
export async function heldTwTickers(): Promise<Array<{ ticker: string; name: string }>> {
  // BUG-066: this scans every user's transactions with no paging, so it silently truncated
  // past PostgREST's max_rows (1000). `id` (UUID PRIMARY KEY) is a total order to page on.
  const { data, error } = await pagedSelect<{ ticker: string; name: string; tx_type: string; qty: number }>(
    (from, to) =>
      db
        .from('transactions')
        .select('ticker, name, tx_type, qty')
        .eq('market', 'TPE')
        .order('id', { ascending: true })
        .range(from, to),
  )
  if (error || !data) return []
  return netOpenTickers(data)
}

export async function downloadJson<T>(path: string): Promise<T | null> {
  try {
    const { data, error } = await db.storage.from(REPORTS_BUCKET).download(path)
    if (error || !data) return null
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}

// ----Daily OHLCV (for technical purposes)----

/**
 * Retrieve the cross-run status from the last column of `batch_run_log` today.
 *
 * **Why put the status in the observation table**: These fields are what we want to observe (how many times will it be rewritten, when will it be finalized),
 * There is no need to create another table for the same data. The price is that it becomes half-loaded - when the write fails
 * (`logBatchRun` intentionally swallows exceptions) The next round will be regarded as the first run of the day, so T86 will be captured again and counted again.
 * That's **doing more** rather than doing wrong things, which is acceptable; but don't forget this characteristic.
 */
export async function readLastRun(todayYmd: string): Promise<LastRun | null> {
  try {
    const { data, error } = await db
      .from('batch_run_log')
      .select(
        'runs_today, t86_fingerprint, t86_revisions, t86_unchanged, t86_frozen, run_sig, borrow_data_date',
      )
      .eq('taipei_ymd', todayYmd)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const fp = data.t86_fingerprint
    return {
      runsToday: Number(data.runs_today ?? 0),
      t86:
        typeof fp === 'string' && fp
          ? {
              fingerprint: fp,
              revisions: Number(data.t86_revisions ?? 0),
              unchanged: Number(data.t86_unchanged ?? 0),
              frozen: Boolean(data.t86_frozen),
            }
          : null,
      runSig: typeof data.run_sig === 'string' ? data.run_sig : null,
      borrowDataDate:
        typeof data.borrow_data_date === 'string' ? data.borrow_data_date : null,
    }
  } catch {
    return null
  }
}

/**
 * PostgREST caps a single response at `max_rows` (1000, see `supabase/config.toml`). A select that
 * can plausibly return more rows than that needs explicit paging, or rows past the cap are silently
 * dropped (AUDIT-2026-09-04 #3: this under-counted `existingKeys` for accounts past 1000
 * `transactions`, so the backup-restore preview reported existing rows as missing).
 *
 * `build` must return a fresh, fully-specified query (including any `.order()`) for the given
 * `[from, to]` range — a supabase-js query builder cannot be re-awaited after use, so each page
 * needs its own builder call.
 */
export async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return { data: rows, error: null }
}
