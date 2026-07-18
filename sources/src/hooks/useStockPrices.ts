/**
 * 背景非同步拉取持股現價：
 * 持股清單變動時自動抓取；提供手動重新整理。
 * 載入完成前呼叫端顯示骨架屏或快取價（quote.stale = true）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Holding } from '../utils/pnlEngine'
import type { PriceMap } from '../services/priceProxy'
import { fetchPrices } from '../services/priceProxy'

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

  // 只在「持股組合」變動時重抓（qty 變動不需要）
  const holdingsKey = useMemo(
    () => holdings.map((h) => h.key).sort().join(','),
    [holdings],
  )
  const itemsRef = useRef(holdings)
  itemsRef.current = holdings

  const load = useCallback(async (force = false) => {
    // 總覽模式同代號可能跨工作區出現多列，先以 key 去重再查價
    const byKey = new Map(itemsRef.current.map((h) => [h.key, h]))
    const items = [...byKey.values()].map((h) => ({ market: h.market, ticker: h.ticker }))
    if (items.length === 0) {
      setPrices({})
      return
    }
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const map = await fetchPrices(items, { force })
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

  // 手動重新整理：略過 TTL 快取強制重抓
  const refresh = useCallback(() => void load(true), [load])

  return { prices, loading, refreshedAt, refresh }
}
