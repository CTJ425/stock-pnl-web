/**
 * Merge ticker lists for the nightly / backfill batch (holdings ∪ watchlist).
 *
 * Pure helpers only — DB reads stay in index.ts so this file stays unit-testable.
 */

export interface BatchTicker {
  ticker: string
  name: string
}

/** Same shape as index.ts TICKER_RE (2–8 alphanumerics). */
const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

/**
 * Deduplicate by ticker. Later lists win on name only when the new name is non-empty
 * and the stored name is empty — so holdings (usually better names) should be listed first.
 */
export function mergeTwTickerLists(...lists: Array<readonly BatchTicker[]>): BatchTicker[] {
  const map = new Map<string, string>()
  for (const list of lists) {
    for (const row of list) {
      const ticker = String(row.ticker ?? '').trim()
      if (!TICKER_RE.test(ticker)) continue
      const name = String(row.name ?? '').trim()
      const prev = map.get(ticker)
      if (prev === undefined) {
        map.set(ticker, name)
      } else if (!prev && name) {
        map.set(ticker, name)
      }
    }
  }
  return [...map.entries()].map(([ticker, name]) => ({ ticker, name }))
}
