/**
 * Background asynchronously pulls current share price:
 * Automatically capture when the holding list changes; background polling every minute (the code in the TTL hits the cache, no request is sent,
 * Updated within 1 minute after expiration); catch up when paging returns to the foreground; provide manual rearrangement.
 * The caller displays a skeleton screen or cached price before loading is complete (quote.stale = true).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Holding } from '../utils/pnlEngine'
import type { PriceMap } from '../services/priceProxy'
import { fetchPrices } from '../services/priceProxy'

/** Background polling interval: whether to actually send a request is determined by the sub-market TTL of priceProxy*/
const POLL_INTERVAL_MS = 60 * 1000

export interface StockPricesState {
  prices: PriceMap
  loading: boolean
  refreshedAt: Date | null
  refresh: () => void
}

export function useStockPrices(holdings: Holding[]): StockPricesState {
  const [prices, setPrices] = useState<PriceMap>({})
  const [loading, setLoading] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const requestSeq = useRef(0)

  // Only re-capture when the "holding portfolio" changes (not required for qty changes)
  const holdingsKey = useMemo(
    () => holdings.map((h) => h.key).sort().join(','),
    [holdings],
  )
  const itemsRef = useRef(holdings)
  itemsRef.current = holdings

  // silent: used for background polling, does not trigger loading instructions (to avoid the refresh button flashing every minute)
  const load = useCallback(async (options?: { force?: boolean; silent?: boolean }) => {
    // The same code number may appear in multiple columns. Use key to remove duplicates first and then check the price.
    const byKey = new Map(itemsRef.current.map((h) => [h.key, h]))
    const items = [...byKey.values()].map((h) => ({ market: h.market, ticker: h.ticker }))
    if (items.length === 0) {
      setPrices({})
      return
    }
    const seq = ++requestSeq.current
    if (!options?.silent) setLoading(true)
    try {
      const map = await fetchPrices(items, { force: options?.force })
      if (seq !== requestSeq.current) return // 過期回應直接丟棄
      setPrices(map)
      setRefreshedAt(new Date())
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey, load])

  // Background polling + re-capture when switching back to the foreground after paging (the background paging timer will be throttled by the browser and will be replenished when switching back)
  useEffect(() => {
    const timer = setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Manual Refresh: Bypassing TTL cache and forcing a refetch
  const refresh = useCallback(() => void load({ force: true }), [load])

  return { prices, loading, refreshedAt, refresh }
}
