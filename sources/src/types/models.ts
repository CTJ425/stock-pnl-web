/** 共用資料模型：與 Supabase schema (build-docs/supabase_schema.sql) 對齊 */

export type Market = 'TPE' | 'US'
export type TxType = 'BUY' | 'SELL'
export type Currency = 'TWD' | 'USD'

export interface Workspace {
  id: string
  name: string
  created_at: string
}

export interface Transaction {
  id: string
  workspace_id: string
  /** 交易日期，格式 YYYY-MM-DD */
  tx_date: string
  market: Market
  /** 股票代號，不含 'TPE:' 前綴（如 '2330'、'AAPL'） */
  ticker: string
  name: string
  tx_type: TxType
  price: number
  qty: number
  fee_tax: number
  created_at: string
}

/** 尚未寫入資料庫的交易（無 id / created_at / workspace_id） */
export type NewTransaction = Omit<Transaction, 'id' | 'created_at' | 'workspace_id'>

export function marketCurrency(market: Market): Currency {
  return market === 'TPE' ? 'TWD' : 'USD'
}

/** 個股在 ledger 中的唯一鍵：市場 + 代號（台美股代號空間不同，仍以複合鍵防碰撞） */
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
