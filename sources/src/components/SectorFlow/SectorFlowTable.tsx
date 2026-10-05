/**
 * The numbers behind the treemap: every sector with its signed 億 figure and its share of the
 * market's turnover. Pressing a sector's name opens its detail right under the row, the same detail
 * a tile opens beside the map. It is the complete, screen-reader-friendly version of the treemap, so
 * nothing is only in the picture.
 *
 * Shows the biggest buyers and sellers (and 半導體, always) first; the rest on request.
 */
import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { chipClass } from '../StockDetail/chipFormat'
import { signedBillion as signed, toneOf, type FlowView, type ViewRow } from './sectorFlowView'

/** Rows shown from each end of the ranking before "顯示全部". */
const VISIBLE_EACH_SIDE = 8
const SEMICONDUCTOR = '24'

const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`)

interface Props {
  view: FlowView
  selected: string | null
  /** Whether a picked sector opens here (otherwise it opens beside the treemap). */
  detailHere: boolean
  onSelect: (code: string) => void
  renderDetail: (code: string) => ReactNode
}

export function SectorFlowTable({ view, selected, detailHere, onSelect, renderDetail }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [semiOpen, setSemiOpen] = useState(true)

  const sectors = view.sectors
  const inShortList = (s: ViewRow, i: number) =>
    i < VISIBLE_EACH_SIDE || i >= sectors.length - VISIBLE_EACH_SIDE || s.code === SEMICONDUCTOR
  const shown = showAll ? sectors : sectors.filter(inShortList)

  // A link can point at a sector the short list leaves out, or at a semiconductor part under a folded
  // parent. The detail has to open where the reader can see it, so those rows are shown.
  const target = detailHere ? selected : null
  const hiddenByList = target !== null && !sectors.some((s, i) => inShortList(s, i) && (s.code === target || s.children.some((c) => c.code === target)))
  const hiddenByFold = target !== null && sectors.some((s) => s.children.some((c) => c.code === target))
  useEffect(() => {
    if (hiddenByList && target !== null && sectors.some((s) => s.code === target)) setShowAll(true)
  }, [hiddenByList, target, sectors])
  useEffect(() => {
    if (hiddenByFold) setSemiOpen(true)
  }, [hiddenByFold])

  const line = (r: ViewRow, child: boolean, toggle?: ReactNode) => {
    const open = detailHere && selected === r.code
    return (
      <Fragment key={r.code}>
        <tr className={[child ? 'sf-child' : '', open ? 'sf-row-selected' : ''].filter(Boolean).join(' ') || undefined}>
          <td role="rowheader" className="sf-name">
            {toggle}
            <button type="button" className="sf-name-btn" aria-expanded={open} onClick={() => onSelect(r.code)}>
              {r.name}
            </button>
          </td>
          <td className={`num ${chipClass(toneOf(r.netTwd))}`}>{signed(r.netTwd)}</td>
          <td className="num sf-share">{pct(r.turnoverShare)}</td>
        </tr>
        {open && (
          <tr className="sf-detail-row">
            <td colSpan={3}>{renderDetail(r.code)}</td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <>
      <div className="table-scroll" style={{ marginTop: 10 }}>
        <table className="data-table sector-flow-table" aria-label="類股資金流向">
          <thead>
            <tr>
              <th scope="col">類股</th>
              <th scope="col" className="num">
                買賣超
              </th>
              <th scope="col" className="num sf-share">
                佔成交
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const hasChildren = s.children.length > 0
              return (
                <Fragment key={s.code}>
                  {line(
                    s,
                    false,
                    hasChildren ? (
                      <button
                        type="button"
                        className="sf-toggle"
                        aria-expanded={semiOpen}
                        aria-label={`${semiOpen ? '收合' : '展開'}${s.name}細分`}
                        onClick={() => setSemiOpen((o) => !o)}
                      >
                        {semiOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                      </button>
                    ) : undefined,
                  )}
                  {hasChildren && semiOpen && s.children.map((c) => line(c, true))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {sectors.length > shown.length || showAll ? (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAll((a) => !a)}>
          {showAll ? '只看買賣超最多與最少的類股' : `顯示全部 ${sectors.length} 類股`}
        </button>
      ) : null}
    </>
  )
}
