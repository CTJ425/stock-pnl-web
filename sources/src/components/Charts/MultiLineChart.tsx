/**
 * Multi-series line chart (for indicators such as KD with "same dimension and same vertical axis").
 *
 * Reason for separation from LineSeriesChart: That one is a single sequence, uses polar colors (red positive, green negative) and draws data point dots;
 * This one is a multi-sequence, uses category colors to express identity, and does not draw dots (too dense dots will make them blur together).
 * The difference between the two is not the number of parameters, but the colors do different things in the picture. If they are combined into one, both sides will look awkward.
 *
 * The calling end must also attach a legend (SPEC: two or more sequences must be attached with a legend, and the identification cannot be based on color alone).
 */
import { ChartFrame } from './chartFrame'
import { lineSegments } from './chartPath'
import { niceDomain, type Domain } from './chartScale'

export interface LineSeries {
  name: string
  color: string
  values: Array<number | null>
}

interface MultiLineChartProps {
  labels: string[]
  series: LineSeries[]
  labelIndices?: number[]
  height?: number
  /** Specify a fixed value range (KD is always between 0 and 100, so that it can float with the data and the high and low ranges cannot be seen)*/
  domain?: Domain
  /** Additional horizontal reference lines (e.g. 20 / 80 for KD)*/
  guides?: number[]
  formatValue: (v: number) => string
  ariaLabel: string
}

export function MultiLineChart({
  labels,
  series,
  labelIndices,
  height = 170,
  domain,
  guides = [],
  formatValue,
  ariaLabel,
}: MultiLineChartProps) {
  const resolved = domain ?? niceDomain(series.flatMap((s) => s.values))

  return (
    <ChartFrame
      height={height}
      domain={resolved}
      labels={labels}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      tooltipFor={(i) => {
        if (!labels[i]) return null
        const parts = series.map((s) => {
          const v = s.values[i]
          return `${s.name} ${v === null || v === undefined ? '無資料' : formatValue(v)}`
        })
        return `${labels[i]}｜${parts.join('　')}`
      }}
    >
      {(geo) => (
        <>
          {guides.map((g) => (
            <line
              key={g}
              x1={0}
              x2={geo.innerW}
              y1={geo.y(g)}
              y2={geo.y(g)}
              stroke="rgba(138, 148, 163, 0.45)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ))}
          {series.map((s) =>
            lineSegments(s.values, geo).map((d, i) => (
              <polyline
                key={`${s.name}-${i}`}
                points={d}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )),
          )}
        </>
      )}
    </ChartFrame>
  )
}
