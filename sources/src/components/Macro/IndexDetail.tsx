/**
 * Index detail view (task 164): 当日 band + 7-range trend chart for foreign/TW indices.
 * Negative requirements: no 三大法人, no 收盤統計, no volume figure or volume sub-chart, no 近 1 月.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { IntradayChart, type TrendSeries } from '../StockDetail/IntradayChart'
import { fetchIntraday } from '../../services/intradayProxy'
import { fetchRemoteDaily } from '../../services/dailyProxy'
import { seriesFromDailyRows, type TrendRange } from '../StockDetail/trendRange'
import { INDEX_TREND_RANGES, indexTrendSource } from './indexTrend'
import {
  marketSession,
  SESSION_HOURS,
  type MarketRegion,
  type SessionState,
} from './sessionHours'
import { pnlClass } from '../../utils/formatters'
import type { IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'

const SESSION_LABELS: Record<SessionState, string> = {
  open: '盤中',
  break: '午休',
  closed: '已收盤',
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })

function fmtIndexNum(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function signed(v: number, suffix = ''): string {
  return `${v >= 0 ? '+' : ''}${fmtIndexNum(v)}${suffix}`
}

function rawCell(v: number | null): string {
  return v === null ? '—' : fmtIndexNum(v)
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

export function IndexDetail({
  def,
  onBack,
}: {
  def: { region: MarketRegion; label: string; ticker: string }
  onBack: () => void
}) {
  const [range, setRange] = useState<TrendRange>('1d')
  const [todaySeries, setTodaySeries] = useState<IntradaySeries | null>(null)
  const [chartSeries, setChartSeries] = useState<TrendSeries | null>(null)
  const [loading, setLoading] = useState(true)
  const reqId = useRef(0)
  const prevTicker = useRef(def.ticker)
  const todaySeriesRef = useRef<IntradaySeries | null>(null)
  todaySeriesRef.current = todaySeries

  useEffect(() => {
    if (prevTicker.current !== def.ticker) {
      prevTicker.current = def.ticker
      setTodaySeries(null)
      todaySeriesRef.current = null
      setChartSeries(null)
      setRange('1d')
    }
  }, [def.ticker])

  const load = useCallback(
    (force = false) => {
      const id = ++reqId.current
      setLoading(true)
      const source = indexTrendSource(range)
      if (source.kind === 'intraday') {
        if (source.range !== '1d' && (force || todaySeriesRef.current === null)) {
          const tReq = force
            ? fetchIntraday({ market: 'IDX', ticker: def.ticker }, '1d', { force })
            : fetchIntraday({ market: 'IDX', ticker: def.ticker }, '1d')
          tReq
            .then((s) => {
              if (reqId.current !== id) return
              setTodaySeries(s)
            })
            .catch(() => {})
        }
        const req = force
          ? fetchIntraday({ market: 'IDX', ticker: def.ticker }, source.range, { force })
          : fetchIntraday({ market: 'IDX', ticker: def.ticker }, source.range)
        req
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
          const req = force
            ? fetchIntraday({ market: 'IDX', ticker: def.ticker }, '1d', { force })
            : fetchIntraday({ market: 'IDX', ticker: def.ticker }, '1d')
          req
            .then((s) => {
              if (reqId.current !== id) return
              setTodaySeries(s)
            })
            .catch(() => {})
        }
        fetchRemoteDaily(def.ticker, source.remoteRange, 'IDX')
          .then((remote) => {
            if (reqId.current !== id) return
            if (!remote) {
              setChartSeries(null)
              setLoading(false)
              return
            }
            setChartSeries(seriesFromDailyRows(def.ticker, remote.rows, range))
            setLoading(false)
          })
          .catch(() => {
            if (reqId.current !== id) return
            setChartSeries(null)
            setLoading(false)
          })
      }
    },
    [def.ticker, range],
  )

  useEffect(() => {
    load()
  }, [load])

  const points = todaySeries?.points ?? []
  const last = points.length > 0 ? points[points.length - 1].c : null
  const prevClose = todaySeries?.prevClose ?? null
  const change = last !== null && prevClose !== null ? last - prevClose : null
  const changePct =
    change !== null && prevClose !== null && prevClose !== 0 ? (change / prevClose) * 100 : null
  const sessionDate =
    todaySeries?.points && todaySeries.points.length > 0
      ? dayFmt.format(new Date(todaySeries.points[todaySeries.points.length - 1].t * 1000))
      : null

  const hours = SESSION_HOURS[def.region]
  const session = marketSession(def.region, new Date())

  return (
    <div
      className="section glass index-detail"
      data-testid="index-detail"
      style={{ padding: '18px 20px' }}
    >
      <div className="m-card-h">
        <div className="m-chart-title-group" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="index-back"
            onClick={onBack}
            aria-label="返回"
          >
            <ArrowLeft size={14} /> 返回
          </button>
          <h3 style={{ margin: 0 }}>{def.label}</h3>
          <span className="badge">{sessionDate === null ? '當日' : `${sessionDate} 當日`}</span>
          <span className="badge">{SESSION_LABELS[session]}</span>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => load(true)}
          disabled={loading}
          aria-label={`重新整理${def.label}`}
        >
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      {todaySeries === null && !loading && (
        <div className="intraday-empty" data-testid="index-empty">
          當日指數資料暫不可用
        </div>
      )}

      {todaySeries !== null && (
        <div className="m-price">
          <span className={`big ${pnlClass(change)}`} data-testid="index-value">
            {last === null ? '—' : fmtIndexNum(last)}
          </span>
          <span className={`delta ${pnlClass(change)}`}>
            {change === null
              ? '—'
              : `${change >= 0 ? '▲' : '▼'} ${fmtIndexNum(Math.abs(change))}${
                  changePct === null ? '' : `　${signed(changePct, '%')}`
                }`}
          </span>
        </div>
      )}

      <div className="index-session-hours" data-testid="index-session-hours">
        本地時間：{hours.local}
        {hours.breakLocal ? `（午休 ${hours.breakLocal}）` : ''}
        　台北時間：{hours.taipei}
      </div>

      <div className="tw-index-band">
        <div className="tw-index-band-row">
          <span className="tw-index-band-caption">當日</span>
          <div className="m-stats tw-index-stats">
            <Cell label="開盤" value={rawCell(todaySeries?.dayOpen ?? null)} testId="index-open" />
            <Cell label="最高" value={rawCell(todaySeries?.dayHigh ?? null)} testId="index-high" />
            <Cell label="最低" value={rawCell(todaySeries?.dayLow ?? null)} testId="index-low" />
            <Cell label="昨收" value={rawCell(prevClose)} testId="index-prev-close" />
            <Cell
              label="漲跌點數"
              value={change === null ? '—' : signed(change)}
              testId="index-change"
              className={change === null ? undefined : pnlClass(change)}
            />
            <Cell
              label="漲跌幅"
              value={changePct === null ? '—' : signed(changePct, '%')}
              testId="index-change-pct"
              className={changePct === null ? undefined : pnlClass(changePct)}
            />
          </div>
        </div>
      </div>

      <div className="tw-index-chart-layout">
        <div className="tw-index-chart-main">
          <IntradayChart
            series={chartSeries}
            loading={loading}
            range={range}
            onRangeChange={setRange}
            ranges={INDEX_TREND_RANGES}
            rangeTestId="index-range-buttons"
            showVolume={false}
            tradeDate={sessionDate}
          />
        </div>
      </div>
    </div>
  )
}
