/**
 * Squarified treemap (Bruls, Huizing, van Wijk 2000): tiles as close to squares as the areas allow,
 * so small values stay visible instead of becoming slivers.
 *
 * Pure geometry: values in, rectangles out. Area is proportional to value, the order is
 * deterministic (value descending, then id), and the same input always yields the same layout, so a
 * recolouring of the same tiles never moves them.
 */
export interface TreemapInput {
  id: string
  value: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed extends Rect {
  id: string
}

/** The worst aspect ratio in a row of `areas` laid along a side of length `side`. */
function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((s, a) => s + a, 0)
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
}

export function squarify(items: TreemapInput[], box: Rect): Placed[] {
  const list = items
    .filter((i) => Number.isFinite(i.value) && i.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  if (list.length === 0 || box.w <= 0 || box.h <= 0) return []

  const scale = (box.w * box.h) / list.reduce((s, i) => s + i.value, 0)
  const out: Placed[] = []
  let { x, y, w, h } = box
  let i = 0
  while (i < list.length) {
    const side = Math.min(w, h)
    const areas = [list[i].value * scale]
    let worst = worstRatio(areas, side)
    let j = i + 1
    while (j < list.length) {
      const next = [...areas, list[j].value * scale]
      const candidate = worstRatio(next, side)
      if (candidate > worst) break
      areas.push(list[j].value * scale)
      worst = candidate
      j++
    }

    const rowSum = areas.reduce((s, a) => s + a, 0)
    if (w >= h) {
      // The short side is the height: the row is a column on the left.
      const colW = rowSum / h
      let cy = y
      areas.forEach((a, k) => {
        out.push({ id: list[i + k].id, x, y: cy, w: colW, h: a / colW })
        cy += a / colW
      })
      x += colW
      w -= colW
    } else {
      const rowH = rowSum / w
      let cx = x
      areas.forEach((a, k) => {
        out.push({ id: list[i + k].id, x: cx, y, w: a / rowH, h: rowH })
        cx += a / rowH
      })
      y += rowH
      h -= rowH
    }
    i = j
  }
  return out
}

export interface SectorInput {
  id: string
  value: number
  /** Laid out inside the parent's tile, below its header. */
  children: TreemapInput[]
}

/** A tile in percent of its container (the page for a sector, the parent's body for a child). */
export interface TilePct {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface SectorTile extends TilePct {
  /** Percent of the parent's body, which starts `headerUnits` below the parent's top. Empty for a flat tile. */
  children: TilePct[]
}

/**
 * Lay the sectors out in a container of the given width/height ratio. A sector with children gets
 * a header strip (`headerUnits`, in the same 100-high units as the layout) and its children are laid
 * out in the rest. Only area ratios matter for the children, so they are expressed in percent of the
 * parent's body, whatever size the browser gives it.
 */
export function layoutSectors(sectors: SectorInput[], aspect: number, headerUnits: number): SectorTile[] {
  const W = 100 * aspect
  const H = 100
  const pct = (r: Rect, boxW: number, boxH: number, id: string): TilePct => ({
    id,
    x: (r.x / boxW) * 100,
    y: (r.y / boxH) * 100,
    w: (r.w / boxW) * 100,
    h: (r.h / boxH) * 100,
  })
  const byId = new Map(sectors.map((s) => [s.id, s]))
  return squarify(sectors.map((s) => ({ id: s.id, value: s.value })), { x: 0, y: 0, w: W, h: H }).map((p) => {
    const sector = byId.get(p.id)!
    const bodyH = Math.max(0, p.h - headerUnits)
    const kids =
      sector.children.length > 0 && bodyH > 0
        ? squarify(sector.children, { x: 0, y: 0, w: p.w, h: bodyH }).map((c) => pct(c, p.w, bodyH, c.id))
        : []
    return { ...pct(p, W, H, p.id), children: kids }
  })
}
