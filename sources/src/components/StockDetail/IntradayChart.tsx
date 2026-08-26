/**
 * 當日走勢圖 (T2): two `ChartFrame` instances stacked — price above, volume below — sharing one
 * hover index so the crosshair and floating tip track together (chartFrame.tsx's hoverIndex/onHover).
 * ChartFrame fixes one plot area per instance (chartFrame.tsx:53, 114), so the volume sub-chart
 * cannot be a second region of the price frame; it is its own frame with its own Y domain.
 */
import { useId, useMemo, useState } from 'react'
import { ChartFrame } from '../Charts/chartFrame'
import type { PlotGeometry } from '../Charts/chartFrame'
import { lineSegments } from '../Charts/chartPath'
import { CHART_COLORS } from '../Charts/chartColors'
import { niceDomain, type Domain } from '../Charts/chartScale'
import type {
  IntradayPoint,
  IntradayRange,
  IntradaySeries,
} from '../../../supabase/functions/stock-price/intradayParse'

/**
 * 均價 line colour: mirrors --accent-2 (index.css) as a literal. Inline SVG here feeds
 * html2canvas → PDF, which cannot resolve CSS variables from ancestor stylesheets — the same
 * reason chartColors.ts keeps CHART_COLORS as literals instead of `var(...)`.
 */
const VWAP_COLOR = '#22d3ee'

const TZ = 'Asia/Taipei'
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })

function hourMinute(epochSeconds: number): { hour: string; label: string } {
  const parts = timeFmt.formatToParts(new Date(epochSeconds * 1000))
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return { hour, label: `${hour}:${minute}` }
}

function dayKey(epochSeconds: number): string {
  return dayFmt.format(new Date(epochSeconds * 1000))
}

function fmt2(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(change: number, base: number): string {
  const p = (change / base) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

/** Cumulative VWAP (均價): running sum(c·v) / running sum(v); null until the first traded bar. */
function vwapSeries(points: IntradayPoint[]): Array<number | null> {
  let pv = 0
  let vol = 0
  return points.map((p) => {
    pv += p.c * p.v
    vol += p.v
    return vol > 0 ? pv / vol : null
  })
}

/**
 * The 均價 the session ends at — the same number the chart's 均價 line terminates on. Shared with
 * `QuoteTab`'s statistics grid and 成交金額 cell so the VWAP is computed once, not twice.
 */
export function finalVwap(points: IntradayPoint[]): number | null {
  if (points.length === 0) return null
  const series = vwapSeries(points)
  return series[series.length - 1]
}

/**
 * Symmetric around prevClose so the dashed 昨收 line sits mid-chart (as the mockup shows).
 * Falls back to niceDomain over the closes when there is no prevClose to centre on.
 */
function priceDomain(points: IntradayPoint[], prevClose: number | null): Domain {
  if (prevClose === null) return niceDomain(points.map((p) => p.c))
  const dev = points.reduce((m, p) => Math.max(m, Math.abs(p.c - prevClose)), 0)
  if (dev === 0) return { min: prevClose - 1, max: prevClose + 1 }
  return { min: prevClose - dev * 1.18, max: prevClose + dev * 1.18 }
}

const pt = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`

/**
 * Area under the close line, closed to `baselineY` (昨收) instead of `geo.innerH`. chartPath.ts's
 * `areaSegments` always closes to the plot bottom, which would fill the whole column instead of
 * splitting the red/green fill at 昨收.
 */
function areaToBaseline(points: IntradayPoint[], geo: PlotGeometry, baselineY: number): string {
  if (points.length === 0) return ''
  const first = geo.bandCenter(0)
  const last = geo.bandCenter(points.length - 1)
  const mid = points.map((p, i) => pt([geo.bandCenter(i), geo.y(p.c)]))
  return [pt([first, baselineY]), ...mid, pt([last, baselineY])].join(' ')
}

export interface IntradayChartProps {
  series: IntradaySeries | null
  loading: boolean
  range: IntradayRange
  onRangeChange: (range: IntradayRange) => void
  tradeDate?: string | null
  /** Render the volume sub-chart. Default true. */
  showVolume?: boolean
}

export function IntradayChart({
  series,
  loading,
  range,
  onRangeChange,
  tradeDate = null,
  showVolume = true,
}: IntradayChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId().replace(/:/g, '')

  const points = series?.points ?? []
  const prevClose = series?.prevClose ?? null
  const vwap = useMemo(() => vwapSeries(points), [points])
  const domain = useMemo(() => priceDomain(points, prevClose), [points, prevClose])
  const volumeDomain = useMemo(
    () => niceDomain(points.map((p) => p.v / 1000), { includeZero: true }),
    [points],
  )

  const labels = useMemo(() => points.map((p) => hourMinute(p.t).label), [points])
  const labelIndices = useMemo(() => {
    if (points.length === 0) return []
    if (range === '5d') {
      return points.reduce<number[]>((acc, p, i) => {
        if (i === 0 || dayKey(p.t) !== dayKey(points[i - 1].t)) acc.push(i)
        return acc
      }, [])
    }
    return points.reduce<number[]>((acc, p, i) => {
      if (i === 0 || hourMinute(p.t).hour !== hourMinute(points[i - 1].t).hour) acc.push(i)
      return acc
    }, [])
  }, [points, range])

  const lastPoint = points.length > 0 ? points[points.length - 1] : null
  const lastChange = lastPoint && prevClose !== null ? lastPoint.c - prevClose : null
  const lineColor =
    lastChange === null ? CHART_COLORS.line : lastChange >= 0 ? CHART_COLORS.up : CHART_COLORS.down

  const rangeLabel = range === '1d' ? '一日' : '五日'
  const dateRemark = useMemo(() => {
    if (range === '1d') {
      const formattedDate =
        tradeDate && /^\d{8}$/.test(tradeDate)
          ? `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`
          : tradeDate
      if (formattedDate) return `${formattedDate} 當日走勢`
      if (lastPoint) return `${dayKey(lastPoint.t)} 當日走勢`
      return '當日走勢'
    }
    return '近 5 日走勢'
  }, [range, tradeDate, lastPoint])

  const ariaLabel = !series || !lastPoint
    ? `${rangeLabel}走勢，無資料`
    : `${series.symbol || '個股'} ${rangeLabel}走勢，最新 ${fmt2(lastPoint.c)}${
        lastChange === null ? '' : `，${lastChange >= 0 ? '上漲' : '下跌'} ${fmt2(Math.abs(lastChange))}`
      }`

  const tooltipFor = (i: number): string | null => {
    const p = points[i]
    if (!p) return null
    const change = prevClose === null ? null : p.c - prevClose
    const v = vwap[i]
    return [
      `時間 ${hourMinute(p.t).label}`,
      `成交 ${fmt2(p.c)}`,
      change === null
        ? null
        : `漲跌 ${change >= 0 ? '+' : ''}${fmt2(change)} (${pct(change, prevClose as number)})`,
      v === null ? null : `均價 ${fmt2(v)}`,
      `單量 ${Math.round(p.v / 1000).toLocaleString('en-US')}`,
    ]
      .filter((s): s is string => s !== null)
      .join('　')
  }

  return (
    <div className="intraday-block">
      <div className="m-card-h">
        <div className="m-chart-title-group">
          <h4>走勢圖</h4>
          <span className="chart-time-badge">{dateRemark}</span>
        </div>
        <div className="m-range" role="group" aria-label="走勢區間">
          <button type="button" aria-pressed={range === '1d'} onClick={() => onRangeChange('1d')}>
            一日
          </button>
          <button type="button" aria-pressed={range === '5d'} onClick={() => onRangeChange('5d')}>
            五日
          </button>
        </div>
      </div>

      {loading ? (
        <div className="intraday-skeleton">
          <span className="skeleton" style={{ width: '100%', height: 220, display: 'block' }} />
          <span
            className="skeleton"
            style={{ width: '100%', height: 70, display: 'block', marginTop: 8 }}
          />
        </div>
      ) : series === null || points.length === 0 ? (
        <div className="intraday-empty">無走勢資料</div>
      ) : (
        <>
          <ChartFrame
            height={showVolume ? 220 : 290}
            domain={domain}
            labels={labels}
            labelIndices={labelIndices}
            ariaLabel={ariaLabel}
            crosshair
            hoverIndex={hover}
            onHover={setHover}
            tooltipAnchor={(i) => points[i]?.c ?? null}
            tooltipFor={tooltipFor}
          >
            {(geo) => {
              const baselineY = prevClose === null ? null : geo.y(prevClose)
              const closeLine = lineSegments(
                points.map((p) => p.c),
                geo,
              )
              const vwapLine = lineSegments(vwap, geo)
              const lastX = points.length > 0 ? geo.bandCenter(points.length - 1) : 0
              const lastY = points.length > 0 ? geo.y(points[points.length - 1].c) : 0

              return (
                <>
                  {baselineY !== null && (
                    <line
                      x1={0}
                      x2={geo.innerW}
                      y1={baselineY}
                      y2={baselineY}
                      stroke={CHART_COLORS.axis}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                  )}

                  {baselineY !== null && (
                    <>
                      <clipPath id={`${clipId}-up`}>
                        <rect x={0} y={0} width={geo.innerW} height={Math.max(baselineY, 0)} />
                      </clipPath>
                      <clipPath id={`${clipId}-down`}>
                        <rect
                          x={0}
                          y={baselineY}
                          width={geo.innerW}
                          height={Math.max(geo.innerH - baselineY, 0)}
                        />
                      </clipPath>
                      <polygon
                        points={areaToBaseline(points, geo, baselineY)}
                        fill={CHART_COLORS.up}
                        opacity={0.14}
                        clipPath={`url(#${clipId}-up)`}
                      />
                      <polygon
                        points={areaToBaseline(points, geo, baselineY)}
                        fill={CHART_COLORS.down}
                        opacity={0.14}
                        clipPath={`url(#${clipId}-down)`}
                      />
                    </>
                  )}

                  {closeLine.map((d, i) => (
                    <polyline
                      key={`close-${i}`}
                      points={d}
                      fill="none"
                      stroke={lineColor}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}

                  {vwapLine.map((d, i) => (
                    <polyline
                      key={`vwap-${i}`}
                      points={d}
                      fill="none"
                      stroke={VWAP_COLOR}
                      strokeWidth={1.2}
                      strokeDasharray="2 2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}

                  {points.length > 0 && <circle cx={lastX} cy={lastY} r={3} fill={lineColor} />}
                </>
              )
            }}
          </ChartFrame>

          {showVolume && (
            <ChartFrame
              height={70}
              domain={volumeDomain}
              labels={labels}
              labelIndices={labelIndices}
              ariaLabel={`${ariaLabel}，成交量`}
              hoverIndex={hover}
              onHover={setHover}
            >
              {(geo) => {
                const zeroY = geo.y(0)
                const barW = Math.max(geo.bandWidth * 0.7, 1)
                return (
                  <>
                    {points.map((p, i) => {
                      const prev = i === 0 ? (prevClose ?? p.c) : points[i - 1].c
                      const color = p.c >= prev ? CHART_COLORS.up : CHART_COLORS.down
                      const value = p.v / 1000
                      const y = geo.y(value)
                      const h = Math.max(zeroY - y, 1)
                      return (
                        <rect
                          key={`vol-${i}`}
                          x={geo.bandCenter(i) - barW / 2}
                          y={Math.min(y, zeroY)}
                          width={barW}
                          height={h}
                          fill={color}
                          opacity={geo.hover === null || geo.hover === i ? 0.5 : 0.25}
                        />
                      )
                    })}
                  </>
                )
              }}
            </ChartFrame>
          )}
        </>
      )}
    </div>
  )
}
