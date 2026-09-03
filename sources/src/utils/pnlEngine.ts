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

export interface OpenLot {
  txId: string
  date: string
  qty: number
  price: number
  /** price * qty + buy fee, reduced proportionally on a partial sell */
  cost: number
  /** price * qty, reduced proportionally on a partial sell */
  rawCost: number
  /** Historical transaction fee rate if specified, used for per-lot unrealized selling fee estimation */
  feeRate?: number | null
}

export interface ShortLot {
  txId: string
  date: string
  qty: number
  price: number
  /** price*qty − sell fee − tax − borrow fee; reduced proportionally on a partial cover */
  proceeds: number
  /** price*qty; reduced proportionally on a partial cover */
  rawProceeds: number
}

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
  /** FIFO lots not yet fully sold, oldest first */
  openLots: OpenLot[]
  /**
   * Number of shares currently sold short (融券). Required on purpose, like `splitFeeTax`'s
   * `ticker`: an optional money field reads as 0 when a caller forgets it, and a forgotten
   * short leg is silent. Let the compiler catch the caller instead.
   */
  shortQty: number
  /** Net proceeds of the open short shares, fee/tax/borrow deducted */
  shortProceeds: number
  /** Gross proceeds (price*qty) of the open short shares */
  shortRawProceeds: number
  /** FIFO lots of open short sells, oldest first */
  shortLots: ShortLot[]
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
  /** Estimation of historical accumulated borrow fee (借券費), charged on a SHORT sell only*/
  feesBorrow: number
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
  // TDR (91xx) and REITs (01xxx[T]) also get the 0.1% ETF rate.
  if (ticker.startsWith('00') || ticker.startsWith('91') || /^01\d{3}[A-Z]?$/i.test(ticker)) return 0.001
  return 0.003
}

/** First correct the binary floating point error (for example, 114 is mistakenly stored as 113.99999999999999) and then round it to the nearest dollar.*/
export function floorSafe(value: number): number {
  return Math.floor(Math.round(value * 1e6) / 1e6)
}

/** 借券費（融券手續費）率, charged on a SHORT sell only. */
export const BORROW_FEE_RATE = 0.0008

// Plain string comparison; `tx_date` (YYYY-MM-DD) and `created_at` (ISO timestamp) both sort
// correctly with `<`/`>`, and this avoids locale-aware collation (localeCompare can treat '-'
// as ignorable punctuation under some ICU locales).
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Split a transaction's recorded `fee_tax` into brokerage fee, securities tax and (for a
 * SHORT sell) borrow fee.
 * `tx_nature === 'DAY_TRADE'` is trusted directly (halved tax rate, no inference).
 * `tx_nature === 'SHORT'` is trusted directly too (full tax rate, never halved, plus borrow
 * fee). Any other value — including an explicit 'SPOT' — falls through to the inference
 * ladder: a mislabelled row whose fee_tax cannot cover the standard tax must not have its
 * brokerage fee forced to 0 (BUG-036).
 */
export function splitFeeTax(
  // `ticker` is required on purpose: sellTaxRate('') answers 0.3%, so an optional ticker would
  // silently overtax every ETF, TDR and REIT by three times. Let the compiler catch a caller
  // that forgets it instead.
  tx: Pick<Transaction, 'tx_type' | 'market' | 'ticker' | 'price' | 'qty' | 'fee_tax'> &
    Pick<Partial<Transaction>, 'tx_nature'>,
): { fee: number; tax: number; borrow: number } {
  const ticker = tx.ticker
  let tax = 0
  let borrow = 0
  if (tx.tx_type === 'SELL' && tx.market === 'TPE') {
    const gross = tx.price * tx.qty
    if (tx.tx_nature === 'SHORT') {
      // 資券當沖 does not get the halved day-trade tax: a SHORT sell always pays full rate.
      const stdTax = floorSafe(gross * sellTaxRate(ticker))
      const stdBorrow = floorSafe(gross * BORROW_FEE_RATE)
      if (tx.fee_tax >= stdTax + stdBorrow) {
        tax = stdTax
        borrow = stdBorrow
      } else if (tx.fee_tax >= stdTax) {
        tax = stdTax
        borrow = tx.fee_tax - stdTax
      } else {
        tax = tx.fee_tax
        borrow = 0
      }
    } else if (tx.tx_nature === 'DAY_TRADE') {
      tax = Math.min(floorSafe((gross * sellTaxRate(ticker)) / 2), tx.fee_tax)
    } else {
      const stdTax = floorSafe(gross * sellTaxRate(ticker))
      if (tx.fee_tax >= stdTax) {
        tax = stdTax
      } else {
        // 現股當沖減半: day-trade sells get half the standard tax rate
        const halfTax = floorSafe((gross * sellTaxRate(ticker)) / 2)
        tax = tx.fee_tax >= halfTax ? halfTax : tx.fee_tax
      }
    }
  }
  return { fee: tx.fee_tax - tax - borrow, tax, borrow }
}

const COMMON_FEE_RATES = [
  0.001425, // 1.0 (原價)
  0.00092625, // 6.5 折
  0.000855, // 6.0 折
  0.0007125, // 5.0 折
  0.00057, // 4.0 折
  0.0005415, // 3.8 折
  0.0004275, // 3.0 折
  0.000399, // 2.8 折
  0.00035625, // 2.5 折
  0.000285, // 2.0 折
  0.00021375, // 1.5 折
  0.0001425, // 1.0 折
  0,
]

/**
 * Infers the transaction fee rate from a transaction record if not explicitly provided.
 */
export function inferTxFeeRate(
  tx: Pick<Transaction, 'tx_type' | 'market' | 'ticker' | 'price' | 'qty' | 'fee_tax'> &
    Pick<Partial<Transaction>, 'fee_rate' | 'tx_nature'>,
): number | null {
  if (tx.fee_rate !== undefined && tx.fee_rate !== null) return tx.fee_rate
  const gross = tx.price * tx.qty
  if (gross <= 0) return null
  if (tx.market === 'US') {
    if (tx.fee_tax === 0) return 0
    return Number((tx.fee_tax / gross).toFixed(6))
  }
  const fee = tx.tx_type === 'BUY' ? tx.fee_tax : splitFeeTax(tx).fee
  if (fee <= 0) return null

  for (const candidate of COMMON_FEE_RATES) {
    if (Math.floor(gross * candidate) === fee) {
      return candidate
    }
  }
  const ratio = fee / gross
  if (ratio <= 0.001425) {
    return ratio
  }
  return null
}

export function computeLedger(transactions: Transaction[]): Ledger {
  const ledger: Ledger = {
    positions: {},
    order: [],
    holdings: [],
    yearly: {},
    years: [],
    summary: { realizedTw: 0, realizedUs: 0, fees: 0, feesBrokerage: 0, feesTax: 0, feesBorrow: 0, count: 0, buyCount: 0, sellCount: 0 },
    warnings: [],
  }

  // Sort by date; same day by creation time (equivalent to the input column order of the GAS version)
  const txs = transactions
    .filter((tx) => tx.qty > 0 && (tx.tx_type === 'BUY' || tx.tx_type === 'SELL'))
    .slice()
    .sort((a, b) => cmp(a.tx_date, b.tx_date) || cmp(a.created_at, b.created_at))

  // Group transactions by trading date
  const dateMap = new Map<string, Transaction[]>()
  for (const tx of txs) {
    let group = dateMap.get(tx.tx_date)
    if (!group) {
      group = []
      dateMap.set(tx.tx_date, group)
    }
    group.push(tx)
  }

  const sortedDates = Array.from(dateMap.keys()).sort(cmp)

  for (const date of sortedDates) {
    const dayTxs = dateMap.get(date)!
    const year = Number(date.slice(0, 4))

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

    // Group dayTxs by ticker key
    const tickerGroups = new Map<string, Transaction[]>()
    for (const tx of dayTxs) {
      const key = positionKey(tx.market, tx.ticker)
      let list = tickerGroups.get(key)
      if (!list) {
        list = []
        tickerGroups.set(key, list)
      }
      list.push(tx)
    }

    for (const [key, groupTxs] of tickerGroups.entries()) {
      const sampleTx = groupTxs[0]
      const currency = marketCurrency(sampleTx.market)

      if (!ledger.positions[key]) {
        ledger.positions[key] = {
          key,
          ticker: sampleTx.ticker,
          name: sampleTx.name || sampleTx.ticker,
          market: sampleTx.market,
          currency,
          qty: 0,
          cost: 0,
          rawCost: 0,
          buyCostTotal: 0,
          realized: 0,
          openLots: [],
          shortQty: 0,
          shortProceeds: 0,
          shortRawProceeds: 0,
          shortLots: [],
        }
        ledger.order.push(key)
      }
      const pos = ledger.positions[key]

      if (!y.tickers[key]) {
        y.tickers[key] = {
          key,
          ticker: sampleTx.ticker,
          name: sampleTx.name || sampleTx.ticker,
          market: sampleTx.market,
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

      for (const tx of groupTxs) {
        // A transaction that carries only the ticker as its name is a placeholder; it must not overwrite a known name.
        if (tx.name && tx.name !== tx.ticker) {
          pos.name = tx.name
          yt.name = tx.name
        }
      }

      // Check if there are DAY_TRADE transactions on this date for this ticker
      const dtSells = groupTxs.filter((t) => t.tx_type === 'SELL' && t.tx_nature === 'DAY_TRADE')
      const dtBuys = groupTxs.filter((t) => t.tx_type === 'BUY' && t.tx_nature === 'DAY_TRADE')

      // Identify candidates for day-trade pairing
      // The fallback widens the candidate list to every same-day trade of the opposite
      // side, so a SHORT leg must be excluded explicitly: a 融券 sell paired off here would
      // never open the short position, and a 融券 cover would realize against the wrong leg.
      const candidateSells = dtSells.length > 0
        ? dtSells
        : (dtBuys.length > 0 ? groupTxs.filter((t) => t.tx_type === 'SELL' && t.tx_nature !== 'SHORT') : [])
      const candidateBuys = dtBuys.length > 0
        ? dtBuys
        : (dtSells.length > 0 ? groupTxs.filter((t) => t.tx_type === 'BUY' && t.tx_nature !== 'SHORT') : [])

      const remBuyMap = new Map<string, { tx: Transaction; remQty: number }>()
      for (const b of candidateBuys) {
        remBuyMap.set(b.id, { tx: b, remQty: b.qty })
      }
      const remSellMap = new Map<string, { tx: Transaction; remQty: number }>()
      for (const s of candidateSells) {
        remSellMap.set(s.id, { tx: s, remQty: s.qty })
      }

      const countedTxIds = new Set<string>()
      const countTx = (t: Transaction) => {
        if (!countedTxIds.has(t.id)) {
          countedTxIds.add(t.id)
          y.count++
          yt.count++
          if (t.tx_type === 'BUY') ledger.summary.buyCount++
          else ledger.summary.sellCount++
        }
      }

      // Pair day trades FIFO
      for (const s of candidateSells) {
        const sEntry = remSellMap.get(s.id)!
        if (sEntry.remQty <= 0) continue

        for (const b of candidateBuys) {
          const bEntry = remBuyMap.get(b.id)!
          if (bEntry.remQty <= 0) continue
          if (sEntry.remQty <= 0) break

          const matchedQty = Math.min(sEntry.remQty, bEntry.remQty)
          sEntry.remQty -= matchedQty
          bEntry.remQty -= matchedQty

          countTx(b)
          countTx(s)

          const buyRatio = matchedQty / b.qty
          const buyGross = b.price * matchedQty
          const buyFee = b.fee_tax * buyRatio
          const buyTotalCost = buyGross + buyFee

          const sellRatio = matchedQty / s.qty
          const sellGross = s.price * matchedQty
          const sellFeeTax = s.fee_tax * sellRatio
          const estTax = splitFeeTax(s).tax * sellRatio
          const sellRevenue = sellGross - sellFeeTax

          const costBasis = buyTotalCost
          const rawCostBasis = buyGross
          const realized = sellRevenue - costBasis
          const avgCost = costBasis / matchedQty

          y.buyAmt += buyTotalCost
          y.buyGross += buyGross
          y.sellAmt += sellRevenue
          y.sellGross += sellGross
          y.costBasis += costBasis
          y.rawCostBasis += rawCostBasis
          y.fees += buyFee + sellFeeTax
          y.feesTax += estTax

          yt.buyAmt += buyTotalCost
          yt.buyGross += buyGross
          yt.sellAmt += sellRevenue
          yt.sellGross += sellGross
          yt.costBasis += costBasis
          yt.rawCostBasis += rawCostBasis
          yt.realized += realized
          yt.fees += buyFee + sellFeeTax
          yt.feesTax += estTax

          pos.buyCostTotal += buyTotalCost
          pos.realized += realized

          ledger.summary.feesTax += estTax
          ledger.summary.feesBrokerage += (buyFee + sellFeeTax - estTax)

          if (currency === 'TWD') y.realizedTw += realized
          else y.realizedUs += realized

          yt.sells.push({
            txId: s.id,
            date: s.tx_date,
            qty: matchedQty,
            price: s.price,
            sellAmt: sellRevenue,
            sellGross,
            costBasis,
            rawCostBasis,
            realized,
            fees: sellFeeTax,
            feesTax: estTax,
            avgCost,
            oversold: false,
          })
        }
      }

      // Process remaining un-matched or regular spot transactions in their original chronological order
      for (const tx of groupTxs) {
        let effQty = tx.qty
        let effFeeTax = tx.fee_tax

        if (tx.tx_type === 'BUY' && remBuyMap.has(tx.id)) {
          effQty = remBuyMap.get(tx.id)!.remQty
          effFeeTax = tx.qty > 0 ? tx.fee_tax * (effQty / tx.qty) : 0
        } else if (tx.tx_type === 'SELL' && remSellMap.has(tx.id)) {
          effQty = remSellMap.get(tx.id)!.remQty
          effFeeTax = tx.qty > 0 ? tx.fee_tax * (effQty / tx.qty) : 0
        }

        if (effQty <= 0) continue

        countTx(tx)
        y.fees += effFeeTax
        yt.fees += effFeeTax

        const { tax: estTax, borrow: estBorrow } = splitFeeTax({ ...tx, qty: effQty, fee_tax: effFeeTax })
        ledger.summary.feesTax += estTax
        ledger.summary.feesBorrow += estBorrow
        ledger.summary.feesBrokerage += effFeeTax - estTax - estBorrow
        y.feesTax += estTax
        yt.feesTax += estTax

        if (tx.tx_nature === 'SHORT' && tx.tx_type === 'SELL') {
          // Open a short position: proceeds and gross are tracked separately from the long
          // side, and never touch y.sellAmt / y.sellGross / y.costBasis — nothing realized yet.
          const gross = tx.price * effQty
          const proceeds = gross - effFeeTax
          pos.shortQty += effQty
          pos.shortProceeds += proceeds
          pos.shortRawProceeds += gross
          pos.shortLots.push({
            txId: tx.id,
            date: tx.tx_date,
            qty: effQty,
            price: tx.price,
            proceeds,
            rawProceeds: gross,
          })
        } else if (tx.tx_nature === 'SHORT' && tx.tx_type === 'BUY') {
          // Cover a short position (FIFO against shortLots). Never touches y.buyAmt/buyGross —
          // this is the cost basis of the realization, not an acquisition.
          const gross = tx.price * effQty
          const coverTotal = gross + effFeeTax
          const matchedQty = Math.min(effQty, pos.shortQty)
          const ratio = effQty > 0 ? matchedQty / effQty : 0
          const coverCost = coverTotal * ratio

          let remaining = matchedQty
          let proceedsBasis = 0
          let rawProceedsBasis = 0
          while (remaining > 0 && pos.shortLots.length > 0) {
            const lot = pos.shortLots[0]
            if (lot.qty <= remaining) {
              proceedsBasis += lot.proceeds
              rawProceedsBasis += lot.rawProceeds
              remaining -= lot.qty
              pos.shortLots.shift()
            } else {
              const lotRatio = remaining / lot.qty
              const consumedProceeds = lot.proceeds * lotRatio
              const consumedRaw = lot.rawProceeds * lotRatio
              proceedsBasis += consumedProceeds
              rawProceedsBasis += consumedRaw
              lot.proceeds -= consumedProceeds
              lot.rawProceeds -= consumedRaw
              lot.qty -= remaining
              remaining = 0
            }
          }

          const realized = proceedsBasis - coverCost
          const rawCoverGross = gross * ratio

          pos.shortQty -= matchedQty
          pos.shortProceeds -= proceedsBasis
          pos.shortRawProceeds -= rawProceedsBasis
          pos.realized += realized

          y.sellAmt += proceedsBasis
          y.sellGross += rawProceedsBasis
          y.costBasis += coverCost
          y.rawCostBasis += rawCoverGross
          yt.sellAmt += proceedsBasis
          yt.sellGross += rawProceedsBasis
          yt.costBasis += coverCost
          yt.rawCostBasis += rawCoverGross
          yt.realized += realized

          if (currency === 'TWD') y.realizedTw += realized
          else y.realizedUs += realized

          yt.sells.push({
            txId: tx.id,
            date: tx.tx_date,
            qty: matchedQty,
            price: tx.price,
            sellAmt: proceedsBasis,
            sellGross: rawProceedsBasis,
            costBasis: coverCost,
            rawCostBasis: rawCoverGross,
            realized,
            fees: effFeeTax * ratio,
            feesTax: 0,
            avgCost: matchedQty > 0 ? coverCost / matchedQty : 0,
            oversold: false,
          })

          // Explicit zeroing (BUG-039 rule): proportional subtraction leaves float residue
          // that would pollute the next short open.
          if (pos.shortQty === 0) {
            pos.shortProceeds = 0
            pos.shortRawProceeds = 0
            pos.shortLots = []
          }

          // Over-cover: the excess shares open a long lot, the same path a BUY already takes.
          if (effQty > matchedQty) {
            const excessQty = effQty - matchedQty
            const excessRatio = excessQty / effQty
            const excessFeeTax = effFeeTax * excessRatio
            const excessGross = tx.price * excessQty
            const excessTotalCost = excessGross + excessFeeTax
            y.buyAmt += excessTotalCost
            y.buyGross += excessGross
            yt.buyAmt += excessTotalCost
            yt.buyGross += excessGross
            pos.cost += excessTotalCost
            pos.rawCost += excessGross
            pos.qty += excessQty
            pos.buyCostTotal += excessTotalCost
            pos.openLots.push({
              txId: tx.id,
              date: tx.tx_date,
              qty: excessQty,
              price: tx.price,
              cost: excessTotalCost,
              rawCost: excessGross,
              feeRate: inferTxFeeRate(tx),
            })
            ledger.warnings.push(
              `${tx.tx_date} ${tx.ticker} 回補 ${effQty} 股，但當時空單僅 ${matchedQty} 股（超出部分視為現股買進）`,
            )
          }
        } else if (tx.tx_type === 'BUY') {
          const gross = tx.price * effQty
          const totalCost = gross + effFeeTax // 手續費計入成本
          y.buyAmt += totalCost
          y.buyGross += gross
          yt.buyAmt += totalCost
          yt.buyGross += gross
          pos.cost += totalCost
          pos.rawCost += gross
          pos.qty += effQty
          pos.buyCostTotal += totalCost
          pos.openLots.push({
            txId: tx.id,
            date: tx.tx_date,
            qty: effQty,
            price: tx.price,
            cost: totalCost,
            rawCost: gross,
            feeRate: inferTxFeeRate(tx),
          })
        } else {
          const gross = tx.price * effQty
          const revenue = gross - effFeeTax
          y.sellAmt += revenue
          y.sellGross += gross
          yt.sellAmt += revenue
          yt.sellGross += gross

          const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 0
          const avgRawCost = pos.qty > 0 ? pos.rawCost / pos.qty : 0
          const matchedQty = Math.min(effQty, pos.qty)
          if (matchedQty < effQty) {
            ledger.warnings.push(
              `${tx.tx_date} ${tx.ticker} 賣出 ${effQty} 股，但當時持有僅 ${pos.qty} 股（超賣部分成本以 0 計算）`,
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

          // Consume open lots FIFO for the matched quantity.
          let remaining = matchedQty
          while (remaining > 0 && pos.openLots.length > 0) {
            const lot = pos.openLots[0]
            if (lot.qty <= remaining) {
              remaining -= lot.qty
              pos.openLots.shift()
            } else {
              const ratio = remaining / lot.qty
              lot.cost -= lot.cost * ratio
              lot.rawCost -= lot.rawCost * ratio
              lot.qty -= remaining
              remaining = 0
            }
          }

          // Moving-average subtraction leaves a tiny float residue (~1e-11) that would
          // permanently pollute the average cost on the next buy; zero it out explicitly.
          if (pos.qty === 0) {
            pos.cost = 0
            pos.rawCost = 0
            pos.openLots = []
          }

          yt.sells.push({
            txId: tx.id,
            date: tx.tx_date,
            qty: effQty,
            price: tx.price,
            sellAmt: revenue,
            sellGross: gross,
            costBasis,
            rawCostBasis,
            realized,
            fees: effFeeTax,
            feesTax: estTax,
            avgCost,
            oversold: matchedQty < effQty,
          })

          if (currency === 'TWD') y.realizedTw += realized
          else y.realizedUs += realized
        }
      }
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
    .filter((pos) => pos.qty > 0 || pos.shortQty > 0)
    // Copy the lots: the spread is shallow, and a Holding sharing this array would let a
    // consumer mutate ledger.positions through it. Every other field is a scalar.
    .map((pos) => ({
      ...pos,
      openLots: pos.openLots.map((l) => ({ ...l })),
      shortLots: pos.shortLots.map((l) => ({ ...l })),
      avgCost: pos.qty > 0 ? pos.cost / pos.qty : 0,
      rawAvgCost: pos.qty > 0 ? pos.rawCost / pos.qty : 0,
    }))
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
    // A hand-built Holding may not carry openLots; fall back to treating it as one lot.
    const lots = Array.isArray(holding.openLots) && holding.openLots.length > 0
      ? holding.openLots
      : [{ qty: holding.qty, feeRate }]
    let fee = 0
    let tax = 0
    for (const lot of lots) {
      const lotVal = price * lot.qty
      const effectiveFeeRate = lot.feeRate !== undefined && lot.feeRate !== null ? lot.feeRate : feeRate
      fee += floorSafe(lotVal * effectiveFeeRate)
      tax += floorSafe(lotVal * sellTaxRate(holding.ticker))
    }
    if (feeRate > 0 && minFee !== undefined && minFee > fee) fee = minFee
    return Math.round(mktVal - holding.qty * holding.avgCost - fee - tax)
  }
  return mktVal - holding.qty * holding.avgCost
}

/**
 * Unrealized P&L of an open short leg at `price`. A cover pays a brokerage fee and no tax,
 * so this is proceeds − (price*shortQty + coverFee). Falling price raises the result.
 */
export function estimateUnrealizedShort(
  holding: Holding,
  price: number,
  feeRate: number,
  minFee?: number,
): number {
  const shortQty = holding.shortQty
  if (!(shortQty > 0)) return 0
  const shortProceeds = holding.shortProceeds
  const coverVal = price * shortQty
  let fee = floorSafe(coverVal * feeRate)
  if (feeRate > 0 && minFee !== undefined && minFee > fee) fee = minFee
  if (holding.currency === 'TWD') {
    return Math.round(shortProceeds - coverVal - fee)
  }
  return shortProceeds - coverVal
}
