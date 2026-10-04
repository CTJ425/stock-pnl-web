/**
 * The two sides of the day: where the institutions bought and where they sold, each as its own
 * whole (100%). Semiconductors are split into their four parts, because the parent can hide a big
 * seller inside a small net (2026-10-02: 半導體 +3.4 億, of which IC 設計 −69.9 億).
 *
 * The two sides are never matched against each other. Buying in one sector and selling in another
 * is not a transfer between them, so nothing here (or in the screen built on it) draws one.
 */
import type { FlowView, ViewRow } from './sectorFlowView'

/** Named slices per side; everything after them is folded into "其他". */
export const TOP_SLICES = 5

export interface SideSlice {
  code: string
  name: string
  /** Signed, in NT$ (negative on the sell side). */
  netTwd: number
  /** Share of this side's total, 0–1. */
  share: number
  /** One of the four semiconductor parts. */
  semiconductor: boolean
  /** The folded remainder, not a sector. */
  other: boolean
}

export interface FlowSide {
  totalTwd: number
  /** Sectors on this side, before folding. */
  count: number
  slices: SideSlice[]
}

export interface FlowSides {
  buy: FlowSide
  sell: FlowSide
  /** Buy total plus sell total. */
  netTwd: number
}

/** Every row that is a leaf of the view: a sector, or — for 半導體 — each of its parts. */
function leaves(view: FlowView): ViewRow[] {
  return view.sectors.flatMap((s) => (s.children.length > 0 ? s.children : [s]))
}

function buildSide(rows: ViewRow[], sign: 1 | -1): FlowSide {
  const side = rows
    .filter((r) => r.netTwd * sign > 0)
    .sort((a, b) => b.netTwd * sign - a.netTwd * sign || a.code.localeCompare(b.code))
  const totalTwd = side.reduce((s, r) => s + r.netTwd, 0)
  if (side.length === 0) return { totalTwd: 0, count: 0, slices: [] }

  const share = (net: number) => Math.abs(net) / Math.abs(totalTwd)
  const named: SideSlice[] = side.slice(0, TOP_SLICES).map((r) => ({
    code: r.code,
    name: r.name,
    netTwd: r.netTwd,
    share: share(r.netTwd),
    semiconductor: r.code.startsWith('24:'),
    other: false,
  }))
  const rest = side.slice(TOP_SLICES)
  if (rest.length > 0) {
    const restTwd = rest.reduce((s, r) => s + r.netTwd, 0)
    named.push({
      code: 'other',
      name: `其他 ${rest.length} 個類股`,
      netTwd: restTwd,
      share: share(restTwd),
      semiconductor: false,
      other: true,
    })
  }
  return { totalTwd, count: side.length, slices: named }
}

export function buildSides(view: FlowView): FlowSides {
  const rows = leaves(view)
  const buy = buildSide(rows, 1)
  const sell = buildSide(rows, -1)
  return { buy, sell, netTwd: buy.totalTwd + sell.totalTwd }
}

// ---- ring geometry (degrees clockwise from 12 o'clock) ----

export const RING = { size: 244, center: 122, radius: 80, stroke: 36, labelRadius: 114, labelBox: 18 } as const

export interface Arc {
  start: number
  sweep: number
  /** Middle of the arc, where the rank numeral sits. */
  mid: number
}

export function ringArcs(slices: SideSlice[]): Arc[] {
  let start = 0
  return slices.map((s) => {
    const sweep = s.share * 360
    const arc = { start, sweep, mid: start + sweep / 2 }
    start += sweep
    return arc
  })
}

/** Top-left of the rank numeral for an arc, in px inside the ring's square. */
export function rankPosition(midDeg: number): { left: number; top: number } {
  const a = (midDeg * Math.PI) / 180
  const half = RING.labelBox / 2
  return {
    left: RING.center + RING.labelRadius * Math.sin(a) - half,
    top: RING.center - RING.labelRadius * Math.cos(a) - half,
  }
}
