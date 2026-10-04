/**
 * Per-account daily meters that share the `warm_quota` table (atomic `take_warm_quota`).
 *
 * The table is keyed by (user_id, ymd). A second meter gets its own key by suffixing the 8-digit
 * Taipei date, which keeps `pruneChipCache`'s lexicographic `ymd < cutoff` delete working:
 * `'20261004:generate' < '20261005'` is true, so yesterday's row is cleaned up like the others.
 * (A prefix such as `g20261004` would sort after every date and never be pruned.)
 */

/**
 * `generate` allowance per account per Taipei day (Task 193 M11). It is the on-demand fallback for a
 * ticker the nightly batch has no report file for; opening a stock reaches it at most once per view,
 * so a person sits far below this. Every call scans all users' transactions and watchlists and may hit
 * TWSE, which is what a script looping on one account must not be able to do for free.
 */
export const GENERATE_DAILY_LIMIT = 150

/** `warm_quota.ymd` for the `generate` meter on `ymd` (8-digit Taipei date). */
export function generateQuotaKey(ymd: string): string {
  return `${ymd}:generate`
}
