/**
 * The exchange rate of the Taiwan dollar against major foreign currencies: Read the daily scheduled production and `fx/twd.json` stored in the public `reports` bucket.
 *
 * **Difference from other proxies: This is a global single file without ticker** (same as macroProxy).
 *
 * This file is of type **Network Interface Contract** and must be used with
 * FxFile alignment for sources/supabase/functions/stock-report/fxRates.ts.
 *
 * Direction trap: `rate` is always "**How ​​many Taiwan dollars can be exchanged for 1 unit of foreign currency**" (1 USD = 32.387 TWD).
 * In the reverse direction, the reciprocal value is taken from the front end, and the second copy is not stored in the data.
 */
import { downloadReportsJson } from './reportsBucket'

/** [Date YYYY-MM-DD, how many Taiwan dollars can be exchanged for 1 foreign currency]*/
export type FxPoint = [date: string, rate: number]

export interface FxCurrency {
  code: string
  name: string
  /** The number of decimal places used for display varies with the currency level (USD 3 digits, KRW 5 digits)*/
  decimals: number
  /** Actual Yahoo currency pairs used for auditing*/
  symbol: string
  latest: number | null
  prevClose: number | null
  /** From old to new, one year*/
  points: FxPoint[]
}

export interface FxData {
  /** Batch output time ISO*/
  asOf: string
  base: string
  currencies: FxCurrency[]
}

/**
 * The **minimum** structural version recognized by the frontend. Must use `>=` for comparison, the reason is the same as macroProxy / fundamentalProxy:
 * Adding fields to the backend is a harmless addition to the old frontend. Using the equal sign will cause the entire paging to hang on the spot when the backend is upgraded.
 * (Online bug fixed in 0.4.1).
 */
export const MIN_FX_SCHEMA = 1

interface StoredFx {
  schema?: number
  asOf?: string
  base?: unknown
  currencies?: unknown
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** One trend point. The broken grid will be discarded in its entirety. If no 0 - 0 exchange rate is added, the conversion will become Infinity.*/
function normalizePoint(v: unknown): FxPoint | null {
  if (!Array.isArray(v) || v.length < 2) return null
  const [date, rate] = v
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const r = numOrNull(rate)
  if (r === null || r <= 0) return null
  return [date, r]
}

function normalizeCurrency(v: unknown): FxCurrency | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.code !== 'string' || !o.code) return null
  if (typeof o.name !== 'string' || !o.name) return null

  const points = Array.isArray(o.points)
    ? o.points.map(normalizePoint).filter((p): p is FxPoint => p !== null)
    : []
  // Currencies with no squares are not put into the screen: the card can display the current price, but when you click on it, the trend chart is empty.
  // That's worse than not showing up at all (the user will think it's broken)
  if (points.length === 0) return null

  const decimals = numOrNull(o.decimals)
  return {
    code: o.code,
    name: o.name,
    // When the backend does not provide or provides an outrageous value, it returns 4 digits to prevent toFixed() from throwing RangeError.
    decimals: decimals !== null && decimals >= 0 && decimals <= 8 ? Math.round(decimals) : 4,
    symbol: typeof o.symbol === 'string' ? o.symbol : '',
    latest: numOrNull(o.latest),
    prevClose: numOrNull(o.prevClose),
    points,
  }
}

function isSupported(d: unknown): d is StoredFx {
  if (!d || typeof d !== 'object') return false
  const f = d as StoredFx
  return typeof f.schema === 'number' && f.schema >= MIN_FX_SCHEMA
}

/** Read the exchange rate; find none / return null if the format does not match (if an error occurs, do not throw it away, and the lack of information must not drag down the entire page)*/
export async function fetchFx(): Promise<FxData | null> {
  const stored = await downloadReportsJson<StoredFx>('fx/twd.json')
  if (!isSupported(stored)) return null

  const currencies = Array.isArray(stored.currencies)
    ? stored.currencies.map(normalizeCurrency).filter((c): c is FxCurrency => c !== null)
    : []
  if (currencies.length === 0) return null

  return {
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    base: typeof stored.base === 'string' ? stored.base : 'TWD',
    currencies,
  }
}
