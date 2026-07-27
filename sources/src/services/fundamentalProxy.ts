/**
 * 基本面（估值 + 月營收 + 產業別）：讀取盤後排程預產、存於公開 `reports` bucket 的
 * `fundamental/{ticker}.json`。
 *
 * 沒有「即點即產」的 fallback，理由同 dailyProxy：個股分析頁的選單只列台股持股，
 * 正是夜間批次 `generate-all` 涵蓋的清單。查無檔案代表批次還沒跑過。
 *
 * 此檔的型別是**網路介面契約**，須與 sources/supabase/functions/stock-report/twFundamental.ts
 * 的 FundamentalFile 對齊。單位陷阱：月營收為千元、殖利率與增減率為 %（欄位名已帶單位）。
 */
import { downloadReportsJson } from './reportsBucket'

export interface Valuation {
  peRatio: number | null
  dividendYieldPercent: number | null
  pbRatio: number | null
  /** BWIBBU 檔的資料日 YYYY-MM-DD */
  dataDate: string | null
}

export interface RevenueMonth {
  /** 'YYYY-MM' */
  yearMonth: string
  revenueThousandTwd: number | null
  momPercent: number | null
  yoyPercent: number | null
  cumulativeYoyPercent: number | null
}

export interface FundamentalData {
  ticker: string
  /** 批次產出時間 ISO */
  asOf: string
  /** 批次的交易日 YYYY-MM-DD */
  dataDate: string
  industry: string | null
  valuation: Valuation | null
  revenueUnit: '千元'
  /** 由舊到新，最多 12 個月 */
  revenueMonths: RevenueMonth[]
  notes: string[]
}

/**
 * 前端認得的**最低**基本面結構版本。
 * 必須是「>=」而不是「===」：後端加欄位就會升 schema，新增欄位對舊前端是無害的加法；
 * 用等號會在後端升版時讓整個分頁當場全掛（0.4.0 在籌碼報告上真實發生過）。
 */
export const MIN_FUNDAMENTAL_SCHEMA = 1

interface StoredFundamental {
  schema?: number
  ticker?: string
  asOf?: string
  dataDate?: string
  industry?: unknown
  valuation?: unknown
  revenueMonths?: unknown
  notes?: unknown
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizeValuation(v: unknown): Valuation | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    peRatio: numOrNull(o.peRatio),
    dividendYieldPercent: numOrNull(o.dividendYieldPercent),
    pbRatio: numOrNull(o.pbRatio),
    dataDate: typeof o.dataDate === 'string' ? o.dataDate : null,
  }
}

function normalizeRevenueMonth(v: unknown): RevenueMonth | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.yearMonth !== 'string' || !o.yearMonth) return null
  return {
    yearMonth: o.yearMonth,
    revenueThousandTwd: numOrNull(o.revenueThousandTwd),
    momPercent: numOrNull(o.momPercent),
    yoyPercent: numOrNull(o.yoyPercent),
    cumulativeYoyPercent: numOrNull(o.cumulativeYoyPercent),
  }
}

function isSupported(d: unknown): d is StoredFundamental {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredFundamental
  return typeof f.schema === 'number' && f.schema >= MIN_FUNDAMENTAL_SCHEMA
}

/** 讀某檔的基本面；查無 / 格式不符回 null */
export async function fetchFundamental(ticker: string): Promise<FundamentalData | null> {
  const stored = await downloadReportsJson<StoredFundamental>(`fundamental/${ticker}.json`)
  if (!isSupported(stored)) return null

  const months = Array.isArray(stored.revenueMonths)
    ? stored.revenueMonths.map(normalizeRevenueMonth).filter((m): m is RevenueMonth => m !== null)
    : []

  return {
    ticker: typeof stored.ticker === 'string' ? stored.ticker : ticker,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    dataDate: typeof stored.dataDate === 'string' ? stored.dataDate : '',
    industry: typeof stored.industry === 'string' && stored.industry ? stored.industry : null,
    valuation: normalizeValuation(stored.valuation),
    revenueUnit: '千元',
    revenueMonths: months,
    notes: Array.isArray(stored.notes)
      ? stored.notes.filter((n): n is string => typeof n === 'string')
      : [],
  }
}
