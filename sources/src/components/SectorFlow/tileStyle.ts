/** How a treemap tile looks: its fill for a net figure, and how much text fits in it. */

/** The strongest fill. Text stays readable on it in both themes (checked on the rendered page). */
const MAX_TINT = 55
const MIN_TINT = 10

/** Fill for a net figure: deeper with size (square-root scale, so a small buyer is still visibly red). */
export function tint(net: number, scale: number): string {
  if (net === 0 || scale <= 0) return 'var(--cds-layer-02)'
  const strength = Math.sqrt(Math.min(1, Math.abs(net) / scale))
  const pct = Math.round(MIN_TINT + strength * (MAX_TINT - MIN_TINT))
  return `color-mix(in srgb, var(${net > 0 ? '--up' : '--down'}) ${pct}%, var(--cds-layer-01))`
}

export type Label = 'full' | 'name' | 'none'

/** What fits in a tile of this size in px: name and figure, the name alone, or nothing. */
export function labelFor(wPx: number, hPx: number): Label {
  if (wPx >= 74 && hPx >= 46) return 'full'
  if (wPx >= 44 && hPx >= 26) return 'name'
  return 'none'
}
