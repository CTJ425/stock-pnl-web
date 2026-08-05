/**
 * Common pure functions for SVG path assembly and layout positioning.
 *
 * Why separate it into a separate file instead of placing it in chartFrame.tsx: That file exports components.
 * Exporting non-components from the component file will trigger react(only-export-components) - Fast Refresh will reload the entire file.
 */
import type { PlotGeometry } from './chartFrame'

/**
 * Cut the value sequence into continuous value segments, each segment is a `[x, y]` coordinate array.
 *
 * This rule "disconnect when null is encountered, do not interpolate, and discard segments with only one point" is shared by polyline, area, and moving average overlay charts.
 * I picked it here because **writing one copy of each will inevitably lead to a delay in "should I connect the missing information?"**——
 * In particular, area filling cannot be divided into segments by itself: as long as the breakpoint of the filling and the line is different by one grid,
 * A color block without lines will appear on the screen, and it will be difficult to see which side is wrong.
 */
function segments(values: Array<number | null>, geo: PlotGeometry): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (current.length > 1) out.push(current)
      current = []
      return
    }
    current.push([geo.bandCenter(i), geo.y(v)])
  })
  if (current.length > 1) out.push(current)
  return out
}

const pt = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`

/**
 * A string of points that cuts a continuous value segment into multiple polylines (breaks when null is encountered and does not interpolate).
 * The line chart, the moving average overlay chart, and the KD chart are shared in three places - writing one for each will inevitably lead to a delay in "should the missing information be connected?"
 */
export function lineSegments(values: Array<number | null>, geo: PlotGeometry): string[] {
  return segments(values, geo).map((seg) => seg.map(pt).join(' '))
}

/**
 * The same segmentation, but each segment is closed down to the bottom edge of the drawing area for `<polygon>` to fill the area.
 *
 * Use `geo.innerH` instead of `geo.y(0)` for the bottom: the value range of the line chart deliberately does not contain 0
 * (The exchange rate is 0.195~0.202, and the financing balance is often tens of thousands. Starting from 0 will suppress the changes into a straight line),
 * `geo.y(0)` will fall far outside the plot area.
 */
export function areaSegments(values: Array<number | null>, geo: PlotGeometry): string[] {
  return segments(values, geo).map((seg) => {
    const first = seg[0]
    const last = seg[seg.length - 1]
    return [pt([first[0], geo.innerH]), ...seg.map(pt), pt([last[0], geo.innerH])].join(' ')
  })
}

/**
 * Clamp the center x of the tooltip within the container to prevent the leftmost/rightmost data points from extending beyond it.
 *
 * `.chart-tip` is `translate(-50%, …)`, the center is aligned with the data point; the center of the first and last points of the sequence
 * If there is only half a bandWidth from the edge of the container, a wider tooltip will be cropped.
 *
 * `estWidth` is an **estimate** (the caller pushes it by the number of characters). The purpose is only to block obvious overflow and does not pursue pixel accuracy——
 * To be precise, you have to render first, then measure and then rearrange. It's not worth it for a prompt box.
 * When the container is narrower than the tooltip, return it to the center (if you clip it again, it will just be cut on the other side).
 */
export function clampTipCenter(centerPx: number, estWidthPx: number, viewW: number): number {
  const half = estWidthPx / 2
  if (half * 2 >= viewW) return viewW / 2
  return Math.min(Math.max(centerPx, half), viewW - half)
}
