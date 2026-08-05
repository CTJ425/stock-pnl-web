/**
 * The daily volume of the Taiwan stock market and the trading amount of the three major legal entities: scheduled production after reading the market, and stored in the public `reports` bucket
 * `market/daily.json`.
 *
 * **The difference with chipsProxy is that the range is not the content**: that is the chips of a single stock (unit "share"),
 * This is the total volume of the entire concentrated market (unit "yuan"). The two figures cannot be compared with each other, nor can they be included in the same picture.
 *
 * The type of this file is **Web Interface Contract** and must be consistent with supabase/functions/stock-report/twMarket.ts
 * The MarketFile is aligned.
 */
import { downloadReportsJson } from './reportsBucket'

/** Each of the six units has an amount in yuan. The three calibers of buying, selling, and buying and selling difference share this shape.*/
export interface MarketInstitutionalSide {
  foreignTwd: number | null
  foreignDealerTwd: number | null
  trustTwd: number | null
  dealerSelfTwd: number | null
  dealerHedgeTwd: number | null
  totalTwd: number | null
}

/**
 * The amount of the three major legal persons. The top six columns are the bid-ask spread (positive means overbought, negative means oversold).
 *
 * `buy` / `sell` are the buying and selling amounts that are only available since 0.6.32. **Old data is null** ——
 * Those days were made up before 0.6.32, and only the difference was saved. It will grow out after the after-hours schedule is recaptured day by day.
 * null means "it hasn't been caught again", not "there was no trading that day", so the screen always displays "—" instead of 0.
 */
export interface MarketInstitutional extends MarketInstitutionalSide {
  buy: MarketInstitutionalSide | null
  sell: MarketInstitutionalSide | null
}

export interface MarketDay {
  /** 'YYYY-MM-DD' */
  date: string
  tradeVolumeShares: number | null
  tradeValueTwd: number | null
  transactions: number | null
  taiex: number | null
  changePoints: number | null
  /** The opening high and low of the weighted index (0.6.30, used to draw K for the market day); it is from a different source than the closing price and may be available later.*/
  taiexOpen: number | null
  taiexHigh: number | null
  taiexLow: number | null
  /**
   * null = **has not been filled in on this day**, it does not mean "no legal person comes in or out on this day".
   * The trading volume value is captured for a whole month at a time, and the legal person amount is requested once a day. The coverage of the two is inherently out of sync.
   */
  institutional: MarketInstitutional | null
}

export interface MarketData {
  asOf: string
  /** From old to new*/
  days: MarketDay[]
}

interface StoredMarket {
  schema: number
  asOf: string
  days: unknown[]
}

/** The lowest version recognized by the front end. See fundamentalProxy for the reasons for using `>=` (adding fields to the backend is not harmful to the old frontend)*/
const MIN_MARKET_SCHEMA = 1

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizeSide(v: unknown): MarketInstitutionalSide | null {
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

function normalizeInstitutional(v: unknown): MarketInstitutional | null {
  const net = normalizeSide(v)
  if (!net) return null
  const o = v as Record<string, unknown>
  return { ...net, buy: normalizeSide(o.buy), sell: normalizeSide(o.sell) }
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

/** Read all market daily data; search none/return null if the format does not match*/
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
