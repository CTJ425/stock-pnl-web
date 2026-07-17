/**
 * 台美股搜尋與代號反查（移植自 GAS 版 unifiedSearch / searchByTicker）：
 * - 台股：由 TWSE / TPEx OpenAPI 全清單在本地模糊比對（雙向：代號前綴、名稱包含）
 * - 美股：經 Supabase Edge Function 代理 Yahoo Finance 搜尋（未設定時僅台股可搜尋）
 */
import type { Market } from '../types/models'
import { isSupabaseConfigured, supabase } from './supabase'
import { getTwStockList } from './twMarketData'

export interface StockSearchResult {
  symbol: string
  name: string
  market: Market
}

const MAX_RESULTS = 10

function hasCJK(str: string): boolean {
  return /[一-鿿]/.test(str)
}

const TW_TICKER_QUERY_RE = /^\d{3,6}[A-Z]?$/i

async function searchTw(query: string): Promise<StockSearchResult[]> {
  try {
    const list = await getTwStockList()
    const q = query.toUpperCase()
    return list
      .filter((r) => r.symbol.startsWith(q) || r.name.includes(query))
      .slice(0, MAX_RESULTS)
      .map((r) => ({ symbol: r.symbol, name: r.name, market: 'TPE' as const }))
  } catch {
    return []
  }
}

interface EdgeSearchResponse {
  results?: Array<{ symbol: string; name: string; market: string }>
}

async function searchViaEdge(query: string): Promise<StockSearchResult[]> {
  if (!isSupabaseConfigured || !supabase) return []
  try {
    const { data, error } = await supabase.functions.invoke<EdgeSearchResponse>('stock-price', {
      body: { action: 'search', query },
    })
    if (error || !Array.isArray(data?.results)) return []
    return data.results
      .filter((r) => r.symbol && r.name)
      .map((r) => ({
        symbol: r.symbol,
        name: r.name,
        market: (r.market === 'TPE' ? 'TPE' : 'US') as Market,
      }))
      .slice(0, MAX_RESULTS)
  } catch {
    return []
  }
}

/** 名稱 / 代號關鍵字搜尋：中文或數字代號優先走台股清單，其餘優先走 Yahoo（經 Edge） */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const looksTaiwan = hasCJK(q) || TW_TICKER_QUERY_RE.test(q)
  if (looksTaiwan) {
    const tw = await searchTw(q)
    if (tw.length > 0) return tw
    return searchViaEdge(q)
  }
  const edge = await searchViaEdge(q)
  if (edge.length > 0) return edge
  return searchTw(q)
}

/** 代號反查名稱與市場（優先精確比對代號與指定市場） */
export async function lookupTicker(
  ticker: string,
  preferredMarket: Market,
): Promise<StockSearchResult | null> {
  const clean = ticker.trim().toUpperCase()
  if (!clean) return null

  const results = await searchStocks(clean)
  if (results.length === 0) return null

  return (
    results.find((r) => r.symbol === clean && r.market === preferredMarket) ??
    results.find((r) => r.symbol === clean) ??
    results.find((r) => r.market === preferredMarket) ??
    results[0]
  )
}
