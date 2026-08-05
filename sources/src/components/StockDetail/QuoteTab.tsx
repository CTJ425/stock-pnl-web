/**
 * Quotation card: Today's opening high and low volume, yesterday's closing and today's closing (0.6.36, replacing the original "My Holdings" card).
 *
 * All seven boxes come from the same current price response (TWSE MIS’s o/h/l/v/y/z/ip), no additional requests are made——
 * This is also the reason why the TWSE OpenAPI daily closing endpoint is not used: it still stops at the previous trading day two hours after the actual closing.
 * Taking it as "today's closing" will regard yesterday's closing as today's closing (actual measured difference on 2026-08-05 is 3.6%).
 *
 * This card is public market data and does not contain personal information, so it is included in the PDF extraction range;
 * The shareholding card it replaced was originally outside the scope precisely because it was a capital.
 */
import { Inbox } from 'lucide-react'
import { isClosed, tradeDateLabel, type PriceQuote } from '../../services/priceProxy'
import { fmtPrice, pnlClass } from '../../utils/formatters'
import { fmtInt } from './chipFormat'

/** The status on the right side of the card title: when was the quotation and whether it was cached*/
export function quoteMeta(quote: PriceQuote | null): string {
  if (!quote) return '尚未取得'
  const day = tradeDateLabel(quote.tradeDate)
  const state = quote.trial ? '試撮中' : isClosed(quote) ? '已收盤' : '盤中'
  const parts = [day, state, quote.tradeTime].filter((s): s is string => !!s)
  return quote.stale ? `${parts.join(' · ')} · 快取` : parts.join(' · ')
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rpt-card">
      <div className="k">{label}</div>
      <div className={className ? `v ${className}` : 'v'}>{value}</div>
    </div>
  )
}

export function QuoteTab({ quote }: { quote: PriceQuote | null }) {
  if (!quote) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Inbox size={32} />
        </div>
        <div>目前抓不到這檔股票的報價。</div>
      </div>
    )
  }

  const closed = isClosed(quote)
  // It will not be colored (flat color) when there are missing items in yesterday's collection. The principle is the same as the current price column in the inventory overview: do not use the current price as a benchmark.
  const dayChange = quote.prevClose === null ? null : quote.price - quote.prevClose

  return (
    <section className="rpt-section">
      <h3>今日行情</h3>
      <div className="rpt-cards">
        <Cell label="開盤" value={fmtPrice(quote.open, 'TWD')} />
        <Cell label="最高" value={fmtPrice(quote.high, 'TWD')} />
        <Cell label="成交量" value={quote.volume === null ? '—' : `${fmtInt(quote.volume)} 張`} />
        <Cell label="昨收" value={fmtPrice(quote.prevClose, 'TWD')} />
        <Cell label="最低" value={fmtPrice(quote.low, 'TWD')} />
        {/* 試撮只在 08:30–09:00 與 13:25–13:30 進行，其餘時間沒有預估價可言 */}
        <Cell label="預估" value={quote.trial ? fmtPrice(quote.price, 'TWD') : '—'} />
        {/* 盤中還沒有「今收」，此時這格是最新成交價，改名以免誤讀 */}
        <Cell
          label={closed ? '今收' : '成交'}
          value={fmtPrice(quote.price, 'TWD')}
          className={pnlClass(dayChange)}
        />
      </div>
      <p className="hint">
        {closed
          ? '今天已經收盤，這是收盤的價格，到明天開盤前都不會再變。'
          : '盤中價格每分鐘更新一次。「預估」只有開盤前（8:30–9:00）和收盤前（13:25–13:30）試撮時才有。'}
      </p>
    </section>
  )
}
