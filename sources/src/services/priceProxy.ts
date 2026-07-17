/**
 * 股票現價取得：
 * 1. 主要策略：Supabase Edge Function `stock-price`（伺服器端代抓 Yahoo Finance，繞開 CORS）
 * 2. 台股備援：TWSE / TPEx OpenAPI 直連（支援 CORS 的官方端點）
 * 3. 降級機制：API 失敗時回傳 localStorage 的上次快取價（標記 stale），
 *    完全無資料則為 null——UI 留空、不誤顯示為全額虧損（與 GAS 版同構）
 */
import type { Market } from '../types/models'
import { positionKey } from '../types/models'
import { isSupabaseConfigured, supabase } from './supabase'
import { getTwStockList } from './twMarketData'

export interface PriceQuote {
  price: number
  /** 取得時間 (ISO) */
  asOf: string
  source: 'edge' | 'twse' | 'cache'
  /** 是否為過期快取價 */
  stale: boolean
}

export interface PriceRequestItem {
  market: Market
  ticker: string
}

/** key 為 positionKey(market, ticker)，查無現價的代號不會出現在結果中 */
export type PriceMap = Record<string, PriceQuote>

const CACHE_KEY = 'stock-pnl-web/price-cache-v1'

function readPriceCache(): PriceMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PriceMap
  } catch {
    return {}
  }
}

function writePriceCache(map: PriceMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    // 快取寫入失敗不影響功能
  }
}

interface EdgePriceResponse {
  prices?: Record<string, { price: number }>
}

async function fetchFromEdge(items: PriceRequestItem[]): Promise<Map<string, number>> {
  const resolved = new Map<string, number>()
  if (!isSupabaseConfigured || !supabase || items.length === 0) return resolved
  try {
    const { data, error } = await supabase.functions.invoke<EdgePriceResponse>('stock-price', {
      body: { action: 'prices', symbols: items },
    })
    if (error || !data?.prices) return resolved
    for (const [key, quote] of Object.entries(data.prices)) {
      if (Number.isFinite(quote?.price) && quote.price > 0) {
        resolved.set(key, quote.price)
      }
    }
  } catch {
    // Edge Function 不可用時交由備援路徑處理
  }
  return resolved
}

async function fetchTwFallback(items: PriceRequestItem[]): Promise<Map<string, number>> {
  const resolved = new Map<string, number>()
  const twItems = items.filter((i) => i.market === 'TPE')
  if (twItems.length === 0) return resolved
  try {
    const list = await getTwStockList()
    const bySymbol = new Map(list.map((r) => [r.symbol, r]))
    for (const item of twItems) {
      const row = bySymbol.get(item.ticker)
      if (row?.close) resolved.set(positionKey(item.market, item.ticker), row.close)
    }
  } catch {
    // 直連備援也失敗時交由快取降級
  }
  return resolved
}

/**
 * 批次取得現價。回傳的 PriceMap 內含新鮮價與（僅在無新鮮價時的）快取價；
 * 兩者皆無的代號不在 map 中，呼叫端應將市值 / 未實現損益留空。
 */
export async function fetchPrices(items: PriceRequestItem[]): Promise<PriceMap> {
  const result: PriceMap = {}
  if (items.length === 0) return result

  const now = new Date().toISOString()
  const fromEdge = await fetchFromEdge(items)

  const unresolved = items.filter((i) => !fromEdge.has(positionKey(i.market, i.ticker)))
  const fromTw = await fetchTwFallback(unresolved)

  for (const [key, price] of fromEdge) {
    result[key] = { price, asOf: now, source: 'edge', stale: false }
  }
  for (const [key, price] of fromTw) {
    result[key] = { price, asOf: now, source: 'twse', stale: false }
  }

  // 快取降級：仍無現價者採用上次成功取得的價格（標記 stale）
  const cache = readPriceCache()
  for (const item of items) {
    const key = positionKey(item.market, item.ticker)
    if (!result[key] && cache[key]) {
      result[key] = { ...cache[key], source: 'cache', stale: true }
    }
  }

  // 僅把「新鮮價」寫回快取
  const nextCache = { ...cache }
  for (const [key, quote] of Object.entries(result)) {
    if (!quote.stale) nextCache[key] = quote
  }
  writePriceCache(nextCache)

  return result
}
