/**
 * 中國信託投信 (CTBC) holdings source (Task 200, expansion release 1). Phase 0 in
 * docs/agent/specs/200-etf-holdings.md § CTBC.
 *
 * The site is a Vue SPA over `https://www.ctbcinvestments.com.tw/API/<path>`. Every call is a POST
 * carrying a `token` both in the query string and in the JSON body:
 *
 * 1. `home/AuthToken` with the site token `www.ctbcinvestments.com` returns a session token. It
 *    contains `+ / =`, so it must be URL-encoded — sent raw, `+` reads as a space and every later call
 *    answers 「Token 無效或過期」.
 * 2. `etf/ETFList` maps the ticker (`ETF_ID` 009828) to the fund id the other calls want (`FID` E0039).
 * 3. `etf/ETFHoldingWeight {FID, StartDate}` returns the whole fund on the latest day on or before
 *    `StartDate`: NAV, units, every holding with its weight over NAV, and the cash lines.
 *
 * Numbers arrive as strings with thousands separators; `amount_` is in each row's own currency
 * (JPY, KRW …), so no NT$ total per asset class exists — `assets` is null for this issuer.
 */
import type { EtfHoldingsDay, EtfHoldingsFuture, EtfHoldingsStock } from './etfHoldings.ts'

export const CTBC_API = 'https://www.ctbcinvestments.com.tw/API/'
const SITE_TOKEN = 'www.ctbcinvestments.com'

export const ctbcRatioPageUrl = (etf: string): string =>
  `https://www.ctbcinvestments.com/Etf/${encodeURIComponent(etf)}/Combination`

/** POST one API call; null on any transport failure. The caller reads `ResultCode`. */
export type CtbcPost = (url: string, body: Record<string, unknown>) => Promise<unknown | null>

export function ctbcCallUrl(path: string, token: string): string {
  return `${CTBC_API}${path}?${new URLSearchParams({ token })}`
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** `Data` of a successful call (`ResultCode` 0), else null. */
function dataOf(res: unknown): unknown {
  const o = obj(res)
  return o && o.ResultCode === 0 ? o.Data : null
}

/** '999,600.00' → 999600; '' or anything unparsable → NaN. */
export function ctbcNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string' || v.trim() === '') return Number.NaN
  return Number(v.replace(/,/g, ''))
}

/**
 * Exchange suffix → market. Taiwan codes carry none ('3037'); foreign ones do ('4062 JP',
 * '007660 KP'). KP / KQ / KS are the Korean boards (KOSPI / KOSDAQ).
 */
const MARKET_OF_SUFFIX: Record<string, string> = { JP: 'JP', KP: 'KR', KQ: 'KR', KS: 'KR', US: 'US', UN: 'US', UW: 'US', HK: 'HK' }

export function splitCtbcCode(raw: string): { code: string; market: string } {
  const [code, suffix] = raw.trim().split(/\s+/)
  if (!suffix) return { code, market: 'TW' }
  return { code, market: MARKET_OF_SUFFIX[suffix] ?? suffix }
}

/** The fund's name and day from `etf/ETFHoldingWeight` `Data`, or null when it is not that shape. */
export function parseCtbcHoldings(data: unknown): { fundName: string; day: EtfHoldingsDay } | null {
  const d = obj(data)
  const assets = Array.isArray(d?.FundAssets) ? obj(d.FundAssets[0]) : null
  const groups = Array.isArray(d?.FundAssetsDetail) ? d.FundAssetsDetail.map(obj) : null
  if (!assets || !groups || groups.some((g) => g === null)) return null

  const dateRaw = typeof assets['資料日期'] === 'string' ? assets['資料日期'] : ''
  const m = dateRaw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
  if (!m) return null
  const navTotal = ctbcNumber(assets['基金淨資產'])
  const units = ctbcNumber(assets['基金在外流通單位數'])
  const perUnit = ctbcNumber(assets['基金每單位淨值'])
  if (![navTotal, units, perUnit].every(Number.isFinite)) return null

  const stocks: EtfHoldingsStock[] = []
  const futures: EtfHoldingsFuture[] = []
  for (const g of groups as Array<Record<string, unknown>>) {
    const rows = Array.isArray(g.Data) ? g.Data.map(obj) : []
    if (rows.some((r) => r === null)) return null
    for (const r of rows as Array<Record<string, unknown>>) {
      const type = String(r.invtp_ ?? '').toUpperCase()
      const weight = ctbcNumber(r.weights_)
      const qty = ctbcNumber(r.qty_)
      if (type === 'STOCK') {
        if (typeof r.code_ !== 'string' || typeof r.name_ !== 'string' || !Number.isFinite(weight) || !Number.isFinite(qty)) {
          return null
        }
        const { code, market } = splitCtbcCode(r.code_)
        stocks.push({ code, name: r.name_.trim(), shares: qty, weight, market })
      } else if (type.startsWith('FUT')) {
        if (typeof r.code_ !== 'string' || !Number.isFinite(weight) || !Number.isFinite(qty)) return null
        futures.push({
          code: r.code_.trim(),
          name: typeof r.name_ === 'string' ? r.name_.trim() : null,
          contracts: qty,
          weight,
          month: typeof r.ym_ === 'string' ? r.ym_ : '',
        })
      }
      // CASH and receivable / payable lines are not holdings.
    }
  }
  stocks.sort((a, b) => b.weight - a.weight)

  const fund = Array.isArray(d?.Fund) ? obj(d.Fund[0]) : null
  return {
    fundName: typeof fund?.FundName === 'string' ? fund.FundName : '',
    day: {
      tradeDate: `${m[1]}-${m[2]}-${m[3]}`,
      publishedAt: null,
      navTotal,
      navPerUnit: perUnit,
      unitsOutstanding: units,
      // CTBC's weights are over the fund's net assets: 3037 on 2026-10-13 was 1,179,528,000 of
      // 10,304,880,295 = 11.446 %, published as 11.44.
      fundSize: navTotal,
      assets: null,
      stocks,
      futures,
    },
  }
}

/**
 * One run's CTBC session: one token and one ticker → FID map shared by every CTBC ETF in the run,
 * so N funds cost N + 2 requests. `fetchHoldings` answers null on any failure.
 */
export function createCtbcSession(post: CtbcPost) {
  let session: Promise<{ token: string; fids: Map<string, string> } | null> | null = null

  async function open(): Promise<{ token: string; fids: Map<string, string> } | null> {
    const auth = obj(dataOf(await post(ctbcCallUrl('home/AuthToken', SITE_TOKEN), { token: SITE_TOKEN })))
    const token = typeof auth?.token === 'string' ? auth.token : null
    if (!token) return null
    const list = obj(dataOf(await post(ctbcCallUrl('etf/ETFList', token), { token, IsWithETF: 'Y' })))
    const rows = Array.isArray(list?.Data) ? list.Data.map(obj) : []
    const fids = new Map<string, string>()
    for (const r of rows) {
      if (r && typeof r.ETF_ID === 'string' && typeof r.FID === 'string') fids.set(r.ETF_ID.trim(), r.FID.trim())
    }
    return fids.size > 0 ? { token, fids } : null
  }

  return {
    /** `Data` of `etf/ETFHoldingWeight` for the latest day on or before `startYmd` (YYYYMMDD). */
    async fetchHoldings(etf: string, startYmd: string): Promise<unknown | null> {
      session ??= open()
      const s = await session
      const fid = s?.fids.get(etf)
      if (!s || !fid) return null
      const startDate = `${startYmd.slice(0, 4)}/${startYmd.slice(4, 6)}/${startYmd.slice(6, 8)}`
      const res = await post(ctbcCallUrl('etf/ETFHoldingWeight', s.token), { token: s.token, FID: fid, StartDate: startDate })
      return dataOf(res)
    },
  }
}
