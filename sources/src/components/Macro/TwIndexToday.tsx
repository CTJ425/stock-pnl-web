/**
 * 當日大盤 (0.9.19; layout reworked 0.9.20): intraday TAIEX panel above the existing 台股 charts.
 * The panel itself is the current session, fetched straight from Yahoo chart v8 via
 * fetchIntraday. `closeStats` folds in the three cards that used to sit in a KPI grid below the
 * panel — they describe the latest *complete* trading day (market/daily.json, ~90min after
 * close), not the current session, so they get their own caption and their own date.
 *
 * Day open/high/low come from `IntradaySeries.dayOpen/dayHigh/dayLow` — measured against the
 * real `^TWII` response, the close series alone is off by tens of points (see intradayParse.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { IntradayChart, type TrendSeries } from '../StockDetail/IntradayChart'
import { fetchIntraday } from '../../services/intradayProxy'
import { fetchRemoteDaily } from '../../services/dailyProxy'
import { fetchIndexQuotes, type IndexQuote } from '../../services/indexQuotes'
import { fmtBillion, fmtBillionSigned, pnlClass, toBillion } from '../../utils/formatters'
import { chipClass } from '../StockDetail/chipFormat'
import { seriesFromDailyRows, type TrendRange } from '../StockDetail/trendRange'
import { INDEX_TREND_RANGES, indexTrendSource } from './indexTrend'
import type { IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'

export interface TwIndexFallbackQuote {
  price?: number | null
  last?: number | null
  prevClose?: number | null
  open?: number | null
  high?: number | null
  low?: number | null
  change?: number | null
  changePct?: number | null
  asOf?: string | null
}

/** Latest *complete* trading day's turnover and institutional net-buy, as TwMarketSection derives
 *  it from market/daily.json. `date` and `instDate` can differ — institutional money is backfilled
 *  around 15:00, so the turnover figure can be today's close while the institutional one is
 *  yesterday's. */
export interface TwIndexCloseStats {
  date: string
  tradeValueTwd: number | null
  instDate: string | null
  instTotalTwd: number | null
  instForeignTwd: number | null
  instTrustTwd: number | null
}

export interface TwMarketInstDay {
  date: string
  totalTwd: number | null
  foreignTwd: number | null
  trustTwd: number | null
  dealerTwd: number | null
}

function fmt2(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })

function shortDate(date: string): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}/${m[2]}` : date
}

/** Raw stat cell: '—' for a value the day has not produced yet, never a guessed 0. */
function rawCell(v: number | null): string {
  return v === null ? '—' : fmt2(v)
}

function signed(v: number, suffix = ''): string {
  return `${v >= 0 ? '+' : ''}${fmt2(v)}${suffix}`
}

function Cell({
  label,
  value,
  testId,
  className,
}: {
  label: string
  value: string
  testId: string
  className?: string
}) {
  return (
    <div className="rpt-card">
      <div className="k">{label}</div>
      <div className={className ? `v ${className}` : 'v'} data-testid={testId}>
        {value}
      </div>
    </div>
  )
}

export function TwIndexToday({
  closeStats,
  recentInstDays,
  quote,
  fallbackQuote,
  onRefresh,
  onBack,
}: {
  closeStats: TwIndexCloseStats | null
  recentInstDays?: TwMarketInstDay[] | null
  quote?: TwIndexFallbackQuote | IndexQuote | null
  fallbackQuote?: TwIndexFallbackQuote | IndexQuote | null
  onRefresh?: () => void
  onBack?: () => void
}) {
  const [range, setRange] = useState<TrendRange>('1d')
  const [todaySeries, setTodaySeries] = useState<IntradaySeries | null>(null)
  const [chartSeries, setChartSeries] = useState<TrendSeries | null>(null)
  const [fetchedQuote, setFetchedQuote] = useState<IndexQuote | null>(null)
  const [loading, setLoading] = useState(true)
  const reqId = useRef(0)
  const todaySeriesRef = useRef<IntradaySeries | null>(null)
  todaySeriesRef.current = todaySeries

  const load = useCallback(
    (force = false) => {
      const id = ++reqId.current
      setLoading(true)
      fetchIndexQuotes(['^TWII'])
        .then((quotes) => {
          if (reqId.current !== id) return
          const q = quotes['^TWII'] ?? null
          if (q) setFetchedQuote(q)
        })
        .catch(() => {})

      const source = indexTrendSource(range)
      if (source.kind === 'intraday') {
        if (source.range !== '1d' && (force || todaySeriesRef.current === null)) {
          fetchIntraday({ market: 'IDX', ticker: '^TWII' }, '1d', { force })
            .then((s) => {
              if (reqId.current !== id) return
              setTodaySeries(s)
            })
            .catch(() => {})
        }
        fetchIntraday({ market: 'IDX', ticker: '^TWII' }, source.range, { force })
          .then((s) => {
            if (reqId.current !== id) return
            if (source.range === '1d') {
              setTodaySeries(s)
            }
            setChartSeries(s)
            setLoading(false)
          })
          .catch(() => {
            if (reqId.current !== id) return
            setChartSeries(null)
            setLoading(false)
          })
      } else {
        if (force || todaySeriesRef.current === null) {
          fetchIntraday({ market: 'IDX', ticker: '^TWII' }, '1d', { force })
            .then((s) => {
              if (reqId.current !== id) return
              setTodaySeries(s)
            })
            .catch(() => {})
        }
        fetchRemoteDaily('^TWII', source.remoteRange, 'IDX')
          .then((remote) => {
            if (reqId.current !== id) return
            if (!remote) {
              setChartSeries(null)
              setLoading(false)
              return
            }
            setChartSeries(seriesFromDailyRows('^TWII', remote.rows, range))
            setLoading(false)
          })
          .catch(() => {
            if (reqId.current !== id) return
            setChartSeries(null)
            setLoading(false)
          })
      }
    },
    [range],
  )

  useEffect(() => {
    load()
  }, [load])

  const propQuote = quote ?? fallbackQuote ?? null
  const activeQuote = propQuote ?? fetchedQuote

  const points = todaySeries?.points ?? []
  const hasSeries = points.length > 0
  const last = hasSeries
    ? points[points.length - 1].c
    : (activeQuote?.price ?? (activeQuote as TwIndexFallbackQuote)?.last ?? null)
  const prevClose = todaySeries?.prevClose ?? activeQuote?.prevClose ?? null
  const change =
    last !== null && prevClose !== null
      ? last - prevClose
      : ((activeQuote as TwIndexFallbackQuote)?.change ?? null)
  const changePct =
    change !== null && prevClose !== null && prevClose !== 0
      ? (change / prevClose) * 100
      : ((activeQuote as TwIndexFallbackQuote)?.changePct ?? null)

  const dayOpen = todaySeries?.dayOpen ?? (activeQuote as TwIndexFallbackQuote)?.open ?? null
  const dayHigh = todaySeries?.dayHigh ?? (activeQuote as TwIndexFallbackQuote)?.high ?? null
  const dayLow = todaySeries?.dayLow ?? (activeQuote as TwIndexFallbackQuote)?.low ?? null

  const sessionDate =
    todaySeries?.points && todaySeries.points.length > 0
      ? dayFmt.format(new Date(todaySeries.points[todaySeries.points.length - 1].t * 1000))
      : activeQuote?.asOf && !Number.isNaN(Date.parse(activeQuote.asOf))
        ? dayFmt.format(new Date(activeQuote.asOf))
        : null
  const hasAside = Boolean(recentInstDays && recentInstDays.length > 0)

  return (
    <div className="section glass tw-index-today" data-testid="tw-index-today">
      <div className="m-card-h">
        <div
          className="m-chart-title-group"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
        >
          {onBack && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="index-back"
              onClick={onBack}
              aria-label="返回"
            >
              <ArrowLeft size={14} /> 返回
            </button>
          )}
          <h3 style={{ margin: 0 }}>加權指數</h3>
          <span className="badge">{sessionDate === null ? '當日' : `${sessionDate} 當日`}</span>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            load(true)
            onRefresh?.()
          }}
          disabled={loading}
          aria-label="重新整理加權指數"
        >
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      {last === null && (
        <div className="intraday-empty" data-testid="tw-index-empty">
          當日大盤資料暫不可用
        </div>
      )}

      {last !== null && (
        <div className="m-price">
          <span className={`big ${pnlClass(change)}`} data-testid="tw-index-value">
            {fmt2(last)}
          </span>
          <span className={`delta ${pnlClass(change)}`}>
            {change === null
              ? '—'
              : `${change >= 0 ? '▲' : '▼'} ${fmt2(Math.abs(change))}${
                  changePct === null ? '' : `　${signed(changePct, '%')}`
                }`}
          </span>
        </div>
      )}

      {/*
        The band renders even when the intraday fetch failed (todaySeries === null, above): row 1 then
        shows '—' for every cell (rawCell/change already fall back to it), and row 2 —closeStats,
        the latest *complete* trading day— is a wholly separate data source that has no reason to
        disappear just because today's session failed to load.
      */}
      <div className="tw-index-band" data-testid="tw-index-band">
        <div className="tw-index-band-row">
          <span className="tw-index-band-caption">當日</span>
          <div className="m-stats tw-index-stats">
            <Cell label="開盤" value={rawCell(dayOpen)} testId="tw-index-open" />
            <Cell label="最高" value={rawCell(dayHigh)} testId="tw-index-high" />
            <Cell label="最低" value={rawCell(dayLow)} testId="tw-index-low" />
            <Cell
              label="昨收"
              value={rawCell(prevClose)}
              testId="tw-index-prev-close"
            />
            <Cell
              label="漲跌點數"
              value={change === null ? '—' : signed(change)}
              testId="tw-index-change"
              className={change === null ? undefined : pnlClass(change)}
            />
            <Cell
              label="漲跌幅"
              value={changePct === null ? '—' : signed(changePct, '%')}
              testId="tw-index-change-pct"
              className={changePct === null ? undefined : pnlClass(changePct)}
            />
          </div>
        </div>

        {closeStats && (
          <div className="tw-index-band-row">
            <span className="tw-index-band-caption">收盤統計</span>
            <div className="m-stats tw-index-stats tw-index-close-stats">
              <div className="kpi">
                <div className="kpi-label">成交金額</div>
                <div className="kpi-value">{fmtBillion(toBillion(closeStats.tradeValueTwd))}</div>
                {/*
                  The date is the point of this row. These three numbers describe the latest
                  *complete* trading day, and during a session that is not the day the chart
                  above is drawing — market/daily.json only lands about 90 minutes after the
                  close. Naming the day is what keeps the two timeframes apart.
                */}
                <div className="kpi-sub">{`${closeStats.date}（最近交易日）`}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">三大法人買賣超</div>
                <div className={`kpi-value ${chipClass(closeStats.instTotalTwd)}`}>
                  {fmtBillionSigned(toBillion(closeStats.instTotalTwd))}
                </div>
                <div className="kpi-sub">
                  {closeStats.instDate === null
                    ? '尚未補到法人金額'
                    : `${closeStats.instDate} 全市場合計`}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">其中外資</div>
                <div className={`kpi-value ${chipClass(closeStats.instForeignTwd)}`}>
                  {fmtBillionSigned(toBillion(closeStats.instForeignTwd))}
                </div>
                {/*
                  The date is repeated here, not left to the cell next door, because
                  `.tw-index-stats` drops to two columns under 560px (index.css) — 其中外資 then
                  wraps onto its own line, away from the 三大法人買賣超 cell that carries it.
                  Only shown when it actually disambiguates: when the institutional print is
                  from the same day as the close, the row caption already said so.
                */}
                <div className="kpi-sub">
                  {closeStats.instDate !== null && closeStats.instDate !== closeStats.date
                    ? `${closeStats.instDate}・投信 ${fmtBillionSigned(toBillion(closeStats.instTrustTwd))}`
                    : `投信 ${fmtBillionSigned(toBillion(closeStats.instTrustTwd))}`}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={`tw-index-chart-layout${hasAside ? ' has-aside' : ''}`}>
        <div className="tw-index-chart-main">
          <IntradayChart
            series={chartSeries}
            loading={loading}
            range={range}
            onRangeChange={setRange}
            ranges={INDEX_TREND_RANGES}
            showVolume={false}
            tradeDate={sessionDate}
          />
        </div>

        {recentInstDays && recentInstDays.length > 0 && (
          <aside className="tw-index-inst-aside">
            <div className="institutional-block" style={{ marginTop: 0 }}>
              <div className="inst-header">
                <div className="inst-header-left">
                  <span className="inst-header-title">三大法人買賣超動向</span>
                  <span className="inst-header-badge">近 2 交易日</span>
                </div>
                <span className="inst-header-note">單位：億元</span>
              </div>
              <div className="inst-days-grid tw-index-inst-days">
                {recentInstDays.map((d, idx) => {
                  const isLatest = idx === 0
                  const tagLabel = isLatest ? '最新' : '前日'

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
                        <span className={`inst-total-val ${pnlClass(d.totalTwd)}`}>
                          {fmtBillionSigned(toBillion(d.totalTwd))}
                        </span>
                      </div>

                      <div className="inst-legs-grid">
                        <div className="inst-leg-cell">
                          <div className="inst-leg-k">外資</div>
                          <div className={`inst-leg-v ${pnlClass(d.foreignTwd)}`}>
                            {fmtBillionSigned(toBillion(d.foreignTwd))}
                          </div>
                        </div>
                        <div className="inst-leg-cell">
                          <div className="inst-leg-k">投信</div>
                          <div className={`inst-leg-v ${pnlClass(d.trustTwd)}`}>
                            {fmtBillionSigned(toBillion(d.trustTwd))}
                          </div>
                        </div>
                        <div className="inst-leg-cell">
                          <div className="inst-leg-k">自營商</div>
                          <div className={`inst-leg-v ${pnlClass(d.dealerTwd)}`}>
                            {fmtBillionSigned(toBillion(d.dealerTwd))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
