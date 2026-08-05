/**
 * Daily OHLCV: Read the post-market schedule and `daily/{ticker}.json` stored in the public `reports` bucket.
 *
 * There is no fallback for "click and buy". This is intentional: the daily line only serves the individual stock analysis page, and the drop-down menu on this page
 * Originally, only the user's Taiwan stock holdings were listed - those codes were the list that would be covered by the night batch `generate-all`.
 * Finding no files means that the batch has not been run yet, and the UI displays "it will be automatically added later" which is healthier than opening an additional public endpoint.
 *
 * This file is of type **Web Interface Contract** and must be consistent with sources/supabase/functions/stock-report/twDaily.ts
 * DailyFile alignment.
 */
import { downloadReportsJson } from './reportsBucket'

/** A daily line: [Trading day, opening, high, low, closing, volume]*/
export type DailyRow = [string, number, number, number, number, number]

export interface DailySeries {
  ticker: string
  /** The time we actually caught it ISO*/
  asOf: string
  /** The latest trading day YYYY-MM-DD*/
  lastDate: string
  /** From old to new*/
  rows: DailyRow[]
}

/**
 * The **lowest** daily structure version recognized by the front end.
 *
 * It must be ">=" instead of "===": the server will upgrade the schema every time it adds a field to the file, and adding new fields will affect the old front-end.
 * It's a harmless addition. If you use the equal sign, once the backend version is upgraded, all technical paging will be suspended on the spot——
 * This is exactly what happened with the chip reporting in 0.4.0 (see MIN_REPORT_SCHEMA in reportProxy.ts).
 */
export const MIN_DAILY_SCHEMA = 1

interface StoredDaily {
  schema?: number
  ticker?: string
  asOf?: string
  lastDate?: string
  rows?: unknown
}

function isValidRow(r: unknown): r is DailyRow {
  return (
    Array.isArray(r) &&
    r.length === 6 &&
    typeof r[0] === 'string' &&
    r.slice(1).every((v) => typeof v === 'number' && Number.isFinite(v))
  )
}

function isSupported(d: unknown): d is Required<StoredDaily> {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredDaily
  return typeof f.schema === 'number' && f.schema >= MIN_DAILY_SCHEMA && Array.isArray(f.rows)
}

/** Read the daily series of a certain file; search for none / format does not match / no valid data and return null*/
export async function fetchDailySeries(ticker: string): Promise<DailySeries | null> {
  const stored = await downloadReportsJson<StoredDaily>(`daily/${ticker}.json`)
  if (!isSupported(stored)) return null

  const rows = (stored.rows as unknown[]).filter(isValidRow)
  if (rows.length === 0) return null

  return {
    ticker: typeof stored.ticker === 'string' ? stored.ticker : ticker,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    lastDate: typeof stored.lastDate === 'string' ? stored.lastDate : rows[rows.length - 1][0],
    rows,
  }
}
