/**
 * Technical page: volume line chart + volume table (0.6.50).
 * Daily candlesticks, moving averages and KD were removed from the UI; data still
 * comes from `daily/{ticker}.json` (OHLCV) so volume / 量比 keep working.
 *
 * The data is scheduled after-hours into the public reports bucket; the front end
 * downloads it directly (see services/dailyProxy.ts). warm-core fills gaps for
 * newly searched tickers (services/warmStock.ts).
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, LineChart, RefreshCw } from 'lucide-react'
import { fmtSignedPercent, pnlClass } from '../../utils/formatters'
import type { DailySeries } from '../../services/dailyProxy'
import type { DailyStatus } from './useDailySeries'
import { MultiLineChart } from '../Charts/MultiLineChart'
import { ChartLegend } from '../Charts/ChartLegend'
import { CATEGORICAL_COLORS } from '../Charts/chartColors'
import { fmtUpdatedAt } from './chipFormat'
import {
  buildTechnicalView,
  RANGE_LABELS,
  type RangeKey,
} from './technicalView'

const RANGES: RangeKey[] = ['3m', '6m', '1y']

/**
 * How many rows the volume table shows before "顯示全部".
 * Cap keeps the card shorter than listing a full year of days at once.
 */
const VOLUME_ROWS_COLLAPSED = 20

/** Volume worth a second look: 1.5x the 20-day average or more */
function heavy(ratio: number | null): boolean {
  return ratio !== null && ratio >= 1.5
}

const VOL_COLOR = CATEGORICAL_COLORS[0]

/** Price: Most Taiwanese stocks are within two decimal places, with meaningless trailing zeros removed.*/
function fmtPrice(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Trading volume is presented in "ticks" (1 tick = 1,000 shares), which is consistent with the Taiwan stock market reading software.*/
function fmtLots(shares: number): string {
  return `${Math.round(shares / 1000).toLocaleString('en-US')} 張`
}

export function TechnicalTab({
  ticker,
  status,
  series,
}: {
  ticker: string
  status: DailyStatus
  series: DailySeries | null
}) {
  const [range, setRange] = useState<RangeKey>('3m')
  const [showAllVolume, setShowAllVolume] = useState(false)

  const view = useMemo(
    () => (series ? buildTechnicalView(series.rows, range) : null),
    [series, range],
  )

  if (status === 'loading') {
    return (
      <section className="rpt-section">
        <div className="empty-state" style={{ padding: 32 }}>
          <RefreshCw size={28} className="spin" />
          <div style={{ marginTop: 10 }}>正在讀取歷史股價…</div>
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="rpt-section">
        <div className="notice notice-warn" role="alert">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          讀取歷史股價失敗，請稍後再試。
        </div>
      </section>
    )
  }

  if (status === 'empty' || !view) {
    return (
      <section className="rpt-section">
        <h3>技術面</h3>
        <div className="empty-state">
          <div className="empty-icon">
            <LineChart size={32} />
          </div>
          <div>這檔還沒有歷史股價。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            歷史股價由每個交易日傍晚的排程自動抓取，最近一次買進的股票要等下一次排程跑完才會出現。
          </div>
        </div>
      </section>
    )
  }

  const { latest } = view
  const volumeRows = showAllVolume ? view.volumeRows : view.volumeRows.slice(0, VOLUME_ROWS_COLLAPSED)

  return (
    <section className="rpt-section">
      <div className="rpt-section-head">
        <h3>
          成交量
          <span className="source-tag">
            資料日 {latest.date} · 更新於 {fmtUpdatedAt(series?.asOf)}
          </span>
        </h3>
        <div className="chip-toggle" role="group" aria-label="選擇顯示區間">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? 'chip-btn active' : 'chip-btn'}
              onClick={() => setRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-with-legend">
        <MultiLineChart
          labels={view.labels}
          series={[{ name: '成交量', color: VOL_COLOR, values: view.volumes }]}
          labelIndices={view.labelIndices}
          height={140}
          formatValue={(v) => fmtLots(v)}
          ariaLabel={`${ticker} 每日成交量折線`}
        />
        <div className="chart-legend-side">
          <ChartLegend items={[{ label: '成交量', color: VOL_COLOR, note: '股數' }]} />
          <div className="chart-legend-foot">單位：張（1 張 = 1,000 股）</div>
        </div>
      </div>

      <div className="rpt-section-head" style={{ marginTop: 14 }}>
        <div className="chart-title">
          每日成交量・{RANGE_LABELS[range]}（{view.volumeRows.length} 個交易日）
        </div>
        {view.volumeRows.length > VOLUME_ROWS_COLLAPSED && (
          <button className="btn btn-sm" onClick={() => setShowAllVolume((v) => !v)}>
            {showAllVolume ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            {showAllVolume
              ? `只顯示近 ${VOLUME_ROWS_COLLAPSED} 日`
              : `顯示全部 ${view.volumeRows.length} 日`}
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th className="num">成交量</th>
              <th className="num">量比</th>
              <th className="num">收盤</th>
              <th className="num">漲跌</th>
            </tr>
          </thead>
          <tbody>
            {volumeRows.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className="num">{fmtLots(r.volume)}</td>
                <td className="num" style={heavy(r.volRatio) ? { fontWeight: 700 } : undefined}>
                  {r.volRatio === null ? '—' : `${fmtNum(r.volRatio, 2)} 倍`}
                </td>
                <td className="num">{fmtPrice(r.close)}</td>
                <td className={`num ${pnlClass(r.changePct)}`}>
                  {r.changePct === null ? '—' : fmtSignedPercent(r.changePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        量比是當日成交量相對前 20 個交易日平均量的倍數，1 倍代表與均量相當。
        成交量與資料日來自盤後日線批次，與上方「行情」卡的即時報價是不同來源，數字可能略有差異。
      </p>
    </section>
  )
}
