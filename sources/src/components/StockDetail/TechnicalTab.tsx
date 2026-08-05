/**
 * Technical page: daily K + moving average, trading volume, KD, and indicator summary for the latest day.
 *
 * The data comes from daily/{ticker}.json (see services/dailyProxy.ts), which is scheduled for after-hours production and stored in the public reports bucket.
 * The front-end downloads directly without going through Edge Function. A warm call is made when there is no check (the newly added stocks have not been covered by the night batch),
 * For throttling rules, see services/warmStock.ts - the same codename will only be tried once per session.
 *
 * **Tried to use IntersectionObserver to defer to "until loading", and then removed it after measuring** (0.6.8):
 * When the four paragraphs are combined into one page, the chips and fundamentals are still loaded at the moment of mounting, and each has only one spinner.
 * The entire page is less than 500px high - the technical page is already in the window, and the observer immediately determines that it is visible and loads it anyway.
 * To make it really delayed, you have to reserve a false height of one or two thousand pixels in the upper two sections. That's just guessing.
 * What is actually saved is only one Storage request of about 17KB (warmStock’s session quota)
 * It has long been used by the fundamental path), and it is not worth changing to a mechanism that "claims to be delayed, but is actually loaded every time".
 *
 * Comparison of Taiwan stock terminology (called "daily/weekly/quarterly lines" in PLAN.md §L):
 * Weekly line = MA5, monthly line = MA20, quarterly line = MA60. The two terms of UI are stated side by side, so that people who only recognize one of them will not understand.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, LineChart, RefreshCw } from 'lucide-react'
import { fetchDailySeries, type DailySeries } from '../../services/dailyProxy'
import { warmStock } from '../../services/warmStock'
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

/** Category colors of moving averages: one each for short, medium and long, assigned in sequence without looping*/
const MA_COLORS = {
  ma5: CATEGORICAL_COLORS[0],
  ma20: CATEGORICAL_COLORS[1],
  ma60: CATEGORICAL_COLORS[2],
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

function pnlClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return 'pnl-flat'
  return v > 0 ? 'pnl-up' : 'pnl-down'
}

export function TechnicalTab({ ticker, reloadKey = 0 }: { ticker: string; reloadKey?: number }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [series, setSeries] = useState<DailySeries | null>(null)
  const [range, setRange] = useState<RangeKey>('3m')
  useEffect(() => {
    let alive = true
    setStatus('loading')
    setSeries(null)
    ;(async () => {
      try {
        let s = await fetchDailySeries(ticker)
        if (!s) {
          const warmed = await warmStock(ticker)
          if (warmed.dailySynced > 0) s = await fetchDailySeries(ticker)
        }
        if (!alive) return
        setSeries(s)
        setStatus(s ? 'ready' : 'empty')
      } catch {
        if (alive) setStatus('error')
      }
    })()
    return () => {
      alive = false
    }
    // reloadKey: Force re-fetching when the user clicks "Refresh" (neither this layer nor dailyProxy has cache, re-run will be the latest)
  }, [ticker, reloadKey])

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

  return (
    <>
      <section className="rpt-section">
        <div className="rpt-section-head">
          <h3>
            日 K 與均線
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
            ]}
            labelIndices={view.labelIndices}
            formatValue={fmtPrice}
            ariaLabel={`${ticker} 日 K 線與 5 / 20 / 60 日均線`}
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
              ]}
            />
            <div className="chart-legend-foot">紅漲綠跌，以當日收盤與開盤相比</div>
          </div>
        </div>
        <p className="hint">
          用的是原始收盤價，沒有還原除權息，與券商 App 看到的均線一致；除權息當天會有跳空。
        </p>
      </section>

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

      <section className="rpt-section">
        <h3>指標摘要（{latest.date}）</h3>
        {/* 不用 data-table：那個表最小寬 720px，為了 8 個數值強迫手機橫向捲動不划算 */}
        <dl className="tech-summary">
          <div className="tech-cell">
            <dt>收盤</dt>
            <dd>
              {fmtPrice(latest.close)}
              <span className={`tech-sub ${pnlClass(latest.change)}`}>
                {latest.change === null
                  ? '—'
                  : `${latest.change > 0 ? '+' : ''}${fmtNum(latest.change)}`}
                {latest.changePct !== null &&
                  `（${latest.changePct > 0 ? '+' : ''}${(latest.changePct * 100).toFixed(2)}%）`}
              </span>
            </dd>
          </div>
          <div className="tech-cell">
            <dt>開 / 高 / 低</dt>
            <dd>
              {fmtPrice(latest.open)}／{fmtPrice(latest.high)}／{fmtPrice(latest.low)}
            </dd>
          </div>
          <div className="tech-cell">
            <dt>成交量</dt>
            <dd>
              {fmtLots(latest.volume)}
              {latest.volRatio !== null && (
                <span className="tech-sub">20 日均量的 {fmtNum(latest.volRatio, 2)} 倍</span>
              )}
            </dd>
          </div>
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
        </dl>
      </section>
    </>
  )
}
