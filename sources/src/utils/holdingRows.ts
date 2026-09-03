/**
 * The "profit and loss column for each tranche" is composed of shareholding + current price.
 *
 * The reason for sharing the module: inventory overview (table) and individual stock analysis (drop-down menu + my holdings) require the same calculation——
 * Minimum handling fees for Taiwan stocks for fractional shares/whole shares, unrealized net gains and losses with withholding sales fees and taxes, and denominator standards for return rates.
 * Writing one on each side is bound to run out of time, here is a single source.
 */
import type { Holding } from './pnlEngine'
import { estimateUnrealized, estimateUnrealizedShort } from './pnlEngine'
import { breakEvenPrice, breakEvenPriceShort, DEFAULT_FEE_RATE } from './fees'
import { getMinFee } from './settings'
import { isClosed, tradeDateLabel, type PriceMap } from '../services/priceProxy'

export interface HoldingRow {
  /** Unique per row: a position with both legs emits two rows. `${holding.key}:${direction}` */
  rowKey: string
  direction: 'LONG' | 'SHORT'
  /** Shares for this row. Negative on a SHORT row, so the UI reads one field. */
  rowQty: number
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
  /**
   * Reference net market value (estimated net proceeds): mktVal − sellFee − sellTax = cost + unrealized.
   * Null if price is missing or unrealized is null.
   */
  netMktVal: number | null
  unrealized: number | null
  /** Pure price difference before any fees: market value − cost before fees, isomorphic to rawRealized annual return*/
  rawUnrealized: number | null
  /** Unrealized rate of return (unrealized ÷ current position cost); null if there is no current price*/
  roi: number | null
  /** Standard broker app ROI using official undiscounted fee rate (0.001425 for TWD), aligning with monthly rebate mode (月退制) */
  brokerRoi: number | null
  /** Capital-guaranteed selling price: Sell the entire amount at this price (minus handling fees/certificate tax) without losing money*/
  breakEven: number
}

export function buildHoldingRows(
  holdings: Holding[],
  prices: PriceMap,
  feeRate: number,
  workspaceId?: string,
): HoldingRow[] {
  return holdings.flatMap((h) => {
    const quote = prices[h.key]
    const price = quote?.price ?? null
    const prevClose = quote?.prevClose ?? null
    const priceStale = quote?.stale ?? false
    const dayChange = price !== null && prevClose !== null ? price - prevClose : null
    const tradeDay = tradeDateLabel(quote?.tradeDate)
    const closed = isClosed(quote)
    const trial = quote?.trial ?? false

    const rows: HoldingRow[] = []

    if (h.qty > 0) {
      const mktVal = price !== null ? price * h.qty : null
      // Taiwan stocks apply the minimum handling fee for whole shares/fractional shares according to the shareholding size; there is no lower limit for US stocks
      const minFee =
        h.currency === 'TWD' ? getMinFee(h.qty >= 1000 ? 'whole' : 'odd', workspaceId) : undefined
      const unrealized = price !== null ? estimateUnrealized(h, price, feeRate, minFee) : null
      const netMktVal = mktVal !== null && unrealized !== null ? h.cost + unrealized : null
      const rawUnrealized = mktVal !== null ? mktVal - h.rawCost : null
      // Current position only (same caliber as brokerage APP): The denominator is the moving average cost of existing holdings
      const roi = unrealized !== null && h.cost !== 0 ? unrealized / h.cost : null
      // Standard broker fee rate (0.001425 for TWD) to align with broker app monthly rebate pre-deduction
      const standardFeeRate = h.currency === 'TWD' ? DEFAULT_FEE_RATE : feeRate
      const standardUnrealized =
        price !== null && h.currency === 'TWD'
          ? estimateUnrealized(h, price, standardFeeRate, minFee, true)
          : null
      const brokerRoi =
        standardUnrealized !== null && h.cost !== 0 ? standardUnrealized / h.cost : null
      const breakEven = breakEvenPrice(h, feeRate, minFee)
      rows.push({
        rowKey: `${h.key}:LONG`,
        direction: 'LONG',
        rowQty: h.qty,
        holding: h,
        price,
        priceStale,
        dayChange,
        tradeDay,
        closed,
        trial,
        mktVal,
        netMktVal,
        unrealized,
        rawUnrealized,
        roi,
        brokerRoi,
        breakEven,
      })
    }

    if (h.shortQty > 0) {
      const minFee =
        h.currency === 'TWD'
          ? getMinFee(h.shortQty >= 1000 ? 'whole' : 'odd', workspaceId)
          : undefined
      const mktVal = price !== null ? price * h.shortQty : null
      const unrealized = price !== null ? estimateUnrealizedShort(h, price, feeRate, minFee) : null
      const rawUnrealized = price !== null ? h.shortRawProceeds - price * h.shortQty : null
      const roi = unrealized !== null && h.shortProceeds !== 0 ? unrealized / h.shortProceeds : null
      const standardFeeRate = h.currency === 'TWD' ? DEFAULT_FEE_RATE : feeRate
      const standardUnrealized =
        price !== null && h.currency === 'TWD'
          ? estimateUnrealizedShort(h, price, standardFeeRate, minFee)
          : null
      const brokerRoi =
        standardUnrealized !== null && h.shortProceeds !== 0
          ? standardUnrealized / h.shortProceeds
          : null
      const breakEven = breakEvenPriceShort(h, feeRate, minFee)
      rows.push({
        rowKey: `${h.key}:SHORT`,
        direction: 'SHORT',
        rowQty: -h.shortQty,
        holding: h,
        price,
        priceStale,
        dayChange,
        tradeDay,
        closed,
        trial,
        mktVal,
        netMktVal: null,
        unrealized,
        rawUnrealized,
        roi,
        brokerRoi,
        breakEven,
      })
    }

    return rows
  })
}
