/**
 * ETF holdings (Task 200): what an ETF holds, as its issuer publishes it. Any ETF code may have a
 * file; which issuers are fetched at all is `etfIssuerOf(...).supported` (shared with the Edge sync).
 *
 * Written by the `generate-market-data` phase (and the `sync-etf-holdings` action) into the public
 * `reports` bucket at `market/etf_holdings/<etf>.json`. The types are a **Web Interface Contract**
 * and must stay aligned with supabase/functions/stock-report/etfHoldings.ts.
 *
 * Every figure is the issuer's own; the screen shows them as given and never recomputes a weight.
 */
import { downloadReportsJson } from './reportsBucket'
import type { ProxyResult } from './marketProxy'
import { isEtfCode } from '../../supabase/functions/_shared/etfIssuer.ts'

export { etfIssuerOf, isEtfCode, supportedIssuerLabels, type EtfIssuer } from '../../supabase/functions/_shared/etfIssuer.ts'

export interface EtfHoldingsStock {
  code: string
  name: string
  shares: number
  /** Percent as published (56.39). */
  weight: number
  /** 'TW', 'JP', 'KR' …; files written before release 1 have none and read as 'TW'. */
  market: string
}

export interface EtfHoldingsFuture {
  code: string
  name: string | null
  contracts: number
  weight: number
  /** Contract month 'YYYYMM'. */
  month: string
}

export interface EtfHoldingsDay {
  /** 'YYYY-MM-DD' */
  tradeDate: string
  /** Issuer's own update stamp, 'YYYY-MM-DD HH:mm:ss' Taipei. */
  publishedAt: string | null
  navTotal: number
  navPerUnit: number
  unitsOutstanding: number
  /** The denominator of `weight` (Yuanta: fund size, which differs from `navTotal`; CTBC: net assets). */
  fundSize: number
  /** NT$ per asset class; null when the issuer publishes none. */
  assets: { stock: number; etf: number; bond: number; futures: number } | null
  stocks: EtfHoldingsStock[]
  futures: EtfHoldingsFuture[]
}

export interface EtfHoldingsData {
  etf: string
  fundName: string
  /** 'yuanta' | 'ctbc' …; '' when the file predates the field. */
  issuer: string
  sourceUrl: string
  updatedAt: string
  /** Newest first. */
  days: EtfHoldingsDay[]
}

/** Lowest schema recognised by the front end. See fundamentalProxy for why this uses `>=`. */
const MIN_ETF_HOLDINGS_SCHEMA = 1

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : null

function normalizeStock(v: unknown): EtfHoldingsStock | null {
  const o = rec(v)
  if (!o || typeof o.code !== 'string' || typeof o.name !== 'string' || !isNum(o.shares) || !isNum(o.weight)) {
    return null
  }
  return { code: o.code, name: o.name, shares: o.shares, weight: o.weight, market: typeof o.market === 'string' && o.market ? o.market : 'TW' }
}

function normalizeFuture(v: unknown): EtfHoldingsFuture | null {
  const o = rec(v)
  if (!o || typeof o.code !== 'string' || !isNum(o.contracts) || !isNum(o.weight)) return null
  return {
    code: o.code,
    name: typeof o.name === 'string' ? o.name : null,
    contracts: o.contracts,
    weight: o.weight,
    month: typeof o.month === 'string' ? o.month : '',
  }
}

function normalizeDay(v: unknown): EtfHoldingsDay | null {
  const o = rec(v)
  if (!o) return null
  const a = o.assets === null ? null : rec(o.assets)
  if (o.assets !== null && !a) return null
  if (typeof o.tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.tradeDate)) return null
  if (![o.navTotal, o.navPerUnit, o.unitsOutstanding].every(isNum)) return null
  if (a && ![a.stock, a.etf, a.bond, a.futures].every(isNum)) return null
  if (!Array.isArray(o.stocks) || !Array.isArray(o.futures)) return null
  const stocks = o.stocks.map(normalizeStock).filter((s): s is EtfHoldingsStock => s !== null)
  const futures = o.futures.map(normalizeFuture).filter((f): f is EtfHoldingsFuture => f !== null)
  // A leveraged / inverse fund holds futures and no stocks (00685L); only a day with neither is empty.
  if (stocks.length === 0 && futures.length === 0) return null
  return {
    tradeDate: o.tradeDate,
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : null,
    navTotal: o.navTotal as number,
    navPerUnit: o.navPerUnit as number,
    unitsOutstanding: o.unitsOutstanding as number,
    fundSize: isNum(o.fundSize) ? o.fundSize : 0,
    assets: a ? { stock: a.stock as number, etf: a.etf as number, bond: a.bond as number, futures: a.futures as number } : null,
    stocks,
    futures,
  }
}

/** Read one ETF's holdings file; `empty` = not an ETF code or no file yet, `invalid` = no usable day. */
export async function fetchEtfHoldings(etf: string): Promise<ProxyResult<EtfHoldingsData>> {
  if (!isEtfCode(etf)) return { kind: 'empty' }
  const stored = await downloadReportsJson<Record<string, unknown>>(`market/etf_holdings/${etf}.json`)
  if (stored === null || stored === undefined) return { kind: 'empty' }
  if (typeof stored !== 'object') return { kind: 'invalid' }
  if (typeof stored.schema !== 'number' || stored.schema < MIN_ETF_HOLDINGS_SCHEMA) return { kind: 'invalid' }
  if (!Array.isArray(stored.days)) return { kind: 'invalid' }
  const days = stored.days
    .map(normalizeDay)
    .filter((d): d is EtfHoldingsDay => d !== null)
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
  if (days.length === 0) return { kind: 'invalid' }
  return {
    kind: 'ok',
    data: {
      etf,
      fundName: typeof stored.fundName === 'string' ? stored.fundName : etf,
      issuer: typeof stored.issuer === 'string' ? stored.issuer : '',
      sourceUrl: typeof stored.sourceUrl === 'string' ? stored.sourceUrl : '',
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
      days,
    },
  }
}
