/**
 * Buy and sell long bar charts. The zero axis is fixedly displayed, the bar grows upward/downward from the zero axis, and the value range is forced to include 0.
 * (Otherwise the visual length of the positive and negative bars will be distorted).
 *
 * Two coloring modes, depending on what the color is doing in the image:
 * - **Single sequence**: Do not specify color → red positive, green negative (polarity encoding, Taiwan stock convention).
 * - **Multiple Sequences**: Each sequence has a category color (identity code), and the positive and negative are expressed in the up and down direction of the zero axis.
 *   Color cannot express "who" and "positive or negative" at the same time, so the two are mutually exclusive. When there are multiple sequences, the caller must attach a legend.
 */
import { ChartFrame } from './chartFrame'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

export interface BarSeries {
  name: string
  /** If omitted, it will be red, positive, green, or negative; required if there are multiple sequences.*/
  color?: string
  values: Array<number | null>
}

interface BarSeriesChartProps {
  labels: string[]
  series: BarSeries[]
  /** Only label the*/
  labelIndices?: number[]
  height?: number
  /** Numeric formatting of tooltip (including unit)*/
  formatValue: (v: number) => string
  ariaLabel: string
}

/** Leave a 2px gap between strips in the same group so that adjacent color blocks will not stick together.*/
const BAR_GAP = 2

export function BarSeriesChart({
  labels,
  series,
  labelIndices,
  height = 170,
  formatValue,
  ariaLabel,
}: BarSeriesChartProps) {
  const domain = niceDomain(series.flatMap((s) => s.values), { includeZero: true })
  const multi = series.length > 1

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={labels}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      tooltipFor={(i) => {
        if (!labels[i]) return null
        if (!multi) {
          const v = series[0]?.values[i]
          return `${labels[i]}　${v === null || v === undefined ? '無資料' : formatValue(v)}`
        }
        // Multi-sequence: list each legal person of the day at once, eliminating the need for hover comparison one by one.
        const lines = series.map((s) => {
          const v = s.values[i]
          return `${s.name} ${v === null || v === undefined ? '無資料' : formatValue(v)}`
        })
        return `${labels[i]}｜${lines.join('　')}`
      }}
    >
      {(geo) => {
        const zeroY = geo.y(0)
        // A single sequence occupies half of the column width; multiple sequences occupy 80% of the column width, leaving a 2px gap for each.
        const groupW = multi ? geo.bandWidth * 0.8 : geo.bandWidth * 0.52
        const slotW = groupW / series.length
        const barW = Math.max(multi ? slotW - BAR_GAP : slotW, 2)

        return (
          <>
            {series.map((s, si) =>
              s.values.map((value, i) => {
                if (value === null || value === undefined) return null
                const valueY = geo.y(value)
                const top = Math.min(valueY, zeroY)
                // When the value is 0, still draw 1px, so that the difference between "there is data but 0" and "no data" can be seen
                const h = Math.max(Math.abs(valueY - zeroY), 1)
                const center = geo.bandCenter(i)
                const x = multi
                  ? center - groupW / 2 + slotW * si + (slotW - barW) / 2
                  : center - barW / 2
                const fill = s.color ?? (value < 0 ? CHART_COLORS.down : CHART_COLORS.up)
                return (
                  <rect
                    key={`${s.name}-${i}`}
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    rx={1.5}
                    fill={fill}
                    opacity={geo.hover === null || geo.hover === i ? 1 : 0.45}
                  />
                )
              }),
            )}
          </>
        )
      }}
    </ChartFrame>
  )
}
