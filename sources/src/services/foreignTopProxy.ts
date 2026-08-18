/**
 * TWSE TWT38U — foreign (and mainland China) investors' TOP 50 net buy / net sell (0.7.19).
 *
 * Snapshot object written by the `generate-chips` phase into the public `reports` bucket at
 * `market/foreign_top50.json`. Type must stay aligned with
 * `supabase/functions/stock-report/twForeignTop.ts`.
 */
import { downloadReportsJson } from './reportsBucket'

export interface ForeignTopItem {
  ticker: string
  name: string
  buy: number
  sell: number
  net: number
  block: boolean
}

export interface ForeignTopData {
  date: string
  asOf: string
  buyTop: ForeignTopItem[]
  sellTop: ForeignTopItem[]
}

interface StoredForeignTop {
  schema: number
  asOf: string
  date: string
  buyTop: unknown[]
  sellTop: unknown[]
}

/** Lowest schema recognized by the front end. See fundamentalProxy for why this uses `>=`. */
const MIN_FOREIGN_TOP_SCHEMA = 1

function normalizeItem(v: unknown): ForeignTopItem | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.ticker !== 'string' || typeof o.name !== 'string') return null
  if (typeof o.buy !== 'number' || typeof o.sell !== 'number' || typeof o.net !== 'number') return null
  return {
    ticker: o.ticker,
    name: o.name,
    buy: o.buy,
    sell: o.sell,
    net: o.net,
    block: o.block === true,
  }
}

/** Read the foreign-investors TOP 50 snapshot; return null if none/format mismatch. */
export async function fetchForeignTop(): Promise<ForeignTopData | null> {
  const stored = await downloadReportsJson<StoredForeignTop>('market/foreign_top50.json')
  if (!stored || typeof stored !== 'object') return null
  if (typeof stored.schema !== 'number' || stored.schema < MIN_FOREIGN_TOP_SCHEMA) return null
  if (typeof stored.date !== 'string') return null
  const buyTop = (Array.isArray(stored.buyTop) ? stored.buyTop : [])
    .map(normalizeItem)
    .filter((x): x is ForeignTopItem => x !== null)
  const sellTop = (Array.isArray(stored.sellTop) ? stored.sellTop : [])
    .map(normalizeItem)
    .filter((x): x is ForeignTopItem => x !== null)
  return {
    date: stored.date,
    asOf: typeof stored.asOf === 'string' ? stored.asOf : '',
    buyTop,
    sellTop,
  }
}
