/**
 * Fire-and-forget warm when the user shows interest in a ticker **before** opening
 * the analysis detail (e.g. first TPE buy).
 *
 * Skips when Storage already has a non-thin fundamental file so daily quota is not
 * burned on re-buys of stocks that night batch already filled.
 *
 * 0.6.46-dev.6: if only history is thin (e.g. 12 months + 2 quarters), call
 * `warmStockHistory` alone — no core quota charge.
 */
import { fetchFundamental } from './fundamentalProxy'
import { needsCoreWarm, needsHistoryWarm } from './needsFundamentalBackfill'
import { warmStock, warmStockHistory } from './warmStock'

/**
 * Warm chip daily + fundamentals if missing or thin.
 * Never throws; safe to `void prefetchStockData(...)` from UI handlers.
 */
export async function prefetchStockData(ticker: string, name?: string): Promise<void> {
  const code = String(ticker ?? '').trim()
  if (!code) return
  try {
    const f = await fetchFundamental(code)
    if (!f || needsCoreWarm(f)) {
      await warmStock(code, name)
      return
    }
    if (needsHistoryWarm(f)) {
      await warmStockHistory(code, name)
    }
  } catch {
    // Background best-effort — analysis page can still warm on open.
  }
}
