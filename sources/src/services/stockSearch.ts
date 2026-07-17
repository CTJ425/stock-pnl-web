/**
 * 台美股搜尋與代號反查（移植自 GAS 版 unifiedSearch / searchByTicker）：
 * - 台股：由 TWSE / TPEx OpenAPI 全清單在本地模糊比對（雙向：代號前綴、名稱包含）
 * - 美股：先比對內建中文名稱表（支援中文反查、離線可用），
 *   再經 Supabase Edge Function 代理 Yahoo Finance 搜尋補足
 */
import type { Market } from '../types/models'
import { isSupabaseConfigured, supabase } from './supabase'
import { getTwStockList } from './twMarketData'
import { searchUsZhNames, usZhName } from './usStockNames'

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

/** 權證 / 牛熊證名稱結尾如「群益5A售12」「統一58購02」「富邦64熊01」；搜尋結果排除，避免蓋過正股 */
const TW_WARRANT_NAME_RE = /[購售牛熊]\d+$/

/** 匹配程度排名：完全相符 > 名稱開頭相符 > 代號前綴 > 名稱包含；分數越小越前面 */
function twMatchScore(symbol: string, name: string, query: string, upperQuery: string): number {
  if (name === query || symbol === upperQuery) return 0
  if (name.startsWith(query)) return 1
  if (symbol.startsWith(upperQuery)) return 2
  if (name.includes(query)) return 3
  return -1
}

async function searchTw(query: string): Promise<StockSearchResult[]> {
  try {
    const list = await getTwStockList()
    const q = query.toUpperCase()
    return list
      .filter((r) => !TW_WARRANT_NAME_RE.test(r.name))
      .map((r) => ({ row: r, score: twMatchScore(r.symbol, r.name, query, q) }))
      .filter((x) => x.score >= 0)
      .sort(
        (a, b) =>
          a.score - b.score ||
          // 同分時短名優先（「台積電」排在「台積電群益92」等衍生商品前）
          a.row.name.length - b.row.name.length ||
          a.row.symbol.localeCompare(b.row.symbol),
      )
      .slice(0, MAX_RESULTS)
      .map(({ row: r }) => ({ symbol: r.symbol, name: r.name, market: 'TPE' as const }))
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

/** 名稱 / 代號關鍵字搜尋：中文或數字代號優先走台股清單（中文另比對美股中文名表），
 *  其餘優先走 Yahoo（經 Edge），名稱以中文譯名優先顯示 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const looksTaiwan = hasCJK(q) || TW_TICKER_QUERY_RE.test(q)
  if (looksTaiwan) {
    const tw = await searchTw(q)
    const usZh = hasCJK(q) ? searchUsZhNames(q) : []
    const combined = [...tw, ...usZh].slice(0, MAX_RESULTS)
    if (combined.length > 0) return combined
    return searchViaEdge(q)
  }
  const edge = await searchViaEdge(q)
  if (edge.length > 0) {
    // Yahoo 回傳英文名稱；常見美股改以中文譯名顯示
    return edge.map((r) =>
      r.market === 'US' ? { ...r, name: usZhName(r.symbol) ?? r.name } : r,
    )
  }
  const usLocal = searchUsZhNames(q)
  if (usLocal.length > 0) return usLocal
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
