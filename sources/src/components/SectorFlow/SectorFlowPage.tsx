/**
 * 資金流向: which industries the three institutional investors (外資、投信、自營商) bought and sold,
 * from the after-hours file `market/sector_flow.json`.
 *
 * Top to bottom: the day's net on one line, a treemap (one tile per industry, area = turnover, colour =
 * what the institutions did there) with the picked industry's detail beside it, and — folded away —
 * the full table. A tile opens the detail beside the map (under it on a phone); a table row opens it
 * under that row. One industry is open at a time. The picked industry lives in the URL
 * (`#/sector-flow/24`), so a link opens the page with it already open. Picking replaces the URL instead
 * of pushing, so the back button leaves the page rather than stepping through every tile touched.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { fetchSectorFlow, type SectorFlowData } from '../../services/sectorFlowProxy'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { chipClass, fmtUpdatedAt } from '../StockDetail/chipFormat'
import { formatViewHash } from '../viewRoute'
import { SectorDetail } from './SectorDetail'
import { SectorFlowTable } from './SectorFlowTable'
import { SectorTreemap } from './SectorTreemap'
import {
  METRIC_LABEL,
  RANGES,
  RANGE_DAYS,
  RANGE_LABEL,
  buildView,
  rangeHint,
  reconciliationGap,
  sideTotals,
  signedBillion as signed,
  toneOf,
  windowLabel,
  type Metric,
  type Range,
  type ViewRow,
} from './sectorFlowView'

const METRICS: Metric[] = ['total', 'foreign', 'trust', 'dealer']

/** Where a picked sector's detail opens: beside (or under) the treemap, or under a table row. */
type Origin = 'map' | 'table'

/** Put the picked sector (or none) in the address bar without adding a history entry. */
function writeSelectionToUrl(code: string | null) {
  const hash = formatViewHash({ view: 'sector-flow', ticker: code ?? undefined })
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
  const narrow = useMediaQuery('(max-width: 720px)')
  const detailRef = useRef<HTMLElement | null>(null)

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
  const totals = useMemo(() => (view ? sideTotals(view) : null), [view])
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
  /** The codes that have a tile: a sector with no turnover in the window is left off the map. */
  const mapCodes = useMemo(() => new Set([...rows.values()].filter((r) => r.turnoverTwd > 0).map((r) => r.code)), [rows])

  // A code from a stale link that this file does not have is ignored, not shown as an error.
  const picked = selected !== null ? (rows.get(selected) ?? null) : null
  const defaultOrigin = (code: string): Origin => (mapCodes.has(code) ? 'map' : 'table')
  const detailIn: Origin | null = picked === null ? null : (origin ?? defaultOrigin(picked.code))

  // A sector that opens in the table needs the table open.
  useEffect(() => {
    if (detailIn === 'table') setTableOpen(true)
  }, [detailIn])

  const pick = (code: string, from: Origin) => {
    const next = code === selected && (origin ?? defaultOrigin(code)) === from ? null : code
    setSelected(next)
    setOrigin(next === null ? null : from)
    writeSelectionToUrl(next)
    // The detail sits under the map on a phone, possibly below the fold: bring it into view.
    if (next !== null && from === 'map') {
      requestAnimationFrame(() => {
        const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        detailRef.current?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'nearest' })
      })
    }
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
      ) : !view || !totals ? (
        <p className="hint" style={{ marginTop: 8 }}>
          尚無類股資金流向資料，盤後三大法人資料公布後會自動產生。
        </p>
      ) : (
        <>
          <div className="sf-summary">
            <div className="sf-summary-net">
              <span className="sf-summary-label">
                {windowLabel(view.dates)}　{who}
                {totals.netTwd >= 0 ? '淨買超' : '淨賣超'}
              </span>
              <strong className={`sf-summary-figure ${chipClass(toneOf(totals.netTwd))}`}>{signed(totals.netTwd)}</strong>
            </div>
            <p className="sf-summary-sides">
              買進的產業 <span className={chipClass(totals.buyTwd)}>{signed(totals.buyTwd)}</span>（{totals.buyCount} 個類股）
              <span className="sf-summary-gap" aria-hidden="true" />
              賣出的產業 <span className={chipClass(totals.sellTwd)}>{signed(totals.sellTwd)}</span>（{totals.sellCount} 個類股）
            </p>
          </div>

          <ul className="sf-legend" aria-label="怎麼看方塊圖">
            <li>一塊是一個類股，面積是成交金額</li>
            <li>
              <span className="sf-swatch sf-swatch-buy" aria-hidden="true" />
              紅色：買超
            </li>
            <li>
              <span className="sf-swatch sf-swatch-sell" aria-hidden="true" />
              綠色：賣超
            </li>
            <li>顏色越深，買賣越多</li>
            <li>點一塊看細節</li>
          </ul>

          <div className="sf-stage">
            <SectorTreemap
              view={view}
              selected={picked?.code ?? null}
              onSelect={(code) => pick(code, 'map')}
              narrow={narrow}
            />
            <aside
              className={detailIn === 'map' ? 'sf-aside' : 'sf-aside sf-aside-empty'}
              ref={detailRef}
              aria-label="類股細節"
            >
              {detailIn === 'map' && picked ? (
                <>
                  <div className="sf-aside-head">
                    <h3>{picked.name}</h3>
                    <button
                      type="button"
                      className="sf-close"
                      aria-label={`關閉${picked.name}細節`}
                      onClick={() => pick(picked.code, 'map')}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                  {renderDetail(picked.code)}
                </>
              ) : (
                <p className="hint">點一塊方塊，看那個類股的法人買賣與主力個股。</p>
              )}
            </aside>
          </div>

          <details
            className="chart-more sf-fold"
            open={tableOpen}
            onToggle={(e) => setTableOpen(e.currentTarget.open)}
          >
            <summary>看詳細數字</summary>
            <p className="hint sf-table-hint">點類股名稱，看那個產業的細節。</p>
            <SectorFlowTable
              view={view}
              selected={picked !== null && detailIn === 'table' ? picked.code : null}
              detailHere={detailIn === 'table'}
              onSelect={(code) => pick(code, 'table')}
              renderDetail={renderDetail}
            />
          </details>

          <p className="hint">
            金額是「法人買賣超股數 × 當日均價（成交金額 ÷ 成交股數）」的估算，單位億元。買進與賣出的產業各自加總，兩邊的總額不同；方塊圖不表示資金從賣出的產業轉到買進的產業。
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
