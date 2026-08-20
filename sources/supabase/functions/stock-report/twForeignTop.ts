/**
 * TWSE TWT38U — foreign (and mainland China) investors' TOP 50 net buy / net sell (0.7.19).
 *
 * Why TWT38U and not the already-cached T86: `selectType=ALLBUT0999` on T86 excludes warrants
 * that TWT38U ranks (e.g. `063787`, `052786`, `074675`) — 4 of 16 sampled days differed. TWT38U
 * is also the cheapest exact source (146 KB vs T86's own fetch, vs 1.98 MB for `selectType=ALL`).
 *
 * Column 11 (合計買賣超, i.e. 外資及陸資合計) drives the ranking — the quantity the table is
 * named after. Columns 3..5 (不含外資自營商) are not stored; add them only if a later task needs
 * them.
 *
 * The upstream row order is not trusted: a PROPOSED draft assumed "first 50 rows" holds, which
 * turns a silent upstream re-sort into wrong data instead of an error. This module always sorts
 * locally.
 */

import { fingerprint } from './pollPlan.ts'

export const FOREIGN_TOP_SCHEMA = 1
export const FOREIGN_TOP_LIMIT = 50

/** rwd endpoint for a single trading day's foreign/mainland net buy-sell TOP list. */
export function twt38uUrl(ymd: string): string {
  return `https://www.twse.com.tw/rwd/zh/fund/TWT38U?date=${ymd}&response=json`
}

export interface Twt38uResponse {
  stat?: string
  date?: string
  fields?: string[]
  data?: string[][]
}

export interface ForeignTopItem {
  ticker: string
  name: string
  buy: number
  sell: number
  net: number
  block: boolean
}

export interface ForeignTopParsed {
  rawDate: string
  date: string
  buyTop: ForeignTopItem[]
  sellTop: ForeignTopItem[]
}

/** The structure of market/foreign_top50.json in Storage. */
export interface ForeignTopFile {
  schema: number
  asOf: string
  date: string
  rawDate: string
  fingerprint: string
  buyTop: ForeignTopItem[]
  sellTop: ForeignTopItem[]
}

/** '68,861,020' → 68861020. Not defensive against non-numeric input — upstream rows are numeric strings. */
function num(v: string): number {
  return Number(v.replace(/,/g, ''))
}

/**
 * Parse a TWT38U response into ranked buy/sell TOP lists.
 *
 * Returns null when the upstream marks the day as having no data (`stat !== 'OK'`), when `data`
 * is missing/empty, or when `date` is not an 8-digit YYYYMMDD — a non-trading day and a
 * not-yet-published table both land here, and both must be treated as "nothing to publish yet".
 */
export function parseForeignTop(resp: Twt38uResponse, limit = FOREIGN_TOP_LIMIT): ForeignTopParsed | null {
  if (resp.stat !== 'OK') return null
  if (!Array.isArray(resp.data) || resp.data.length === 0) return null
  const rawDate = resp.date
  if (!rawDate || !/^\d{8}$/.test(rawDate)) return null

  const items: ForeignTopItem[] = []
  for (const row of resp.data) {
    if (!Array.isArray(row) || row.length < 12) continue
    const net = num(row[11])
    if (net === 0) continue
    items.push({
      ticker: row[1].trim(),
      name: row[2].trim(),
      buy: num(row[9]),
      sell: num(row[10]),
      net,
      block: row[0] === '*',
    })
  }

  const byTickerAsc = (a: ForeignTopItem, b: ForeignTopItem) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0)

  const buyTop = items
    .filter((x) => x.net > 0)
    .sort((a, b) => b.net - a.net || byTickerAsc(a, b))
    .slice(0, limit)

  const sellTop = items
    .filter((x) => x.net < 0)
    .sort((a, b) => a.net - b.net || byTickerAsc(a, b))
    .slice(0, limit)

  const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
  return { rawDate, date, buyTop, sellTop }
}

/**
 * Content fingerprint over the ranked rows, cells joined with U+001F (unit separator) rather
 * than concatenation — a plain join would let `['12','3']` and `['1','23']` collide (AUDIT-04).
 *
 * The joined string is then hashed (0.9.7). Returning it raw made this column roughly 10KB per
 * row: it is persisted twice — into `source_probe_tick.fingerprint` on every probe round, and
 * into `market/foreign_top50.json` as that file's idempotency key — and every other source
 * already stores the short `<length>:<djb2>` form. The separator still does its job because it
 * is applied before hashing.
 */
const UNIT_SEP = String.fromCharCode(31)

export function foreignTopFingerprint(p: ForeignTopParsed): string {
  const cells: (string | number | boolean)[] = []
  for (const x of p.buyTop) cells.push(x.ticker, x.name, x.buy, x.sell, x.net, x.block)
  for (const x of p.sellTop) cells.push(x.ticker, x.name, x.buy, x.sell, x.net, x.block)
  return fingerprint(cells.join(UNIT_SEP))
}
