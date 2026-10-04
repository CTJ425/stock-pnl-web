/**
 * What one sector did, in plain words and four numbers. With nothing selected it says how to read
 * the picture instead, so the panel is never empty.
 */
import { chipClass } from '../StockDetail/chipFormat'
import { fmtBillion, toBillion } from '../../utils/formatters'
import { leadClause, signedBillion as signed, toneOf, windowLabel, type ViewRow } from './sectorFlowView'

interface Props {
  row: ViewRow | null
  /** Dates the figures cover, for the subtitle. */
  dates: string[]
  onClear: () => void
}

/** "法人合計賣超 69.9 億，主要是外資賣超 77.3 億。" */
function sentence(row: ViewRow): string {
  const total = row.groups.totalTwd
  const lead = leadClause(row.groups)
  if (Math.abs(toBillion(total) ?? 0) < 0.05) return '法人合計幾乎沒有買賣超。'
  const head = `法人合計${total > 0 ? '買超' : '賣超'} ${fmtBillion(toBillion(Math.abs(total)))}`
  return lead ? `${head}，主要是${lead}。` : `${head}。`
}

export function SectorDetail({ row, dates, onClear }: Props) {
  if (!row) {
    return (
      <aside className="sf-detail" aria-label="類股細節">
        <p className="sf-detail-guide">點任一個方塊，看那個產業的外資、投信、自營商各買賣了多少，以及主力個股。</p>
        <p className="hint">方塊越大，代表那個產業當天成交越多；紅色是法人買超，綠色是賣超。</p>
      </aside>
    )
  }

  const { groups } = row
  const lines: Array<[string, number]> = [
    ['外資', groups.foreignTwd],
    ['投信', groups.trustTwd],
    ['自營商', groups.dealerTwd],
    ['合計', groups.totalTwd],
  ]
  return (
    <aside className="sf-detail" aria-label="類股細節" aria-live="polite">
      <div className="sf-detail-head">
        <h3 className="sf-detail-title">{row.name}</h3>
        <button type="button" className="btn btn-sm" onClick={onClear}>
          取消選取
        </button>
      </div>
      <p className="hint sf-detail-sub">{windowLabel(dates)}</p>
      <p className="sf-detail-sentence">{sentence(row)}</p>

      <dl className="sf-detail-groups">
        {lines.map(([label, v]) => (
          <div key={label} className={label === '合計' ? 'sf-detail-total' : undefined}>
            <dt>{label}</dt>
            <dd className={chipClass(toneOf(v))}>{signed(v)}</dd>
          </div>
        ))}
      </dl>

      <p className="hint">
        成交 {fmtBillion(toBillion(row.turnoverTwd))}
        {row.turnoverShare !== null ? `，佔全市場 ${(row.turnoverShare * 100).toFixed(1)}%` : ''}
      </p>

      {row.movers ? (
        <div className="sf-detail-movers">
          <h4>{row.movers.side === 'buy' ? '買超主力' : '賣超主力'}</h4>
          <ul>
            {row.movers.stocks.map((s) => (
              <li key={s.ticker}>
                <span>
                  {s.name} <span className="hint">{s.ticker}</span>
                </span>
                <span className={chipClass(s.netTwd)}>{signed(s.netTwd)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : dates.length > 1 ? (
        <p className="hint">個股只列單日的主力，切回「今日」就會看到。</p>
      ) : null}
    </aside>
  )
}
