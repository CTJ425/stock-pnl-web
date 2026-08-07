/**
 * Before the newly added stocks ran out in batches at night, the daily line and fundamentals did not exist yet.
 * This service allows the front end to call an Edge Function once when "Storage is found", without having to wait until 17:30 that night.
 *
 * Call discipline (this is the key to quota safety, don’t bypass it):
 * 1. **Only called when Storage is empty or the fundamental history has not been filled**. It cannot be called unconditionally every time it is mounted.
 * 2. **The same codename is only typed once in the entire session**——`attempted`. Note down the codenames that have been tried.
 *    Even if the server replies "There is no data in this file" (for example, the ETF has no fundamentals), it will not be retried.
 *    Without this, a stock that can never get data will cause users to burn an invocation every time they cut a page.
 *
 *    **The only exception (0.6.29)**: Unseal the codename when the server returns `fundamentalComplete: false`.
 *    That means the history has not been completed (the time budget has been used up), and it should be completed next time the page is opened——
 *    This is a loop with an endpoint: after it is filled up, the server will return true and the seal will take effect from now on.
 * 3. Concurrency deduplication: `inflight` allows multiple components that are triggered at the same time to share the same promise.
 *
 * Server side (0.6.44): `assertUser` + per-account `WARM_DAILY_LIMIT`, plus the batch's own
 * "skip if already latest" short-circuit. Front-end session seal and back-end quota both stay ——
 * the former saves invocations for the user, the latter bounds abuse after the holdings whitelist
 * was retired so any listed code can be warmed.
 */
import { supabase } from './supabase'

export interface WarmResult {
  ok: boolean
  dailySynced: number
  fundamentalSynced: number
  /** Whether the history of fundamentals has been corrected to the point where there is nothing left to add; false means it is worth calling again*/
  fundamentalComplete: boolean
  /**
   * This time, the number of periods actually filled in (month + quarter) will be replenished.
   *
   * and `fundamentalSynced` are two different things: the latter only counts whether syncFundamental has rewritten the entire file.
   * The backfill is to merge the history column by column into the existing file, and the count will not be touched——
   * The caller must look at this to determine whether it is worth re-reading Storage.
   */
  backfilled: number
}

const FAILED: WarmResult = {
  ok: false,
  dailySynced: 0,
  fundamentalSynced: 0,
  fundamentalComplete: false,
  backfilled: 0,
}

const inflight = new Map<string, Promise<WarmResult>>()
const attempted = new Set<string>()

/** For testing: clear the deduplication status of this module*/
export function resetWarmState(): void {
  inflight.clear()
  attempted.clear()
}

/**
 * Replace the daily production line and fundamentals of a single model.
 * The same code number will only be sent once in the same session; repeated calls will directly return the last result or failure value.
 *
 * `name` became the caller's job in 0.6.44: the server used to look it up in the holdings whitelist,
 * and that whitelist is gone. It only lands in `fundamental/{ticker}.json`, which nothing on screen
 * reads, so an omitted name costs nothing —— pass it when you have it and the stored file stays honest.
 */
export async function warmStock(ticker: string, name?: string): Promise<WarmResult> {
  if (!supabase) return FAILED

  const pending = inflight.get(ticker)
  if (pending) return pending
  if (attempted.has(ticker)) return FAILED

  attempted.add(ticker)

  const task = (async (): Promise<WarmResult> => {
    try {
      const { data, error } = await supabase.functions.invoke('stock-report', {
        body: { action: 'warm', ticker, name: name ?? '' },
      })
      if (error || !data || typeof data !== 'object') return FAILED
      const d = data as Record<string, unknown>
      const result: WarmResult = {
        ok: d.ok === true,
        dailySynced: typeof d.dailySynced === 'number' ? d.dailySynced : 0,
        fundamentalSynced: typeof d.fundamentalSynced === 'number' ? d.fundamentalSynced : 0,
        fundamentalComplete: d.fundamentalComplete === true,
        backfilled:
          (Array.isArray(d.revenueMonths) ? d.revenueMonths.length : 0) +
          (Array.isArray(d.profitQuarters) ? d.profitQuarters.length : 0),
      }
      // Release the seal before the filling is completed, and let the filling continue the next time the page is opened (the server returns true after the filling is completed, and the seal takes effect)
      if (result.ok && !result.fundamentalComplete) attempted.delete(ticker)
      return result
    } catch {
      return FAILED
    } finally {
      inflight.delete(ticker)
    }
  })()

  inflight.set(ticker, task)
  return task
}
