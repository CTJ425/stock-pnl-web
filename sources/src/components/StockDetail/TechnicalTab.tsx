/**
 * Technical page: daily K + MA + Bollinger (20,2), volume, KD.
 * Indicator summary lives on the 行情 card (QuoteTab).
 *
 * Data: daily/{ticker}.json (after-hours batch / warm). Front-end downloads Storage
 * directly. Terminology: weekly line = MA5, monthly = MA20, quarterly = MA60.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, LineChart, RefreshCw } from 'lucide-react'
import { fmtSignedPercent, pnlClass } from '../../utils/formatters'
import type { DailySeries } from '../../services/dailyProxy'
import type { DailyStatus } from './useDailySeries'
import { CandleChart } from '../Charts/CandleChart'
import { MultiLineChart } from '../Charts/MultiLineChart'
import { BarSeriesChart } from '../Charts/BarSeriesChart'
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
 *
 * The alternative —— always listing the whole range —— means 244 rows on 近 1 年, which makes this one card taller
 * than the three charts above it put together. A capped scrolling box is **not** the way out: 0.2.x had one
 * (480px, sticky header) and it was deliberately removed so tables expand in full.
 */
const VOLUME_ROWS_COLLAPSED = 20

/** Volume worth a second look: 1.5x the 20-day average or more */
function heavy(ratio: number | null): boolean {
  return ratio !== null && ratio >= 1.5
}

/** Category colors of moving averages: one each for short, medium and long, assigned in sequence without looping*/
const MA_COLORS = {
  ma5: CATEGORICAL_COLORS[0],
  ma20: CATEGORICAL_COLORS[1],
  ma60: CATEGORICAL_COLORS[2],
} as const

/** Bollinger: mid aligns with MA20 orange; upper/lower use slate (literal for PDF) */
const BB_COLORS = {
  mid: CATEGORICAL_COLORS[1],
  upper: '#94a3b8',
  lower: '#64748b',
} as const

const KD_COLORS = { k: CATEGORICAL_COLORS[0], d: CATEGORICAL_COLORS[3] } as const

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
    <>
      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>
            日 K · 均線 · 布林通道
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
          <CandleChart
            candles={view.candles}
            overlays={[
              { name: 'MA5', color: MA_COLORS.ma5, values: view.ma5 },
              { name: 'MA20', color: MA_COLORS.ma20, values: view.ma20 },
              { name: 'MA60', color: MA_COLORS.ma60, values: view.ma60 },
              { name: 'BB上', color: BB_COLORS.upper, values: view.bbUpper },
              { name: 'BB中', color: BB_COLORS.mid, values: view.bbMid },
              { name: 'BB下', color: BB_COLORS.lower, values: view.bbLower },
            ]}
            labelIndices={view.labelIndices}
            formatValue={fmtPrice}
            ariaLabel={`${ticker} 日 K、均線與布林通道`}
            tooltipExtra={(i) => {
              const v = view.volumes[i]
              return v === undefined ? null : `量 ${fmtLots(v)}`
            }}
          />
          <div className="chart-legend-side">
            <ChartLegend
              items={[
                { label: 'MA5', color: MA_COLORS.ma5, note: '週線' },
                { label: 'MA20', color: MA_COLORS.ma20, note: '月線' },
                { label: 'MA60', color: MA_COLORS.ma60, note: '季線' },
                { label: 'BB上', color: BB_COLORS.upper, note: '中軌+2σ' },
                { label: 'BB中', color: BB_COLORS.mid, note: 'SMA20' },
                { label: 'BB下', color: BB_COLORS.lower, note: '中軌−2σ' },
              ]}
            />
            <div className="chart-legend-foot">紅漲綠跌；布林為 20 日、±2 標準差</div>
          </div>
        </div>
        <p className="hint">
          用的是原始收盤價，沒有還原除權息，與券商 App 看到的均線一致；除權息當天會有跳空。
          布林中軌即 20 日均線，與 MA20 重疊屬正常。
        </p>
      </section>

      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>KD 指標</h3>
        </div>
        <div className="chart-with-legend">
          <MultiLineChart
            labels={view.labels}
            series={[
              { name: 'K', color: KD_COLORS.k, values: view.k },
              { name: 'D', color: KD_COLORS.d, values: view.d },
            ]}
            labelIndices={view.labelIndices}
            domain={{ min: 0, max: 100 }}
            guides={[20, 80]}
            formatValue={(v) => fmtNum(v, 1)}
            ariaLabel={`${ticker} KD 指標`}
          />
          <div className="chart-legend-side">
            <ChartLegend
              items={[
                { label: 'K', color: KD_COLORS.k },
                { label: 'D', color: KD_COLORS.d },
              ]}
            />
            <div className="chart-legend-foot">虛線為 20 / 80</div>
          </div>
        </div>
        <p className="hint">
          KD 常用來看短期的買賣力道：低於 20 代表跌得比較兇，高於 80 代表漲得比較兇。
          它只是參考，不代表接下來一定會反轉。
        </p>
      </section>

      {/*
        Volume sits after KD since 0.6.38 (the two swapped places), and the table follows its own chart directly:
        the chart answers "was today heavy or light", the table answers "how heavy, exactly, and against what".
      */}
      <section className="rpt-section">
        <h3>成交量</h3>
        <BarSeriesChart
          labels={view.labels}
          series={[{ name: '成交量', color: CATEGORICAL_COLORS[0], values: view.volumes }]}
          labelIndices={view.labelIndices}
          height={120}
          formatValue={(v) => fmtLots(v)}
          ariaLabel={`${ticker} 每日成交量`}
        />

        <div className="rpt-section-head" style={{ marginTop: 14 }}>
          <div className="chart-title">
            每日成交量・{RANGE_LABELS[range]}（{view.volumeRows.length} 個交易日）
          </div>
          {view.volumeRows.length > VOLUME_ROWS_COLLAPSED && (
            <button className="btn btn-sm" onClick={() => setShowAllVolume((v) => !v)}>
              {showAllVolume ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              {showAllVolume ? `只顯示近 ${VOLUME_ROWS_COLLAPSED} 日` : `顯示全部 ${view.volumeRows.length} 日`}
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
                  {/*
                    The ratio is what the table gives that the bar chart cannot: the chart shows relative height,
                    this says "today is N times the 20-day average". Bold from 1.5x —— that is the level worth a look.
                  */}
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
    </>
  )
}
