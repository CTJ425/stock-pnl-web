/**
 * Moving average cost method profit and loss calculation engine
 *
 * ComputeLedger_ transplanted from the GAS version of code.gs, scans transactions one by one and maintains:
 * - Current position of each stock (number of shares held, position cost, historical accumulated purchase cost, realized profit and loss)
 * - Summary for each year (realized profits and losses, total transaction volume, handling fees, number of transactions, individual stock details)
 * - Data anomaly warning (oversold: the cost of the oversold part is calculated as 0, which is the same as the GAS version)
 *
 * Differences from the GAS version: the currency is determined by the market field ('TPE' → TWD, 'US' → USD),
 * No longer relies on the 'TPE:' prefix of ticker.
 */
import type { Currency, Market, Transaction } from '../types/models'
import { marketCurrency, positionKey } from '../types/models'

export interface Position {
  key: string
  ticker: string
  name: string
  market: Market
  currency: Currency
  /** Number of shares currently held*/
  qty: number
  /** Current position cost (moving average, including buying fees)*/
  cost: number
  /** Current position cost (excluding handling fees, used for "average transaction price")*/
  rawCost: number
  /** Historical accumulated purchase cost (denominator of return rate)*/
  buyCostTotal: number
  /** Cumulative realized gains and losses*/
  realized: number
}

export interface Holding extends Position {
  /** Average purchase cost (cost / qty, including handling fees)*/
  avgCost: number
  /** Average transaction price (rawCost/qty, excluding handling fees)*/
  rawAvgCost: number
}

export interface SellDetail {
  txId: string
  date: string        // tx_date YYYY-MM-DD
  qty: number
  price: number       // 成交單價
  sellAmt: number     // 實收 = 成交價金 − fee_tax
  sellGross: number   // 成交價金
  costBasis: number   // 賣出當下移動平均成本 × 配對股數（含買入手續費）
  rawCostBasis: number
  realized: number    // sellAmt − costBasis
  fees: number        // 該筆 fee_tax
  feesTax: number     // 該筆證交稅估算
  avgCost: number     // 賣出當下的平均成本（含費）
  oversold: boolean   // 超賣：超賣部分成本以 0 計
}

/**
 * A summary of the entry and exit of a certain stock during the year. The amount field has two calibers: "fee included" and "fee not included":
 * - Including fees (buyAmt / sellAmt / costBasis): The actual money paid and received has been included in the handling fee and certification tax
 * - Not including fees (buyGross / sellGross / rawCostBasis): pure transaction price, for comparison with broker transaction returns
 * Identity: realized = sellAmt − costBasis (the same applies to the non-fee version)
 */
export interface YearTickerDetail {
  key: string
  ticker: string
  name: string
  market: Market
  currency: Currency
  /** Purchase cash outflow (transaction price + handling fee)*/
  buyAmt: number
  /** Purchase transaction price (excluding handling fees)*/
  buyGross: number
  /** Actual receipts from sale (transaction price − handling fee − securities tax)*/
  sellAmt: number
  /** Sales transaction price (before tax)*/
  sellGross: number
  /** Acquisition cost of selling position (moving average cost × number of matched shares, including original purchase fee)*/
  costBasis: number
  /** Same as above, but using the average transaction price without handling fees.*/
  rawCostBasis: number
  realized: number
  fees: number
  /** Securities tax estimate, same as summary caliber*/
  feesTax: number
  count: number
  sells: SellDetail[]
}

export interface YearSummary {
  year: number
  realizedTw: number
  realizedUs: number
  buyAmt: number
  buyGross: number
  sellAmt: number
  sellGross: number
  costBasis: number
  rawCostBasis: number
  fees: number
  /** Securities tax estimate, same as summary caliber*/
  feesTax: number
  count: number
  tickers: Record<string, YearTickerDetail>
}

export interface LedgerSummary {
  /** Historical cumulative realized gains and losses (TWD) of Taiwan stocks*/
  realizedTw: number
  /** Historical cumulative realized gains and losses on U.S. stocks (USD)*/
  realizedUs: number
  /** Historical accumulated handling fees (mixed currency, isomorphic to GAS version KPI)*/
  fees: number
  /** Estimation of historical accumulated "pure handling fees" (fees − feesTax)*/
  feesBrokerage: number
  /** Estimation of historical accumulated securities tax: For selling Taiwan stocks, sellTaxRate is deduced (floorSafe (transaction price × tax rate), the upper limit is fee_tax); for buying and US stocks, it is 0*/
  feesTax: number
  /** Historical cumulative number of transactions*/
  count: number
  /** Historical cumulative number of purchases*/
  buyCount: number
  /** Historical cumulative number of sales*/
  sellCount: number
}

export interface Ledger {
  positions: Record<string, Position>
  /** position key in order of first appearance*/
  order: string[]
  /** For stocks currently holding > 0 shares, Taiwan stocks are listed first and are sorted by code (same structure as Dashboard)*/
  holdings: Holding[]
  yearly: Record<number, YearSummary>
  /** Years with transactions (incremental)*/
  years: number[]
  summary: LedgerSummary
  warnings: string[]
}

/**
 * The securities tax rate for selling Taiwan stocks: 0.3% for general stocks, 0.1% for ETFs starting with code 00,
 * Bond ETFs (starting with 00 and ending with B, such as 00679B) are currently exempt from 0
 */
export function sellTaxRate(ticker: string): number {
  if (/^00\d+B$/i.test(ticker)) return 0
  return ticker.startsWith('00') ? 0.001 : 0.003
}

/** First correct the binary floating point error (for example, 114 is mistakenly stored as 113.99999999999999) and then round it to the nearest dollar.*/
export function floorSafe(value: number): number {
  return Math.floor(Math.round(value * 1e6) / 1e6)
}

export function computeLedger(transactions: Transaction[]): Ledger {
  const ledger: Ledger = {
    positions: {},
    order: [],
    holdings: [],
    yearly: {},
    years: [],
    summary: { realizedTw: 0, realizedUs: 0, fees: 0, feesBrokerage: 0, feesTax: 0, count: 0, buyCount: 0, sellCount: 0 },
    warnings: [],
  }

  // Sort by date; same day by creation time (equivalent to the input column order of the GAS version)
  const txs = transactions
    .filter((tx) => tx.qty > 0 && (tx.tx_type === 'BUY' || tx.tx_type === 'SELL'))
    .slice()
    .sort(
      (a, b) =>
        a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at),
    )

  for (const tx of txs) {
    const year = Number(tx.tx_date.slice(0, 4))
    const currency = marketCurrency(tx.market)
    const key = positionKey(tx.market, tx.ticker)

    if (!ledger.yearly[year]) {
      ledger.yearly[year] = {
        year,
        realizedTw: 0,
        realizedUs: 0,
        buyAmt: 0,
        buyGross: 0,
        sellAmt: 0,
        sellGross: 0,
        costBasis: 0,
        rawCostBasis: 0,
        fees: 0,
        feesTax: 0,
        count: 0,
        tickers: {},
      }
    }
    const y = ledger.yearly[year]

    if (!ledger.positions[key]) {
      ledger.positions[key] = {
        key,
        ticker: tx.ticker,
        name: tx.name || tx.ticker,
        market: tx.market,
        currency,
        qty: 0,
        cost: 0,
        rawCost: 0,
        buyCostTotal: 0,
        realized: 0,
      }
      ledger.order.push(key)
    }
    const pos = ledger.positions[key]
    if (tx.name) pos.name = tx.name

    if (!y.tickers[key]) {
      y.tickers[key] = {
        key,
        ticker: tx.ticker,
        name: tx.name || tx.ticker,
        market: tx.market,
        currency,
        buyAmt: 0,
        buyGross: 0,
        sellAmt: 0,
        sellGross: 0,
        costBasis: 0,
        rawCostBasis: 0,
        realized: 0,
        fees: 0,
        feesTax: 0,
        count: 0,
        sells: [],
      }
    }
    const yt = y.tickers[key]
    if (tx.name) yt.name = tx.name

    y.count++
    y.fees += tx.fee_tax
    yt.count++
    yt.fees += tx.fee_tax

    // Estimating based on the tax rate, the error in manual adjustment or on-the-spot tax refund will fall on the handling fee
    const estTax =
      tx.tx_type === 'SELL' && tx.market === 'TPE'
        ? Math.min(floorSafe(tx.price * tx.qty * sellTaxRate(tx.ticker)), tx.fee_tax)
        : 0
    ledger.summary.feesTax += estTax
    ledger.summary.feesBrokerage += tx.fee_tax - estTax
    y.feesTax += estTax
    yt.feesTax += estTax

    if (tx.tx_type === 'BUY') {
      ledger.summary.buyCount++
      const gross = tx.price * tx.qty
      const totalCost = gross + tx.fee_tax // 手續費計入成本
      y.buyAmt += totalCost
      y.buyGross += gross
      yt.buyAmt += totalCost
      yt.buyGross += gross
      pos.cost += totalCost
      pos.rawCost += gross
      pos.qty += tx.qty
      pos.buyCostTotal += totalCost
    } else {
      ledger.summary.sellCount++
      const gross = tx.price * tx.qty
      const revenue = gross - tx.fee_tax
      y.sellAmt += revenue
      y.sellGross += gross
      yt.sellAmt += revenue
      yt.sellGross += gross

      const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 0
      const avgRawCost = pos.qty > 0 ? pos.rawCost / pos.qty : 0
      const matchedQty = Math.min(tx.qty, pos.qty)
      if (matchedQty < tx.qty) {
        ledger.warnings.push(
          `${tx.tx_date} ${tx.ticker} 賣出 ${tx.qty} 股，但當時持有僅 ${pos.qty} 股（超賣部分成本以 0 計算）`,
        )
      }
      const costBasis = avgCost * matchedQty
      const rawCostBasis = avgRawCost * matchedQty
      const realized = revenue - costBasis
      y.costBasis += costBasis
      y.rawCostBasis += rawCostBasis
      yt.costBasis += costBasis
      yt.rawCostBasis += rawCostBasis
      pos.cost -= costBasis
      pos.rawCost -= rawCostBasis
      pos.qty -= matchedQty
      pos.realized += realized
      yt.realized += realized

      yt.sells.push({
        txId: tx.id,
        date: tx.tx_date,
        qty: tx.qty,
        price: tx.price,
        sellAmt: revenue,
        sellGross: gross,
        costBasis,
        rawCostBasis,
        realized,
        fees: tx.fee_tax,
        feesTax: estTax,
        avgCost,
        oversold: matchedQty < tx.qty,
      })

      if (currency === 'TWD') y.realizedTw += realized
      else y.realizedUs += realized
    }
  }

  ledger.years = Object.keys(ledger.yearly)
    .map(Number)
    .sort((a, b) => a - b)

  for (const key of ledger.order) {
    const pos = ledger.positions[key]
    if (pos.currency === 'TWD') ledger.summary.realizedTw += pos.realized
    else ledger.summary.realizedUs += pos.realized
  }
  for (const year of ledger.years) {
    ledger.summary.fees += ledger.yearly[year].fees
    ledger.summary.count += ledger.yearly[year].count
  }

  ledger.holdings = ledger.order
    .map((key) => ledger.positions[key])
    .filter((pos) => pos.qty > 0)
    .map((pos) => ({ ...pos, avgCost: pos.cost / pos.qty, rawAvgCost: pos.rawCost / pos.qty }))
    .sort((a, b) => {
      if (a.currency !== b.currency) return a.currency === 'TWD' ? -1 : 1
      return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0
    })

  return ledger
}

/**
 * Estimating the "net unrealized profit and loss" of a single holding at current prices (identical to the GAS version of the Dashboard formula):
 * - Taiwan stocks: after deducting the estimated selling fee and securities tax (the floor of each item is rounded to the nearest dollar, the handling fee can be set to a single minimum limit),
 *   The outermost round rounds the floating point mantissa
 * - US stocks: market capitalization - cost, no withholding
 */
export function estimateUnrealized(
  holding: Holding,
  price: number,
  feeRate: number,
  minFee?: number,
): number {
  const mktVal = price * holding.qty
  if (holding.currency === 'TWD') {
    let fee = floorSafe(mktVal * feeRate)
    if (feeRate > 0 && minFee !== undefined && minFee > fee) fee = minFee
    return Math.round(
      mktVal - holding.qty * holding.avgCost - fee - floorSafe(mktVal * sellTaxRate(holding.ticker)),
    )
  }
  return mktVal - holding.qty * holding.avgCost
}
