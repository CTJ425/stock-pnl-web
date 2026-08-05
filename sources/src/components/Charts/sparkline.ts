/**
 * Coordinate calculation of mini trend lines (pure function, convenient for independent testing).
 *
 * Why not use `LineSeriesChart` in the same directory: the one with coordinate axes, grid lines, hover crosshairs and
 * Tooltip, the default height is 170px - when placed in a table or KPI card, it will be higher than the container itself. What we want here is
 * "Looking at the direction at a glance" is not a map of readable values, so it only counts the path and does not draw any scales.
 *
 * 0.6.19 was born for the general economic indicator card. From 0.6.21, it is also used for stock holding profitability, so it was moved from Macro to Charts.
 *
 * The coordinate system is 0..width / 0..height of viewBox, and the actual size is left to CSS
 * (SVG is stretched with `preserveAspectRatio="none"`, and line width is maintained with `vector-effect`).
 */

export interface SparklineGeometry {
  /** The coordinate string used by `<polyline points>`*/
  line: string
  /** Closed path for offline coloring (`<path d>`)*/
  area: string
  /** The last point with value is used to draw the endpoint circle*/
  lastX: number
  lastY: number
}

/**
 * Convert a set of values ​​into the coordinates of a mini trend line.
 *
 * `null` (the issue has not yet been released) **skip without drawing**, but still occupies an x ​​position ——
 * Compressing it will distort the timeline, and drawing it as 0 is just making up a number out of thin air.
 *
 * If there are less than two valid values, null is returned (one point cannot be connected), and the caller does not render accordingly.
 */
export function sparkline(
  values: ReadonlyArray<number | null | undefined>,
  width: number,
  height: number,
  pad = 3,
): SparklineGeometry | null {
  const pts: Array<{ x: number; y: number }> = []
  const usable = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
  const finite = usable.filter((v): v is number => v !== null)
  if (finite.length < 2 || values.length < 2) return null

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  // When all are of the same height, pendulum center line, do not divide by 0
  const span = max - min || 1
  const top = pad
  const bottom = height - pad

  usable.forEach((v, i) => {
    if (v === null) return
    const x = (i / (values.length - 1)) * width
    const y = max === min ? height / 2 : bottom - ((v - min) / span) * (bottom - top)
    pts.push({ x: round(x), y: round(y) })
  })

  const line = pts.map((p) => `${p.x},${p.y}`).join(' ')
  const first = pts[0]
  const last = pts[pts.length - 1]
  return {
    line,
    area: `M${first.x},${first.y} ${line} L${last.x},${height} L${first.x},${height} Z`,
    lastX: last.x,
    lastY: last.y,
  }
}

/** Two decimal places are enough for the coordinates. The string should be shorter and the DOM should be smaller.*/
function round(n: number): number {
  return Math.round(n * 100) / 100
}
