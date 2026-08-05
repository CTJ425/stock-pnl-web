/**
 * Market card ("行情"): today's quote plus the indicator summary of the latest completed trading day.
 *
 * 0.6.38 merged the technical page's "指標摘要" into here, because the two answered the same question in
 * two places. What was dropped in the merge are the summary's 收盤 / 開高低 / 成交量 cells: the quote grid
 * above already shows them, live. What is kept are the things the quote cannot give — moving averages, KD,
 * RSI, MACD and the volume ratio.
 *
 * ⚠️ **The two halves can be different days and that is not a bug**: the quote is MIS in real time, the
 * summary comes from the after-hours daily batch (`daily/{ticker}.json`), which only lands in the evening.
 * During the session the summary still describes the previous trading day —— hence its own date in the
 * heading. Do not "tidy" that date away.
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
import type { TechnicalView } from './technicalView'

type TechnicalLatest = TechnicalView['latest']

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

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

/** The half that survives the merge: only what the live quote cannot say (see the file header). */
function IndicatorSummary({ latest }: { latest: TechnicalLatest }) {
  return (
    <section className="rpt-section">
      <h3>指標摘要（{latest.date}）</h3>
      {/* Not data-table: that one has a 720px min width, which forces phones to scroll sideways for five values */}
      <dl className="tech-summary">
        <div className="tech-cell">
          <dt>均線</dt>
          <dd>
            {fmtNum(latest.ma5)}／{fmtNum(latest.ma20)}／{fmtNum(latest.ma60)}
            <span className="tech-sub">
              MA5 / MA20 / MA60{latest.alignment ? ` · ${latest.alignment}` : ''}
            </span>
          </dd>
        </div>
        <div className="tech-cell">
          <dt>KD</dt>
          <dd>
            {fmtNum(latest.k, 1)}／{fmtNum(latest.d, 1)}
            <span className="tech-sub">K / D</span>
          </dd>
        </div>
        <div className="tech-cell">
          <dt>RSI(14)</dt>
          <dd>{fmtNum(latest.rsi14, 1)}</dd>
        </div>
        <div className="tech-cell">
          <dt>MACD 柱</dt>
          <dd className={pnlClass(latest.macdHist)}>{fmtNum(latest.macdHist)}</dd>
        </div>
        <div className="tech-cell">
          <dt>量比</dt>
          <dd>
            {latest.volRatio === null ? '—' : `${fmtNum(latest.volRatio, 2)} 倍`}
            <span className="tech-sub">對 20 日均量</span>
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function QuoteTab({
  quote,
  latest = null,
}: {
  quote: PriceQuote | null
  latest?: TechnicalLatest | null
}) {
  if (!quote) {
    return (
      <>
        <div className="empty-state">
          <div className="empty-icon">
            <Inbox size={32} />
          </div>
          <div>目前抓不到這檔股票的報價。</div>
        </div>
        {/* The indicators come from a different source, so a missing quote must not take them down with it */}
        {latest && <IndicatorSummary latest={latest} />}
      </>
    )
  }

  const closed = isClosed(quote)
  // It will not be colored (flat color) when there are missing items in yesterday's collection. The principle is the same as the current price column in the inventory overview: do not use the current price as a benchmark.
  const dayChange = quote.prevClose === null ? null : quote.price - quote.prevClose

  return (
    <>
      {/* No heading of its own since 0.6.38: the card is already called 行情, and two titles read as two cards */}
      <section className="rpt-section">
        <div className="rpt-cards">
          <Cell label="開盤" value={fmtPrice(quote.open, 'TWD')} />
          <Cell label="最高" value={fmtPrice(quote.high, 'TWD')} />
          <Cell label="成交量" value={quote.volume === null ? '—' : `${fmtInt(quote.volume)} 張`} />
          <Cell label="昨收" value={fmtPrice(quote.prevClose, 'TWD')} />
          <Cell label="最低" value={fmtPrice(quote.low, 'TWD')} />
          {/* Trial matching only runs 08:30–09:00 and 13:25–13:30; there is no estimate outside those windows */}
          <Cell label="預估" value={quote.trial ? fmtPrice(quote.price, 'TWD') : '—'} />
          {/* Mid-session there is no "今收" yet, so this cell is the last trade — renamed to avoid a misread */}
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
      {latest && <IndicatorSummary latest={latest} />}
    </>
  )
}
