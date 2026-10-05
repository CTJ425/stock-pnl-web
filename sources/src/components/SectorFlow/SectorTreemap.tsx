/**
 * The 方塊熱度圖: one tile per sector, area = turnover (where the money trades), colour = what the
 * institutions did there (red buy, green sell, deeper = more). 半導體 is a tile with its four
 * sub-sectors inside it.
 *
 * Area is turnover, which does not change when the investor group or the window changes — switching
 * 外資 / 投信 / 自營商 only recolours, and every sector stays where the reader last saw it.
 *
 * Tiles are buttons: the picture is also the way into the detail panel, by mouse, touch or keyboard.
 * A tile too small to hold text carries its name and figure in `aria-label` / `title` instead.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { labelFor, tint, type Label } from './tileStyle'
import { layoutSectors, type TilePct } from './treemapLayout'
import { signedBillion, type FlowView, type ViewRow, type ViewSector } from './sectorFlowView'

/** Width/height of the container: wide on a desktop, tall on a phone so small tiles keep room. */
const ASPECT_WIDE = 1.45
const ASPECT_NARROW = 0.78
/** Height of a parent tile's header strip, in layout units (the layout is 100 units high) and in px. */
const HEADER_UNITS_WIDE = 5
const HEADER_UNITS_NARROW = 6
const HEADER_PX = 24

const pct = (v: number) => `${v}%`
const place = (t: TilePct): CSSProperties => ({ left: pct(t.x), top: pct(t.y), width: pct(t.w), height: pct(t.h) })

function useWidth(initial: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || initial))
    ro.observe(el)
    setWidth(el.clientWidth || initial)
    return () => ro.disconnect()
  }, [initial])
  return [ref, width]
}

interface TileProps {
  row: ViewRow
  at: TilePct
  scale: number
  label: Label
  selected: boolean
  onSelect: (code: string) => void
}

function Tile({ row, at, scale, label, selected, onSelect }: TileProps) {
  const figure = signedBillion(row.netTwd)
  const share = row.turnoverShare === null ? '' : `，佔成交 ${(row.turnoverShare * 100).toFixed(1)}%`
  return (
    <button
      type="button"
      className={selected ? 'sf-tile sf-tile-selected' : 'sf-tile'}
      style={{ ...place(at), background: tint(row.netTwd, scale) }}
      aria-pressed={selected}
      aria-label={`${row.name}，買賣超 ${figure}${share}`}
      title={`${row.name}　${figure}`}
      onClick={() => onSelect(row.code)}
    >
      {label !== 'none' && (
        <span className="sf-tile-text">
          <span className="sf-tile-name">{row.name}</span>
          {label === 'full' && <span className="sf-tile-figure">{figure}</span>}
        </span>
      )}
    </button>
  )
}

interface Props {
  view: FlowView
  selected: string | null
  /** Called with the tile's code; the caller decides whether a second press clears the selection. */
  onSelect: (code: string) => void
  narrow: boolean
}

export function SectorTreemap({ view, selected, onSelect, narrow }: Props) {
  const aspect = narrow ? ASPECT_NARROW : ASPECT_WIDE
  const [ref, width] = useWidth(narrow ? 340 : 720)
  const height = width / aspect

  const layout = useMemo(
    () =>
      layoutSectors(
        view.sectors
          .filter((s) => s.turnoverTwd > 0)
          .map((s) => ({
            id: s.code,
            value: s.turnoverTwd,
            children: s.children.filter((c) => c.turnoverTwd > 0).map((c) => ({ id: c.code, value: c.turnoverTwd })),
          })),
        aspect,
        narrow ? HEADER_UNITS_NARROW : HEADER_UNITS_WIDE,
      ),
    [view.sectors, aspect, narrow],
  )

  const sectors = useMemo(() => new Map(view.sectors.map((s) => [s.code, s])), [view.sectors])

  return (
    <div
      ref={ref}
      className="sf-treemap"
      style={{ aspectRatio: String(aspect) }}
      role="group"
      aria-label="類股方塊圖：面積是成交金額，紅色買超、綠色賣超，顏色越深越多"
    >
      {layout.map((t) => {
        const s = sectors.get(t.id) as ViewSector
        const wPx = (t.w / 100) * width
        const hPx = (t.h / 100) * height
        if (t.children.length === 0) {
          return (
            <Tile
              key={s.code}
              row={s}
              at={t}
              scale={view.scale}
              label={labelFor(wPx, hPx)}
              selected={selected === s.code}
              onSelect={onSelect}
            />
          )
        }
        const bodyH = Math.max(0, hPx - HEADER_PX)
        const kids = new Map(s.children.map((c) => [c.code, c]))
        return (
          <div key={s.code} className="sf-parent" style={place(t)}>
            <button
              type="button"
              className={selected === s.code ? 'sf-parent-head sf-tile-selected' : 'sf-parent-head'}
              style={{ background: tint(s.netTwd, view.scale), height: HEADER_PX }}
              aria-pressed={selected === s.code}
              aria-label={`${s.name}合計，買賣超 ${signedBillion(s.netTwd)}`}
              onClick={() => onSelect(s.code)}
            >
              <span className="sf-tile-name">{s.name}</span>
              <span className="sf-tile-figure">{signedBillion(s.netTwd)}</span>
            </button>
            <div className="sf-parent-body" style={{ top: HEADER_PX }}>
              {t.children.map((c) => {
                const row = kids.get(c.id)!
                return (
                  <Tile
                    key={c.id}
                    row={row}
                    at={c}
                    scale={view.scale}
                    label={labelFor((c.w / 100) * wPx, (c.h / 100) * bodyH)}
                    selected={selected === c.id}
                    onSelect={onSelect}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
