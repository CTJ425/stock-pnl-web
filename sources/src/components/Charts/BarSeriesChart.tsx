/**
 * Buy and sell long bar charts. The zero axis is fixedly displayed, the bar grows upward/downward from the zero axis, and the value range is forced to include 0.
 * (Otherwise the visual length of the positive and negative bars will be distorted).
 *
 * Two coloring modes, depending on what the color is doing in the image:
 * - **Single sequence**: Do not specify color → red positive, green negative (polarity encoding, Taiwan stock convention).
 * - **Multiple Sequences**: Each sequence has a category color (identity code), and the positive and negative are expressed in the up and down direction of the zero axis.
 *   Color cannot express "who" and "positive or negative" at the same time, so the two are mutually exclusive. When there are multiple sequences, the caller must attach a legend.
 * - **Stacked** (2026-09-27): multiple sequences share one bar per day, positives stacked upward and
 *   negatives downward from the zero axis, separated by a 2px gap. Used where the day's total matters as
 *   much as who contributed it (三大法人). The domain is the stacked extent, not the largest single value.
 *
 * `selectedIndex` / `onSelect` turn the bars into a picker (年度收益 picks a year); the unselected bars
 * fade so the choice reads without a second colour.
 */
import { useMemo } from 'react'
import { ChartFrame } from './chartFrame'
import type { PlotGeometry } from './chartFrame'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

export interface BarSeries {
  name: string
  /** If omitted, it will be red, positive, green, or negative; required if there are multiple sequences.*/
  color?: string
  values: Array<number | null>
}

/** Leave a 2px gap between strips in the same group so that adjacent color blocks will not stick together.*/
const BAR_GAP = 2

interface BarRect {
  key: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  /** Data index, kept alongside the geometry so the dim-on-hover opacity can be applied outside the memo.*/
  index: number
}

/**
 * Bar positions depend only on `series` and geometry, never on `hover` (only the dim-on-hover
 * opacity does) — memoised in its own component so `useMemo` attaches to a real render rather
 * than to `ChartFrame`'s (a hook called inside the render-prop callback below would do exactly
 * that). `geo.hover` stays out of the memo key on purpose: reading it here would defeat it.
 */
function BarSeriesBars({
  series,
  geo,
  multi,
  stacked,
  selectedIndex,
}: {
  series: BarSeries[]
  geo: PlotGeometry
  multi: boolean
  stacked: boolean
  selectedIndex?: number | null
}) {
  const { bandCenter, y, bandWidth } = geo
  const bars = useMemo(() => {
    const zeroY = y(0)
    if (stacked) {
      const barW = Math.max(Math.min(bandWidth * 0.62, 24), 2)
      const out: BarRect[] = []
      const count = Math.max(0, ...series.map((s) => s.values.length))
      for (let i = 0; i < count; i++) {
        let up = 0
        let down = 0
        series.forEach((s) => {
          const value = s.values[i]
          if (value === null || value === undefined || value === 0) return
          const from = value > 0 ? up : down
          const to = from + value
          const y1 = y(from)
          const y2 = y(to)
          const h = Math.max(Math.abs(y2 - y1) - BAR_GAP, 1)
          // The gap sits on the side away from the zero axis so the stack stays anchored to the baseline.
          const top = value > 0 ? Math.min(y1, y2) + BAR_GAP : Math.min(y1, y2)
          out.push({ key: `${s.name}-${i}`, x: bandCenter(i) - barW / 2, y: top, width: barW, height: h, fill: s.color ?? CHART_COLORS.axis, index: i })
          if (value > 0) up = to
          else down = to
        })
      }
      return out
    }
    // A single sequence occupies half of the column width; multiple sequences occupy 80% of the column width, leaving a 2px gap for each.
    const groupW = multi ? bandWidth * 0.8 : bandWidth * 0.52
    const slotW = groupW / series.length
    const barW = Math.max(multi ? slotW - BAR_GAP : slotW, 2)
    const out: BarRect[] = []
    series.forEach((s, si) => {
      s.values.forEach((value, i) => {
        if (value === null || value === undefined) return
        const valueY = y(value)
        const top = Math.min(valueY, zeroY)
        // When the value is 0, still draw 1px, so that the difference between "there is data but 0" and "no data" can be seen
        const h = Math.max(Math.abs(valueY - zeroY), 1)
        const center = bandCenter(i)
        const x = multi
          ? center - groupW / 2 + slotW * si + (slotW - barW) / 2
          : center - barW / 2
        const fill = s.color ?? (value < 0 ? CHART_COLORS.down : CHART_COLORS.up)
        out.push({ key: `${s.name}-${i}`, x, y: top, width: barW, height: h, fill, index: i })
      })
    })
    return out
  }, [series, bandCenter, y, bandWidth, multi, stacked])

  return (
    <>
      {bars.map((b) => (
        <rect
          key={b.key}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          rx={1.5}
          fill={b.fill}
          opacity={
            selectedIndex !== undefined && selectedIndex !== null
              ? selectedIndex === b.index || geo.hover === b.index
                ? 1
                : 0.4
              : geo.hover === null || geo.hover === b.index
                ? 1
                : 0.45
          }
        />
      ))}
    </>
  )
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
  /** Stack the series into one bar per label (positives up, negatives down). */
  stacked?: boolean
  /** Highlighted bar when the chart is used as a picker. */
  selectedIndex?: number | null
  onSelect?: (index: number) => void
}

export function BarSeriesChart({
  labels,
  series,
  labelIndices,
  height = 170,
  formatValue,
  ariaLabel,
  stacked = false,
  selectedIndex,
  onSelect,
}: BarSeriesChartProps) {
  const multi = series.length > 1
  const extent = stacked
    ? labels.flatMap((_, i) => {
        const vals = series.map((s) => s.values[i]).filter((v): v is number => v !== null && v !== undefined)
        return [vals.filter((v) => v > 0).reduce((a, b) => a + b, 0), vals.filter((v) => v < 0).reduce((a, b) => a + b, 0)]
      })
    : series.flatMap((s) => s.values)
  const domain = niceDomain(extent, { includeZero: true })

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={labels}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      onSelect={onSelect}
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
        if (stacked) {
          const total = series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
          lines.push(`合計 ${formatValue(total)}`)
        }
        return `${labels[i]}｜${lines.join('　')}`
      }}
    >
      {(geo) => (
        <BarSeriesBars series={series} geo={geo} multi={multi} stacked={stacked} selectedIndex={selectedIndex} />
      )}
    </ChartFrame>
  )
}
