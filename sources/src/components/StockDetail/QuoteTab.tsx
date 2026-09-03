/**
 * Market card ("行情"): Yahoo-style quote header + statistics grid, the intraday chart, and the
 * indicator summary of the latest completed trading day.
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
 *
 * 0.9.17 (revision 4) added an optional 我的持股 block to the right-hand `.quote-aside`, which reverses that
 * "public data only" premise for one block — so it carries its own class, `quote-aside-private`, and
 * `.report-surface .quote-aside-private { display: none }` (index.css) hides it for the duration of the PDF
 * capture. The rest of this card, including the moved-in 指標摘要, is unaffected and still exports as before.
 */
import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { isClosed, tradeDateLabel, type PriceQuote } from '../../services/priceProxy'
import { fetchIntraday } from '../../services/intradayProxy'
import { fmtPercent, fmtPrice, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'
import { fmtInt, fmtLotsFromShares, shortDate } from './chipFormat'
import { IntradayChart, finalVwap } from './IntradayChart'
import { getStockCategory } from '../../utils/stockCategory'
import type { TechnicalView } from './technicalView'
import type { IntradayRange, IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'
import type { ChipDay, ReportHolding } from '../../services/reportProxy'

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
          <dt>布林</dt>
          <dd>
            {fmtNum(latest.bbLower)}／{fmtNum(latest.bbMid)}／{fmtNum(latest.bbUpper)}
            <span className="tech-sub">下／中／上（20, 2）</span>
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

/** Delta magnitude: plain 2-decimal, no currency prefix — the big price above it already carries NT$. */
function fmtDelta(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function QuoteTab({
  quote,
  latest = null,
  ticker,
  name,
  holding = null,
  history = null,
}: {
  quote: PriceQuote | null
  latest?: TechnicalLatest | null
  ticker: string
  name: string
  holding?: ReportHolding | null
  history?: ChipDay[] | null
}) {
  const [range, setRange] = useState<IntradayRange>('1d')
  const [series, setSeries] = useState<IntradaySeries | null>(null)
  const [intradayLoading, setIntradayLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIntradayLoading(true)
    fetchIntraday({ market: 'TPE', ticker }, range).then((s) => {
      if (cancelled) return
      setSeries(s)
      setIntradayLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [ticker, range])

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
  const dayChangePct = quote.prevClose === null || quote.prevClose === 0 ? null : dayChange! / quote.prevClose
  const amplitude =
    quote.high === null || quote.low === null || quote.prevClose === null || quote.prevClose === 0
      ? null
      : (quote.high - quote.low) / quote.prevClose

  // Same number the chart's 均價 line ends at — computed once in IntradayChart.tsx and reused here.
  const vwap = finalVwap(series?.points ?? [])

  // Same three states, same order of precedence as `quoteMeta` above — the card head one level up
  // renders that one for this very quote, and two different words for one number reads as a bug.
  const stamp = [
    tradeDateLabel(quote.tradeDate),
    quote.trial ? '試撮中' : closed ? '收盤' : '盤中',
    quote.tradeTime,
  ]
    .filter((s): s is string => !!s)
    .join(' · ')

  // Both derived from the quote already on screen, so they cannot disagree with it (see the file header
  // on why 損益/報酬率 below are the opposite: taken verbatim, never recomputed).
  const marketValue = holding ? holding.qty * quote.price : null
  const netMktVal =
    holding && holding.unrealized !== null
      ? holding.qty * holding.avgCost + holding.unrealized
      : null
  const todayPnl =
    holding && quote.prevClose !== null ? holding.qty * (quote.price - quote.prevClose) : null

  const recentDays = (history ?? [])
    .filter((d) => d.institutional !== null && d.institutional !== undefined)
    .slice(-2)
    .reverse()

  const category = getStockCategory(ticker, name, quote.industry)

  return (
    <>
      <div className="quote-top-banner">
        <div className="m-quote-head m-sym">
          <h2>{name}</h2>
          <span className="code">{ticker}</span>
          {category && <span className="watchlist-card-badge quote-badge">{category}</span>}
        </div>
        <div className="m-price">
          <span className={`big ${pnlClass(dayChange)}`}>{fmtPrice(quote.price, 'TWD')}</span>
          {quote.trial && <span className="trial-marker">預估</span>}
          <span className={`delta ${pnlClass(dayChange)}`}>
            {dayChange === null
              ? '—'
              : `${dayChange >= 0 ? '▲' : '▼'} ${fmtDelta(Math.abs(dayChange))}${
                  dayChangePct === null ? '' : `　${fmtSignedPercent(dayChangePct)}`
                }`}
          </span>
          {stamp && <span className="stamp">{stamp}</span>}
        </div>
      </div>

      <div className="quote-layout">
        <div className="quote-main">
          <div className="m-stats">
            <Cell label="成交量" value={quote.volume === null ? '—' : `${fmtInt(quote.volume)} 張`} />
            <Cell label="開盤" value={fmtPrice(quote.open, 'TWD')} />
            <Cell label="最高" value={fmtPrice(quote.high, 'TWD')} />
            <Cell label="最低" value={fmtPrice(quote.low, 'TWD')} />
            <Cell label="昨收" value={fmtPrice(quote.prevClose, 'TWD')} />
            <Cell label="均價" value={fmtPrice(vwap, 'TWD')} />
            <Cell label="漲跌幅" value={fmtSignedPercent(dayChangePct)} className={pnlClass(dayChange)} />
            <Cell label="振幅" value={fmtPercent(amplitude)} />
          </div>
          <p className="hint">
            {closed
              ? '今天已經收盤，這是收盤的價格，到明天開盤前都不會再變。'
              : '盤中價格每分鐘更新一次。「預估」只有開盤前（8:30–9:00）和收盤前（13:25–13:30）試撮時才有。'}
          </p>

          <IntradayChart
            series={series}
            loading={intradayLoading}
            range={range}
            onRangeChange={setRange}
            tradeDate={quote.tradeDate}
          />

          {recentDays.length > 0 && (
            <div className="institutional-block">
              <div className="inst-header">
                <div className="inst-header-left">
                  <span className="inst-header-title">三大法人買賣超動向</span>
                  <span className="inst-header-badge">近 2 交易日</span>
                </div>
                <span className="inst-header-note">單位：張（每日約 15:30 公布）</span>
              </div>
              <div className="inst-days-grid">
                {recentDays.map((d, idx) => {
                  const isLatest = idx === 0
                  const tagLabel = isLatest ? '最新' : '前日'
                  const inst = d.institutional
                  const totalNet = inst?.total?.net
                  const foreignNet = inst?.foreign?.net
                  const trustNet = inst?.trust?.net
                  const dealerNet = inst?.dealer?.net

                  return (
                    <div key={d.date} className="inst-day-card">
                      <div className="inst-day-head">
                        <span className="inst-day-title">{shortDate(d.date)}</span>
                        <span className={`inst-day-tag ${isLatest ? 'is-latest' : ''}`}>
                          {tagLabel}
                        </span>
                      </div>

                      <div className="inst-day-total">
                        <span className="inst-total-label">三大法人合計</span>
                        <span className={`inst-total-val ${pnlClass(totalNet)}`}>
                          {fmtLotsFromShares(totalNet)} 張
                        </span>
                      </div>

                      <div className="inst-legs-grid">
                        <div className="inst-leg-cell">
                          <div className="inst-leg-k">外資</div>
                          <div className={`inst-leg-v ${pnlClass(foreignNet)}`}>
                            {fmtLotsFromShares(foreignNet)}
                          </div>
                        </div>
                        <div className="inst-leg-cell">
                          <div className="inst-leg-k">投信</div>
                          <div className={`inst-leg-v ${pnlClass(trustNet)}`}>
                            {fmtLotsFromShares(trustNet)}
                          </div>
                        </div>
                        <div className="inst-leg-cell">
                          <div className="inst-leg-k">自營商</div>
                          <div className={`inst-leg-v ${pnlClass(dealerNet)}`}>
                            {fmtLotsFromShares(dealerNet)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="quote-aside">
          {holding && (
            <div className="quote-aside-private">
              <h4>我的持股概況</h4>
              <div className="holding-pnl">
                <span className={`holding-pnl-big ${pnlClass(holding.unrealized)}`}>
                  {fmtSignedMoney(holding.unrealized, 'TWD')}
                  {holding.brokerUnrealized !== undefined &&
                    holding.brokerUnrealized !== null &&
                    holding.brokerUnrealized !== holding.unrealized && (
                      <span
                        style={{ fontSize: 13, opacity: 0.75, fontWeight: 500, marginLeft: 6 }}
                        title="依券商牌告未折讓費率（0.1425%）預扣之損益，對齊券商 APP 月退制口徑"
                      >
                        (券商 {fmtSignedMoney(holding.brokerUnrealized, 'TWD')})
                      </span>
                    )}
                </span>
                <span className={`holding-roi ${pnlClass(holding.roi)}`}>
                  {holding.roi === null ? '—' : fmtSignedPercent(holding.roi)}
                  {holding.brokerRoi !== undefined &&
                    holding.brokerRoi !== null &&
                    fmtSignedPercent(holding.brokerRoi) !== fmtSignedPercent(holding.roi) && (
                      <span
                        style={{ fontSize: 11, opacity: 0.75, fontWeight: 400, marginLeft: 6 }}
                        title="依券商牌告未折讓費率（0.1425%）預扣之報酬率，對齊券商 APP 月退制口徑"
                      >
                        (券商 {fmtSignedPercent(holding.brokerRoi)})
                      </span>
                    )}
                </span>
              </div>
              <div className="holding-grid">
                <div className="holding-cell">
                  <div className="k">持有</div>
                  <div className="v">{fmtInt(holding.qty)} 股</div>
                </div>
                <div className="holding-cell">
                  <div className="k">成本</div>
                  <div className="v">{fmtPrice(holding.avgCost, 'TWD')}</div>
                </div>
                <div className="holding-cell">
                  <div className="k">市值</div>
                  <div
                    className="v"
                    title={
                      netMktVal !== null
                        ? `若以現價全數賣出，扣除手續費與證交稅後的預估實收金額：約 NT$ ${fmtInt(netMktVal)}`
                        : undefined
                    }
                  >
                    {fmtInt(marketValue)}
                  </div>
                </div>
                <div className="holding-cell">
                  <div className="k">今日</div>
                  <div className="v">{todayPnl === null ? '—' : fmtSignedMoney(todayPnl, 'TWD')}</div>
                </div>
              </div>
            </div>
          )}

          {latest && <IndicatorSummary latest={latest} />}
        </aside>
      </div>
    </>
  )
}
