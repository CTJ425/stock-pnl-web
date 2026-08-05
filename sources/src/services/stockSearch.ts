/**
 * Taiwan and US stock search and code reverse check (ported from GAS version unifiedSearch / searchByTicker):
 * - Taiwan stocks: local fuzzy comparison by TWSE / TPEx OpenAPI full list (two-way: code prefix, name inclusion)
 * - US stocks: first compare the built-in Chinese name table (supports Chinese reverse search, available offline),
 *   Then search and supplement through Supabase Edge Function agent Yahoo Finance
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

/** The names of warrants/CBBCs end with "Qunyi 5A Sell 12", "Tongyi 58 Buy 02", "Fubon 64 Bear 01"; the search results are excluded to avoid overshadowing the underlying stocks.*/
const TW_WARRANT_NAME_RE = /[購售牛熊]\d+$/

/** Ranking of matching degree: exact match > match at the beginning of the name > code prefix > name contains; the smaller the score, the higher it is*/
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
          // Priority will be given to short names at the same time ("TSMC" is ranked before derivatives such as "TSMC Qunyi 92")
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

/** Name/code keyword search: Chinese or numeric code priority list of Taiwan stocks (Chinese is compared to the Chinese list of US stocks),
 *  For others, go to Yahoo first (via Edge), and the Chinese translation of the name will be displayed first.*/
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
    // Yahoo returns the English name; common U.S. stock changes are displayed with Chinese translations
    return edge.map((r) =>
      r.market === 'US' ? { ...r, name: usZhName(r.symbol) ?? r.name } : r,
    )
  }
  const usLocal = searchUsZhNames(q)
  if (usLocal.length > 0) return usLocal
  return searchTw(q)
}

/** Code name and market reverse check (priority is given to accurate comparison of code names and designated markets)*/
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
