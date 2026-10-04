/**
 * 錢進了哪些產業／錢出了哪些產業: two rings, each its own 100%. A ring only shows the biggest five
 * of its side and folds the rest into 其他, and the numerals around it match the numbered list beside
 * it, so which slice is which never depends on telling two reds apart.
 */
import { chipClass } from '../StockDetail/chipFormat'
import { RING, rankPosition, ringArcs, type FlowSide, type FlowSides } from './flowSides'
import { signedBillion } from './sectorFlowView'

type Kind = 'buy' | 'sell'

/** Minimum arc left visible as a gap between slices, in px along the ring. */
const GAP_PX = 2.5
const CIRCUMFERENCE = 2 * Math.PI * RING.radius

const pct = (share: number) => `${(share * 100).toFixed(1)}%`

/** Slices alternate between a deep and a soft tone so neighbours differ in lightness; 其他 is neutral. */
const toneOf = (i: number, other: boolean) => (other ? 'other' : i % 2 === 0 ? 'deep' : 'soft')

interface PanelProps {
  kind: Kind
  title: string
  side: FlowSide
  /** "買進合計" / "賣出合計" */
  totalLabel: string
  emptyText: string
}

function SidePanel({ kind, title, side, totalLabel, emptyText }: PanelProps) {
  const arcs = ringArcs(side.slices)
  const total = signedBillion(side.totalTwd)
  return (
    <section className="sf-panel" aria-label={title}>
      <h3 className="sf-panel-title">{title}</h3>
      {side.slices.length === 0 ? (
        <p className="hint">{emptyText}</p>
      ) : (
        <>
          <p className="hint sf-panel-sub">每一塊是佔{kind === 'buy' ? '買進' : '賣出'} {total}的比例</p>
          <div className="sf-panel-body">
            <div className="sf-ring" style={{ width: RING.size, height: RING.size }}>
              <svg width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`} aria-hidden="true">
                {side.slices.map((s, i) => {
                  const len = (arcs[i].sweep / 360) * CIRCUMFERENCE
                  const dash = Math.max(len - GAP_PX, 0.5)
                  return (
                    <circle
                      key={s.code}
                      className={`sf-slice sf-slice-${kind}-${toneOf(i, s.other)}`}
                      cx={RING.center}
                      cy={RING.center}
                      r={RING.radius}
                      fill="none"
                      strokeWidth={RING.stroke}
                      strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                      strokeDashoffset={-(arcs[i].start / 360) * CIRCUMFERENCE}
                      transform={`rotate(-90 ${RING.center} ${RING.center})`}
                    />
                  )
                })}
              </svg>
              <div className="sf-ring-center">
                <span className="sf-ring-label">{totalLabel}</span>
                <span className={`sf-ring-total ${chipClass(side.totalTwd)}`}>{total}</span>
              </div>
              {side.slices.map((s, i) => {
                if (s.other) return null
                const { left, top } = rankPosition(arcs[i].mid)
                return (
                  <span key={s.code} className="sf-rank" style={{ left, top }} aria-hidden="true">
                    {i + 1}
                  </span>
                )
              })}
            </div>

            <ul className="sf-side-list" aria-label={`${title}，前 ${side.slices.filter((s) => !s.other).length} 名`}>
              {side.slices.map((s, i) => (
                <li key={s.code}>
                  <span className={`sf-swatch-box sf-slice-${kind}-${toneOf(i, s.other)}`} aria-hidden="true" />
                  <span className="sf-side-rank">{s.other ? '' : i + 1}</span>
                  <span className="sf-side-name">
                    {s.name}
                    {s.semiconductor && <span className="sf-tag">半導體</span>}
                  </span>
                  <span className="sf-side-share">{pct(s.share)}</span>
                  <span className={`sf-side-amount ${chipClass(s.netTwd)}`}>{signedBillion(s.netTwd)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

export function SectorSides({ sides }: { sides: FlowSides }) {
  return (
    <div className="sf-sides">
      <SidePanel
        kind="buy"
        title="錢進了哪些產業"
        side={sides.buy}
        totalLabel="買進合計"
        emptyText="這段期間沒有買超的類股。"
      />
      <SidePanel
        kind="sell"
        title="錢出了哪些產業"
        side={sides.sell}
        totalLabel="賣出合計"
        emptyText="這段期間沒有賣超的類股。"
      />
    </div>
  )
}
