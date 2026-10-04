/**
 * Live quote for the one watched (not held) Taiwan stock on screen in 個股分析.
 *
 * `useStockPrices` is holdings-only, so a watched ticker used to be fetched once per selection in an
 * effect inside AnalysisPage. Two defects came with that (Task 193 M4 / M5):
 *  - the quote lived in `useState` that an effect cleared AFTER the new selection had rendered, so for one
 *    render the next stock was shown with the previous stock's price, and 損益試算 seeded its inputs from it;
 *  - nothing polled, so the price froze at the moment of selection while the page promised a refresh
 *    every minute.
 *
 * The state is keyed by ticker and only read back for the ticker asked about, so a stale quote can never be
 * returned. Polling follows `useStockPrices`: a minute apart, skipped while the tab is hidden, caught up on
 * return (`fetchPrices` serves a fresh quote from its TTL cache, so most ticks send no request).
 */
import { useEffect, useState } from 'react'
import { fetchPrices, type PriceQuote } from '../services/priceProxy'
import { positionKey } from '../types/models'

const POLL_INTERVAL_MS = 60 * 1000

export function useWatchQuote(ticker: string | null): PriceQuote | null {
  const [state, setState] = useState<{ ticker: string; quote: PriceQuote | null } | null>(null)

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    const load = () => {
      fetchPrices([{ market: 'TPE', ticker }])
        .then((map) => {
          if (!cancelled) setState({ ticker, quote: map[positionKey('TPE', ticker)] ?? null })
        })
        .catch(() => {
          if (!cancelled) setState({ ticker, quote: null })
        })
    }
    load()
    const poll = () => {
      if (document.visibilityState === 'visible') load()
    }
    let timer = setInterval(poll, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      clearInterval(timer)
      load()
      timer = setInterval(poll, POLL_INTERVAL_MS)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ticker])

  return ticker && state?.ticker === ticker ? state.quote : null
}
