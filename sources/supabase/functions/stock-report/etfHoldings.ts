/**
 * ETF holdings (Task 200): what an ETF holds, as its issuer publishes it. 0050 only for now.
 *
 * Source: Yuanta's JSON bridge, the same `PCF/Daily` call its own 「持股比重」 page makes
 * (docs/agent/specs/200-etf-holdings.md § Phase 0). Three facts about it that are easy to get wrong:
 *
 * 1. The quantities in `FundWeights` are the **whole fund**, not the creation basket (that is `InKind`).
 * 2. The `date` query parameter is the **announcement** date; the trade date is `PCF.trandate`, so the
 *    day is always read from the response, never from what was asked.
 * 3. The weights are percentages of `Summary.fundsize`, not of `PCF.totalav`.
 *
 * Every figure is stored as published. Nothing here recomputes a weight or a NAV for display; the
 * arithmetic below only checks that a response is whole before it may replace a good one.
 */

export const ETF_HOLDINGS_SCHEMA = 1
/** Trading days kept per ETF; the screen uses the newest only, the rest is for a later day-over-day view. */
export const ETF_HOLDINGS_MAX_DAYS = 20

export interface EtfHoldingsStock {
  code: string
  name: string
  shares: number
  /** Percent as published (56.39). */
  weight: number
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
  /** 'YYYY-MM-DD', from the source's trade date — not the day it was fetched. */
  tradeDate: string
  /** The source's own update stamp ('YYYY-MM-DD HH:mm:ss', Taipei), as given. */
  publishedAt: string | null
  navTotal: number
  navPerUnit: number
  unitsOutstanding: number
  /** The denominator of `weight`. Differs from `navTotal`. */
  fundSize: number
  assets: { stock: number; etf: number; bond: number; futures: number }
  stocks: EtfHoldingsStock[]
  futures: EtfHoldingsFuture[]
}

export interface EtfHoldingsFile {
  schema: typeof ETF_HOLDINGS_SCHEMA
  etf: string
  fundName: string
  issuer: 'yuanta'
  /** The official page, for the user to check against. */
  sourceUrl: string
  updatedAt: string
  /** Newest first. */
  days: EtfHoldingsDay[]
}

export const etfHoldingsPath = (etf: string): string => `market/etf_holdings/${etf}.json`

export const yuantaRatioPageUrl = (etf: string): string =>
  `https://www.yuantaetfs.com/product/detail/${encodeURIComponent(etf)}/ratio`

/** Latest published day; `annYmd` (YYYYMMDD announcement date) asks for an older one. */
export function yuantaHoldingsUrl(etf: string, annYmd?: string): string {
  const base =
    'https://etfapi.yuantaetfs.com/ectranslation/api/bridge?APIType=ETFAPI&CompanyName=YUANTAFUNDS' +
    '&DeviceId=null&FuncId=PCF%2FDaily&AppName=ETF&Device=3&Platform=ETF'
  return `${base}&ticker=${encodeURIComponent(etf)}${annYmd ? `&date=${annYmd}` : ''}`
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** The fund's name and the day's figures, or null when the response is not a PCF/Daily body. */
export function parseYuantaHoldings(raw: unknown): { fundName: string; day: EtfHoldingsDay } | null {
  const root = obj(raw)
  const pcf = obj(root?.PCF)
  const weights = obj(root?.FundWeights)
  const summary = obj(weights?.Summary)
  if (!pcf || !weights || !summary) return null

  const trandate = typeof pcf.trandate === 'string' ? pcf.trandate : ''
  if (!/^\d{8}$/.test(trandate)) return null
  if (![pcf.totalav, pcf.nav, pcf.osunit, summary.fundsize].every(isNum)) return null
  if (![summary.stkvalues, summary.etfvalues, summary.bndvalues, summary.futvalues].every(isNum)) return null
  if (!Array.isArray(weights.StockWeights) || !Array.isArray(weights.FutureWeights)) return null

  const stocks: EtfHoldingsStock[] = []
  for (const s of weights.StockWeights) {
    const o = obj(s)
    if (!o || typeof o.code !== 'string' || typeof o.name !== 'string' || !isNum(o.qty) || !isNum(o.weights)) {
      return null
    }
    stocks.push({ code: o.code.trim(), name: o.name.trim(), shares: o.qty, weight: o.weights })
  }
  // The screen cuts to the top 10, so the order must be the published weight, largest first —
  // not whatever order the response happens to use (Yuanta's matched it on the days checked).
  stocks.sort((a, b) => b.weight - a.weight)
  const futures: EtfHoldingsFuture[] = []
  for (const f of weights.FutureWeights) {
    const o = obj(f)
    if (!o || typeof o.code !== 'string' || !isNum(o.qty) || !isNum(o.weights)) return null
    futures.push({
      code: o.code.trim(),
      name: typeof o.name === 'string' ? o.name.trim() : null,
      contracts: o.qty,
      weight: o.weights,
      month: typeof o.ym === 'string' ? o.ym : '',
    })
  }

  return {
    fundName: typeof pcf.fundname === 'string' ? pcf.fundname : '',
    day: {
      tradeDate: `${trandate.slice(0, 4)}-${trandate.slice(4, 6)}-${trandate.slice(6, 8)}`,
      publishedAt: typeof pcf.upddate === 'string' ? pcf.upddate : null,
      navTotal: pcf.totalav as number,
      navPerUnit: pcf.nav as number,
      unitsOutstanding: pcf.osunit as number,
      fundSize: summary.fundsize as number,
      assets: {
        stock: summary.stkvalues as number,
        etf: summary.etfvalues as number,
        bond: summary.bndvalues as number,
        futures: summary.futvalues as number,
      },
      stocks,
      futures,
    },
  }
}

export interface HoldingsRules {
  minStocks: number
  maxStocks: number
  /** Codes that must be present; a list without them is a truncated or wrong response. */
  mustInclude: string[]
}

/** 0050 tracks 臺灣50: 50 constituents, 2330 by far the largest. */
export const ETF_0050_RULES: HoldingsRules = { minStocks: 45, maxStocks: 55, mustInclude: ['2330'] }

/** NAV per unit is rounded to 2 decimals; on 2026-10-12 nav × units missed totalav by 0.0027 %. */
const NAV_IDENTITY_TOLERANCE = 0.0005
/** Percentage points; on 2026-10-12 the weight sum missed stock / fundsize by 0.02 pp. */
const STOCK_WEIGHT_TOLERANCE_PP = 0.5

export type HoldingsValidation = { ok: true } | { ok: false; rule: string }

/**
 * Is this day whole enough to publish? Each failed check names itself so the run log says which.
 * `todayYmd` is the Taipei calendar day (YYYYMMDD).
 */
export function validateHoldingsDay(day: EtfHoldingsDay, rules: HoldingsRules, todayYmd: string): HoldingsValidation {
  const trade = day.tradeDate.replace(/-/g, '')
  if (!/^\d{8}$/.test(trade) || Number.isNaN(Date.parse(day.tradeDate))) return { ok: false, rule: 'trade-date' }
  if (trade > todayYmd) return { ok: false, rule: 'trade-date-future' }

  if (!(day.navTotal > 0 && day.navPerUnit > 0 && day.unitsOutstanding > 0 && day.fundSize > 0)) {
    return { ok: false, rule: 'nav-positive' }
  }
  if (Math.abs((day.navPerUnit * day.unitsOutstanding) / day.navTotal - 1) > NAV_IDENTITY_TOLERANCE) {
    return { ok: false, rule: 'nav-identity' }
  }

  const n = day.stocks.length
  if (n < rules.minStocks || n > rules.maxStocks) return { ok: false, rule: 'stock-count' }
  const codes = new Set(day.stocks.map((s) => s.code))
  if (codes.size !== n) return { ok: false, rule: 'stock-duplicate' }
  if (!day.stocks.every((s) => s.code !== '' && Number.isInteger(s.shares) && s.shares > 0 && s.weight > 0)) {
    return { ok: false, rule: 'stock-row' }
  }
  if (!rules.mustInclude.every((c) => codes.has(c))) return { ok: false, rule: 'stock-missing' }

  const weightSum = day.stocks.reduce((sum, s) => sum + s.weight, 0)
  const stockShare = (day.assets.stock / day.fundSize) * 100
  if (Math.abs(weightSum - stockShare) > STOCK_WEIGHT_TOLERANCE_PP) return { ok: false, rule: 'stock-weight-sum' }

  // Futures amount and futures weight are not cross-checked: what `futvalues` measures is not documented.
  if (day.assets.futures > 0 && day.futures.length === 0) return { ok: false, rule: 'futures-missing' }
  return { ok: true }
}

/** Same date replaced, newest first, capped. */
export function appendHoldingsDay(
  existing: EtfHoldingsDay[],
  day: EtfHoldingsDay,
  max = ETF_HOLDINGS_MAX_DAYS,
): EtfHoldingsDay[] {
  return [day, ...existing.filter((d) => d.tradeDate !== day.tradeDate)]
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
    .slice(0, max)
}

/** Content identity of a day; `publishedAt` is left out so a re-stamp alone is not a change. */
export function holdingsFingerprint(day: EtfHoldingsDay): string {
  const { publishedAt: _ignored, ...rest } = day
  return JSON.stringify(rest)
}

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000
/** Yuanta stamped 15:54–16:33 between 2026-09-29 and 2026-10-13. */
const PUBLISH_HOUR_TAIPEI = 16

/**
 * The newest trade date that ought to be published at `now` ('YYYY-MM-DD'): today from 16:00 Taipei
 * on a weekday, otherwise the previous weekday. Holidays are not known here — on one the sync makes a
 * single request and finds nothing new, which is cheaper than another copy of the holiday calendar.
 */
export function expectedLatestTradeDate(now: Date): string {
  const t = new Date(now.getTime() + TAIPEI_OFFSET_MS)
  const day = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
  const weekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6
  if (!(weekday(day) && t.getUTCHours() >= PUBLISH_HOUR_TAIPEI)) {
    do day.setUTCDate(day.getUTCDate() - 1)
    while (!weekday(day))
  }
  return day.toISOString().slice(0, 10)
}
