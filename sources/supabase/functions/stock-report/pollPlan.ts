/**
 * Pure logic for polling decisions (0.6.1).
 *
 * **Why should it be made into a separate file**: `index.ts` calls `Deno.serve` when the module is loaded, and vitest cannot import it.
 * So the judgment written there is equal to no test. After changing the batch from 3 shifts a day to 32 polls a day,
 * "When can we not crawl it at all?" becomes a security key - the cost of making a wrong judgment has increased from 3 times to 32 times.
 * 0.3.9 The reason for burning out the quota is my own logical error (the mismatch of the retention period unit of prune makes me work in vain every night).
 * It is not malicious traffic, so every judgment here must be tested.
 */

/**
 * A maximum of several actual executions are allowed per day (more than this will cause a short circuit).
 *
 * cron is only executed 32 times a day, so under normal circumstances it will never hit this upper limit - it is foolproof, and it prevents two things:
 * 1. Our own judgment logic was wrong, resulting in no short circuit when there should be a short circuit (shape 0.3.9).
 * 2. `generate-all` only relies on `x-cron-secret`, and the function is deployed with `--no-verify-jwt`.
 *    The URL is in the public bundle. If the key is leaked, this upper limit is the final brake.
 */
export const MAX_RUNS_PER_DAY = 40

/**
 * The T86 captured several times in a row will be considered final if the content is the same.
 *
 * Deliberately **look at the content instead of looking at the clock**: `schema.sql` §6c Those "what time to announce" annotations are on 2026-07-27
 * Within one day, it was overturned by actual testing in three aspects (T86 time, borrowing time, borrowing semantics). Guesses on the clock expire,
 * "Catching the same thing twice in a row" doesn't work.
 */
export const T86_STABLE_POLLS = 2

/**
 * Content fingerprint. Length + djb2 hash, length first blocks most collisions.
 * It is only used to determine "whether it is the same as last time" and does not require cryptographic strength.
 */
export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value) ?? ''
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return `${s.length}:${h.toString(36)}`
}

/**
 * T86-specific content fingerprint. **The data column must be sorted first** and cannot be calculated directly on the entire JSON package.
 *
 * 2026-07-27 The actual test in the official area was stepped on: the same information was captured twice, and the content of column 1334 was exactly the same as the collection.
 * However, the order of several columns will be changed (the endpoint sorting between columns with the same last column is unstable).
 * If `JSON.stringify` is used directly, different fingerprints will be calculated in each round, so `nextT86State` will always be judged as "overwritten",
 * `t86_frozen` is always false, `decideSkip` is never short-circuited - all 32 rounds are run in one day, and all three gates are disabled.
 * The `batch_run_log` from 20:30–22:00 that night was in this shape: `t86_unchanged` jumped between 0/1 and could not reach 2.
 *
 * Only take `date` / `total` / sorted columns: the remaining fields (title / fields / notes / hints) are fixed templates,
 * Moreover, if Postgres jsonb is removed quickly, **jsonb will rearrange the keys of objects**, and including them is inviting instability.
 */
export function t86Fingerprint(resp: unknown): string {
  const r = resp as { data?: unknown; date?: unknown; total?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.data)) return fingerprint(resp)
  return fingerprint({
    date: r.date ?? null,
    total: r.total ?? null,
    rows: sortedRows(r.data as unknown[]),
  })
}

/**
 * Semantic fingerprint of array-type responses (for bare arrays like `BWIBBU_ALL`).
 * Same reason as `t86Fingerprint`: **TWSE's endpoints do not guarantee stable column order**,
 * Directly counting fingerprints on the entire package will misjudge “the order has changed” as “the content has changed”.
 */
export function rowsFingerprint(rows: unknown): string {
  if (!Array.isArray(rows)) return fingerprint(rows)
  return fingerprint(sortedRows(rows))
}

/**
 * Each row is serialized and sorted independently —— removing "row order" as a source of instability.
 *
 * ⚠️ The separator matters (0.6.42, AUDIT-04). Joining with an empty string made the encoding ambiguous:
 * ['12','3'] and ['1','23'] both produced '123', so two genuinely different rows could share a fingerprint. That
 * fingerprint is the gate deciding whether today's T86 is **final** (`nextT86State` freezes after N identical
 * polls), so a collision reads a real revision as "unchanged". U+001F cannot occur in a TWSE JSON string field.
 *
 * Changing the separator changes every fingerprint, so the first round after deploying counts one extra
 * `revisions` against yesterday's stored value and restarts the stability count. It settles by itself.
 */
const CELL_SEP = '\u001f'

function sortedRows(rows: unknown[]): string[] {
  return rows
    .map((row) => (Array.isArray(row) ? row.join(CELL_SEP) : (JSON.stringify(row) ?? '')))
    .sort()
}

/** Today’s rewrite status of T86; brought back by the last column of `batch_run_log` across rounds*/
export interface T86State {
  fingerprint: string
  /** I have been rewritten several times today (the first time I caught it does not count as a rewrite)*/
  revisions: number
  /** The content captured several times in a row is the same as last time*/
  unchanged: number
  /** Finalized: No more recaptures in subsequent rounds*/
  frozen: boolean
}

/**
 * Advance the status based on the fingerprint captured this time.
 *
 * Users pointed out that T86 "updates every 15 minutes starting from 16:00" - which means that the first catch of the day is not necessarily the final version.
 * The original `loadT86` is "cache the first non-empty response that day, and never update it again."
 * The two conflict: catching it early will lock the first edition into the day's answers, which is worse than catching it late. This function is to resolve this conflict.
 */
export function nextT86State(
  prev: T86State | null,
  fp: string,
  stablePolls: number = T86_STABLE_POLLS,
): T86State {
  if (!prev) return { fingerprint: fp, revisions: 0, unchanged: 0, frozen: false }
  if (prev.fingerprint !== fp) {
    // The content has changed: the number of rewrites is +1, consecutive times are reset to zero, and observation is restarted.
    return { fingerprint: fp, revisions: prev.revisions + 1, unchanged: 0, frozen: false }
  }
  const unchanged = prev.unchanged + 1
  return {
    fingerprint: fp,
    revisions: prev.revisions,
    unchanged,
    frozen: unchanged >= stablePolls,
  }
}

export type SkipReason = 'complete' | 'run-cap'

export interface SkipDecision {
  skip: boolean
  reason: SkipReason | null
}

/**
 * Do you want to skip this round completely (without making any external requests).
 *
 * `t86Frozen` is the key and not just `t86Today` - catching the T86 of the day does not mean it is finalized,
 * You have to keep coming back to see if it has been rewritten before finalizing it (see `nextT86State`).
 *
 * Margin trading will not be available until after 21:00, so "Today's All" must include it;
 * If you just look at T86 and call it a day, stop at 17:00, you will never be caught doing margin trading that day.
 *
 * `borrowLanded` is the same argument one source further out (BUG-026). 借券 flips to the next
 * trading day only after the close-plus-settlement —— measured 22:15 on both environments on
 * 2026-08-11, i.e. **later than every other term in this gate**. Judging 「今天做完了」 without it
 * meant the gate answered `complete` from ~21:00, so when the flip finally arrived the whole chips
 * phase short-circuited before `loadBorrow` ever ran: 7 hits, 7 × 「產出 0 檔」, borrow never landed
 * that day. The fixed shifts could not save it either —— the last one runs at 21:45, before the flip.
 *
 * Note what this deliberately does **not** do: it does not ask 「有沒有抓過借券」, it asks
 * 「借券的日期有沒有走過今天」 (`borrowHit`). Those differ exactly on the day the endpoint is up
 * but has not flipped yet, which is the entire afternoon.
 */
export function decideSkip(input: {
  t86Today: boolean
  t86Frozen: boolean
  marginToday: boolean
  borrowLanded: boolean
  runsToday: number
  maxRuns?: number
}): SkipDecision {
  const maxRuns = input.maxRuns ?? MAX_RUNS_PER_DAY
  if (input.runsToday >= maxRuns) return { skip: true, reason: 'run-cap' }
  if (input.t86Today && input.t86Frozen && input.marginToday && input.borrowLanded) {
    return { skip: true, reason: 'complete' }
  }
  return { skip: false, reason: null }
}

/**
 * The section of margin trading in `runSignature`: **Which days do the data really exist** (ymd from old to new).
 *
 * The reason for existence is the actual regression of 0.6.1 (official area test on 2026-07-30): originally passed
 * `marginDatedFailed ? '' : dataYmd`, while `marginDatedFailed` asks "Have there been any **any** in the past 7 days?
 * Caught in one day" - there must be a historical day, so it is false all day long, and this period is equal to the constant `dataYmd` all day long.
 * So in the 21:00 round, the day's margin trading was really captured into the cache, but the fingerprints did not change and the report was not heavy.
 * Starting from 21:15, `decideSkip` determines that complete is all short-circuited - the `margin` reported that day always stops at null.
 * You have to wait for the first round the next day (`batch_run_log` is checked daily, `last` is null and forced to re-produce).
 * By then the manifest had already been changed to a new day.
 *
 * After changing to look at "which days", the fingerprint will change as soon as the day's margin trading arrives, which just triggers a heavy production;
 * Historical day covering (covering holes in the trend chart) is also covered.
 */
export function marginSigPart(marginYmds: readonly string[]): string {
  return marginYmds.slice().sort().join(',')
}

/**
 * Input fingerprint of report content. If the same, there is no need to repeat the report——
 * The saving is not money (5 files × 5KB), but making `generatedAt` only jump when there is a real change.
 * Otherwise, 32 polls will wash out the signal "when did it change".
 */
export function runSignature(parts: {
  dataYmd: string
  t86: string
  margin: string
  borrow: string
  tickers: string[]
}): string {
  return [
    parts.dataYmd,
    parts.t86,
    parts.margin,
    parts.borrow,
    // Even if the holding list has changed, it needs to be restocked: when a new stock is added, it is not included in the old report.
    parts.tickers.slice().sort().join(','),
  ].join('|')
}
