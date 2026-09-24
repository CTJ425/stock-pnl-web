import { isClosed, tradeDateLabel, type PriceQuote } from '../../services/priceProxy'
import type { Market } from '../../types/models'

/** The status on the right side of the card title: when was the quotation and whether it was cached*/
export function quoteMeta(quote: PriceQuote | null, market?: Market): string {
  if (!quote) return '尚未取得'
  const day = tradeDateLabel(quote.tradeDate)
  const state = quote.trial ? '試撮中' : isClosed(quote, market) ? '已收盤' : '盤中'
  const parts = [day, state, quote.tradeTime].filter((s): s is string => !!s)
  return quote.stale ? `${parts.join(' · ')} · 快取` : parts.join(' · ')
}
