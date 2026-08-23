/**
 * TWSE after-hours chip capture and analysis.
 *
 * Data source (confirmed by actual measurement, all are whole-market large stocks, single stocks are screened according to ticker):
 * - The trading of individual stocks of the three major legal persons exceeded: TWSE rwd `fund/T86` (date parameter required, return { fields, data, date })
 * - Margin margin trading (main): TWSE rwd `marginTrading/MI_MARGN` (requires date parameter, including buy/sell/repay)
 * - Margin margin trading (fallback): TWSE OpenAPI `exchangeReport/MI_MARGN` (no date, only the balance on the latest trading day)
 * - The number of shares available for borrowing and selling: TWSE OpenAPI `SBL/TWT96U` (no date, TWSE/GRETAI two parallel fields)
 *
 * Unit trap: The number of T86 is "number of shares", and the number of MI_MARGN is "transaction unit (pieces)". The two cannot be confused,
 * UIs must be individually labeled (see UI copywriting guidelines in docs/agent/SPEC.md).
 *
 * The parsing functions are all pure functions and do not touch the Internet, which is convenient for unit testing; HTTP crawling and DB cache are combined in index.ts.
 * The over-the-counter (TPEx) stock-by-stock endpoint is currently not supported, and the corresponding block mark is missing when there is no data.
 */

import { rowsFingerprint } from './pollPlan.ts'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const MI_MARGN_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN'
export const SBL_URL = 'https://openapi.twse.com.tw/v1/SBL/TWT96U'

export function t86Url(dateYYYYMMDD: string): string {
  return `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateYYYYMMDD}&selectType=ALLBUT0999&response=json`
}

/** Stock-by-stock summary of margin trading with date (the OpenAPI version does not have a date parameter and cannot produce trend charts)*/
export function marginDatedUrl(dateYYYYMMDD: string): string {
  return `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${dateYYYYMMDD}&selectType=ALL&response=json`
}

/** Thousands of strings are converted to numbers; empty strings/non-digits are returned to null. Keep the positive and negative signs (the buying and selling excess can be negative)*/
export function normNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Buy/Sell/Trade Super Trio. If any source lacks this item, it will be represented by null (not pretended to be 0)*/
export interface ChipLeg {
  buy: number | null
  sell: number | null
  /** Oversold (buy − sell); official disclosed values ​​are preferred*/
  net: number | null
}

const NULL_LEG: ChipLeg = { buy: null, sell: null, net: null }

/** a + b, return null when both are null (if one side has a value, it is regarded as 0 on the other side)*/
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

function addLegs(a: ChipLeg, b: ChipLeg): ChipLeg {
  return {
    buy: addNullable(a.buy, b.buy),
    sell: addNullable(a.sell, b.sell),
    net: addNullable(a.net, b.net),
  }
}

/** Three major legal persons (unit: shares). Each item includes buying/selling/over-selling*/
export interface InstitutionalChip {
  /** Foreign mainland investment (excluding foreign self-operated operators)*/
  foreign: ChipLeg
  /** Foreign self-operated business*/
  foreignDealer: ChipLeg
  /** investment trust*/
  trust: ChipLeg
  /** Proprietary traders (self-trading + hedging, T86 does not directly disclose buying/selling, it is divided into two groups and added together)*/
  dealer: ChipLeg
  /** The total of the three major legal persons (T86 only discloses the over-trading, buying/selling is summed by the five legs)*/
  total: ChipLeg
}

/**
 * Margin margin trading (unit: trading unit = Zhang).
 * In securities lending, buy means "covering" and sell means "shorting", which are opposite to financing.
 * When `source` is 'openapi', only the balance is available, and buy / sell / redeem is null.
 */
export interface MarginChip {
  marginBuy: number | null
  marginSell: number | null
  /** Financing cash repayment*/
  marginRedeem: number | null
  marginPrev: number | null
  marginToday: number | null
  /** Change in financing balance = today − day before yesterday*/
  marginChange: number | null
  marginLimit: number | null
  /** Securities lending = covering*/
  shortBuy: number | null
  /** Short selling = short selling*/
  shortSell: number | null
  /** Securities lending and cash repayment*/
  shortRedeem: number | null
  shortPrev: number | null
  shortToday: number | null
  /** Change in securities lending balance = today − the day before yesterday*/
  shortChange: number | null
  shortLimit: number | null
  /** Mutual offset of securities (sheets)*/
  offset: number | null
  source: 'rwd' | 'openapi'
}

export interface BorrowChip {
  /** Number of shares available for borrowing and selling*/
  availableVolume: number | null
}

interface T86Response {
  stat?: string
  fields?: string[]
  data?: string[][]
  date?: string
  tables?: Array<{ fields?: string[]; data?: string[][] }>
}

/** Extract fields/data from T86 response (compatible with top-level and tables[0] structures)*/
function t86Table(resp: T86Response): { fields: string[]; data: string[][] } {
  if (Array.isArray(resp.fields) && Array.isArray(resp.data)) {
    return { fields: resp.fields, data: resp.data }
  }
  const t = resp.tables?.[0]
  if (t && Array.isArray(t.fields) && Array.isArray(t.data)) {
    return { fields: t.fields, data: t.data }
  }
  return { fields: [], data: [] }
}

/** T86 field names may contain full-width whitespace/trailing whitespace, normalize during comparison*/
function cleanHeader(s: string): string {
  return s.replace(/\s+/g, '')
}

/**
 * T86 shares the three major legal persons. T86 column names are not repeated, so the comparison is by name (the comparison position index can withstand column order changes).
 * The official only discloses the "trading excess" of the dealers/three major legal entities, and their purchases/sales are made up by the sum of the items.
 */
export function extractInstitutional(resp: T86Response, ticker: string): InstitutionalChip | null {
  const { fields, data } = t86Table(resp)
  if (fields.length === 0 || data.length === 0) return null
  const idx = (name: string): number => fields.findIndex((f) => cleanHeader(f) === name)
  const codeIdx = idx('證券代號')
  if (codeIdx < 0) return null
  const row = data.find((r) => String(r[codeIdx]).trim() === ticker)
  if (!row) return null
  const at = (name: string): number | null => {
    const i = idx(name)
    return i >= 0 ? normNum(row[i]) : null
  }
  const leg = (buy: string, sell: string, net: string): ChipLeg => ({
    buy: at(buy),
    sell: at(sell),
    net: at(net),
  })

  const foreign = leg(
    '外陸資買進股數(不含外資自營商)',
    '外陸資賣出股數(不含外資自營商)',
    '外陸資買賣超股數(不含外資自營商)',
  )
  const foreignDealer = leg('外資自營商買進股數', '外資自營商賣出股數', '外資自營商買賣超股數')
  const trust = leg('投信買進股數', '投信賣出股數', '投信買賣超股數')
  const dealerSelf = leg(
    '自營商買進股數(自行買賣)',
    '自營商賣出股數(自行買賣)',
    '自營商買賣超股數(自行買賣)',
  )
  const dealerHedge = leg('自營商買進股數(避險)', '自營商賣出股數(避險)', '自營商買賣超股數(避險)')
  const dealerSum = addLegs(dealerSelf, dealerHedge)
  // The total transaction amount of the dealer shall be based on the official column, and only the split items shall be used for buying/selling.
  const dealer: ChipLeg = {
    buy: dealerSum.buy,
    sell: dealerSum.sell,
    net: at('自營商買賣超股數') ?? dealerSum.net,
  }

  const legsSum = [foreign, foreignDealer, trust, dealerSelf, dealerHedge].reduce(addLegs, NULL_LEG)
  const total: ChipLeg = {
    buy: legsSum.buy,
    sell: legsSum.sell,
    net: at('三大法人買賣超股數') ?? legsSum.net,
  }

  return { foreign, foreignDealer, trust, dealer, total }
}

type MarginRow = Record<string, string>

const diff = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a - b

/**
 * OpenAPI version of margin trading (fallback): only balance, no buying/selling/repayment.
 * It is only applicable to the "latest trading day" and cannot produce trend charts, so it is only used when the rwd endpoint fails.
 */
export function extractMargin(rows: MarginRow[], ticker: string): MarginChip | null {
  const row = rows.find((r) => String(r['股票代號']).trim() === ticker)
  if (!row) return null
  const marginToday = normNum(row['融資今日餘額'])
  const marginPrev = normNum(row['融資前日餘額'])
  const shortToday = normNum(row['融券今日餘額'])
  const shortPrev = normNum(row['融券前日餘額'])
  return {
    marginBuy: null,
    marginSell: null,
    marginRedeem: null,
    marginPrev,
    marginToday,
    marginChange: diff(marginToday, marginPrev),
    marginLimit: normNum(row['融資限額']),
    shortBuy: null,
    shortSell: null,
    shortRedeem: null,
    shortPrev,
    shortToday,
    shortChange: diff(shortToday, shortPrev),
    shortLimit: normNum(row['融券限額']),
    offset: normNum(row['資券互抵']),
    source: 'openapi',
  }
}

export interface MarginDatedResponse {
  stat?: string
  date?: string
  tables?: Array<{ fields?: string[]; data?: string[][] }>
}

/**
 * Column positions of the rwd version of the stock-by-stock margin trading table (actual measurement 2026-07-22, 16 columns in total).
 * "Buy" and "Sell" appear twice each in the same column of fields (one group each for financing and securities lending).
 * **The value must be obtained by position index. If you use name comparison, you will get the wrong group**.
 */
const MARGIN_IDX = {
  code: 0,
  marginBuy: 2,
  marginSell: 3,
  marginRedeem: 4,
  marginPrev: 5,
  marginToday: 6,
  marginLimit: 7,
  shortBuy: 8,
  shortSell: 9,
  shortRedeem: 10,
  shortPrev: 11,
  shortToday: 12,
  shortLimit: 13,
  offset: 14,
} as const

/** The rwd response may contain multiple tables (large market total / stock-by-stock summary); the first column of the stock-by-stock table is "code"*/
export function marginTable(resp: MarginDatedResponse): { fields: string[]; data: string[][] } | null {
  for (const t of resp.tables ?? []) {
    const fields = t.fields ?? []
    const data = t.data ?? []
    // Column order protection: If it does not match, it will be regarded as the endpoint format change, and the caller will fall back to OpenAPI fallback
    if (cleanHeader(fields[0] ?? '') === '代號' && fields.length >= 15 && data.length > 0) {
      return { fields, data }
    }
  }
  return null
}

export function extractMarginDated(resp: MarginDatedResponse, ticker: string): MarginChip | null {
  const table = marginTable(resp)
  if (!table) return null
  const row = table.data.find((r) => String(r[MARGIN_IDX.code]).trim() === ticker)
  if (!row) return null
  const at = (i: number): number | null => normNum(row[i])
  const marginToday = at(MARGIN_IDX.marginToday)
  const marginPrev = at(MARGIN_IDX.marginPrev)
  const shortToday = at(MARGIN_IDX.shortToday)
  const shortPrev = at(MARGIN_IDX.shortPrev)
  return {
    marginBuy: at(MARGIN_IDX.marginBuy),
    marginSell: at(MARGIN_IDX.marginSell),
    marginRedeem: at(MARGIN_IDX.marginRedeem),
    marginPrev,
    marginToday,
    marginChange: diff(marginToday, marginPrev),
    marginLimit: at(MARGIN_IDX.marginLimit),
    shortBuy: at(MARGIN_IDX.shortBuy),
    shortSell: at(MARGIN_IDX.shortSell),
    shortRedeem: at(MARGIN_IDX.shortRedeem),
    shortPrev,
    shortToday,
    shortChange: diff(shortToday, shortPrev),
    shortLimit: at(MARGIN_IDX.shortLimit),
    offset: at(MARGIN_IDX.offset),
    source: 'rwd',
  }
}

/** rwd Whether the margin trading response is available (for index.ts to decide whether to cache/fallback)*/
export function marginDatedOk(resp: MarginDatedResponse): boolean {
  return marginTable(resp) !== null
}

/**
 * Content fingerprint of the per-stock margin table, for the probe's content-settled retire gate.
 *
 * Only `marginTable(resp).data` counts: the market-total table (`tables[0]`) is a different shape
 * and must not affect the result, and row order is unstable across TWSE polls (same reason as
 * `t86Fingerprint`) so `rowsFingerprint` sorts before hashing.
 */
export function marginDatedFingerprint(resp: MarginDatedResponse): string | null {
  const table = marginTable(resp)
  if (!table) return null
  return rowsFingerprint(table.data)
}

interface SblRow {
  TWSECode?: string
  TWSEAvailableVolume?: string
  GRETAICode?: string
  GRETAIAvailableVolume?: string
}

/**
 * OpenAPI version fallback. **The response does not have any date field**, there is no way to know which day the data is——
 * That's why the rwd version below is used instead.
 *
 * NOTE: The field names TWSECode / GRETAICode are misleading. According to actual measurements, both are listed stocks.
 * It's just that the official original report has a "two columns side by side" layout, and OpenAPI just cuts it into two sets of columns.
 * So you have to look for both columns.
 */
export function extractBorrow(rows: SblRow[], ticker: string): BorrowChip | null {
  for (const r of rows) {
    if (String(r.TWSECode).trim() === ticker) return { availableVolume: normNum(r.TWSEAvailableVolume) }
    if (String(r.GRETAICode).trim() === ticker) return { availableVolume: normNum(r.GRETAIAvailableVolume) }
  }
  return null
}

// ---- Borrow coupons (rwd version, with date)----

/**
 * rwd endpoint for borrowing bonds. `date` parameter **Invalid actual measurement** (with any date, the same latest data will be returned),
 * But `title` comes with a date ("Number of shares that can be borrowed and sold on July 27, 115"),
 * This is enough to determine which day the data is obtained - the OpenAPI version cannot do this.
 *
 * ⚠️ Semantic reminder: "The number of shares that can be borrowed and sold on that day" is the **quota for the next trading day**, not the number for the day that the market has closed.
 * When the actual measured last trading day is 07/24 (Friday), the title displays 07/27 (Monday).
 * Therefore, its date will be different from the chip's data date and must be marked separately.
 */
export const BORROW_DATED_URL = 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT96U?response=json'

export interface BorrowDatedResponse {
  stat?: string
  title?: string
  fields?: string[]
  data?: string[][]
}

/** "Number of shares that can be borrowed and sold on July 27, 115" → `2026-07-27`; the parsing cannot return null*/
export function parseRocTitleDate(title: string | null | undefined): string | null {
  const m = /(\d{2,3})年(\d{1,2})月(\d{1,2})日/.exec(String(title ?? ''))
  if (!m) return null
  const year = Number(m[1]) + 1911
  const p = (v: string) => v.padStart(2, '0')
  return `${year}-${p(m[2])}-${p(m[3])}`
}

/** The storage cell of rwd wraps the code in the <a> tag and takes the plain text*/
function cellText(v: unknown): string {
  return String(v ?? '').replace(/<[^>]*>/g, '').trim()
}

export function borrowDatedOk(resp: BorrowDatedResponse): boolean {
  return (
    Array.isArray(resp?.data) &&
    resp.data.length > 0 &&
    parseRocTitleDate(resp.title) !== null
  )
}

/** rwd The data date of borrowing securities (=next trading day); cannot be parsed and returns null*/
export function borrowDatedDate(resp: BorrowDatedResponse): string | null {
  return parseRocTitleDate(resp?.title)
}

/**
 * Get a single code from the rwd borrowing table. The original report is a "two columns side by side" layout:
 * Each column has 4 cells = two groups (code, number of shares), so both groups must be searched.
 */
export function extractBorrowDated(resp: BorrowDatedResponse, ticker: string): BorrowChip | null {
  for (const row of resp?.data ?? []) {
    for (let i = 0; i + 1 < row.length; i += 2) {
      if (cellText(row[i]) === ticker) return { availableVolume: normNum(row[i + 1]) }
    }
  }
  return null
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

export type T86ResponseShape = T86Response
