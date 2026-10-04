/**
 * The numbers behind the picture: every sector with its signed 億 figure, a bar, its share of the
 * market's turnover and the movers behind the number. It is the complete, screen-reader-friendly
 * version of the treemap, so nothing is only in the picture.
 *
 * Shows the biggest buyers and sellers (and 半導體, always) first; the rest on request.
 */
import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { chipClass } from '../StockDetail/chipFormat'
import { signedBillion as signed, toneOf, type FlowView, type ViewRow } from './sectorFlowView'

/** Rows shown from each end of the ranking before "顯示全部". */
const VISIBLE_EACH_SIDE = 8
const SEMICONDUCTOR = '24'

const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`)

function Bar({ net, scale }: { net: number; scale: number }) {
  const width = scale > 0 ? Math.min(50, (Math.abs(net) / scale) * 50) : 0
  return (
    <td className="sf-bar-cell" aria-hidden="true">
      <div className="sf-bar">
        {net !== 0 && <span className={net > 0 ? 'sf-fill sf-buy' : 'sf-fill sf-sell'} style={{ width: `${width}%` }} />}
      </div>
    </td>
  )
}

function Movers({ row }: { row: ViewRow }) {
  if (!row.movers) return null
  return (
    <div className="sf-movers">
      {row.movers.side === 'buy' ? '買超主力' : '賣超主力'}：{row.movers.stocks.map((s) => s.name).join('、')}
    </div>
  )
}

interface Props {
  view: FlowView
  selected: string | null
}

export function SectorFlowTable({ view, selected }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [semiOpen, setSemiOpen] = useState(true)

  const sectors = view.sectors
  const shown = showAll
    ? sectors
    : sectors.filter((s, i) => i < VISIBLE_EACH_SIDE || i >= sectors.length - VISIBLE_EACH_SIDE || s.code === SEMICONDUCTOR)

  const rowClass = (code: string, extra = '') => {
    const cls = [extra, selected === code ? 'sf-row-selected' : ''].filter(Boolean).join(' ')
    return cls || undefined
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
              <th scope="col" className="sf-bar-head">
                <span className="sr-only">買賣超大小，紅色向右為買超，綠色向左為賣超</span>
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
                  <tr className={rowClass(s.code)} aria-selected={selected === s.code || undefined}>
                    <td role="rowheader" className="sf-name">
                      {hasChildren ? (
                        <button
                          type="button"
                          className="sf-toggle"
                          aria-expanded={semiOpen}
                          aria-label={`${semiOpen ? '收合' : '展開'}${s.name}細分`}
                          onClick={() => setSemiOpen((o) => !o)}
                        >
                          {semiOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                          {s.name}
                        </button>
                      ) : (
                        s.name
                      )}
                      <Movers row={s} />
                    </td>
                    <td className={`num ${chipClass(toneOf(s.netTwd))}`}>{signed(s.netTwd)}</td>
                    <Bar net={s.netTwd} scale={view.scale} />
                    <td className="num sf-share">{pct(s.turnoverShare)}</td>
                  </tr>
                  {hasChildren &&
                    semiOpen &&
                    s.children.map((c) => (
                      <tr key={c.code} className={rowClass(c.code, 'sf-child')} aria-selected={selected === c.code || undefined}>
                        <td role="rowheader" className="sf-name">
                          {c.name}
                          <Movers row={c} />
                        </td>
                        <td className={`num ${chipClass(toneOf(c.netTwd))}`}>{signed(c.netTwd)}</td>
                        <Bar net={c.netTwd} scale={view.scale} />
                        <td className="num sf-share">{pct(c.turnoverShare)}</td>
                      </tr>
                    ))}
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
