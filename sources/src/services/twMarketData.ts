/**
 * 台股全清單（上市 + 上櫃）：代號、名稱與最近收盤價。
 *
 * 資料來源（官方 OpenAPI 未開放 CORS，無法由瀏覽器直連）：
 * - 上市：TWSE openapi STOCK_DAY_AVG_ALL（日收盤價）
 * - 上櫃：TPEx openapi tpex_mainboard_quotes（與原 GAS 版 getOtcList_ 相同來源）
 *
 * 開發模式：經 Vite dev server 代理（vite.config.ts 的 /api/twse、/api/tpex）。
 * 正式環境：嘗試直連（多半因 CORS 失敗並靜默降級），主要依賴
 * Supabase Edge Function 代理（priceProxy / stockSearch 的優先路徑）。
 *
 * 清單快取於 localStorage（TTL 30 分鐘），同時供「名稱模糊搜尋 / 代號反查」
 * 與「台股現價備援」使用。
 */

const DEV = import.meta.env.DEV
const TWSE_URL = DEV
  ? '/api/twse/v1/exchangeReport/STOCK_DAY_AVG_ALL'
  : 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'
const TPEX_URL = DEV
  ? '/api/tpex/openapi/v1/tpex_mainboard_quotes'
  : 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

export interface TwStockRow {
  symbol: string
  name: string
  /** 最近收盤價；來源暫缺時為 null */
  close: number | null
}

const CACHE_KEY = 'stock-pnl-web/tw-list-v1'
const CACHE_TTL_MS = 30 * 60 * 1000

interface CacheShape {
  at: number
  rows: TwStockRow[]
}

function readCache(): TwStockRow[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheShape
    if (!Array.isArray(parsed.rows) || Date.now() - parsed.at > CACHE_TTL_MS) return null
    return parsed.rows
  } catch {
    return null
  }
}

function writeCache(rows: TwStockRow[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows } satisfies CacheShape))
  } catch {
    // 超過容量等情況直接放棄快取，功能不受影響
  }
}

function toNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function fetchTwse(): Promise<TwStockRow[]> {
  const res = await fetch(TWSE_URL, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`)
  const arr = (await res.json()) as Array<Record<string, unknown>>
  return arr
    .map((r) => ({
      symbol: String(r.Code ?? '').trim(),
      name: String(r.Name ?? '').trim(),
      close: toNumber(r.ClosingPrice),
    }))
    .filter((r) => r.symbol && r.name)
}

async function fetchTpex(): Promise<TwStockRow[]> {
  const res = await fetch(TPEX_URL, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`TPEx HTTP ${res.status}`)
  const arr = (await res.json()) as Array<Record<string, unknown>>
  return arr
    .map((r) => ({
      symbol: String(r.SecuritiesCompanyCode ?? r.Code ?? '').trim(),
      name: String(r.CompanyName ?? r.Name ?? '').trim(),
      close: toNumber(r.Close ?? r.ClosingPrice ?? r.LatestPrice),
    }))
    .filter((r) => r.symbol && r.name)
}

let inflight: Promise<TwStockRow[]> | null = null

/** 取得台股全清單（記憶體去重 + localStorage 快取；兩來源其一失敗仍回傳另一來源） */
export async function getTwStockList(): Promise<TwStockRow[]> {
  const cached = readCache()
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async () => {
    const results = await Promise.allSettled([fetchTwse(), fetchTpex()])
    const rows: TwStockRow[] = []
    const seen = new Set<string>()
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      for (const row of r.value) {
        if (seen.has(row.symbol)) continue
        seen.add(row.symbol)
        rows.push(row)
      }
    }
    if (rows.length === 0) {
      throw new Error('台股清單載入失敗（TWSE 與 TPEx 皆無回應）')
    }
    writeCache(rows)
    return rows
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}
