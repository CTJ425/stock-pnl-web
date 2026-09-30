/**
 * 區間收益 (Task 176): pick any two dates and see which stocks made or lost money in between.
 *
 * Why this needs no engine recomputation: `SellDetail` records the moving-average cost **as it stood
 * at the moment of that sell**, so a leg's realized P&L is already final and independent of which
 * window you look at. Slicing legs by `date` is therefore exact, and a range covering a whole
 * calendar year reproduces that year's row in the yearly table figure for figure — the property the
 * tests pin down.
 *
 * Only money already in the account is counted: realized sells (including 融券回補) and cash
 * dividends. Shares still held have no place here — an open position's paper gain belongs to
 * "now", not to a date range — so a ticker that was only bought inside the window is left out.
 */
import type { Currency } from '../../types/models'
import type { Ledger, SellDetail, YearTickerDetail } from '../../utils/pnlEngine'
import { addMonthsKey } from '../../utils/taipeiDate'
import { roiBasis } from './pnlMath'

export type RangePreset = '1m' | '3m' | '1y' | 'ytd' | 'lastYear' | 'all' | 'custom'

export const RANGE_PRESETS: ReadonlyArray<{ id: RangePreset; label: string }> = [
  { id: '1m', label: '近 1 個月' },
  { id: '3m', label: '近 3 個月' },
  { id: '1y', label: '近 1 年' },
  { id: 'ytd', label: '今年以來' },
  { id: 'lastYear', label: '去年' },
  { id: 'all', label: '全部' },
  { id: 'custom', label: '自訂' },
]

/** Inclusive calendar-date window; both ends are 'YYYY-MM-DD' and compared as strings. */
export interface DateRange {
  from: string
  to: string
}

/**
 * The span of dates the ledger actually covers, used for the 全部 preset and to clamp the custom
 * date inputs. `null` when the ledger holds no sell or dividend leg at all.
 */
export function ledgerSpan(ledger: Ledger): DateRange | null {
  let from = ''
  let to = ''
  for (const year of ledger.years) {
    for (const yt of Object.values(ledger.yearly[year].tickers)) {
      for (const date of [...yt.sells.map((s) => s.date), ...yt.dividendLegs.map((d) => d.date)]) {
        if (!from || date < from) from = date
        if (!to || date > to) to = date
      }
    }
  }
  return from ? { from, to } : null
}

/**
 * Turn a preset into an inclusive window. `today` is the current Asia/Taipei calendar date, so
 * 近 3 個月 means the real last three months — an empty table is the truthful answer when nothing
 * was sold in them. 'custom' has no answer of its own; the caller keeps those two dates.
 */
export function resolveRange(preset: RangePreset, today: string, span: DateRange | null): DateRange {
  const year = Number(today.slice(0, 4))
  switch (preset) {
    case '1m':
      return { from: addMonthsKey(today, -1), to: today }
    case '3m':
      return { from: addMonthsKey(today, -3), to: today }
    case '1y':
      return { from: addMonthsKey(today, -12), to: today }
    case 'ytd':
      return { from: `${year}-01-01`, to: today }
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
    case 'all':
    case 'custom':
      return span ?? { from: today, to: today }
  }
}

/** One stock's realized money inside the window. */
export interface RangeTickerRow {
  key: string
  ticker: string
  name: string
  market: YearTickerDetail['market']
  currency: Currency
  realized: number
  costBasis: number
  rawCostBasis: number
  sellAmt: number
  sellGross: number
  fees: number
  feesTax: number
  dividends: number
  /** Realized + dividends: what this stock actually added to the account in the window. */
  total: number
  /** Sell legs in the window, oldest first — the expanded detail rows. */
  sells: SellDetail[]
}

export interface RangeTotals {
  realized: number
  costBasis: number
  rawCostBasis: number
  sellAmt: number
  sellGross: number
  fees: number
  feesTax: number
  dividends: number
  total: number
  sellCount: number
  /** Stocks that ended the window up / down on realized money plus dividends. */
  gainers: number
  losers: number
}

export interface RangeResult {
  rows: RangeTickerRow[]
  totals: RangeTotals
  /** True when the ledger has legs but none fall inside the window (a different empty from "no data"). */
  empty: boolean
}

function emptyTotals(): RangeTotals {
  return {
    realized: 0,
    costBasis: 0,
    rawCostBasis: 0,
    sellAmt: 0,
    sellGross: 0,
    fees: 0,
    feesTax: 0,
    dividends: 0,
    total: 0,
    sellCount: 0,
    gainers: 0,
    losers: 0,
  }
}

/**
 * Aggregate one currency's realized money between `from` and `to`, both ends included.
 *
 * A ticker is merged across years by `key`: a window spanning 2025-12 → 2026-02 must show one row
 * per stock, not one per calendar year.
 */
export function rangeRows(ledger: Ledger, currency: Currency, range: DateRange): RangeResult {
  const { from, to } = range
  const byKey = new Map<string, RangeTickerRow>()
  const totals = emptyTotals()

  const rowFor = (yt: YearTickerDetail): RangeTickerRow => {
    let row = byKey.get(yt.key)
    if (!row) {
      row = {
        key: yt.key,
        ticker: yt.ticker,
        name: yt.name,
        market: yt.market,
        currency: yt.currency,
        realized: 0,
        costBasis: 0,
        rawCostBasis: 0,
        sellAmt: 0,
        sellGross: 0,
        fees: 0,
        feesTax: 0,
        dividends: 0,
        total: 0,
        sells: [],
      }
      byKey.set(yt.key, row)
    } else if (yt.name && yt.name !== yt.ticker) {
      // A later year may carry the real name where an earlier placeholder row only had the code.
      row.name = yt.name
    }
    return row
  }

  for (const year of ledger.years) {
    for (const yt of Object.values(ledger.yearly[year].tickers)) {
      if (yt.currency !== currency) continue
      const sells = yt.sells.filter((s) => s.date >= from && s.date <= to)
      const dividends = yt.dividendLegs
        .filter((d) => d.date >= from && d.date <= to)
        .reduce((sum, d) => sum + d.net, 0)
      if (sells.length === 0 && dividends === 0) continue

      const row = rowFor(yt)
      row.dividends += dividends
      row.sells.push(...sells)
      for (const s of sells) {
        row.realized += s.realized
        row.costBasis += s.costBasis
        row.rawCostBasis += s.rawCostBasis
        row.sellAmt += s.sellAmt
        row.sellGross += s.sellGross
        row.fees += s.fees
        row.feesTax += s.feesTax
      }
    }
  }

  const rows = [...byKey.values()]
  for (const row of rows) {
    row.total = row.realized + row.dividends
    row.sells.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.legId < b.legId ? -1 : 1))
    totals.realized += row.realized
    totals.costBasis += row.costBasis
    totals.rawCostBasis += row.rawCostBasis
    totals.sellAmt += row.sellAmt
    totals.sellGross += row.sellGross
    totals.fees += row.fees
    totals.feesTax += row.feesTax
    totals.dividends += row.dividends
    totals.sellCount += row.sells.length
    if (row.total > 0) totals.gainers++
    else if (row.total < 0) totals.losers++
  }
  totals.total = totals.realized + totals.dividends

  // Biggest earner first; ties (two dividend-only rows, say) fall back to the code so the order is stable.
  rows.sort((a, b) => b.total - a.total || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))

  return { rows, totals, empty: rows.length === 0 }
}

/** Every in-window sell leg of one currency, for the totals row's fee-aware return rate. */
export function rangeRoi(rows: RangeTickerRow[]) {
  return roiBasis(rows.flatMap((r) => r.sells))
}
