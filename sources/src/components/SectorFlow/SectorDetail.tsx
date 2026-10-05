/**
 * What one sector did, opened where it was picked (beside the treemap, or under a row of the
 * table): one plain sentence, the four investor figures, its share of the market, and the five
 * biggest buyers or sellers behind the number.
 *
 * Which side's stocks it lists follows the sign of the figure on screen: a sector that bought lists
 * its buyers, one that sold lists its sellers. The ranking follows the investor group chosen on the
 * page, so 外資 names the stocks 外資 traded, not the stocks all three traded together.
 */
import { chipClass } from '../StockDetail/chipFormat'
import { fmtBillion, toBillion } from '../../utils/formatters'
import { METRIC_LABEL, leadClause, signedBillion as signed, toneOf, windowLabel, type Metric, type ViewRow } from './sectorFlowView'

interface Props {
  row: ViewRow
  /** Dates the figures cover. */
  dates: string[]
  metric: Metric
}

/** "法人合計賣超 69.9 億，主要是外資賣超 77.3 億。" */
function sentence(row: ViewRow): string {
  const total = row.groups.totalTwd
  const lead = leadClause(row.groups)
  if (Math.abs(toBillion(total) ?? 0) < 0.05) return '法人合計幾乎沒有買賣超。'
  const head = `法人合計${total > 0 ? '買超' : '賣超'} ${fmtBillion(toBillion(Math.abs(total)))}`
  return lead ? `${head}，主要是${lead}。` : `${head}。`
}

export function SectorDetail({ row, dates, metric }: Props) {
  const { groups } = row
  const lines: Array<[string, number]> = [
    ['外資', groups.foreignTwd],
    ['投信', groups.trustTwd],
    ['自營商', groups.dealerTwd],
    ['合計', groups.totalTwd],
  ]
  const side = row.netTwd >= 0 ? 'buy' : 'sell'
  const list = row.movers ? row.movers[side] : []
  const who = metric === 'total' ? '' : METRIC_LABEL[metric]
  const title = `${who}${side === 'buy' ? '買超' : '賣超'}主力前 ${list.length}`

  return (
    <div className="sf-detail" role="group" aria-label={`${row.name}細節`}>
      {dates.length > 1 && <p className="hint sf-detail-sub">{windowLabel(dates)}</p>}
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

      {list.length > 0 ? (
        <div className="sf-detail-movers">
          <h4>
            {title}
            <span className="sf-detail-basis">{metric === 'total' ? '依三大法人合計排名' : `依${METRIC_LABEL[metric]}排名`}</span>
          </h4>
          <ul>
            {list.map((s) => (
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
      ) : metric !== 'total' ? (
        <p className="hint">這份資料還沒有{METRIC_LABEL[metric]}各自的個股排名，下一輪盤後更新後就會有。</p>
      ) : null}
    </div>
  )
}
