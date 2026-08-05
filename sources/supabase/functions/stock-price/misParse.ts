/**
 * TWSE MIS 即時行情（mis.twse.com.tw/stock/api/getStockInfo.jsp）純解析邏輯。
 * 與 Deno 執行環境無關，供 index.ts 使用並由前端 Vitest 直接單元測試
 * （見 src/services/misParse.test.ts）。
 *
 * MIS 為證交所看盤網站背後的非官方文件化端點，回應格式：
 *   { rtcode: '0000', msgArray: [{ c, z, y, b, ... }] }
 *   c: 代號；z: 最新成交價；y: 昨收；b: 最佳五檔買價（'_' 分隔）；
 *   o/h/l: 今日開盤 / 最高 / 最低；v: 累積成交量（張）；
 *   d: 交易日（YYYYMMDD）；t: 最後撮合時間（HH:mm:ss）；ip: 試撮中為 '1'。
 *   昨收本來就在同一筆回應裡，取它當漲跌著色的基準不會多打一次 API（0.6.34）。
 *   0.6.36 同理再取 o/h/l/v/d/t/ip 供個股分析的報價卡 —— 同一筆回應，零額外請求。
 *   收盤後這些欄位仍是當日定案值（實測 15:23 仍回 d=當日、t=13:30:00），
 *   而 TWSE OpenAPI 此時還停在前一個交易日，所以「今收」一律以本端點為準。
 *   無效值以 '-' 表示。
 */

export interface MisQuote {
  ticker: string
  price: number
  /** 昨收（`y`）；無效時為 null。前端據此判斷現價的漲跌著色 */
  prevClose: number | null
  /** 今日開盤（`o`） */
  open: number | null
  /** 今日最高（`h`） */
  high: number | null
  /** 今日最低（`l`） */
  low: number | null
  /** 累積成交量（`v`，單位：張）；尚無成交時為 0，與「取不到」的 null 不同 */
  volume: number | null
  /** 交易日（`d`，YYYYMMDD）—— 報價卡據此標示這組數字屬於哪一天 */
  tradeDate: string | null
  /** 最後撮合時間（`t`，HH:mm:ss）；達 13:30:00 表示收盤已定案 */
  tradeTime: string | null
  /** 是否為試撮階段（`ip` === '1'）：此時 z 是試撮預估價，不是成交價 */
  trial: boolean
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
 * 成交量與價格的有效範圍不同：0 張是「今天還沒成交」，是真值，不能當成取不到。
 * 正因為 0 有效，空字串就不能交給 Number() —— 它會回 0，讓「沒有這個欄位」
 * 變成「成交量 0 張」。缺欄位一律先擋在前面。
 */
function toCount(value: unknown): number | null {
  const s = String(value ?? '').replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** 交易日 `d`：只認 8 位數字（YYYYMMDD），其餘一律當取不到 */
function toTradeDate(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return /^\d{8}$/.test(s) ? s : null
}

/** 最後撮合時間 `t`：只認 HH:mm:ss */
function toTradeTime(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return /^\d{2}:\d{2}:\d{2}$/.test(s) ? s : null
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
    quotes.push({
      ticker,
      price,
      prevClose: toPrice(row.y),
      open: toPrice(row.o),
      high: toPrice(row.h),
      low: toPrice(row.l),
      volume: toCount(row.v),
      tradeDate: toTradeDate(row.d),
      tradeTime: toTradeTime(row.t),
      trial: String(row.ip ?? '').trim() === '1',
    })
  }
  return quotes
}
