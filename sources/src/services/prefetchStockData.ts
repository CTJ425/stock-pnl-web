/**
 * Fire-and-forget warm when the user shows interest in a ticker **before** opening
 * the analysis detail (watchlist add / first TPE buy).
 *
 * Skips when Storage already has a non-thin fundamental file so daily quota is not
 * burned on re-buys of stocks that night batch already filled.
 */
import { fetchFundamental } from './fundamentalProxy'
import { needsFundamentalBackfill } from './needsFundamentalBackfill'
import { warmStock } from './warmStock'

/**
 * Warm chip daily + fundamentals if missing or thin.
 * Never throws; safe to `void prefetchStockData(...)` from UI handlers.
 */
export async function prefetchStockData(ticker: string, name?: string): Promise<void> {
  const code = String(ticker ?? '').trim()
  if (!code) return
  try {
    const f = await fetchFundamental(code)
    if (f && !needsFundamentalBackfill(f)) return
    await warmStock(code, name)
  } catch {
    // Background best-effort — analysis page can still warm on open.
  }
}
