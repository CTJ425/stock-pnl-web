/**
 * The dashboard's statement totals (2026-09-26 redesign): per-market sums and the
 * TWD-combined figure. Pure, so the arithmetic is tested without rendering the page.
 */
import type { Currency } from '../../types/models'
import type { HoldingRow } from '../../utils/holdingRows'
import { rowUnrealized, type PnlBasis } from '../../utils/pnlBasis'

/** Known values summed; null only when none is known (a partial quote set still shows a sum). */
export function sumOrNull(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length > 0 ? known.reduce((s, v) => s + v, 0) : null
}

export interface MarketSums {
  currency: Currency
  rows: HoldingRow[]
  hasShort: boolean
  /** Long leg market value; 0 (not unknown) when the market has no long rows. */
  longMkt: number | null
  /** Short leg market value; null when there are no short rows. */
  shortMkt: number | null
  /** long − short when both legs are known; the long leg alone without shorts; else null. */
  netMkt: number | null
  /** Cost of the long leg only: a position with both legs shares one holding object. */
  cost: number | null
  unrealized: number | null
  /** Quotes finished loading and at least one row still has no price. */
  quoteMissing: boolean
}

export function marketSums(rows: HoldingRow[], currency: Currency, basis: PnlBasis, loading: boolean): MarketSums {
  const longRows = rows.filter((r) => r.direction === 'LONG')
  const shortRows = rows.filter((r) => r.direction === 'SHORT')
  const hasShort = shortRows.length > 0
  // No long rows means the long leg is 0, not unknown: sumOrNull([]) is null, and null reads as
  // "quotes not here yet" to the page, which would draw a short-only market as skeletons.
  const longMkt = longRows.length === 0 ? 0 : sumOrNull(longRows.map((r) => r.mktVal))
  const shortMkt = hasShort ? sumOrNull(shortRows.map((r) => r.mktVal)) : null
  // Both legs must be known for a net figure: treating a missing leg as 0 prints a plausible
  // but wrong number.
  const netMkt = hasShort ? (longMkt !== null && shortMkt !== null ? longMkt - shortMkt : null) : longMkt
  return {
    currency,
    rows,
    hasShort,
    longMkt,
    shortMkt,
    netMkt,
    cost: longRows.length === 0 ? 0 : sumOrNull(longRows.map((r) => r.holding.cost)),
    unrealized: sumOrNull(rows.map((r) => rowUnrealized(r, basis))),
    quoteMissing: !loading && rows.length > 0 && rows.some((r) => r.price === null),
  }
}

export interface Combined {
  value: number | null
  currency: Currency
  /** Both markets are held but the US figure could not be converted, so it is left out. */
  usLeftOut: boolean
}

/**
 * One figure for the statement totals. Both markets held and a rate known → TWD sum; both held
 * but no rate (local mode) or a US figure missing → the TW figure, flagged, never a guessed
 * conversion; one market held → that market in its own currency.
 */
export function combine(
  tw: number | null,
  us: number | null,
  hasTw: boolean,
  hasUs: boolean,
  usdTwd: number | null,
): Combined {
  if (hasTw && hasUs) {
    if (usdTwd !== null && tw !== null && us !== null) return { value: tw + us * usdTwd, currency: 'TWD', usLeftOut: false }
    return { value: tw, currency: 'TWD', usLeftOut: true }
  }
  if (hasUs) return { value: us, currency: 'USD', usLeftOut: false }
  return { value: tw, currency: 'TWD', usLeftOut: false }
}

/**
 * The as-of phrase printed beside 未實現淨損益: 「9/25 收盤」 once every quoted TW row (or, without TW
 * rows, every quoted row) is a finalised close, 「試撮中」 during an auction, otherwise the time
 * the quotes were refreshed.
 */
export function asOfLabel(rows: HoldingRow[], refreshedAt: Date | null): string {
  const tw = rows.filter((r) => r.holding.currency === 'TWD')
  const quoted = (tw.length > 0 ? tw : rows).filter((r) => r.price !== null)
  if (quoted.some((r) => r.trial)) return '試撮中'
  const closedDay = quoted.length > 0 && quoted.every((r) => r.closed) ? quoted.find((r) => r.tradeDay)?.tradeDay : null
  if (closedDay) return `${closedDay} 收盤`
  if (refreshedAt) return `${refreshedAt.toLocaleTimeString('zh-TW', { hour12: false })} 更新`
  return ''
}
