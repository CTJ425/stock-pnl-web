/**
 * Fundamentals (valuation + monthly revenue + industry): Read the after-hours scheduled production and save it in the public `reports` bucket
 * `fundamental/{ticker}.json`。
 *
 * There is no fallback for "click and buy", the reason is the same as dailyProxy: the selection list on the individual stock analysis page only lists Taiwan stocks.
 * Exactly the list covered by the nightly batch `generate-all`. Checking no files means that the batch has not been run yet.
 *
 * This file is of type **Web Interface Contract** and must be consistent with sources/supabase/functions/stock-report/twFundamental.ts
 * The FundamentalFile is aligned. Unit trap: The monthly revenue is 1,000 yuan, the profit rate and the increase/decrease rate are % (the column name already contains the unit).
 */
import { downloadReportsJson } from './reportsBucket'

export interface Valuation {
  peRatio: number | null
  dividendYieldPercent: number | null
  pbRatio: number | null
  /** Data date of BWIBBU file YYYY-MM-DD*/
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

/**
 * Profitability ratio for one quarter (from 0.6.5). The unit must always be %, and the field name must be written before tax/after tax:
 * "Net profit margin" is a colloquial term in Taiwan that refers to both, so using it as a field name will definitely be misunderstood.
 */
export interface ProfitQuarter {
  /** 'YYYY-Qn' */
  yearQuarter: string
  revenueMillionTwd: number | null
  /** Gross profit margin*/
  grossMarginPercent: number | null
  /** profit margin*/
  operatingMarginPercent: number | null
  /** Net profit margin before tax*/
  pretaxMarginPercent: number | null
  /** net profit margin after tax*/
  netMarginPercent: number | null
  /**
   * Basic earnings per share (yuan, starting from 0.6.28).
   *
   * A ratio is "how well earned" and EPS is "how much is earned per share" - it is the number that compares to the price-to-earnings ratio.
   * **Only backend paths are available**, so the latest season usually appears a few days later (see backend epsChecked).
   */
  epsTwd: number | null
}

export interface FundamentalData {
  ticker: string
  /** Batch output time ISO*/
  asOf: string
  /** The trading day of the batch YYYY-MM-DD*/
  dataDate: string
  industry: string | null
  valuation: Valuation | null
  revenueUnit: '千元'
  /** Old to new, up to 12 months*/
  revenueMonths: RevenueMonth[]
  /** Oldest to Newest, up to 8 seasons. The old file of schema 1 does not have this column, and it is an empty array after normalization.*/
  profitQuarters: ProfitQuarter[]
  notes: string[]
}

/**
 * The **minimum** version of the fundamental structure that the front end recognizes.
 * It must be ">=" instead of "===": adding fields to the backend will upgrade the schema, and adding new fields is a harmless addition to the old frontend;
 * Using the equal sign will cause the entire page to crash when the backend is upgraded (this actually happened in the chip report in 0.4.0).
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
  profitQuarters?: unknown
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

function normalizeProfitQuarter(v: unknown): ProfitQuarter | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.yearQuarter !== 'string' || !o.yearQuarter) return null
  return {
    yearQuarter: o.yearQuarter,
    revenueMillionTwd: numOrNull(o.revenueMillionTwd),
    grossMarginPercent: numOrNull(o.grossMarginPercent),
    operatingMarginPercent: numOrNull(o.operatingMarginPercent),
    pretaxMarginPercent: numOrNull(o.pretaxMarginPercent),
    netMarginPercent: numOrNull(o.netMarginPercent),
    epsTwd: numOrNull(o.epsTwd),
  }
}

function isSupported(d: unknown): d is StoredFundamental {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredFundamental
  return typeof f.schema === 'number' && f.schema >= MIN_FUNDAMENTAL_SCHEMA
}

/** Read the fundamentals of a certain file; find none/return null if the format does not match*/
export async function fetchFundamental(ticker: string): Promise<FundamentalData | null> {
  const stored = await downloadReportsJson<StoredFundamental>(`fundamental/${ticker}.json`)
  if (!isSupported(stored)) return null

  const months = Array.isArray(stored.revenueMonths)
    ? stored.revenueMonths.map(normalizeRevenueMonth).filter((m): m is RevenueMonth => m !== null)
    : []

  // The old file of schema 1 does not have this column; the missing column and the empty array are the same thing on the screen (no profitability to see)
  const quarters = Array.isArray(stored.profitQuarters)
    ? stored.profitQuarters.map(normalizeProfitQuarter).filter((q): q is ProfitQuarter => q !== null)
    : []

  return {
    ticker: typeof stored.ticker === 'string' ? stored.ticker : ticker,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    dataDate: typeof stored.dataDate === 'string' ? stored.dataDate : '',
    industry: typeof stored.industry === 'string' && stored.industry ? stored.industry : null,
    valuation: normalizeValuation(stored.valuation),
    revenueUnit: '千元',
    revenueMonths: months,
    profitQuarters: quarters,
    notes: Array.isArray(stored.notes)
      ? stored.notes.filter((n): n is string => typeof n === 'string')
      : [],
  }
}
