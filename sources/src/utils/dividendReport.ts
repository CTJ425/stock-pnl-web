/**
 * 股利專區 (Task 183): the cash dividends of one year and one market, in the three shapes the
 * report draws them — a month-by-month total, a per-stock share, and the payments themselves.
 *
 * Built from `Transaction[]` rather than from the ledger on purpose. The section needs the gross
 * figure, the withheld figure and the shares behind each payment, which is exactly a DIVIDEND row;
 * `DividendLeg` carries only the net. Summing the same `price * qty - fee_tax` the engine sums
 * keeps `net` here identical to `YearTickerDetail.dividends` by construction, so the section can
 * never disagree with the yearly table.
 *
 * The caliber of the two pictures is **gross** (配息總額), the figure a broker app shows, with the
 * net printed beside it — the user reconciles against the broker first and their own pocket second.
 */
import type { Currency, Market, Transaction } from '../types/models'
import { marketCurrency, positionKey } from '../types/models'

/** How many stocks get an identity colour before the rest fold into 其他. */
export const TOP_N = 4

/** The bucket's key; never a real `positionKey`, which always contains a colon. */
export const OTHER_KEY = 'other'

/** `colorIndex` for the folded bucket: a neutral, deliberately not a fifth identity hue. */
export const OTHER_COLOR = -1

/** One cash dividend payment. */
export interface DividendRow {
  txId: string
  /** `tx_date`, read as the 發放日 — the day the money reached the account. */
  date: string
  market: Market
  ticker: string
  name: string
  key: string
  /** 除息股數 */
  qty: number
  /** 每股股利 */
  perShare: number
  /** 配息總額 = qty * perShare */
  gross: number
  /** 代扣費用 = fee_tax (二代健保 + 匯費, as the broker deducted it) */
  fee: number
  /** 實收 */
  net: number
}

/** One stock's slice of the year, or the folded 其他 bucket. */
export interface DividendShare {
  key: string
  ticker: string
  name: string
  gross: number
  /** One decimal; the slices of a report sum to exactly 100.0 (largest remainder). */
  pct: number
  /** 0..TOP_N-1 for a named stock, `OTHER_COLOR` for the bucket. */
  colorIndex: number
  /** How many stocks the bucket holds; 1 for a named stock. */
  memberCount: number
}

/** One bar of the monthly chart. `segments` is ordered largest first, the bucket always last. */
export interface DividendMonth {
  /** 1..12 */
  month: number
  gross: number
  segments: Array<{ key: string; label: string; gross: number; colorIndex: number }>
}

export interface DividendReport {
  year: number
  currency: Currency
  rows: DividendRow[]
  gross: number
  fee: number
  net: number
  /** Number of payments, which is not the number of stocks. */
  count: number
  tickerCount: number
  months: DividendMonth[]
  shares: DividendShare[]
  /** The largest month's gross, the scale every bar is drawn against. 0 when the year is empty. */
  peakMonth: number
}

/**
 * The rows a report is built from: cash dividends only, in this market's currency, in this year.
 *
 * `qty > 0` mirrors `computeLedger`'s own filter, so a malformed row is dropped in both places
 * rather than counted here and ignored there. 股票股利 is excluded by type: it moves shares and
 * cost, never cash, and putting it in a money chart would double-count the position.
 */
function selectRows(transactions: Transaction[], year: number, currency: Currency): DividendRow[] {
  const prefix = `${year}-`
  const rows: DividendRow[] = []
  for (const tx of transactions) {
    if (tx.tx_type !== 'DIVIDEND') continue
    if (tx.qty <= 0) continue
    if (!tx.tx_date.startsWith(prefix)) continue
    if (marketCurrency(tx.market) !== currency) continue
    const gross = tx.price * tx.qty
    rows.push({
      txId: tx.id,
      date: tx.tx_date,
      market: tx.market,
      ticker: tx.ticker,
      name: tx.name,
      key: positionKey(tx.market, tx.ticker),
      qty: tx.qty,
      perShare: tx.price,
      gross,
      fee: tx.fee_tax,
      net: gross - tx.fee_tax,
    })
  }
  // Newest first, and a stable tiebreak so two payments on one day never swap between renders.
  rows.sort((a, b) => (a.date === b.date ? a.txId.localeCompare(b.txId) : b.date.localeCompare(a.date)))
  return rows
}

/**
 * Percentages to one decimal that sum to exactly 100.0.
 *
 * Rounding each share on its own gives 54.1 + 28.0 + 11.6 + 6.4 = 100.1, and a share table that
 * does not add up is the first thing a reader notices. Largest remainder hands the leftover tenths
 * to the shares that lost the most in rounding.
 */
export function largestRemainderPct(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return values.map(() => 0)
  const exact = values.map((v) => (v / total) * 1000)
  const floors = exact.map(Math.floor)
  let left = 1000 - floors.reduce((sum, v) => sum + v, 0)
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => (b.rem === a.rem ? a.i - b.i : b.rem - a.rem))
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return floors.map((v) => v / 10)
}

/**
 * Colour is assigned by size within the report, not by a stable per-ticker mapping.
 *
 * The usual rule — colour follows the entity, never its rank — guards against a filter repainting
 * the survivors of one dataset. Here the control is the year picker, and two years hold different
 * stocks anyway, so there is no "2609 is violet" for a reader to carry across. Within one rendered
 * year the mapping is fixed, and the legend and the table both print the name beside the swatch, so
 * identity never rests on colour alone.
 */
export function buildDividendReport(
  transactions: Transaction[],
  year: number,
  currency: Currency,
): DividendReport {
  const rows = selectRows(transactions, year, currency)

  const byTicker = new Map<string, { ticker: string; name: string; gross: number }>()
  let gross = 0
  let fee = 0
  for (const row of rows) {
    gross += row.gross
    fee += row.fee
    const found = byTicker.get(row.key)
    if (found) found.gross += row.gross
    else byTicker.set(row.key, { ticker: row.ticker, name: row.name, gross: row.gross })
  }

  const ranked = [...byTicker.entries()].sort((a, b) =>
    b[1].gross === a[1].gross ? a[0].localeCompare(b[0]) : b[1].gross - a[1].gross,
  )
  const top = ranked.slice(0, TOP_N)
  const rest = ranked.slice(TOP_N)

  const colorOf = new Map<string, number>()
  top.forEach(([key], i) => colorOf.set(key, i))

  const sliceGross = [...top.map(([, v]) => v.gross)]
  if (rest.length > 0) sliceGross.push(rest.reduce((sum, [, v]) => sum + v.gross, 0))
  const pcts = largestRemainderPct(sliceGross)

  const shares: DividendShare[] = top.map(([key, v], i) => ({
    key,
    ticker: v.ticker,
    name: v.name,
    gross: v.gross,
    pct: pcts[i],
    colorIndex: i,
    memberCount: 1,
  }))
  // 其他 is a bucket, not a rank: it stays last even when it outweighs the smallest named stock.
  if (rest.length > 0) {
    shares.push({
      key: OTHER_KEY,
      ticker: '',
      name: `其他 ${rest.length} 檔`,
      gross: sliceGross[sliceGross.length - 1],
      pct: pcts[pcts.length - 1],
      colorIndex: OTHER_COLOR,
      memberCount: rest.length,
    })
  }

  const months: DividendMonth[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    gross: 0,
    segments: [],
  }))
  const monthParts = months.map(() => new Map<string, { label: string; gross: number; colorIndex: number }>())
  for (const row of rows) {
    const idx = Number(row.date.slice(5, 7)) - 1
    if (idx < 0 || idx > 11) continue
    months[idx].gross += row.gross
    const color = colorOf.get(row.key)
    const folded = color === undefined
    const key = folded ? OTHER_KEY : row.key
    const part = monthParts[idx]
    const found = part.get(key)
    if (found) {
      found.gross += row.gross
      // A bucket segment covering more than one stock stops naming any single one.
      if (folded && found.label !== `其他（${row.ticker} ${row.name}）`) found.label = '其他'
    } else {
      part.set(key, {
        label: folded ? `其他（${row.ticker} ${row.name}）` : `${row.ticker} ${row.name}`,
        gross: row.gross,
        colorIndex: folded ? OTHER_COLOR : color,
      })
    }
  }
  months.forEach((m, i) => {
    m.segments = [...monthParts[i].entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => {
        if (a.key === OTHER_KEY) return 1
        if (b.key === OTHER_KEY) return -1
        return b.gross - a.gross
      })
  })

  return {
    year,
    currency,
    rows,
    gross,
    fee,
    net: gross - fee,
    count: rows.length,
    tickerCount: byTicker.size,
    months,
    shares,
    peakMonth: months.reduce((max, m) => Math.max(max, m.gross), 0),
  }
}

/** The years that hold at least one cash dividend in this currency, newest first. */
export function dividendYears(transactions: Transaction[], currency: Currency): number[] {
  const years = new Set<number>()
  for (const tx of transactions) {
    if (tx.tx_type !== 'DIVIDEND' || tx.qty <= 0) continue
    if (marketCurrency(tx.market) !== currency) continue
    const year = Number(tx.tx_date.slice(0, 4))
    if (Number.isFinite(year) && year > 0) years.add(year)
  }
  return [...years].sort((a, b) => b - a)
}

/**
 * A round scale top for the bar chart: the smallest "nice" number at or above the peak month, so
 * the axis reads 30,000 rather than 29,200 and the gridlines land on thirds of it.
 */
export function chartScaleMax(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  for (const step of [1, 1.5, 2, 3, 5, 7.5, 10]) {
    const candidate = step * magnitude
    if (candidate >= peak) return candidate
  }
  return 10 * magnitude
}
