/**
 * Chart outline: Y-axis grid and scale, X-axis label, hover hit area and tooltip.
 * Each chart is only responsible for drawing "marks" (bars/polylines), and the coordinates are provided by geo.
 *
 * Two design decisions dictated by the limitations of PDF capture:
 * 1. viewBox width = measured container width (1:1, no scaling). Although using a fixed viewBox to scale proportionally eliminates the need for measurement,
 *    However, the font size will expand and shrink according to the container - the scale becomes twice as large on a wide screen, but too small to be seen clearly on a mobile phone.
 * 2. Font level and color should be written as SVG attributes without relying on CSS. html2canvas will serialize inline SVG into images.
 *    CSS variables in external style sheets and ancestor layers cannot be parsed, and the PDF will turn into a giant black text.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CHART_COLORS } from './chartColors'
import { clampTipCenter } from './chartPath'
import { domainTicks, fmtAxisNumber, scaleY, tickStep, type Domain } from './chartScale'

const PAD = { left: 58, right: 12, top: 10, bottom: 24 }
/** The default value when the width has not been measured yet (first render / test environment without ResizeObserver)*/
const FALLBACK_W = 560
const MIN_W = 240
const FONT_SIZE = 11

/** Measure container width so SVG is drawn at 1:1*/
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_W)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setWidth(Math.max(Math.round(el.clientWidth), MIN_W))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

export interface PlotGeometry {
  innerW: number
  innerH: number
  count: number
  bandWidth: number
  /** Center x of the i-th data point (drawing area coordinates)*/
  bandCenter: (i: number) => number
  /** value → drawing area y coordinate*/
  y: (v: number) => number
  /** The index of the current hover (null if not), used for marker highlighting*/
  hover: number | null
}

interface ChartFrameProps {
  height: number
  domain: Domain
  /** X-axis label, the length is the number of data points*/
  labels: string[]
  /**
   * Label only these indexes (each one if not specified).
   * There are only 7 points on the chip chart that can be fully marked, but there are 244 daily kings in a year - the full mark will become a black bar.
   * The hit zone is still built point by point, and hover accuracy is not affected.
   */
  labelIndices?: number[]
  ariaLabel: string
  /** Return the tooltip text of the point; return null to indicate that the point is not displayed.*/
  tooltipFor?: (index: number) => string | null
  /**
   * Draw a vertical dotted line across the drawing area when hovering.
   *
   * **Only line charts enabled** (0.6.8). The markers of the K-line and bar charts themselves occupy the entire column, and the hover has been expressed with dodge.
   * Adding another line is just noise; and they have existing DOM assertions that one more element will step on.
   */
  crosshair?: boolean
  /**
   * Return the **value** of the point and let the tooltip move up and down against the data point (like Google Finance).
   *
   * When not given, the tooltip remains pinned to the top of the drawing area - bar charts and K-lines do not have a single "y" of the point
   * (The bar has two ends, high and low, and the K-line has four prices.) Selecting one will only make the prompt box stop at a meaningless position.
   */
  tooltipAnchor?: (index: number) => number | null
  /**
   * Controlled hover (0.6.34): When multiple pictures stacked one on top of the other and sharing the same set of X-axis want to highlight the same day together,
   * The index is held externally (see `TwMarketSection`). **If you don’t give it, keep each map self-sustaining**,
   * The rest of the callers are unaffected - the images each ask their own questions, and together they are just interference.
   */
  hoverIndex?: number | null
  onHover?: (index: number | null) => void
  children: (geo: PlotGeometry) => ReactNode
}

export function ChartFrame({
  height,
  domain,
  labels,
  labelIndices,
  ariaLabel,
  tooltipFor,
  crosshair = false,
  tooltipAnchor,
  hoverIndex,
  onHover,
  children,
}: ChartFrameProps) {
  const [ownHover, setOwnHover] = useState<number | null>(null)
  const controlled = hoverIndex !== undefined
  const hover = controlled ? hoverIndex : ownHover
  const setHover = (index: number | null) => {
    if (!controlled) setOwnHover(index)
    onHover?.(index)
  }
  const { ref: wrapRef, width: viewW } = useMeasuredWidth()
  const titleId = useId()

  const innerW = viewW - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const count = Math.max(labels.length, 1)
  const bandWidth = innerW / count
  const geo: PlotGeometry = {
    innerW,
    innerH,
    count,
    bandWidth,
    bandCenter: (i) => bandWidth * (i + 0.5),
    y: (v) => scaleY(v, domain, innerH),
    hover,
  }

  const ticks = domainTicks(domain)
  const step = tickStep(domain)
  const shownLabels = labelIndices ?? labels.map((_, i) => i)
  const tipText = hover === null ? null : (tooltipFor?.(hover) ?? null)
  // Position the tooltip in percentage, eliminating the need to store another pixel coordinate in React state.
  // The width is estimated by the number of characters: about 8px/word mixed with Chinese and English numbers, plus left and right padding - only used for clamp, no accuracy is required
  const tipCenter =
    hover === null
      ? 0
      : clampTipCenter(PAD.left + geo.bandCenter(hover), (tipText?.length ?? 0) * 8 + 18, viewW)
  const tipLeft = (tipCenter / viewW) * 100
  // If there is a tooltipAnchor and the point has a value, it will be attached to the data point. Otherwise, "pin to the top of the drawing area" will be used.
  const anchorValue = hover === null ? null : (tooltipAnchor?.(hover) ?? null)
  const tipTop =
    anchorValue === null
      ? (PAD.top / height) * 100
      : ((PAD.top + geo.y(anchorValue)) / height) * 100

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {/*
        One tab stop for the whole chart: once focused, arrow keys step point by point, Home / End jump to the
        ends, Esc cancels. role changed from img to group —— something focusable and operable should not
        announce itself as a picture.
      */}
      <svg
        className="chart-svg"
        viewBox={`0 0 ${viewW} ${height}`}
        width={viewW}
        height={height}
        role="group"
        aria-labelledby={titleId}
        tabIndex={0}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          const last = labels.length - 1
          if (last < 0) return
          const move = (next: number) => {
            e.preventDefault()
            setHover(Math.min(Math.max(next, 0), last))
          }
          if (e.key === 'ArrowRight') move(hover === null ? 0 : hover + 1)
          else if (e.key === 'ArrowLeft') move(hover === null ? last : hover - 1)
          else if (e.key === 'Home') move(0)
          else if (e.key === 'End') move(last)
          else if (e.key === 'Escape') setHover(null)
        }}
      >
        <title id={titleId}>{ariaLabel}</title>
        <g transform={`translate(${PAD.left}, ${PAD.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={0}
                x2={innerW}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke={t === 0 ? CHART_COLORS.zero : CHART_COLORS.grid}
                strokeWidth={t === 0 ? 1.2 : 1}
              />
              <text
                x={-8}
                y={geo.y(t) + FONT_SIZE / 3}
                textAnchor="end"
                fontSize={FONT_SIZE}
                fill={CHART_COLORS.axis}
              >
                {fmtAxisNumber(t, step)}
              </text>
            </g>
          ))}

          {/* The crosshair is drawn before the markers so the line and area sit on top of it (as Google Finance does) */}
          {crosshair && hover !== null && (
            <line
              x1={geo.bandCenter(hover)}
              x2={geo.bandCenter(hover)}
              y1={0}
              y2={innerH}
              stroke={CHART_COLORS.axis}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {children(geo)}

          {shownLabels.map((i) => (
            <text
              key={`${labels[i]}-${i}`}
              x={geo.bandCenter(i)}
              y={innerH + FONT_SIZE + 4}
              textAnchor="middle"
              fontSize={FONT_SIZE}
              fill={CHART_COLORS.axis}
            >
              {labels[i]}
            </text>
          ))}

          {/*
            Transparent hit area: the whole column is hoverable, which is easier to hit than a thin bar.

            A year of daily candles is 244 invisible tab stops; after 0.6.8 merged the four sections into one
            page, a single page could hold up to 765 —— a keyboard user would press tab seven hundred times to
            get past it. Hence one tab stop for the whole chart (see tabIndex and onKeyDown on the <svg>),
            with arrow keys stepping between points once inside.
          */}
          {labels.map((label, i) => (
            <rect
              key={`hit-${label}-${i}`}
              x={bandWidth * i}
              y={0}
              width={bandWidth}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </g>
      </svg>

      {tipText && (
        <div className="chart-tip" style={{ left: `${tipLeft}%`, top: `${tipTop}%` }} role="status">
          {tipText}
        </div>
      )}
    </div>
  )
}
