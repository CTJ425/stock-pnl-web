/**
 * 背景非同步拉取持股現價：
 * 持股清單變動時自動抓取；每分鐘背景輪詢（TTL 內的代號命中快取、不發請求，
 * 過期後 1 分鐘內更新）；分頁切回前景時補抓；提供手動重新整理。
 * 載入完成前呼叫端顯示骨架屏或快取價（quote.stale = true）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Holding } from '../utils/pnlEngine'
import type { PriceMap } from '../services/priceProxy'
import { fetchPrices } from '../services/priceProxy'

/** 背景輪詢間隔：實際發請求與否由 priceProxy 的分市場 TTL 決定 */
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

  // 只在「持股組合」變動時重抓（qty 變動不需要）
  const holdingsKey = useMemo(
    () => holdings.map((h) => h.key).sort().join(','),
    [holdings],
  )
  const itemsRef = useRef(holdings)
  itemsRef.current = holdings

  // silent：背景輪詢用，不觸發 loading 指示（避免重新整理按鈕每分鐘閃動）
  const load = useCallback(async (options?: { force?: boolean; silent?: boolean }) => {
    // 同代號可能出現多列，先以 key 去重再查價
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

  // 背景輪詢 + 分頁切回前景補抓（背景分頁 timer 會被瀏覽器節流，切回時補上）
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

  // 手動重新整理：略過 TTL 快取強制重抓
  const refresh = useCallback(() => void load({ force: true }), [load])

  return { prices, loading, refreshedAt, refresh }
}
