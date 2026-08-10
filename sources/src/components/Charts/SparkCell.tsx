/**
 * Mini trend line in the "Trend" column of the table (0.6.35 extracted from TwMarketSection).
 *
 * Both tables require this thing: The Taiwan stock legal person table shows that the total trading volume exceeded the last 15 trading days.
 * The U.S. General Economic Statement looks at the last 12 periods of a single indicator. **Only draw, not "continuous" judgment** ——
 * What legal persons look at is the sign of the amount, and what the general manager looks at is the increase or decrease from the previous period. Those are two different things.
 * Hardly synthesizing a "universal streak" will only add one parameter and a condition.
 *
 * The color is determined by the caller and passed in as a literal value. CSS variables are not used: when exporting PDF with html2canvas
 * If the variables of the ancestor layer cannot be resolved, the entire image will turn black (`chartColors.ts` has the same note).
 *
 * When there are less than two points, `sparkline` returns null, and "—" is printed here instead of leaving blank ——
 * If a dot cannot be connected to a line, the hard drawing will become a small dot and look like a broken picture;
 * The blank space will be read as "there is no data in this box", which is not the same thing as "the data is not enough to draw a line".
 * Both tables require this behavior, so they are placed in the component rather than handled separately.
 */
import { sparkline } from './sparkline'

/** viewBox size. The actual display size is specified by the caller in inline style (the column width requirements of the two tables are different)*/
export const SPARK_W = 64
export const SPARK_H = 18

interface SparkCellProps {
  /** From old to new*/
  points: ReadonlyArray<number | null>
  color: string
  ariaLabel: string
  /** Display width (px). Defaults to SPARK_W; larger for the institutional day column. */
  width?: number
  /** Display height (px). Defaults to SPARK_H. */
  height?: number
}

export function SparkCell({
  points,
  color,
  ariaLabel,
  width = SPARK_W,
  height = SPARK_H,
}: SparkCellProps) {
  // Geometry always uses the fixed viewBox so path math stays stable; CSS size scales the SVG.
  const g = sparkline(points, SPARK_W, SPARK_H)
  if (!g) return <>—</>
  return (
    <svg
      className="mac-spark"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      style={{ width, height, display: 'block' }}
    >
      <path d={g.area} fill={color} opacity="0.16" />
      <polyline
        points={g.line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={g.lastX} cy={g.lastY} r="2.2" fill={color} />
    </svg>
  )
}
