/** Shared data model: aligned with Supabase schema (sources/supabase/schema.sql)*/

export type Market = 'TPE' | 'US'
export type TxType = 'BUY' | 'SELL'
export type Currency = 'TWD' | 'USD'

export interface Workspace {
  id: string
  name: string
  created_at: string
  fee_rate?: number | null
}

export interface Transaction {
  id: string
  workspace_id: string
  /** Transaction date, format YYYY-MM-DD*/
  tx_date: string
  market: Market
  /** Stock code without 'TPE:' prefix (e.g. '2330', 'AAPL')*/
  ticker: string
  name: string
  tx_type: TxType
  price: number
  qty: number
  fee_tax: number
  created_at: string
}

/** Transactions not yet written to the database (no id/created_at/workspace_id)*/
export type NewTransaction = Omit<Transaction, 'id' | 'created_at' | 'workspace_id'>

export function marketCurrency(market: Market): Currency {
  return market === 'TPE' ? 'TWD' : 'USD'
}

/** The only key for individual stocks in ledger: market + code (the code spaces for Taiwan and the United States are different, so composite keys are still used to prevent collisions)*/
export function positionKey(market: Market, ticker: string): string {
  return `${market}:${ticker}`
}

export const TX_TYPE_LABEL: Record<TxType, string> = {
  BUY: '買入',
  SELL: '賣出',
}

export const MARKET_LABEL: Record<Market, string> = {
  TPE: '台股',
  US: '美股',
}
