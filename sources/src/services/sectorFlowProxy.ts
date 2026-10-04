/**
 * Sector money flow: what the three institutional investors bought and sold, by industry, in NT$.
 *
 * Written by the `generate-chips` phase (and the `sync-sector-flow` action) into the public
 * `reports` bucket at `market/sector_flow.json`. The type is a **Web Interface Contract** and must
 * stay aligned with supabase/functions/stock-report/twSectorFlow.ts.
 *
 * Amounts are estimates: net shares × the stock's day VWAP. The file also carries the official
 * listed-market total next to the estimate so the screen can show how close the two are.
 */
import { downloadReportsJson } from './reportsBucket'
import type { ProxyResult } from './marketProxy'

export interface SectorTopStock {
  ticker: string
  name: string
  netTwd: number
}

export type InstitutionGroup = 'foreign' | 'trust' | 'dealer'

export interface SectorMovers {
  buy: SectorTopStock[]
  sell: SectorTopStock[]
}

export interface SectorFlowRow {
  /** Industry code ('24'), 'ETF', 'NA', or a semiconductor child ('24:design'). */
  code: string
  name: string
  /** Set on semiconductor children only. */
  parent: string | null
  foreignTwd: number
  trustTwd: number
  dealerTwd: number
  totalTwd: number
  /** Everything traded in the sector that day, not only what the institutions touched. */
  turnoverTwd: number
  stocks: number
  /** Ranked by the three groups together. Newest day only. */
  topBuy: SectorTopStock[]
  topSell: SectorTopStock[]
  /** The same lists ranked by one group alone. Absent on files written before 0.10.30-dev.7. */
  groupTops?: Record<InstitutionGroup, SectorMovers>
}

export interface SectorFlowDay {
  /** 'YYYY-MM-DD' */
  date: string
  coverage: { listed: boolean; otc: boolean }
  rows: SectorFlowRow[]
  marketTurnoverTwd: number
  estimateListedTotalTwd: number
  /** null = not fetched that day. */
  officialListedTotalTwd: number | null
  unpriced: number
}

export interface SectorFlowData {
  asOf: string
  /** Oldest to newest. Only the newest day carries topBuy/topSell. */
  days: SectorFlowDay[]
}

interface StoredSectorFlow {
  schema: number
  asOf: string
  days: unknown[]
}

/** Lowest schema recognised by the front end. See fundamentalProxy for why this uses `>=`. */
const MIN_SECTOR_FLOW_SCHEMA = 1

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function normalizeTop(v: unknown): SectorTopStock | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.ticker !== 'string' || typeof o.name !== 'string' || !isNum(o.netTwd)) return null
  return { ticker: o.ticker, name: o.name, netTwd: o.netTwd }
}

const tops = (x: unknown): SectorTopStock[] =>
  Array.isArray(x) ? x.map(normalizeTop).filter((t): t is SectorTopStock => t !== null) : []

function normalizeMovers(v: unknown): SectorMovers {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { buy: tops(o.buy), sell: tops(o.sell) }
}

function normalizeGroupTops(v: unknown): Record<InstitutionGroup, SectorMovers> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return { foreign: normalizeMovers(o.foreign), trust: normalizeMovers(o.trust), dealer: normalizeMovers(o.dealer) }
}

function normalizeRow(v: unknown): SectorFlowRow | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.code !== 'string' || typeof o.name !== 'string') return null
  if (![o.foreignTwd, o.trustTwd, o.dealerTwd, o.totalTwd, o.turnoverTwd].every(isNum)) return null
  return {
    code: o.code,
    name: o.name,
    parent: typeof o.parent === 'string' ? o.parent : null,
    foreignTwd: o.foreignTwd as number,
    trustTwd: o.trustTwd as number,
    dealerTwd: o.dealerTwd as number,
    totalTwd: o.totalTwd as number,
    turnoverTwd: o.turnoverTwd as number,
    stocks: isNum(o.stocks) ? o.stocks : 0,
    topBuy: tops(o.topBuy),
    topSell: tops(o.topSell),
    groupTops: normalizeGroupTops(o.groupTops),
  }
}

function normalizeDay(v: unknown): SectorFlowDay | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null
  if (!Array.isArray(o.rows) || !isNum(o.marketTurnoverTwd)) return null
  const rows = o.rows.map(normalizeRow).filter((r): r is SectorFlowRow => r !== null)
  if (rows.length === 0) return null
  const cov = (o.coverage ?? {}) as Record<string, unknown>
  return {
    date: o.date,
    coverage: { listed: cov.listed !== false, otc: cov.otc === true },
    rows,
    marketTurnoverTwd: o.marketTurnoverTwd,
    estimateListedTotalTwd: isNum(o.estimateListedTotalTwd) ? o.estimateListedTotalTwd : 0,
    officialListedTotalTwd: isNum(o.officialListedTotalTwd) ? o.officialListedTotalTwd : null,
    unpriced: isNum(o.unpriced) ? o.unpriced : 0,
  }
}

/** Read the sector-flow file; `empty` = no file yet, `invalid` = a file exists but no day in it passes the checks. */
export async function fetchSectorFlow(): Promise<ProxyResult<SectorFlowData>> {
  const stored = await downloadReportsJson<StoredSectorFlow>('market/sector_flow.json')
  if (stored === null || stored === undefined) return { kind: 'empty' }
  if (typeof stored !== 'object') return { kind: 'invalid' }
  if (typeof stored.schema !== 'number' || stored.schema < MIN_SECTOR_FLOW_SCHEMA) return { kind: 'invalid' }
  if (!Array.isArray(stored.days)) return { kind: 'invalid' }
  const days = stored.days
    .map(normalizeDay)
    .filter((d): d is SectorFlowDay => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (days.length === 0) return { kind: 'invalid' }
  return { kind: 'ok', data: { asOf: typeof stored.asOf === 'string' ? stored.asOf : '', days } }
}
