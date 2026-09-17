/**
 * Per-position Yahoo chart quotes for the Discord holdings card (Task 165 Phase 2).
 * Spec: docs/agent/specs/discord-holdings.md §2.2.
 */
import { indexChartUrl, type IndexChartResponse } from './globalIndexClose.ts'
import { tradingDateOf } from './twDaily.ts'
import { positionKey, type Market } from '../_shared/engine/models.ts'

export interface HoldingQuote {
  ymd: string
  close: number
  prevClose: number | null
}

/**
 * Picks the last bar whose session has closed, re-stating `lastCompletedClose`
 * (globalIndexClose.ts:47-78): D6 leaves that file untouched, so the same open-session
 * rule is duplicated here rather than imported.
 */
export function lastCompletedBar(resp: IndexChartResponse, nowSec: number): HoldingQuote | null {
  const result = resp.chart?.result?.[0]
  if (!result) return null
  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []

  const bars: Array<{ t: number; close: number }> = []
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i]
    if (typeof c === 'number' && Number.isFinite(c)) bars.push({ t: timestamps[i], close: c })
  }
  if (bars.length === 0) return null
  bars.sort((a, b) => a.t - b.t)

  const regular = result.meta?.currentTradingPeriod?.regular
  if (regular && typeof regular.start === 'number' && typeof regular.end === 'number' && nowSec < regular.end) {
    const last = bars[bars.length - 1]
    if (last.t >= regular.start) bars.pop()
  }
  if (bars.length === 0) return null

  const last = bars[bars.length - 1]
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null
  const gmtoffset = result.meta?.gmtoffset ?? 0
  return { ymd: tradingDateOf(last.t, gmtoffset), close: last.close, prevClose: prev ? prev.close : null }
}

/** TPE tries the listed symbol then OTC; US has one symbol space. */
export function quoteSymbols(market: Market, ticker: string): string[] {
  return market === 'TPE' ? [`${ticker}.TW`, `${ticker}.TWO`] : [ticker]
}

/** Parsed JSON; rejects on network / non-2xx. */
export type ChartFetch = (url: string) => Promise<unknown>

/**
 * `ChartFetch` with a timeout and one retry (added after the step-2b review: no timeout
 * and no retry was a risk). 429/5xx/network/timeout get one retry after a 500ms sleep,
 * whichever of the two failure kinds happens first; any other non-2xx rejects at once;
 * a JSON parse failure rejects without a retry.
 */
export function makeChartFetch(deps: {
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  timeoutMs?: number
}): ChartFetch {
  const timeoutMs = deps.timeoutMs ?? 8_000

  const once = (url: string): Promise<Response> => deps.fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })

  async function finish(res: Response, url: string, alreadyRetried: boolean): Promise<unknown> {
    if (res.ok) return res.json()
    if (!alreadyRetried && (res.status === 429 || res.status >= 500)) {
      await deps.sleep(500)
      const retried = await once(url)
      return finish(retried, url, true)
    }
    throw new Error(`HTTP ${res.status}`)
  }

  return async (url: string): Promise<unknown> => {
    let res: Response
    try {
      res = await once(url)
    } catch {
      await deps.sleep(500)
      res = await once(url) // second attempt; a rejection here propagates as the final failure
      return finish(res, url, true)
    }
    return finish(res, url, false)
  }
}

/**
 * One fetch sequence per position key per run: quotes are memoized across every user's
 * ledgers so two users holding the same ticker do not double the Yahoo calls.
 */
export function createQuoteCache(
  fetchJson: ChartFetch,
  nowSec: number,
): { get(market: Market, ticker: string): Promise<HoldingQuote | null> } {
  const cache = new Map<string, Promise<HoldingQuote | null>>()

  return {
    get(market: Market, ticker: string): Promise<HoldingQuote | null> {
      const key = positionKey(market, ticker)
      let pending = cache.get(key)
      if (!pending) {
        pending = (async () => {
          for (const symbol of quoteSymbols(market, ticker)) {
            try {
              const json = await fetchJson(indexChartUrl(symbol))
              const bar = lastCompletedBar(json as IndexChartResponse, nowSec)
              if (bar) return bar
            } catch {
              // this symbol failed (network, non-2xx, or a synchronous throw) — try the next one
            }
          }
          return null
        })()
        cache.set(key, pending)
      }
      return pending
    },
  }
}
