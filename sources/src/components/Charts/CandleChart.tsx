/**
 * Daily K candle chart, moving average can be superimposed.
 *
 * A few deliberate trade-offs:
 * - **Value range does not include 0**. A stock price starting at 0 would squeeze the entire year's volatility into a thin line at the top.
 * - **Red Up and Green Down** (Taiwan stock market convention, the same color group as the up/down of the chip chart): determined by "current closing vs. opening",
 *   Not compared to the previous bar - this is consistent with the solid/hollow logic of the market reading software.
 * - **Category color for moving averages**: The difference between the moving averages is the "status" (5/20/60 days), not the rise or fall,
 *   So use CATEGORICAL_COLORS instead of up/down (colors can only do one thing at a time, see SPEC).
 * - When there are 244 candles in a year, each candle is less than 2px, and the candle entity will degenerate into a line; at this time, it is still guaranteed to be at least 1px wide,
 *   Let it be seen that "there is this root".
 */
import { useMemo } from 'react'
import { ChartFrame } from './chartFrame'
import type { PlotGeometry } from './chartFrame'
import { lineSegments } from './chartPath'
import { CHART_COLORS } from './chartColors'
import { niceDomain } from './chartScale'

/**
 * If either open high or low close is null, this root cannot be drawn and the column will be left blank (0.6.34).
 *
 * Originally, the caller first filtered out the incomplete days, but in this way, the Nth day was no longer the Nth day——
 * When stacked with other graphs that share an x-axis, the same hover index will refer to different dates.
 * Keep the fields, just don't draw them, so the index can be correct. It still doesn’t work to use the closing price to cover the opening high and low:
 * That would draw a whole row of crosshairs that would look like there were really no fluctuations on that day.
 */
export interface Candle {
  label: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
}

/** The one with the same price among the four (used for drawing and tooltip)*/
type FullCandle = { label: string; open: number; high: number; low: number; close: number }

function full(c: Candle | undefined): FullCandle | null {
  if (!c || c.open === null || c.high === null || c.low === null || c.close === null) return null
  return c as FullCandle
}

export interface OverlayLine {
  name: string
  color: string
  values: Array<number | null>
}

interface CandleBody {
  key: string
  center: number
  yHigh: number
  yLow: number
  top: number
  bodyH: number
  color: string
  /** Data index, kept alongside the geometry so the dim-on-hover opacity can be applied outside the memo.*/
  index: number
}

/**
 * Candle body/wick positions depend only on `candles` and geometry, never on `hover` (only the
 * dim-on-hover opacity does) — memoised in its own component so `useMemo` attaches to a real
 * render rather than to `ChartFrame`'s (a hook called inside the render-prop callback below
 * would do exactly that).
 */
function CandleBodies({ candles, geo }: { candles: Candle[]; geo: PlotGeometry }) {
  const { bodyW, bars } = useMemo(() => {
    // The candle body occupies 60% of the width of the column, leaving a gap; no matter how narrow it is, the minimum is 1px
    const bodyW = Math.max(geo.bandWidth * 0.6, 1)
    const out: CandleBody[] = []
    candles.forEach((raw, i) => {
      const c = full(raw)
      if (!c) return
      const color = c.close >= c.open ? CHART_COLORS.up : CHART_COLORS.down
      const center = geo.bandCenter(i)
      const yHigh = geo.y(c.high)
      const yLow = geo.y(c.low)
      const yOpen = geo.y(c.open)
      const yClose = geo.y(c.close)
      const top = Math.min(yOpen, yClose)
      // When the opening is equal to the closing (crosshair), still draw 1px, otherwise the whole bar will disappear that day
      const bodyH = Math.max(Math.abs(yClose - yOpen), 1)
      out.push({ key: `${c.label}-${i}`, center, yHigh, yLow, top, bodyH, color, index: i })
    })
    return { bodyW, bars: out }
  }, [candles, geo.bandCenter, geo.y, geo.bandWidth])

  return (
    <>
      {bars.map((b) => (
        <g key={b.key} opacity={geo.hover !== null && geo.hover !== b.index ? 0.45 : 1}>
          <line x1={b.center} x2={b.center} y1={b.yHigh} y2={b.yLow} stroke={b.color} strokeWidth={1} />
          <rect x={b.center - bodyW / 2} y={b.top} width={bodyW} height={b.bodyH} fill={b.color} />
        </g>
      ))}
    </>
  )
}

/**
 * Moving-average overlay path strings depend only on `overlays` and geometry, never on
 * `hover` — same reasoning and same memoisation split as `CandleBodies` above.
 */
function CandleOverlays({ overlays, geo }: { overlays: OverlayLine[]; geo: PlotGeometry }) {
  const paths = useMemo(
    () => overlays.map((o) => ({ name: o.name, color: o.color, segs: lineSegments(o.values, geo) })),
    [overlays, geo.bandCenter, geo.y],
  )
  return (
    <>
      {paths.map(({ name, color, segs }) =>
        segs.map((d, si) => (
          <polyline
            key={`${name}-${si}`}
            points={d}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )),
      )}
    </>
  )
}

interface CandleChartProps {
  candles: Candle[]
  overlays?: OverlayLine[]
  labelIndices?: number[]
  height?: number
  formatValue: (v: number) => string
  ariaLabel: string
  /** Additional text attached to the end of the tooltip (such as volume)*/
  tooltipExtra?: (index: number) => string | null
  /** When sharing hover with other charts, it is held externally; if not given, it is self-held (see chartFrame)*/
  hoverIndex?: number | null
  onHover?: (index: number | null) => void
  crosshair?: boolean
}

export function CandleChart({
  candles,
  overlays = [],
  labelIndices,
  height = 260,
  formatValue,
  ariaLabel,
  tooltipExtra,
  hoverIndex,
  onHover,
  crosshair,
}: CandleChartProps) {
  // The value range must accommodate both the high and low of the candle and the moving average, otherwise the moving average will be drawn outside the box.
  const domain = niceDomain([
    ...candles.flatMap((c) => [c.high, c.low]),
    ...overlays.flatMap((o) => o.values),
  ])

  return (
    <ChartFrame
      height={height}
      domain={domain}
      labels={candles.map((c) => c.label)}
      labelIndices={labelIndices}
      ariaLabel={ariaLabel}
      hoverIndex={hoverIndex}
      onHover={onHover}
      crosshair={crosshair}
      tooltipFor={(i) => {
        const c = full(candles[i])
        // Only the date will be reported on days when the opening, closing, and closing are both high and low: other charts that share the X-axis will still have the number for that day.
        // Returning null here will cause this picture to be the only one in the entire crosshair without a prompt, making it look like it is broken.
        if (!c) return candles[i]?.label ?? null
        const ohlc = `開 ${formatValue(c.open)}　高 ${formatValue(c.high)}　低 ${formatValue(c.low)}　收 ${formatValue(c.close)}`
        const ma = overlays
          .map((o) => {
            const v = o.values[i]
            return v === null || v === undefined ? null : `${o.name} ${formatValue(v)}`
          })
          .filter((s): s is string => s !== null)
        const extra = tooltipExtra?.(i)
        return [c.label, ohlc, ma.join('　'), extra].filter(Boolean).join('｜')
      }}
    >
      {(geo) => (
        <>
          <CandleBodies candles={candles} geo={geo} />
          <CandleOverlays overlays={overlays} geo={geo} />
        </>
      )}
    </ChartFrame>
  )
}
