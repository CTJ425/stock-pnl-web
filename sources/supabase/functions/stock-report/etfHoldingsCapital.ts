/**
 * 群益投信 (Capital) holdings source (Task 200, expansion release 2). Phase 0 in
 * docs/agent/specs/200-etf-holdings.md § Release 2.
 *
 * The site is an Angular app over `https://www.capitalfund.com.tw/CFWeb/api/<path>`, no token:
 *
 * 1. `POST etf/list` (JSON body `null`; an empty body answers 411) answers `{etfFilters, funds}`;
 *    `funds[]` maps the ticker (`stockNo` 00919) to the fund id the other calls want (`fundNo` '195').
 * 2. `POST etf/buyback {fundId, date}` is what its 「投資組合」 and 「申購買回清單」 pages show: the whole
 *    fund (2881 富邦金 611,370,000 shares ≈ 15.50 % of NAV on 2026-10-13), not the creation basket.
 *    `date` is the announcement date (`pcf.date1`); the trade date is `pcf.date2`. `null` = latest.
 *
 * Weights are over NAV (00919: stocks 99.58 % + futures 0.42 % = 100 %). There are no NT$ totals per
 * asset class (only margin / cash / payable lines), so `assets` is null, as for CTBC.
 */
import type { EtfHoldingsFuture, EtfHoldingsStock } from './etfHoldings.ts'
import type { ParsedHoldings } from './etfHoldingsSync.ts'

export const CAPITAL_API = 'https://www.capitalfund.com.tw/CFWeb/api/'

export const capitalRatioPageUrl = (fundNo: string): string =>
  `https://www.capitalfund.com.tw/etf/product/detail/${encodeURIComponent(fundNo)}/portfolio`

/** POST one API call with a JSON body; null on any transport failure. */
export type CapitalPost = (url: string, body: unknown) => Promise<unknown | null>

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** `data` of a successful call (`code` 200), else null. */
function dataOf(res: unknown): unknown {
  const o = obj(res)
  return o && o.code === 200 ? o.data : null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 'TX202610' → 'TX'; '台指期202610' → '台指期'. */
const stripMonth = (s: string, month: string): string => (month && s.endsWith(month) ? s.slice(0, -month.length) : s).trim()

/** A list field: missing or null reads as empty; any other non-array is a malformed response. */
function listOf(v: unknown): unknown[] | null {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : null
}

/** A Taiwan stock code: 4–6 digits, optionally one trailing letter (00919's holdings, 2881 …). */
const TW_CODE = /^\d{4,6}[A-Z]?$/

/**
 * The fund's name and day from `etf/buyback` `data`; `{ unsupported }` for a well-formed fund this
 * parser has no screen for (bond rows, a non-TWD fund, foreign stock codes); null when malformed.
 */
export function parseCapitalHoldings(data: unknown): ParsedHoldings | null {
  const d = obj(data)
  const pcf = obj(d?.pcf)
  const stockRows = listOf(d?.stocks)
  const futureRows = listOf(d?.futures)
  const bondRows = listOf(d?.bonds)
  if (!pcf || !stockRows || !futureRows || !bondRows) return null
  // Bonds and foreign funds: not parsed yet — skipped quietly, never dropped silently into a wrong day.
  if (bondRows.length > 0) return { unsupported: 'bonds' }
  if (typeof pcf.dollar === 'string' && pcf.dollar !== 'TWD') return { unsupported: 'currency' }

  const date = typeof pcf.date2 === 'string' ? pcf.date2 : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (![pcf.nav, pcf.totUnit, pcf.pUnit].every(isNum)) return null

  const stocks: EtfHoldingsStock[] = []
  for (const s of stockRows) {
    const o = obj(s)
    if (!o || typeof o.stocNo !== 'string' || typeof o.stocName !== 'string' || !isNum(o.weight) || !isNum(o.share)) {
      return null
    }
    if (!TW_CODE.test(o.stocNo.trim())) return { unsupported: 'foreign-stock' }
    stocks.push({ code: o.stocNo.trim(), name: o.stocName.trim(), shares: o.share, weight: o.weight, market: 'TW' })
  }
  stocks.sort((a, b) => b.weight - a.weight)

  const futures: EtfHoldingsFuture[] = []
  for (const f of futureRows) {
    const o = obj(f)
    if (!o || !isNum(o.weight) || !isNum(o.lot)) return null
    const month = typeof o.txDate === 'string' ? o.txDate.trim() : ''
    const desc = typeof o.txDesc === 'string' ? o.txDesc : ''
    const ename = typeof o.txEname === 'string' ? o.txEname : ''
    futures.push({
      code: stripMonth(ename || desc, month),
      name: desc ? stripMonth(desc, month) : null,
      contracts: o.lot,
      weight: o.weight,
      month,
    })
  }

  return {
    fundName: typeof pcf.fundName === 'string' ? pcf.fundName : '',
    day: {
      tradeDate: date,
      publishedAt: null,
      navTotal: pcf.nav as number,
      navPerUnit: pcf.pUnit as number,
      unitsOutstanding: pcf.totUnit as number,
      fundSize: pcf.nav as number,
      assets: null,
      stocks,
      futures,
    },
  }
}

/**
 * One run's Capital session: one ticker → fundNo map shared by every Capital ETF in the run, so N
 * funds cost N + 1 requests. `fundNoOf` is for the official page link.
 */
export function createCapitalSession(post: CapitalPost) {
  let list: Promise<Map<string, string> | null> | null = null
  let opened = false

  async function open(): Promise<Map<string, string> | null> {
    // `data` is `{ etfFilters, funds }`; the funds are under `funds` (28 on 2026-10-14).
    const rows = obj(dataOf(await post(`${CAPITAL_API}etf/list`, null)))?.funds
    const map = new Map<string, string>()
    for (const r of Array.isArray(rows) ? rows.map(obj) : []) {
      if (r && typeof r.stockNo === 'string' && typeof r.fundNo === 'string') map.set(r.stockNo.trim(), r.fundNo.trim())
    }
    return map.size > 0 ? map : null
  }

  return {
    /** Calls the next `fetchHoldings` makes: 2 while the list is not loaded yet, then 1. */
    pendingCalls: (): number => (opened ? 1 : 2),
    /** The fund id once the list is loaded (for the official page link), else null. */
    async fundNoOf(etf: string): Promise<string | null> {
      return list ? ((await list)?.get(etf) ?? null) : null
    },
    /** `data` of `etf/buyback` for the latest published day. */
    async fetchHoldings(etf: string): Promise<unknown | null> {
      opened = true
      list ??= open()
      const fundNo = (await list)?.get(etf)
      if (!fundNo) return null
      return dataOf(await post(`${CAPITAL_API}etf/buyback`, { fundId: fundNo, date: null }))
    },
  }
}
