/**
 * The "profit and loss column for each tranche" is composed of shareholding + current price.
 *
 * The reason for sharing the module: inventory overview (table) and individual stock analysis (drop-down menu + my holdings) require the same calculation——
 * Minimum handling fees for Taiwan stocks for fractional shares/whole shares, unrealized net gains and losses with withholding sales fees and taxes, and denominator standards for return rates.
 * Writing one on each side is bound to run out of time, here is a single source.
 */
import type { Holding } from './pnlEngine'
import { estimateUnrealized } from './pnlEngine'
import { breakEvenPrice } from './fees'
import { getMinFee } from './settings'
import { isClosed, tradeDateLabel, type PriceMap } from '../services/priceProxy'

export interface HoldingRow {
  holding: Holding
  price: number | null
  priceStale: boolean
  /**
   * The difference between the current price and yesterday's closing price (0.6.34) is used to color the current price column.
   * The quotation source is null when it closed yesterday - it shows a flat color, and does not use 0 to pretend that "it did not rise or fall today".
   */
  dayChange: number | null
  /** The trading day ('M/D') to which this quotation belongs; there is no backup path for US stocks and Taiwan stocks, it is null*/
  tradeDay: string | null
  /** Whether it is the finalized value of the day's closing price - the tooltip therefore says "closing price" instead of "current price" (0.6.36)*/
  closed: boolean
  /**
   * Is this price an indicative auction price rather than a trade? (0.6.42, AUDIT-01)
   *
   * During 08:30–09:00 and 13:25–13:30 MIS's `z` is the trial-matching estimate —— **nothing changed hands at it**.
   * The quote card has always labelled it 「試撮中」; the dashboard was computing 未實現淨損益 from the same number
   * with no marker at all, which is the asymmetry this field closes.
   */
  trial: boolean
  mktVal: number | null
  unrealized: number | null
  /** Pure price difference before any fees: market value − cost before fees, isomorphic to rawRealized annual return*/
  rawUnrealized: number | null
  /** Unrealized rate of return (unrealized ÷ current position cost); null if there is no current price*/
  roi: number | null
  /** Capital-guaranteed selling price: Sell the entire amount at this price (minus handling fees/certificate tax) without losing money*/
  breakEven: number
}

export function buildHoldingRows(
  holdings: Holding[],
  prices: PriceMap,
  feeRate: number,
  workspaceId?: string,
): HoldingRow[] {
  return holdings.map((h) => {
    const quote = prices[h.key]
    const price = quote?.price ?? null
    const mktVal = price !== null ? price * h.qty : null
    // Taiwan stocks apply the minimum handling fee for whole shares/fractional shares according to the shareholding size; there is no lower limit for US stocks
    const minFee =
      h.currency === 'TWD' ? getMinFee(h.qty >= 1000 ? 'whole' : 'odd', workspaceId) : undefined
    const unrealized = price !== null ? estimateUnrealized(h, price, feeRate, minFee) : null
    const rawUnrealized = mktVal !== null ? mktVal - h.rawCost : null
    // Current position only (same caliber as brokerage APP): The denominator is the moving average cost of existing holdings
    const roi = unrealized !== null && h.cost !== 0 ? unrealized / h.cost : null
    const breakEven = breakEvenPrice(h, feeRate, minFee)
    const prevClose = quote?.prevClose ?? null
    return {
      holding: h,
      price,
      priceStale: quote?.stale ?? false,
      dayChange: price !== null && prevClose !== null ? price - prevClose : null,
      tradeDay: tradeDateLabel(quote?.tradeDate),
      closed: isClosed(quote),
      trial: quote?.trial ?? false,
      mktVal,
      unrealized,
      rawUnrealized,
      roi,
      breakEven,
    }
  })
}
