/**
 * 資金流向: which industries the three institutional investors (外資、投信、自營商) bought and sold,
 * from the after-hours file `market/sector_flow.json`.
 *
 * Top to bottom: the day's net in one figure with the two totals beside it, then two rings — where
 * the buying went and where the selling came from, each its own 100% — and, folded away, the full
 * table. Picking a ring slice, a legend row or a table row opens that sector's detail in place, under
 * the thing that was picked. The picked sector lives in the URL (`#/sector-flow/24`), so a link opens
 * the page with that sector already open. Picking replaces the URL instead of pushing, so the back
 * button leaves the page rather than stepping through every row the reader touched.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchSectorFlow, type SectorFlowData } from '../../services/sectorFlowProxy'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'
import { formatViewHash } from '../viewRoute'
import { buildSides } from './flowSides'
import { SectorDetail } from './SectorDetail'
import { SectorFlowTable } from './SectorFlowTable'
import { SectorSides } from './SectorSides'
import {
  METRIC_LABEL,
  RANGES,
  RANGE_DAYS,
  RANGE_LABEL,
  buildView,
  rangeHint,
  reconciliationGap,
  signedBillion as signed,
  toneOf,
  windowLabel,
  type Metric,
  type Range,
  type ViewRow,
} from './sectorFlowView'

const METRICS: Metric[] = ['total', 'foreign', 'trust', 'dealer']

/** Where a picked sector's detail opens: under a ring's legend row, or under a table row. */
type Origin = 'ring' | 'table'

/** Put the picked sector (or none) in the address bar without adding a history entry. */
function writeSelectionToUrl(code: string | null) {
  // 其他 is not a sector: it has no link of its own.
  const hash = formatViewHash({ view: 'sector-flow', ticker: code && !code.startsWith('other:') ? code : undefined })
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
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
  /** Set by a press; a sector arriving from a link has none and is placed by `detailIn` below. */
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [tableOpen, setTableOpen] = useState(false)

  // A pasted link or the back/forward buttons change the route's argument from outside.
  useEffect(() => {
    setSelected(focus ?? null)
    setOrigin(null)
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
  const dayCount = data?.days.length ?? 0
  const hint = data ? rangeHint(dayCount) : null

  const rows = useMemo(() => {
    const m = new Map<string, ViewRow>()
    for (const s of view?.sectors ?? []) {
      m.set(s.code, s)
      for (const c of s.children) m.set(c.code, c)
    }
    return m
  }, [view])
  /** The codes that have a row in a legend, i.e. the named slices of either ring. */
  const ringCodes = useMemo(
    () => new Set([...(sides?.buy.slices ?? []), ...(sides?.sell.slices ?? [])].filter((s) => !s.other).map((s) => s.code)),
    [sides],
  )

  // A code from a stale link that this file does not have is ignored, not shown as an error.
  const isOther = selected !== null && selected.startsWith('other:')
  const picked = selected !== null && !isOther ? (rows.get(selected) ?? null) : null
  const sectorPicked = picked !== null
  /** Under a ring when pressed there (or linked to a named slice); otherwise in the table. */
  const detailIn: Origin | null = !sectorPicked
    ? null
    : origin ?? (ringCodes.has(picked.code) ? 'ring' : 'table')

  // A sector that opens in the table needs the table open.
  useEffect(() => {
    if (detailIn === 'table') setTableOpen(true)
  }, [detailIn])

  const pick = (code: string, from: Origin) => {
    const next = code === selected && (origin ?? (ringCodes.has(code) ? 'ring' : 'table')) === from ? null : code
    setSelected(next)
    setOrigin(next === null ? null : from)
    writeSelectionToUrl(next)
  }

  const renderDetail = (code: string) => {
    const row = rows.get(code)
    return row && view ? <SectorDetail row={row} dates={view.dates} metric={metric} /> : null
  }

  const gap = view?.reconciliation ? reconciliationGap(view.reconciliation) : null
  const who = metric === 'total' ? '三大法人合計' : METRIC_LABEL[metric]

  return (
    <div className="section glass sf-page">
      <div className="rpt-section-head">
        <h2 className="head-tight sf-title">類股資金流向</h2>
        {data && <span className="source-tag section-stamp">資料更新於 {fmtUpdatedAt(data.asOf)}</span>}
        <div className="inst-metric-seg" role="group" aria-label="切換期間">
          {RANGES.map((r) => {
            const enough = dayCount >= RANGE_DAYS[r]
            return (
              <button
                key={r}
                type="button"
                className="btn btn-sm"
                aria-pressed={range === r}
                disabled={!enough}
                title={enough ? undefined : `資料累積中：目前 ${dayCount} 天，${RANGE_LABEL[r]}需要 ${RANGE_DAYS[r]} 天`}
                onClick={() => setRange(r)}
              >
                {RANGE_LABEL[r]}
              </button>
            )
          })}
        </div>
        <div className="inst-metric-seg" role="group" aria-label="切換法人">
          {METRICS.map((m) => (
            <button key={m} type="button" className="btn btn-sm" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {hint && <p className="hint sf-range-hint">{hint}</p>}

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

          <SectorSides
            sides={sides}
            selected={isOther ? selected : sectorPicked && detailIn === 'ring' ? picked.code : null}
            detailHere={detailIn === 'ring'}
            onSelect={(code) => pick(code, 'ring')}
            renderDetail={renderDetail}
          />

          <details
            className="chart-more sf-fold"
            open={tableOpen}
            onToggle={(e) => setTableOpen(e.currentTarget.open)}
          >
            <summary>看詳細數字</summary>
            <p className="hint sf-table-hint">點類股名稱，看那個產業的細節。</p>
            <SectorFlowTable
              view={view}
              selected={sectorPicked && detailIn === 'table' ? picked.code : null}
              detailHere={detailIn === 'table'}
              onSelect={(code) => pick(code, 'table')}
              renderDetail={renderDetail}
            />
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

