/**
 * 台股全市場每日量能與三大法人買賣金額：讀盤後排程預產、存於公開 `reports` bucket
 * 的 `market/daily.json`。
 *
 * **與 chipsProxy 的差別是範圍不是內容**：那是單一個股的籌碼（單位「股」），
 * 這是整個集中市場的總量（單位「元」）。兩者的數字不可互相比較，也不可放進同一張圖。
 *
 * 此檔的型別是**網路介面契約**，須與 supabase/functions/stock-report/twMarket.ts
 * 的 MarketFile 對齊。
 */
import { downloadReportsJson } from './reportsBucket'

/** 三大法人買賣差額，單位元。正為買超、負為賣超 */
export interface MarketInstitutional {
  foreignTwd: number | null
  foreignDealerTwd: number | null
  trustTwd: number | null
  dealerSelfTwd: number | null
  dealerHedgeTwd: number | null
  totalTwd: number | null
}

export interface MarketDay {
  /** 'YYYY-MM-DD' */
  date: string
  tradeVolumeShares: number | null
  tradeValueTwd: number | null
  transactions: number | null
  taiex: number | null
  changePoints: number | null
  /** 加權指數的開高低（0.6.30，畫大盤日 K 用）；與收盤價不同來源，可能較晚才有 */
  taiexOpen: number | null
  taiexHigh: number | null
  taiexLow: number | null
  /**
   * null＝**這天還沒補到**，不是「這天沒有法人進出」。
   * 成交量值一次抓一整月、法人金額一天一個請求，兩者的覆蓋範圍本來就不同步。
   */
  institutional: MarketInstitutional | null
}

export interface MarketData {
  asOf: string
  /** 由舊到新 */
  days: MarketDay[]
}

interface StoredMarket {
  schema: number
  asOf: string
  days: unknown[]
}

/** 前端認得的最低版本。用 `>=` 的理由見 fundamentalProxy（後端加欄位對舊前端無害） */
const MIN_MARKET_SCHEMA = 1

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizeInstitutional(v: unknown): MarketInstitutional | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    foreignTwd: numOrNull(o.foreignTwd),
    foreignDealerTwd: numOrNull(o.foreignDealerTwd),
    trustTwd: numOrNull(o.trustTwd),
    dealerSelfTwd: numOrNull(o.dealerSelfTwd),
    dealerHedgeTwd: numOrNull(o.dealerHedgeTwd),
    totalTwd: numOrNull(o.totalTwd),
  }
}

function normalizeDay(v: unknown): MarketDay | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null
  return {
    date: o.date,
    tradeVolumeShares: numOrNull(o.tradeVolumeShares),
    tradeValueTwd: numOrNull(o.tradeValueTwd),
    transactions: numOrNull(o.transactions),
    taiex: numOrNull(o.taiex),
    changePoints: numOrNull(o.changePoints),
    taiexOpen: numOrNull(o.taiexOpen),
    taiexHigh: numOrNull(o.taiexHigh),
    taiexLow: numOrNull(o.taiexLow),
    institutional: normalizeInstitutional(o.institutional),
  }
}

/** 讀全市場每日資料；查無 / 格式不符回 null */
export async function fetchMarketDaily(): Promise<MarketData | null> {
  const stored = await downloadReportsJson<StoredMarket>('market/daily.json')
  if (!stored || typeof stored !== 'object') return null
  if (typeof stored.schema !== 'number' || stored.schema < MIN_MARKET_SCHEMA) return null
  const days = (Array.isArray(stored.days) ? stored.days : [])
    .map(normalizeDay)
    .filter((d): d is MarketDay => d !== null)
  if (days.length === 0) return null
  return { asOf: typeof stored.asOf === 'string' ? stored.asOf : '', days }
}
