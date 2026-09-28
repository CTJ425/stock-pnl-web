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
 * This card is public market data and does not contain personal information. The shareholding card it
 * replaced held capital data instead.
 *
 * 0.9.17 (revision 4) added an optional 我的持股 block to the right-hand `.quote-aside`, which reverses that
 * "public data only" premise for one block — so it carries its own class, `quote-aside-private`.
 */
import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { isClosed, tradeDateLabel, type PriceQuote } from '../../services/priceProxy'
import type { Market } from '../../types/models'
import { fetchIntraday } from '../../services/intradayProxy'
import { fetchRemoteDaily, type DailySeries } from '../../services/dailyProxy'
import {
  fmtPercent,
  fmtPrice,
  fmtSignedMoney,
  fmtSignedPercent,
  pnlClass,
  roundPrice,
} from '../../utils/formatters'
import { fmtInt } from './chipFormat'
import { IntradayChart, type TrendSeries } from './IntradayChart'
import { finalVwap } from './intradayStats'
import { getStockCategory } from '../../utils/stockCategory'
import type { TechnicalView } from './technicalView'
import { remoteRangeOf } from './technicalView'
import {
  TREND_RANGES,
  dailyKeyOf,
  isIntradayRange,
  seriesFromDailyRows,
  type TrendRange,
} from './trendRange'
import type { DailyStatus } from './useDailySeries'
import type { ReportHolding } from '../../services/reportProxy'
import { priceLimits } from './whatIf'

type TechnicalLatest = TechnicalView['latest']

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rpt-card">
      <dt className="k">{label}</dt>
      <dd className={className ? `v ${className}` : 'v'}>{value}</dd>
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
  dailySeries = null,
  dailyStatus = 'ready',
  market = 'TPE',
}: {
  quote: PriceQuote | null
  latest?: TechnicalLatest | null
  ticker: string
  name: string
  holding?: ReportHolding | null
  dailySeries?: DailySeries | null
  dailyStatus?: DailyStatus
  market?: Market
}) {
  const [range, setRange] = useState<TrendRange>('1d')
  const [series, setSeries] = useState<TrendSeries | null>(null)
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [intradayError, setIntradayError] = useState(false)

  const rangeKey = dailyKeyOf(range)
  /**
   * Only the local-daily branch below reads `dailyStatus`, so only that branch may put it in the
   * dependency array. Freezing it to a constant elsewhere matters in both directions:
   *
   * - Omitting it entirely is a bug. `useDailySeries` reports a failed fetch with
   *   `setStatus('error')` alone — `series` stays the same `null` — so the effect would never
   *   re-run and the skeleton would spin forever.
   * - Depending on it unconditionally is also wrong. On the default 一日 range the daily fetch
   *   still resolves in the background, and that transition would clear `series` and re-fetch,
   *   flashing the skeleton on every page load for no reason.
   */
  const localDailyStatus: DailyStatus =
    rangeKey !== null && rangeKey !== '5y' && rangeKey !== 'all' ? dailyStatus : 'ready'

  // Three cases: 盤中 (network), 已有的日線 (no network), 遠端日線 (network). `alive` guards
  // both async branches — 0.9.41 shipped exactly this bug on 技術面 when state was cleared
  // in only one branch, leaving the previous range's rows on screen under the new label.
  useEffect(() => {
    let alive = true
    setSeries(null)

    if (isIntradayRange(range)) {
      setIntradayLoading(true)
      setIntradayError(false)
      fetchIntraday({ market: 'TPE', ticker }, range)
        .then((s) => {
          if (!alive) return
          setSeries(s)
          setIntradayLoading(false)
        })
        .catch(() => {
          if (!alive) return
          setIntradayError(true)
          setIntradayLoading(false)
        })
      return () => {
        alive = false
      }
    }

    const key = rangeKey
    if (key === '5y' || key === 'all') {
      setIntradayLoading(true)
      setIntradayError(false)
      const remoteRange = remoteRangeOf(key)!
      fetchRemoteDaily(ticker, remoteRange).then((remote) => {
        if (!alive) return
        if (remote === null) {
          setIntradayError(true)
          setIntradayLoading(false)
          return
        }
        const built = seriesFromDailyRows(ticker, remote.rows, range)
        setSeries(built && { ...built, ticker: remote.ticker ?? ticker, fetchedAt: remote.fetchedAt })
        setIntradayLoading(false)
      })
      return () => {
        alive = false
      }
    }

    // key is '1m' | '6m' | 'ytd' | '1y': already-loaded daily series, no network.
    setIntradayLoading(localDailyStatus === 'loading')
    setIntradayError(localDailyStatus === 'error')
    const built = seriesFromDailyRows(ticker, dailySeries?.rows ?? [], range)
    setSeries(
      built && dailySeries ? { ...built, ticker: dailySeries.ticker, fetchedAt: dailySeries.asOf } : built,
    )
  }, [ticker, range, rangeKey, dailySeries, localDailyStatus])

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

  const closed = isClosed(quote, 'TPE')
  // It will not be colored (flat color) when there are missing items in yesterday's collection. The principle is the same as the current price column in the inventory overview: do not use the current price as a benchmark.
  const dayChange = quote.prevClose === null ? null : quote.price - quote.prevClose
  const dayChangePct = quote.prevClose === null || quote.prevClose === 0 ? null : dayChange! / quote.prevClose
  const amplitude =
    quote.high === null || quote.low === null || quote.prevClose === null || quote.prevClose === 0
      ? null
      : (quote.high - quote.low) / quote.prevClose

  // Same number the chart's 均價 line ends at — computed once in IntradayChart.tsx and reused here.
  // A cumulative VWAP over a daily range is not a meaningful number, so it only shows for 一日/五日.
  const vwap = isIntradayRange(range) ? finalVwap(series?.points ?? []) : null

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

  const category = getStockCategory(ticker, name, quote.industry)

  // DT-02: TW-only 漲停/跌停 badge, from the same ±10% 昨收 band the chart's reference lines use.
  const limits = market === 'TPE' ? priceLimits(quote.prevClose) : null
  const limitState =
    limits && roundPrice(quote.price) === limits.limitUp
      ? 'up'
      : limits && roundPrice(quote.price) === limits.limitDown
        ? 'down'
        : null

  return (
    <>
      {/*
        2026-09-27 statement redesign: the stock's letterhead (name, price, move, the day's figures) on the
        left, its price chart on the right, then 我的持股 as one ruled strip. The two-day 法人 cards that used
        to sit here are gone: the 籌碼 tab now opens with a chart of the same numbers.
      */}
      <div className="sd-head">
        <div className="sd-head-main">
          <div className="quote-top-banner">
            <div className="m-quote-head m-sym">
              <h2>{name}</h2>
              <span className="code">{ticker}</span>
              {category && <span className="quote-badge">{category}</span>}
            </div>
            <div className="m-price">
              <span className={`big ${pnlClass(dayChange)}`}>{fmtPrice(quote.price, 'TWD')}</span>
              {limitState && (
                <span className={`quote-limit-badge ${limitState === 'up' ? 'pnl-up' : 'pnl-down'}`}>
                  {limitState === 'up' ? '漲停' : '跌停'}
                </span>
              )}
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

          <dl className="m-stats">
            <Cell
              label="成交量"
              value={
                quote.volume === null
                  ? '—'
                  : market === 'US'
                    ? `${fmtInt(quote.volume * 1000)} 股`
                    : `${fmtInt(quote.volume)} 張`
              }
            />
            <Cell label="開盤" value={fmtPrice(quote.open, 'TWD')} />
            <Cell label="最高" value={fmtPrice(quote.high, 'TWD')} />
            <Cell label="最低" value={fmtPrice(quote.low, 'TWD')} />
            <Cell label="昨收" value={fmtPrice(quote.prevClose, 'TWD')} />
            <Cell label="均價" value={fmtPrice(vwap, 'TWD')} />
            <Cell label="漲跌幅" value={fmtSignedPercent(dayChangePct)} className={pnlClass(dayChange)} />
            <Cell label="振幅" value={fmtPercent(amplitude)} />
          </dl>
          <p className="hint">
            {closed
              ? '今天已經收盤，這是收盤的價格，到明天開盤前都不會再變。'
              : '盤中價格每分鐘更新一次。「預估」只有開盤前（8:30–9:00）和收盤前（13:25–13:30）試撮時才有。'}
          </p>
        </div>

        <div className="sd-head-chart">
          <IntradayChart
            series={series}
            loading={intradayLoading}
            error={intradayError}
            range={range}
            onRangeChange={setRange}
            ranges={TREND_RANGES}
            tradeDate={quote.tradeDate}
            ticker={ticker}
            market={market}
          />
        </div>
      </div>

      <div className="quote-aside sd-aside">
        {holding && (
          <div className="quote-aside-private sd-mine" aria-label="我的持股概況">
            <h4>我的持股概況</h4>
            <div className="sd-mine-grid">
              <div>
                <div className="k">持有</div>
                <div className="v">{fmtInt(holding.qty)} 股</div>
                <div className="s">均價 {fmtPrice(holding.avgCost, 'TWD')}</div>
              </div>
              <div>
                <div className="k">市值</div>
                <div
                  className="v"
                  title={
                    netMktVal !== null
                      ? `若以現價全數賣出，扣除手續費與證交稅後的預估實收金額：約 NT$ ${fmtInt(netMktVal)}`
                      : undefined
                  }
                >
                  {marketValue === null ? '—' : `NT$${fmtInt(marketValue)}`}
                </div>
                {netMktVal !== null && <div className="s">全部賣出約可拿回 NT${fmtInt(netMktVal)}</div>}
              </div>
              <div>
                <div className="k">未實現淨損益</div>
                <div className={`v holding-pnl-big ${pnlClass(holding.unrealized)}`}>
                  {fmtSignedMoney(holding.unrealized, 'TWD')}
                </div>
                <div className="s">
                  <span className={`holding-roi ${pnlClass(holding.roi)}`}>
                    {holding.roi === null ? '—' : fmtSignedPercent(holding.roi)}
                  </span>
                  {holding.brokerUnrealized !== undefined &&
                    holding.brokerUnrealized !== null &&
                    holding.brokerUnrealized !== holding.unrealized && (
                      <span title="依券商牌告未折讓費率（0.1425%）預扣之損益，對齊券商 APP 月退制口徑">
                        ・券商 {fmtSignedMoney(holding.brokerUnrealized, 'TWD')}
                        {holding.brokerRoi !== undefined &&
                          holding.brokerRoi !== null &&
                          fmtSignedPercent(holding.brokerRoi) !== fmtSignedPercent(holding.roi) &&
                          `（${fmtSignedPercent(holding.brokerRoi)}）`}
                      </span>
                    )}
                </div>
              </div>
            </div>
          </div>
        )}

        {latest && <IndicatorSummary latest={latest} />}
      </div>
    </>
  )
}
