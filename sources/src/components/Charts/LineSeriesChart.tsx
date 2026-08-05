/**
 * Line chart (single series), Google Finance style: gradient fill below line, hover vertical dashed line,
 * The tooltip is attached to the data point (0.6.8).
 *
 * The value range is not forced to contain 0 - the financing balance is often tens of thousands, and the exchange rate is 0.19x. Starting from 0 will suppress the changes into a straight line.
 * There is a big gap in magnitude between financing and securities lending, so draw one for each and do not share the Y-axis.
 * Days with missing data are cut off (not interpolated) to avoid looking like there are real numbers for that day.
 */
import { useId } from 'react'
import { ChartFrame } from './chartFrame'
import { areaSegments, lineSegments } from './chartPath'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

export interface LinePoint {
  label: string
  value: number | null
}

/**
 * If the number exceeds this number, dots will not be drawn point by point, only the hover one will be drawn.
 *
 * The chip page only has 7 days, and it is useful to mark "which days have information" with dots;
 * The exchange rate is 260 points a year, 260 dots will paste the line into a caterpillar, but not see the trend.
 */
const DOT_LIMIT = 20

interface LineSeriesChartProps {
  points: LinePoint[]
  height?: number
  color?: string
  /**
   * Label only these cells on the X-axis. The financing balance trend only lasts 7 days, and all bids are eligible.
   * However, the exchange rate has 260 points a year, and it will become a mess if it is not thinned out (newly added in 0.6.7, using the prop of the same name of MultiLineChart).
   */
  labelIndices?: number[]
  formatValue: (v: number) => string
  ariaLabel: string
  /** When sharing hover with other charts, it is held externally; if not given, it is self-held (see chartFrame)*/
  hoverIndex?: number | null
  onHover?: (index: number | null) => void
}

export function LineSeriesChart({
  points,
  height = 170,
  color = CHART_COLORS.line,
  labelIndices,
  formatValue,
  ariaLabel,
  hoverIndex,
  onHover,
}: LineSeriesChartProps) {
  const domain = niceDomain(points.map((p) => p.value))
  const showDots = points.length <= DOT_LIMIT
  const values = points.map((p) => p.value)

  /*
    The gradient id cannot be useId()'s raw value: React produces strings like `:r3:` with colons in them, and
    `url(#:r3:)` is not valid selector syntax —— the fill silently disappears. Strip the colons first.
    One page can hold several charts (two on the FX page, two on the chips page), so the id must be unique per
    instance and cannot be hard-coded.
  */
  const gradId = `chart-area-${useId().replace(/:/g, '')}`

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={points.map((p) => p.label)}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      crosshair
      hoverIndex={hoverIndex}
      onHover={onHover}
      tooltipAnchor={(i) => points[i]?.value ?? null}
      tooltipFor={(i) => {
        const p = points[i]
        if (!p) return null
        return `${p.label}　${p.value === null ? '無資料' : formatValue(p.value)}`
      }}
    >
      {(geo) => (
        <>
          <defs>
            {/*
              The stop colours must be literals, never CSS variables —— when html2canvas serialises the SVG it
              cannot resolve variables from ancestor scopes, and the chip report's PDF comes out solid black
              (see chartColors.ts).
            */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Area below the line: drawn first so it cannot cover the line and its dots */}
          {areaSegments(values, geo).map((d, i) => (
            <polygon key={`area-${i}`} points={d} fill={`url(#${gradId})`} stroke="none" />
          ))}

          {lineSegments(values, geo).map((d, i) => (
            <polyline
              key={i}
              points={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {points.map((p, i) =>
            p.value === null || (!showDots && geo.hover !== i) ? null : (
              <circle
                key={`${p.label}-${i}`}
                cx={geo.bandCenter(i)}
                cy={geo.y(p.value)}
                r={geo.hover === i ? 4.5 : 2.8}
                fill={color}
              />
            ),
          )}
        </>
      )}
    </ChartFrame>
  )
}
