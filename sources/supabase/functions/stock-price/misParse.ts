/**
 * TWSE MIS 即時行情（mis.twse.com.tw/stock/api/getStockInfo.jsp）純解析邏輯。
 * 與 Deno 執行環境無關，供 index.ts 使用並由前端 Vitest 直接單元測試
 * （見 src/services/misParse.test.ts）。
 *
 * MIS 為證交所看盤網站背後的非官方文件化端點，回應格式：
 *   { rtcode: '0000', msgArray: [{ c, z, y, b, ... }] }
 *   c: 代號；z: 最新成交價；y: 昨收；b: 最佳五檔買價（'_' 分隔）。
 *   無效值以 '-' 表示。
 */

export interface MisQuote {
  ticker: string
  price: number
}

/** 每檔同時嘗試上市（tse_）與上櫃（otc_）channel，MIS 會自動忽略無效者 */
const CHANNELS_PER_TICKER = 2
/** MIS 單次請求的 channel 上限（保守值，避免 URL 過長或被拒） */
const MAX_CHANNELS_PER_REQUEST = 50

/**
 * 將台股代號組成 MIS 查詢 channel 群組，每群組不超過單次請求上限，
 * 且同一代號的 tse/otc channel 保證落在同一群組。
 */
export function buildMisChannels(tickers: string[]): string[][] {
  const tickersPerGroup = Math.floor(MAX_CHANNELS_PER_REQUEST / CHANNELS_PER_TICKER)
  const groups: string[][] = []
  for (let i = 0; i < tickers.length; i += tickersPerGroup) {
    groups.push(
      tickers.slice(i, i + tickersPerGroup).flatMap((t) => [`tse_${t}.tw`, `otc_${t}.tw`]),
    )
  }
  return groups
}

function toPrice(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 成交價退階：z（成交）→ b 第一檔（買一）→ y（昨收，含盤後 / 尚無成交）。
 *
 * 實測 z 經常為 '-'（此端點的快照未必帶最後成交價），因此買一價是常態路徑而非例外。
 * 退階選買一（而非賣一或買賣中價）是刻意的：本頁的市值 / 未實現損益語意是
 * 「現在全部賣出可拿回多少」，買一才是實際可成交的賣出價，估算偏保守不偏樂觀。
 */
function pickPrice(row: Record<string, unknown>): number | null {
  const last = toPrice(row.z)
  if (last !== null) return last
  const firstBid = toPrice(String(row.b ?? '').split('_')[0])
  if (firstBid !== null) return firstBid
  return toPrice(row.y)
}

/**
 * 解析 MIS 回應為報價清單；無法解析的列直接略過。
 * 同一代號出現多列（理論上 tse/otc 不會同時有效）時取第一列。
 */
export function parseMisResponse(data: unknown): MisQuote[] {
  const body = data as { msgArray?: unknown } | null | undefined
  if (!body || !Array.isArray(body.msgArray)) return []

  const quotes: MisQuote[] = []
  const seen = new Set<string>()
  for (const item of body.msgArray) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const ticker = String(row.c ?? '').trim()
    if (!ticker || seen.has(ticker)) continue
    const price = pickPrice(row)
    if (price === null) continue
    seen.add(ticker)
    quotes.push({ ticker, price })
  }
  return quotes
}
