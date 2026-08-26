/**
 * 當日大盤 (0.9.19): intraday TAIEX panel above the existing 台股 KPI grid. The KPI grid below
 * still describes the latest *complete* trading day (market/daily.json, ~90min after close);
 * this panel is the current session, fetched straight from Yahoo chart v8 via fetchIntraday.
 *
 * Day open/high/low come from `IntradaySeries.dayOpen/dayHigh/dayLow` — measured against the
 * real `^TWII` response, the close series alone is off by tens of points (see intradayParse.ts).
 */
import { useEffect, useState } from 'react'
import { IntradayChart } from '../StockDetail/IntradayChart'
import { fetchIntraday } from '../../services/intradayProxy'
import { pnlClass } from '../../utils/formatters'
import type { IntradayRange, IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'

function fmt2(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

export function TwIndexToday() {
  const [range, setRange] = useState<IntradayRange>('1d')
  const [series, setSeries] = useState<IntradaySeries | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchIntraday({ market: 'IDX', ticker: '^TWII' }, range).then((s) => {
      if (cancelled) return
      setSeries(s)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [range])

  const points = series?.points ?? []
  const last = points.length > 0 ? points[points.length - 1].c : null
  const prevClose = series?.prevClose ?? null
  const change = last !== null && prevClose !== null ? last - prevClose : null
  const changePct =
    change !== null && prevClose !== null && prevClose !== 0 ? (change / prevClose) * 100 : null

  return (
    <div className="section glass panel tw-index-today" data-testid="tw-index-today">
      <div className="m-card-h">
        <div className="m-chart-title-group">
          <h3>加權指數</h3>
          <span className="badge">當日</span>
        </div>
      </div>

      {series === null ? (
        <div className="intraday-empty" data-testid="tw-index-empty">
          當日大盤資料暫不可用
        </div>
      ) : (
        <>
          <div className="m-price">
            <span className={`big ${pnlClass(change)}`} data-testid="tw-index-value">
              {last === null ? '—' : fmt2(last)}
            </span>
            <span className={`delta ${pnlClass(change)}`}>
              {change === null
                ? '—'
                : `${change >= 0 ? '▲' : '▼'} ${fmt2(Math.abs(change))}${
                    changePct === null ? '' : `　${signed(changePct, '%')}`
                  }`}
            </span>
          </div>

          <div className="m-range tw-index-range" role="group" aria-label="區間">
            <button type="button" aria-pressed={range === '1d'} onClick={() => setRange('1d')}>
              1日
            </button>
            <button type="button" aria-pressed={range === '5d'} onClick={() => setRange('5d')}>
              5日
            </button>
          </div>

          <IntradayChart
            series={series}
            loading={loading}
            range={range}
            onRangeChange={setRange}
            showVolume={false}
          />

          <div className="m-stats tw-index-stats">
            <Cell label="開盤" value={rawCell(series?.dayOpen ?? null)} testId="tw-index-open" />
            <Cell label="最高" value={rawCell(series?.dayHigh ?? null)} testId="tw-index-high" />
            <Cell label="最低" value={rawCell(series?.dayLow ?? null)} testId="tw-index-low" />
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
        </>
      )}
    </div>
  )
}
