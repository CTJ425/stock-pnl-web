/**
 * USD→TWD rate for the dashboard's combined totals (2026-09-26 redesign).
 *
 * Reads the same real-time FX quote the 外幣匯率 page uses (`fetchFxQuotes`, localStorage TTL
 * cache, then the `stock-price` Edge Function). In local mode there is no Edge Function and no
 * cache, so the rate stays null and the dashboard keeps the two markets apart instead of
 * inventing a conversion.
 */
import { useEffect, useState } from 'react'
import { fetchFxQuotes } from '../services/fxQuoteProxy'

export function useUsdTwdRate(active: boolean, refreshKey: number): number | null {
  const [rate, setRate] = useState<number | null>(null)

  useEffect(() => {
    if (!active) return
    let alive = true
    void fetchFxQuotes(['USD'], refreshKey > 0).then((quotes) => {
      if (alive) setRate(quotes.USD?.price ?? null)
    })
    return () => {
      alive = false
    }
  }, [active, refreshKey])

  return active ? rate : null
}
