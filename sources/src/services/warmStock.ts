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
 *    **Unseal only when incomplete AND this call made progress** (0.6.44-dev.7):
 *    `fundamentalComplete: false` alone used to unseal every time, so a stock stuck below 12 quarters
 *    (budget exhausted, MOPS empty) re-warmed on every page open. Now we unseal only when
 *    `backfilled > 0` — real progress with room left. No progress → stay sealed; nightly batch
 *    remains the path to finish the rest.
 * 3. Concurrency deduplication: `inflight` allows multiple components that are triggered at the same time to share the same promise.
 *
 * Server side (0.6.44): `assertUser` + per-account `WARM_DAILY_LIMIT`, plus the batch's own
 * "skip if already latest" short-circuit. Front-end session seal and back-end quota both stay ——
 * the former saves invocations for the user, the latter bounds abuse after the holdings whitelist
 * was retired so any listed code can be warmed.
 *
 * Phased warm (0.6.46-dev.4):
 * - `warmStockCore` — daily + latest fundamental (quota charged). Page paint + daily chart use this.
 * - `warmStockHistory` — MOPS revenue/profit backfill only (no second quota). Call after core when
 *   `fundamentalComplete` is false.
 * - `warmStock` — progressive: core then history (prefetch / one-shot callers).
 *
 * BUG-A fix (0.6.46-dev.5):
 * - Sealed core/history returns the **last result** for that ticker (not a bare FAILED) so callers
 *   still see `ok` / `fundamentalComplete` and can decide to run history.
 * - Detail page also starts history when Storage is still thin even if core did not re-run.
 */
import { supabase } from './supabase'

export type WarmPhase = 'core' | 'history' | 'full'

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
  /** Echo of the phase that ran (absent on failed/local short-circuits). */
  phase?: WarmPhase
}

const FAILED: WarmResult = {
  ok: false,
  dailySynced: 0,
  fundamentalSynced: 0,
  fundamentalComplete: false,
  backfilled: 0,
}

const inflightCore = new Map<string, Promise<WarmResult>>()
const inflightHistory = new Map<string, Promise<WarmResult>>()
const attemptedCore = new Set<string>()
const attemptedHistory = new Set<string>()
/** Last outcome per ticker so a sealed re-call does not look like a hard failure (BUG-A). */
const lastCore = new Map<string, WarmResult>()
const lastHistory = new Map<string, WarmResult>()

/**
 * Chip backfill (三大法人 / 融資券 / 借券) for a newly added symbol (Task 130).
 * Separate result shape from `WarmResult` — the server slices the already-cached
 * whole-market payload for one ticker, so there is no daily/fundamental count here.
 */
export interface WarmChipsResult {
  ok: boolean
  daysWritten: number
  /** True when the reports for the latest ymd already existed; not a failure. */
  skipped?: boolean
}

const FAILED_CHIPS: WarmChipsResult = { ok: false, daysWritten: 0 }

const inflightChips = new Map<string, Promise<WarmChipsResult>>()
const attemptedChips = new Set<string>()
const lastChips = new Map<string, WarmChipsResult>()

/** For testing: clear the deduplication status of this module*/
export function resetWarmState(): void {
  inflightCore.clear()
  inflightHistory.clear()
  attemptedCore.clear()
  attemptedHistory.clear()
  lastCore.clear()
  lastHistory.clear()
  inflightChips.clear()
  attemptedChips.clear()
  lastChips.clear()
}

function parseWarmResult(data: Record<string, unknown>, phase: WarmPhase): WarmResult {
  return {
    ok: data.ok === true,
    dailySynced: typeof data.dailySynced === 'number' ? data.dailySynced : 0,
    fundamentalSynced: typeof data.fundamentalSynced === 'number' ? data.fundamentalSynced : 0,
    fundamentalComplete: data.fundamentalComplete === true,
    backfilled:
      (Array.isArray(data.revenueMonths) ? data.revenueMonths.length : 0) +
      (Array.isArray(data.profitQuarters) ? data.profitQuarters.length : 0),
    phase,
  }
}

/**
 * Unseal history only when incomplete *and* this round filled something — otherwise seal sticks
 * (avoids burning warm every open when the server keeps returning complete=false).
 */
function maybeUnsealHistory(ticker: string, result: WarmResult): void {
  if (result.ok && !result.fundamentalComplete && result.backfilled > 0) {
    attemptedHistory.delete(ticker)
  }
}

async function invokeWarm(
  ticker: string,
  name: string | undefined,
  phase: WarmPhase,
): Promise<WarmResult> {
  if (!supabase) return { ...FAILED, phase }
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'warm', ticker, name: name ?? '', phase },
      timeout: 45_000, // server WARM_BUDGET_MS = 30_000, plus headroom
    })
    if (error || !data || typeof data !== 'object') return { ...FAILED, phase }
    return parseWarmResult(data as Record<string, unknown>, phase)
  } catch {
    return { ...FAILED, phase }
  }
}

/**
 * Daily line + latest fundamental only. Quota is charged on the server for this phase.
 * Same ticker is sealed for the rest of the session after one attempt (including concurrent share).
 * Re-calls return the last result (not FAILED) so UI can still chain history (BUG-A).
 */
export async function warmStockCore(ticker: string, name?: string): Promise<WarmResult> {
  if (!supabase) return FAILED

  const pending = inflightCore.get(ticker)
  if (pending) return pending
  if (attemptedCore.has(ticker)) {
    return lastCore.get(ticker) ?? { ...FAILED, phase: 'core' }
  }

  attemptedCore.add(ticker)

  const task = (async (): Promise<WarmResult> => {
    try {
      const result = await invokeWarm(ticker, name, 'core')
      lastCore.set(ticker, result)
      return result
    } finally {
      inflightCore.delete(ticker)
    }
  })()

  inflightCore.set(ticker, task)
  return task
}

/**
 * MOPS history backfill only. Does not charge a second daily quota (server-side).
 * Call after `warmStockCore` when `fundamentalComplete` is false.
 * Unseals only when incomplete and this round made progress.
 * Sealed re-calls return the last history result (BUG-A companion).
 */
export async function warmStockHistory(ticker: string, name?: string): Promise<WarmResult> {
  if (!supabase) return FAILED

  const pending = inflightHistory.get(ticker)
  if (pending) return pending
  if (attemptedHistory.has(ticker)) {
    return lastHistory.get(ticker) ?? { ...FAILED, phase: 'history' }
  }

  attemptedHistory.add(ticker)

  const task = (async (): Promise<WarmResult> => {
    try {
      const result = await invokeWarm(ticker, name, 'history')
      lastHistory.set(ticker, result)
      maybeUnsealHistory(ticker, result)
      return result
    } finally {
      inflightHistory.delete(ticker)
    }
  })()

  inflightHistory.set(ticker, task)
  return task
}

/**
 * Progressive warm: core then history when needed.
 * Prefer this for background prefetch. Detail pages should call core, paint, then history
 * so first paint is not blocked by MOPS.
 *
 * `name` became the caller's job in 0.6.44: the server used to look it up in the holdings whitelist,
 * and that whitelist is gone. It only lands in `fundamental/{ticker}.json`, which nothing on screen
 * reads, so an omitted name costs nothing —— pass it when you have it and the stored file stays honest.
 */
export async function warmStock(ticker: string, name?: string): Promise<WarmResult> {
  const core = await warmStockCore(ticker, name)
  if (!core.ok || core.fundamentalComplete) return core

  const hist = await warmStockHistory(ticker, name)
  return {
    ok: core.ok || hist.ok,
    dailySynced: core.dailySynced + hist.dailySynced,
    fundamentalSynced: core.fundamentalSynced + hist.fundamentalSynced,
    fundamentalComplete: hist.ok ? hist.fundamentalComplete : core.fundamentalComplete,
    backfilled: core.backfilled + hist.backfilled,
    phase: 'full',
  }
}

function parseChipsResult(data: Record<string, unknown>): WarmChipsResult {
  return {
    ok: data.ok === true,
    daysWritten: typeof data.daysWritten === 'number' ? data.daysWritten : 0,
    skipped: data.skipped === 'already-present' ? true : undefined,
  }
}

async function invokeWarmChips(ticker: string, name: string | undefined): Promise<WarmChipsResult> {
  if (!supabase) return FAILED_CHIPS
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'warm', ticker, name: name ?? '', phase: 'chips' },
      timeout: 45_000,
    })
    if (error || !data || typeof data !== 'object') return FAILED_CHIPS
    return parseChipsResult(data as Record<string, unknown>)
  } catch {
    return FAILED_CHIPS
  }
}

/**
 * Chip backfill for a newly added symbol. Sealed per ticker for the rest of the session
 * (same style as `warmStockCore`) so a re-render or a second `addWatch` cannot burn a
 * second invocation.
 */
export async function warmStockChips(ticker: string, name?: string): Promise<WarmChipsResult> {
  if (!supabase) return FAILED_CHIPS

  const pending = inflightChips.get(ticker)
  if (pending) return pending
  if (attemptedChips.has(ticker)) {
    return lastChips.get(ticker) ?? FAILED_CHIPS
  }

  attemptedChips.add(ticker)

  const task = (async (): Promise<WarmChipsResult> => {
    try {
      const result = await invokeWarmChips(ticker, name)
      lastChips.set(ticker, result)
      return result
    } finally {
      inflightChips.delete(ticker)
    }
  })()

  inflightChips.set(ticker, task)
  return task
}
