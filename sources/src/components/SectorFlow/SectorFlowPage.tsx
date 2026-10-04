/**
 * 資金流向: which industries the three institutional investors (外資、投信、自營商) bought and sold,
 * from the after-hours file `market/sector_flow.json`.
 *
 * Top to bottom: the day's net in one figure with the two totals beside it, then two rings — where
 * the buying went and where the selling came from, each its own 100% — then, folded away, the
 * treemap (how big each sector is, with a detail panel) and the full numbers. The selected sector
 * lives in the URL (`#/sector-flow/24`), so a link opens the page with that sector already picked.
 * Selecting replaces the URL instead of pushing, so the back button leaves the page rather than
 * stepping through every tile the reader touched.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSectorFlow, type SectorFlowData } from '../../services/sectorFlowProxy'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'
import { formatViewHash } from '../viewRoute'
import { buildSides } from './flowSides'
import { SectorDetail } from './SectorDetail'
import { SectorFlowTable } from './SectorFlowTable'
import { SectorSides } from './SectorSides'
import { SectorTreemap } from './SectorTreemap'
import {
  METRIC_LABEL,
  WEEK_DAYS,
  buildView,
  reconciliationGap,
  signedBillion as signed,
  toneOf,
  windowLabel,
  type Metric,
  type Range,
  type ViewRow,
} from './sectorFlowView'

const METRICS: Metric[] = ['total', 'foreign', 'trust', 'dealer']
const NARROW_QUERY = '(max-width: 720px)'

/** Put the picked sector (or none) in the address bar without adding a history entry. */
function writeSelectionToUrl(code: string | null) {
  const hash = formatViewHash({ view: 'sector-flow', ticker: code ?? undefined })
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
}

function Legend() {
  return (
    <ul className="sf-legend" aria-label="圖例">
      <li>
        <span className="sf-swatch sf-swatch-buy" aria-hidden="true" />
        紅色：法人買超
      </li>
      <li>
        <span className="sf-swatch sf-swatch-sell" aria-hidden="true" />
        綠色：法人賣超
      </li>
      <li>顏色越深，買賣越多</li>
      <li>方塊越大，成交越多</li>
    </ul>
  )
}

export function SectorFlowPage({ focus }: { focus?: string }) {
  const [data, setData] = useState<SectorFlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  /** A file came back but no day in it passed the checks, distinct from "no file yet". */
  const [invalid, setInvalid] = useState(false)
  const [range, setRange] = useState<Range>('day')
  const [metric, setMetric] = useState<Metric>('total')
  const [selected, setSelected] = useState<string | null>(focus ?? null)
  // A link to a sector opens the treemap it points into; otherwise it stays folded away.
  const [treemapOpen, setTreemapOpen] = useState(Boolean(focus))
  const narrow = useMediaQuery(NARROW_QUERY)
  const detailRef = useRef<HTMLDivElement | null>(null)

  // A pasted link or the back/forward buttons change the route's argument from outside.
  useEffect(() => {
    setSelected(focus ?? null)
    if (focus) setTreemapOpen(true)
  }, [focus])

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
  const sides = useMemo(() => (view ? buildSides(view) : null), [view])
  const canWeek = (data?.days.length ?? 0) >= 2

  const rows = useMemo(() => {
    const m = new Map<string, ViewRow>()
    for (const s of view?.sectors ?? []) {
      m.set(s.code, s)
      for (const c of s.children) m.set(c.code, c)
    }
    return m
  }, [view])
  // A code from a stale link that this file does not have is ignored, not shown as an error.
  const picked = selected !== null ? (rows.get(selected) ?? null) : null

  const select = (code: string | null) => {
    setSelected(code)
    writeSelectionToUrl(code)
    // Stacked under the picture on a phone: bring the panel into view so the tap visibly did something.
    if (code && narrow) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }))
    }
  }
  const gap = view?.reconciliation ? reconciliationGap(view.reconciliation) : null
  const who = metric === 'total' ? '三大法人合計' : METRIC_LABEL[metric]

  return (
    <div className="section glass sf-page">
      <div className="rpt-section-head">
        <h2 className="head-tight sf-title">類股資金流向</h2>
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
      ) : !view || !sides ? (
        <p className="hint" style={{ marginTop: 8 }}>
          尚無類股資金流向資料，盤後三大法人資料公布後會自動產生。
        </p>
      ) : (
        <>
          <div className="sf-strip">
            <div className="sf-strip-lead">
              <div className="sf-strip-label">
                {windowLabel(view.dates)}　{who}
                {sides.netTwd >= 0 ? '淨買超' : '淨賣超'}
              </div>
              <div className={`sf-hero ${chipClass(toneOf(sides.netTwd))}`}>{signed(sides.netTwd)}</div>
              <p className="sf-strip-note">買進的產業減掉賣出的產業</p>
            </div>
            <div className="sf-strip-cell">
              <div className="sf-strip-label">買進的產業</div>
              <div className={`sf-figure ${chipClass(sides.buy.totalTwd)}`}>{signed(sides.buy.totalTwd)}</div>
              <p className="sf-strip-note">共 {sides.buy.count} 個類股</p>
            </div>
            <div className="sf-strip-cell">
              <div className="sf-strip-label">賣出的產業</div>
              <div className={`sf-figure ${chipClass(sides.sell.totalTwd)}`}>{signed(sides.sell.totalTwd)}</div>
              <p className="sf-strip-note">共 {sides.sell.count} 個類股</p>
            </div>
          </div>

          <SectorSides sides={sides} />

          <details
            className="chart-more sf-fold"
            open={treemapOpen}
            onToggle={(e) => setTreemapOpen(e.currentTarget.open)}
          >
            <summary>看方塊圖：各產業有多大</summary>
            <Legend />
            <div className="sf-stage">
              <SectorTreemap
                view={view}
                selected={picked ? picked.code : null}
                narrow={narrow}
                onSelect={(code) => select(code === selected ? null : code)}
              />
              <div ref={detailRef}>
                <SectorDetail row={picked} dates={view.dates} onClear={() => select(null)} />
              </div>
            </div>
          </details>

          <details className="chart-more sf-fold">
            <summary>看詳細數字</summary>
            <SectorFlowTable view={view} selected={picked ? picked.code : null} />
          </details>

          <p className="hint">
            金額是「法人買賣超股數 × 當日均價（成交金額 ÷ 成交股數）」的估算，單位億元。左右兩個圓各自是 100%：左邊只看買超的產業，右邊只看賣超的產業，兩邊的總額不同；這兩個圖不表示資金從賣出的產業轉到買進的產業。
            {view.allOtc ? '涵蓋上市與上櫃。' : '部分日期只含上市（當時上櫃資料還沒公布）。'}
            半導體拆成 IC 設計、晶圓製造、封裝測試、設備材料與其他四塊計算（依櫃買中心產業價值鏈歸類），所以 IC 設計的賣壓不會被半導體合計蓋住；ETF 與受益證券另列。
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
