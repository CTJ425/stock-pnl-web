/**
 * Sector money flow: what the three institutional investors (外資, 投信, 自營商) bought and sold
 * today, summed by industry, in NT$.
 *
 * Nothing upstream publishes this. TWSE and TPEx give net **shares** per stock (T86,
 * tpex_3insti_daily_trading) and the industry of each company; NT$ per sector is built here:
 *
 *   net NT$ of a stock = net shares × that stock's day VWAP (成交金額 ÷ 成交股數)
 *
 * VWAP, not the closing price: institutions trade through the session, and on 2026-10-02 the sum
 * over all listed stocks came to 103.2 億 against the 104.2 億 TWSE publishes in BFI82U (−0.9%),
 * while the closing price gave 114.7 億 (+10%). The estimate is therefore labelled an estimate,
 * and the official listed total is stored next to it for the reader to compare.
 *
 * Unit trap: shares in, NT$ out. Every `*Twd` field is yuan; the screen converts to 億.
 *
 * Sectors are the 33 official industries plus `ETF` (code starts with 0, not in an industry list)
 * and `NA` (priced but in no list). 半導體業 (24) is also split into IC 設計 / 晶圓製造 / 封裝測試 /
 * 其他 as child rows (`parent: '24'`); the children add up to the parent exactly.
 */
import { fingerprint } from './pollPlan.ts'
import { normNum } from './twChips.ts'
import { parseBfi82u } from './twMarket.ts'
import { SEMICONDUCTOR_SEGMENTS } from './semiconductorSegments.ts'

export const SECTOR_FLOW_SCHEMA = 1
/** Trading days kept in the file. Per-sector sums are small; 20 days covers 近 5 日 and one month of trend. */
export const SECTOR_FLOW_DAYS_CAP = 20
/** Biggest buyers and sellers kept per sector. */
export const TOP_PER_SECTOR = 3

export const SEMICONDUCTOR_CODE = '24'

// ---- upstream URLs ----

export function miIndexUrl(ymd: string): string | null {
  if (!/^\d{8}$/.test(ymd)) return null
  return `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`
}
/** Latest trading day only (no date parameter); the row `Date` says which day it is. */
export const TPEX_INSTITUTIONAL_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading'
export const TPEX_QUOTES_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'
export const INDUSTRY_LISTED_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
export const INDUSTRY_OTC_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'

// ---- sector names ----

/**
 * Short names for the screen. Codes 01–31 are TWSE's classification (INDUSTRY_NAMES in
 * twFundamental.ts); 32–38 are the categories added in 2021 — checked against the member
 * companies the open data returns for each code (e.g. 33 = 茂生農經, 36 = 一零四, 37 = 大魯閣).
 */
export const SECTOR_NAMES: Readonly<Record<string, string>> = {
  '01': '水泥',
  '02': '食品',
  '03': '塑膠',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙',
  '10': '鋼鐵',
  '11': '橡膠',
  '12': '汽車',
  '14': '建材營造',
  '15': '航運',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '19': '綜合',
  '20': '其他',
  '21': '化學',
  '22': '生技醫療',
  '23': '油電燃氣',
  '24': '半導體',
  '25': '電腦及週邊',
  '26': '光電',
  '27': '通信網路',
  '28': '電子零組件',
  '29': '電子通路',
  '30': '資訊服務',
  '31': '其他電子',
  '32': '文化創意',
  '33': '農業科技',
  '34': '電子商務',
  '35': '綠能環保',
  '36': '數位雲端',
  '37': '運動休閒',
  '38': '居家生活',
  '91': '存託憑證',
  ETF: 'ETF 與受益證券',
  NA: '未分類',
}

export const SEMICONDUCTOR_CHILDREN: Readonly<Record<string, string>> = {
  design: 'IC 設計',
  foundry: '晶圓製造',
  osat: '封裝測試',
  other: '設備、材料與其他',
}

// ---- types ----

export interface PriceRow {
  name: string
  shares: number
  valueTwd: number
  close: number | null
}

/** Net shares by investor group. `foreign` = 外陸資 + 外資自營商; `dealer` = 自營商 (self-trading + hedging). */
export interface InstNet {
  foreign: number
  trust: number
  dealer: number
}

export interface SectorTopStock {
  ticker: string
  name: string
  netTwd: number
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
  /** Everything traded in this sector that day, not only what the institutions touched. */
  turnoverTwd: number
  stocks: number
  topBuy: SectorTopStock[]
  topSell: SectorTopStock[]
}

export interface SectorFlowDay {
  /** 'YYYY-MM-DD' */
  date: string
  /** Which markets the figures include. `otc: false` = TPEx was not yet on this day when we ran. */
  coverage: { listed: boolean; otc: boolean }
  rows: SectorFlowRow[]
  /** Turnover of every stock in coverage. */
  marketTurnoverTwd: number
  /** This estimate over all listed stocks (ETF included) … */
  estimateListedTotalTwd: number
  /** … against what TWSE publishes for the same group (BFI82U 合計). null = not fetched. */
  officialListedTotalTwd: number | null
  /** Institutional stocks that had no usable price and were left out. */
  unpriced: number
}

/** The structure of market/sector_flow.json in Storage. */
export interface SectorFlowFile {
  schema: number
  asOf: string
  fingerprint: string
  /** Oldest to newest, up to SECTOR_FLOW_DAYS_CAP. Only the newest day carries topBuy/topSell. */
  days: SectorFlowDay[]
}

// ---- parsing ----

const norm = (s: unknown): string => String(s ?? '').replace(/[\s　]/g, '')

/** ROC '1151002' → '2026-10-02'; anything else → null. */
export function rocCompactDate(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{2,3})(\d{2})(\d{2})$/)
  if (!m) return null
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. */
function dashYmd(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

interface RwdTable {
  stat?: string
  date?: string
  fields?: string[]
  data?: unknown[][]
  tables?: { title?: string; fields?: string[]; data?: unknown[][] }[]
}

/**
 * TWSE MI_INDEX: the 每日收盤行情 table (everything except warrants). Columns are found by header
 * text, never by position (a shifted column still parses, into the wrong numbers).
 */
export function parseMiIndexPrices(json: unknown): { date: string; prices: Map<string, PriceRow> } | null {
  const r = (json ?? {}) as RwdTable
  if (r.stat !== 'OK' || !Array.isArray(r.tables) || !/^\d{8}$/.test(String(r.date ?? ''))) return null
  const table = r.tables.find((t) => String(t.title ?? '').includes('每日收盤行情'))
  if (!table || !Array.isArray(table.fields) || !Array.isArray(table.data)) return null
  const f = table.fields.map(norm)
  const iCode = f.indexOf('證券代號')
  const iName = f.indexOf('證券名稱')
  const iShares = f.indexOf('成交股數')
  const iValue = f.indexOf('成交金額')
  const iClose = f.indexOf('收盤價')
  if ([iCode, iName, iShares, iValue, iClose].some((i) => i < 0)) return null

  const prices = new Map<string, PriceRow>()
  for (const row of table.data) {
    if (!Array.isArray(row)) continue
    const code = norm(row[iCode])
    const shares = normNum(row[iShares])
    const valueTwd = normNum(row[iValue])
    if (!code || shares === null || valueTwd === null) continue
    prices.set(code, { name: String(row[iName] ?? '').trim(), shares, valueTwd, close: normNum(row[iClose]) })
  }
  return prices.size > 0 ? { date: dashYmd(String(r.date)), prices } : null
}

/**
 * TWSE T86: net shares per stock for the three groups. All four parts must be present; the
 * "三大法人買賣超股數" column is not read because it is the sum of these (checked on all 1,338 rows
 * of 2026-10-02).
 */
export function parseTwseInstitutional(json: unknown): Map<string, InstNet> | null {
  const r = (json ?? {}) as RwdTable
  const src = Array.isArray(r.data) && Array.isArray(r.fields) ? r : r.tables?.[0]
  if (!src || !Array.isArray(src.fields) || !Array.isArray(src.data)) return null
  const f = src.fields.map(norm)
  const iCode = f.indexOf('證券代號')
  const iForeign = f.indexOf('外陸資買賣超股數(不含外資自營商)')
  const iForeignDealer = f.indexOf('外資自營商買賣超股數')
  const iTrust = f.indexOf('投信買賣超股數')
  const iDealer = f.indexOf('自營商買賣超股數')
  if ([iCode, iForeign, iForeignDealer, iTrust, iDealer].some((i) => i < 0)) return null

  const out = new Map<string, InstNet>()
  for (const row of src.data) {
    if (!Array.isArray(row)) continue
    const code = norm(row[iCode])
    const foreign = normNum(row[iForeign])
    const foreignDealer = normNum(row[iForeignDealer])
    const trust = normNum(row[iTrust])
    const dealer = normNum(row[iDealer])
    if (!code || foreign === null || trust === null || dealer === null) continue
    out.set(code, { foreign: foreign + (foreignDealer ?? 0), trust, dealer })
  }
  return out.size > 0 ? out : null
}

type OpenApiRow = Record<string, unknown>

/** The key of `row` whose whitespace-and-case-stripped form satisfies `match`. */
function findKey(row: OpenApiRow, match: (k: string) => boolean): string | null {
  for (const k of Object.keys(row)) if (match(norm(k).toLowerCase())) return k
  return null
}

/**
 * TPEx tpex_3insti_daily_trading (net shares per stock). The English keys carry stray spaces and
 * two spellings, so they are matched on a normalised form. `date` is the data day (ROC in the file).
 */
export function parseTpexInstitutional(rows: unknown): { date: string | null; net: Map<string, InstNet> } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const first = rows[0] as OpenApiRow
  const kForeign = findKey(first, (k) => k.endsWith('(foreigndealersexcluded)-difference'))
  const kForeignDealer = findKey(first, (k) => k === 'foreigndealers-difference')
  const kTrust = findKey(first, (k) => k === 'securitiesinvestmenttrustcompanies-difference')
  const kDealer = findKey(first, (k) => k === 'dealers-difference')
  if (!kForeign || !kTrust || !kDealer) return null

  const net = new Map<string, InstNet>()
  for (const raw of rows) {
    const row = raw as OpenApiRow
    const code = norm(row.SecuritiesCompanyCode)
    const foreign = normNum(row[kForeign])
    const trust = normNum(row[kTrust])
    const dealer = normNum(row[kDealer])
    if (!code || foreign === null || trust === null || dealer === null) continue
    net.set(code, { foreign: foreign + (kForeignDealer ? (normNum(row[kForeignDealer]) ?? 0) : 0), trust, dealer })
  }
  return net.size > 0 ? { date: rocCompactDate(first.Date), net } : null
}

/** TPEx tpex_mainboard_quotes: price, shares and amount per stock. */
export function parseTpexQuotes(rows: unknown): { date: string | null; prices: Map<string, PriceRow> } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const prices = new Map<string, PriceRow>()
  for (const raw of rows) {
    const row = raw as OpenApiRow
    const code = norm(row.SecuritiesCompanyCode)
    const shares = normNum(row.TradingShares)
    const valueTwd = normNum(row.TransactionAmount)
    if (!code || shares === null || valueTwd === null) continue
    prices.set(code, {
      name: String(row.CompanyName ?? '').trim(),
      shares,
      valueTwd,
      close: normNum(row.Close),
    })
  }
  return prices.size > 0 ? { date: rocCompactDate((rows[0] as OpenApiRow).Date), prices } : null
}

/** ticker → industry code, from either company-profile list. */
export function parseIndustryMap(rows: unknown, codeKey: string, industryKey: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!Array.isArray(rows)) return out
  for (const raw of rows) {
    const row = raw as OpenApiRow
    const code = norm(row[codeKey])
    const industry = norm(row[industryKey])
    if (code && industry) out.set(code, industry)
  }
  return out
}

// ---- aggregation ----

export interface SectorFlowInput {
  /** 'YYYY-MM-DD' */
  date: string
  listedPrices: Map<string, PriceRow>
  listedInst: Map<string, InstNet>
  /** null = TPEx is not on this day yet; the figures then cover the listed market only. */
  otc: { prices: Map<string, PriceRow>; inst: Map<string, InstNet> } | null
  industry: Map<string, string>
  /** BFI82U 合計 買賣差額 for the day, NT$. null = not available. */
  officialListedTotalTwd: number | null
}

interface Acc {
  code: string
  name: string
  parent: string | null
  foreign: number
  trust: number
  dealer: number
  turnover: number
  stocks: number
  buys: SectorTopStock[]
  sells: SectorTopStock[]
}

function newAcc(code: string, name: string, parent: string | null): Acc {
  return { code, name, parent, foreign: 0, trust: 0, dealer: 0, turnover: 0, stocks: 0, buys: [], sells: [] }
}

/** Which sector a ticker belongs to; semiconductor tickers also get a child key. */
export function classify(
  ticker: string,
  industry: Map<string, string>,
): { sector: string; child: string | null } {
  const code = industry.get(ticker)
  if (code) {
    if (code === SEMICONDUCTOR_CODE) {
      return { sector: code, child: `${code}:${SEMICONDUCTOR_SEGMENTS[ticker] ?? 'other'}` }
    }
    return { sector: code, child: null }
  }
  return { sector: /^0\d/.test(ticker) ? 'ETF' : 'NA', child: null }
}

const byNetDesc = (a: SectorTopStock, b: SectorTopStock) => b.netTwd - a.netTwd || a.ticker.localeCompare(b.ticker)
const byNetAsc = (a: SectorTopStock, b: SectorTopStock) => a.netTwd - b.netTwd || a.ticker.localeCompare(b.ticker)

export function buildSectorFlowDay(input: SectorFlowInput): SectorFlowDay {
  const accs = new Map<string, Acc>()
  const acc = (code: string): Acc => {
    let a = accs.get(code)
    if (!a) {
      const [parentCode, segment] = code.split(':')
      a = segment
        ? newAcc(code, SEMICONDUCTOR_CHILDREN[segment] ?? segment, parentCode)
        : newAcc(code, SECTOR_NAMES[code] ?? `產業 ${code}`, null)
      accs.set(code, a)
    }
    return a
  }

  const prices = new Map(input.listedPrices)
  const inst = new Map(input.listedInst)
  if (input.otc) {
    for (const [k, v] of input.otc.prices) prices.set(k, v)
    for (const [k, v] of input.otc.inst) inst.set(k, v)
  }

  let marketTurnover = 0
  for (const [ticker, p] of prices) {
    marketTurnover += p.valueTwd
    const { sector, child } = classify(ticker, input.industry)
    acc(sector).turnover += p.valueTwd
    if (child) acc(child).turnover += p.valueTwd
  }

  let estimateListedTotal = 0
  let unpriced = 0
  for (const [ticker, net] of inst) {
    const p = prices.get(ticker)
    if (!p || p.shares <= 0 || p.valueTwd <= 0) {
      if (net.foreign !== 0 || net.trust !== 0 || net.dealer !== 0) unpriced++
      continue
    }
    const vwap = p.valueTwd / p.shares
    const foreign = net.foreign * vwap
    const trust = net.trust * vwap
    const dealer = net.dealer * vwap
    const total = foreign + trust + dealer
    if (input.listedInst.has(ticker)) estimateListedTotal += total

    const { sector, child } = classify(ticker, input.industry)
    for (const key of child ? [sector, child] : [sector]) {
      const a = acc(key)
      a.foreign += foreign
      a.trust += trust
      a.dealer += dealer
      a.stocks++
    }
    const top: SectorTopStock = { ticker, name: p.name, netTwd: Math.round(total) }
    const target = acc(sector)
    if (top.netTwd > 0) target.buys.push(top)
    else if (top.netTwd < 0) target.sells.push(top)
    if (child) {
      const c = acc(child)
      if (top.netTwd > 0) c.buys.push(top)
      else if (top.netTwd < 0) c.sells.push(top)
    }
  }

  const rows: SectorFlowRow[] = [...accs.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({
      code: a.code,
      name: a.name,
      parent: a.parent,
      foreignTwd: Math.round(a.foreign),
      trustTwd: Math.round(a.trust),
      dealerTwd: Math.round(a.dealer),
      totalTwd: Math.round(a.foreign + a.trust + a.dealer),
      turnoverTwd: Math.round(a.turnover),
      stocks: a.stocks,
      topBuy: a.buys.sort(byNetDesc).slice(0, TOP_PER_SECTOR),
      topSell: a.sells.sort(byNetAsc).slice(0, TOP_PER_SECTOR),
    }))

  return {
    date: input.date,
    coverage: { listed: true, otc: input.otc !== null },
    rows,
    marketTurnoverTwd: Math.round(marketTurnover),
    estimateListedTotalTwd: Math.round(estimateListedTotal),
    officialListedTotalTwd: input.officialListedTotalTwd,
    unpriced,
  }
}

/** The 合計 買賣差額 of a BFI82U response, NT$; null when the response is not a trading day. */
export function officialListedTotal(bfi82u: unknown): number | null {
  return parseBfi82u(bfi82u)?.totalTwd ?? null
}

// ---- file ----

/** Content fingerprint of the newest day. Rows are sorted by code and ties broken by ticker, so a re-ordered upstream cannot change it. */
export function sectorFlowFingerprint(day: SectorFlowDay): string {
  return fingerprint(day)
}

/**
 * Add `day` to the file (replacing the same date), keep the newest SECTOR_FLOW_DAYS_CAP days, and
 * drop the top-stock lists from every day but the newest — they are the bulk of the size and only
 * the latest day shows them.
 */
export function appendSectorFlowDay(existing: SectorFlowFile | null, day: SectorFlowDay, asOf: string): SectorFlowFile {
  const kept = (existing?.days ?? []).filter((d) => d.date !== day.date)
  const days = [...kept, day].sort((a, b) => a.date.localeCompare(b.date)).slice(-SECTOR_FLOW_DAYS_CAP)
  const newest = days[days.length - 1]
  const slim = days.map((d) =>
    d === newest ? d : { ...d, rows: d.rows.map((r) => ({ ...r, topBuy: [], topSell: [] })) },
  )
  return { schema: SECTOR_FLOW_SCHEMA, asOf, fingerprint: sectorFlowFingerprint(day), days: slim }
}
