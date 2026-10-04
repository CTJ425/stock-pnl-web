/**
 * 類股資金流向: which industries the three institutional investors (外資、投信、自營商) bought and
 * sold, in 億元, from the after-hours file `market/sector_flow.json`.
 *
 * Fetches its own file (no props) like ForeignTopSection, so mounting it in TwMarketSection costs an
 * import and one JSX line.
 *
 * The first thing on the card is the answer in words; the table underneath is the evidence. 半導體 is
 * open by default because its split (IC 設計 / 晶圓製造 / 封裝測試) is the question the card exists for.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { fetchSectorFlow, type SectorFlowData } from '../../services/sectorFlowProxy'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'
import {
  METRIC_LABEL,
  WEEK_DAYS,
  buildView,
  reconciliationGap,
  signedBillion as signed,
  summarize,
  toneOf,
  type Metric,
  type Range,
  type ViewRow,
} from './sectorFlowView'

/** Rows shown from each end of the ranking before "顯示全部". */
const VISIBLE_EACH_SIDE = 8
const SEMICONDUCTOR = '24'
const METRICS: Metric[] = ['total', 'foreign', 'trust', 'dealer']

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

export function SectorFlowSection() {
  const [data, setData] = useState<SectorFlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  /** A file came back but no day in it passed the checks, distinct from "no file yet". */
  const [invalid, setInvalid] = useState(false)
  const [range, setRange] = useState<Range>('day')
  const [metric, setMetric] = useState<Metric>('total')
  const [showAll, setShowAll] = useState(false)
  const [semiOpen, setSemiOpen] = useState(true)

  useEffect(() => {
    let alive = true
    fetchSectorFlow()
      .then((result) => {
        if (!alive) return
        setData(result.kind === 'ok' ? result.data : null)
        setInvalid(result.kind === 'invalid')
      })
      .catch(() => {
        if (alive) setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const view = useMemo(() => (data ? buildView(data.days, range, metric) : null), [data, range, metric])
  const summary = useMemo(() => (view ? summarize(view, metric) : []), [view, metric])
  const canWeek = (data?.days.length ?? 0) >= 2

  const sectors = view?.sectors ?? []
  const shown = showAll
    ? sectors
    : sectors.filter((s, i) => i < VISIBLE_EACH_SIDE || i >= sectors.length - VISIBLE_EACH_SIDE || s.code === SEMICONDUCTOR)
  const gap = view?.reconciliation ? reconciliationGap(view.reconciliation) : null

  return (
    <div className="section glass" style={{ padding: '18px 20px', marginTop: 18 }}>
      <div className="rpt-section-head">
        <h3 className="head-tight">類股資金流向</h3>
        {data && <span className="source-tag section-stamp">資料更新於 {fmtUpdatedAt(data.asOf)}</span>}
        <div className="inst-metric-seg" role="group" aria-label="切換期間">
          <button type="button" className="btn btn-sm" aria-pressed={range === 'day'} onClick={() => setRange('day')}>
            今日
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={range === 'week'}
            disabled={!canWeek}
            onClick={() => setRange('week')}
          >
            近 {WEEK_DAYS} 日
          </button>
        </div>
        <div className="inst-metric-seg" role="group" aria-label="切換法人">
          {METRICS.map((m) => (
            <button key={m} type="button" className="btn btn-sm" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="hint" style={{ marginTop: 8 }}>
          正在讀取類股資金流向…
        </p>
      ) : error ? (
        <div className="notice notice-error" style={{ marginTop: 8 }}>
          讀取類股資金流向失敗，請稍後重新整理。
        </div>
      ) : invalid ? (
        <p className="hint" style={{ marginTop: 8 }}>
          資料格式不符，無法顯示
        </p>
      ) : !view ? (
        <p className="hint" style={{ marginTop: 8 }}>
          尚無類股資金流向資料，盤後三大法人資料公布後會自動產生。
        </p>
      ) : (
        <>
          <div className="sf-summary" aria-live="polite">
            {summary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

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
                      <tr>
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
                          <tr key={c.code} className="sf-child">
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

          <p className="hint">
            金額是「法人買賣超股數 × 當日均價（成交金額 ÷ 成交股數）」的估算，單位億元；紅色為買超、綠色為賣超，「佔成交」是該類股成交金額佔全市場的比例。
            {view.allOtc ? '涵蓋上市與上櫃。' : '部分日期只含上市（當時上櫃資料還沒公布）。'}
            ETF 與受益證券另列一行；半導體細分依櫃買中心產業價值鏈歸類，沒列在其中的歸「設備、材料與其他」。
          </p>
          {view.reconciliation && (
            <p className="hint">
              上市部分估算合計 {signed(view.reconciliation.estimateTwd)}，證交所公布 {signed(view.reconciliation.officialTwd)}
              {gap ? `（${gap}）` : ''}。
            </p>
          )}
        </>
      )}
    </div>
  )
}
