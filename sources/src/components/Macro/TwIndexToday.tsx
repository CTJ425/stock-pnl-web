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
import { useEffect, useState } from 'react'
import { IntradayChart } from '../StockDetail/IntradayChart'
import { fetchIntraday } from '../../services/intradayProxy'
import { fmtBillion, fmtBillionSigned, pnlClass, toBillion } from '../../utils/formatters'
import { chipClass } from '../StockDetail/chipFormat'
import type { IntradayRange, IntradaySeries } from '../../../supabase/functions/stock-price/intradayParse'

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

export function TwIndexToday({ closeStats }: { closeStats: TwIndexCloseStats | null }) {
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

      {series === null && (
        <div className="intraday-empty" data-testid="tw-index-empty">
          當日大盤資料暫不可用
        </div>
      )}

      {series !== null && (
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
      )}

      {/*
        The band renders even when the intraday fetch failed (series === null, above): row 1 then
        shows '—' for every cell (rawCell/change already fall back to it), and row 2 —closeStats,
        the latest *complete* trading day— is a wholly separate data source that has no reason to
        disappear just because today's session failed to load.
      */}
      <div className="tw-index-band" data-testid="tw-index-band">
        <div className="tw-index-band-row">
          <span className="tw-index-band-caption">當日</span>
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

      {series !== null && (
        <IntradayChart
          series={series}
          loading={loading}
          range={range}
          onRangeChange={setRange}
          showVolume={false}
        />
      )}
    </div>
  )
}
