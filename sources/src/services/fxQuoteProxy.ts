/**
 * 匯率**即時報價**：經 `stock-price` Edge Function 取得，帶 localStorage TTL 快取。
 *
 * **與 fxProxy 的分工**（0.6.7 拆開的理由）：
 * - `fxProxy` 讀 `fx/twd.json` —— 每日排程預產的**歷史序列**，走勢圖用。
 * - 這裡讀的是**現在的報價**，幣別卡與日變動用。
 *
 * 為什麼非拆不可：`fx/twd.json` 的最後一筆是「最近一根**完整**日線」，
 * 而今天的日線要等倫敦日過完（台北隔天早上 07:00）才成立 ——
 * 整個交易日內畫面都會停在昨天的收盤。實測 2026-07-29 台北 11:00：
 * 檔案 32.302、市場實際 32.435，差 0.42%。
 *
 * 快取策略沿用 priceProxy 的三層：L1 這裡的 localStorage、L2 Edge Function 的
 * `price_cache`、L3 Yahoo。TTL 10 分鐘、兩層一致，且 `asOf` 用報價的實際取得時間，
 * 兩層 TTL 才不會疊加（同 priceProxy 的準則）。
 */
import { isSupabaseConfigured, supabase } from './supabase'

export interface FxQuote {
  /** 1 單位外幣可換多少台幣（與 fxProxy 的方向一致） */
  price: number
  /** 報價的實際取得時間 ISO */
  asOf: string
}

export type FxQuoteMap = Record<string, FxQuote>

/** 與 Edge Function 的 FX_CACHE_TTL_MS 一致 */
export const FX_QUOTE_TTL_MS = 10 * 60 * 1000

const CACHE_KEY = 'stock-pnl-web/fx-quotes-v1'

export function readFxQuoteCache(): FxQuoteMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const out: FxQuoteMap = {}
    for (const [code, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price <= 0) continue
      if (typeof o.asOf !== 'string') continue
      out[code] = { price: o.price, asOf: o.asOf }
    }
    return out
  } catch {
    return {}
  }
}

function writeFxQuoteCache(map: FxQuoteMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    // 無痕模式 / 配額滿：記不住快取不影響功能
  }
}

export function isQuoteFresh(q: FxQuote | undefined, now: number): q is FxQuote {
  if (!q) return false
  const t = Date.parse(q.asOf)
  return Number.isFinite(t) && now - t < FX_QUOTE_TTL_MS
}

/**
 * 取得指定幣別的即時報價。
 *
 * 失敗一律回**已知的快取值**而不是拋錯 —— 這一頁在報價拿不到時仍要能看
 * （幣別卡會退回每日檔的收盤價，見 FxPage）。
 *
 * @param force 忽略 TTL 強制重抓（畫面上的「重新整理」用）
 */
export async function fetchFxQuotes(codes: string[], force = false): Promise<FxQuoteMap> {
  const cached = readFxQuoteCache()
  if (!isSupabaseConfigured || !supabase || codes.length === 0) return cached

  const now = Date.now()
  const missing = force ? codes : codes.filter((c) => !isQuoteFresh(cached[c], now))
  if (missing.length === 0) return cached

  try {
    const { data, error } = await supabase.functions.invoke('stock-price', {
      body: { action: 'fx', codes: missing },
    })
    if (error) return cached

    const quotes = (data as { quotes?: unknown } | null)?.quotes
    if (!quotes || typeof quotes !== 'object') return cached

    const merged: FxQuoteMap = { ...cached }
    for (const [code, v] of Object.entries(quotes as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price <= 0) continue
      merged[code] = { price: o.price, asOf: typeof o.asOf === 'string' ? o.asOf : new Date().toISOString() }
    }
    writeFxQuoteCache(merged)
    return merged
  } catch {
    return cached
  }
}
