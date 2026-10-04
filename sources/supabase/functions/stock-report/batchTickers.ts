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

/** Whether `ticker` (trimmed) appears in `allowed` — used for the generate/warm whitelist gate. */
export function allowsTicker(allowed: readonly BatchTicker[], ticker: string): boolean {
  const wanted = ticker.trim()
  return allowed.some((row) => row.ticker === wanted)
}

/** One `transactions` row as the whitelist reads it. */
export interface HeldTxRow {
  ticker?: unknown
  name?: unknown
  tx_type?: unknown
  qty?: unknown
  user_id?: unknown
  workspace_id?: unknown
}

/**
 * Tickers with an open position, reduced from raw `transactions` rows.
 *
 * The test is `net !== 0`, not `net > 0`. 融券 opens with a SELL and closes with a BUY, so a
 * short-only ticker nets negative. Under `net > 0` it fell out of the whitelist: `generate`
 * answered 403 and the nightly batch never wrote its file, so 籌碼分析 failed outright.
 * The whitelist is an anti-scraping ceiling, not an accounting rule — a non-zero net means the
 * user really traded that ticker, whichever side they are on.
 *
 * `tx_nature` is deliberately NOT read here. It would split the two legs exactly, but PROD has
 * no such column yet (BUG-044-P), and selecting a missing column makes the query error, which
 * empties the whole whitelist and 403s every ticker.
 */
export function netOpenTickers(rows: readonly HeldTxRow[]): BatchTicker[] {
  // One ledger = one (user, workspace, ticker). Netting across ledgers would let one account's
  // SELL cancel another account's position, and a user's short in one workspace cancel a long in
  // another. Rows without the two ids (tests, old callers) share a single ledger.
  const ledgers = new Map<string, number>()
  const names = new Map<string, string>()
  for (const row of rows) {
    const ticker = String(row.ticker ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    const qty = Number(row.qty) || 0
    // DIVIDEND's qty is the share count the cash was paid on — it moves no shares. STOCK_DIVIDEND
    // adds shares, like the ledger engine's own opening-leg rule (pnlEngine `isOpenLeg`).
    let delta = 0
    if (row.tx_type === 'BUY' || row.tx_type === 'STOCK_DIVIDEND') delta = qty
    else if (row.tx_type === 'SELL') delta = -qty
    const ledger = `${String(row.user_id ?? '')}|${String(row.workspace_id ?? '')}|${ticker}`
    ledgers.set(ledger, (ledgers.get(ledger) ?? 0) + delta)
    names.set(ticker, String(row.name ?? '').trim() || names.get(ticker) || '')
  }
  const open = new Set<string>()
  for (const [ledger, net] of ledgers) {
    if (net !== 0) open.add(ledger.slice(ledger.lastIndexOf('|') + 1))
  }
  return [...names.entries()].filter(([ticker]) => open.has(ticker)).map(([ticker, name]) => ({ ticker, name }))
}
