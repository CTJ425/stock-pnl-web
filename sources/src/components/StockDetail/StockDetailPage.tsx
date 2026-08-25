/**
 * Content area for individual stock analysis.
 *
 * Starting from 0.6.8, the four sections of "My Holdings/Chips/Fundamentals/Technicals" are merged into a single long page** (Type D: card grouping),
 * Only two tabs are left: "Analysis Content/AI Analysis". AI does not work together and deliberately -
 * It has an API Key input box and dialog state, and the content is triggered by buttons and is not always there.
 *
 * Each segment has a `.glass` card (`.detail-card`), and the borders are separated by the white space between cards.
 * I chose this version because it has zero interaction and no problem of "things being put away and cannot be found".
 *
 * 0.6.36 Replace "My holdings" in the first paragraph with "Quotation" (today's open high and low volume/yesterday's close/today's close).
 * The reason why stock holdings were initially excluded from the PDF capture is because they are private capital; the quotations are public market data.
 * There is no such concern, so `surfaceRef` is changed to wrap all four segments.
 *
 * This is a pure presentation component: which level to look at and where the quote comes from are all determined by the caller (AnalysisPage).
 * The selector on the left side of the page is also passed in from the caller (currently it is a drop-down menu for switching individual stocks).
 *
 * Data flow: Storage-first reads the shared report of scheduled pre-production, and then clicks and produces fallback if there is no problem.
 * Fundamentals are loaded once at this layer and distributed to three places (the industry badge of the title, the fundamentals section, and AI analysis).
 * Independent from chip reporting, failure of either does not affect the other.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import {
  fetchStoredReport,
  generateReport,
  type ReportData,
  type ReportHolding,
} from '../../services/reportProxy'
import { fetchFundamental, type FundamentalData } from '../../services/fundamentalProxy'
import { needsCoreWarm, needsHistoryWarm } from '../../services/needsFundamentalBackfill'
import { warmStockCore, warmStockHistory } from '../../services/warmStock'
import { AiTab } from './AiTab'
import { ChipsTab } from './ChipsTab'
import { FundamentalTab } from './FundamentalTab'
import { QuoteTab, quoteMeta } from './QuoteTab'
import { TechnicalTab } from './TechnicalTab'
import { WhatIfTab } from './WhatIfTab'
import { useDailySeries } from './useDailySeries'
import { buildTechnicalView } from './technicalView'
import type { PriceQuote } from '../../services/priceProxy'

export interface StockDetailTarget {
  ticker: string
  name: string
  /** Stockholding context: No longer displayed on the screen, but it will still be brought to the backend when reporting on click*/
  holding: ReportHolding | null
  /** The current price quotation is displayed on the quotation card; if it cannot be caught, it will be null.*/
  quote: PriceQuote | null
}

interface StockDetailPageProps extends StockDetailTarget {
  /** Fee-exclusive average traded price, for seeding 損益試算's buy price. Null for a watched stock. */
  rawAvgCost?: number | null
  /** Fee-inclusive average cost (庫存總覽's own cost basis), for 損益試算's real fee override. Null for a watched stock. */
  avgCost?: number | null
  /** The control items on the left side of the top of the page (AnalysisPage passes in the drop-down menu for switching stocks)*/
  selector?: ReactNode
  /** Fired when a row in a watchlist component is clicked. */
  onSelectTicker?: (ticker: string, name: string) => void
  /** Fired after a watchlist component successfully adds or removes a watched ticker. */
  onWatchlistChanged?: () => void
}

type DetailTab = 'analysis' | 'whatif' | 'ai'
type AnalysisSectionTab = 'chips' | 'fundamental' | 'technical'

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'analysis', label: '分析內容' },
  { id: 'whatif', label: '損益試算' },
  { id: 'ai', label: 'AI 分析' },
]

const SECTION_TABS: Array<{ id: AnalysisSectionTab; label: string; meta: string }> = [
  { id: 'chips', label: '籌碼分析', meta: '三大法人 · 融資融券' },
  { id: 'fundamental', label: '基本面', meta: '估值 · 獲利能力 · 月營收' },
  { id: 'technical', label: '技術面', meta: '日 K · 均線 · 布林 · 成交量 · KD' },
]

/** Group headers for long pages. Four sections are shared, making the level obviously higher than the `.rpt-section h3` inside each section.*/
function CardHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="card-head">
      <span className="card-dot" aria-hidden="true" />
      <h3>{title}</h3>
      {meta && <span className="card-meta">{meta}</span>}
    </div>
  )
}

export function StockDetailPage({
  ticker,
  name,
  holding,
  quote,
  rawAvgCost = null,
  avgCost = null,
  selector,
}: StockDetailPageProps) {
  const [tab, setTab] = useState<DetailTab>('analysis')
  const [activeSection, setActiveSection] = useState<AnalysisSectionTab>('chips')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null)
  const [fundLoading, setFundLoading] = useState(true)
  // +1 when the user clicks "Refresh" to string in the dependencies of each loaded effect to force a refetch.
  const [reloadKey, setReloadKey] = useState(0)

  /*
    The daily series is loaded here rather than inside the technical section (0.6.38): since the indicator
    summary moved into the 行情 card, two sections need the same file and it must only be downloaded once.
    `latest` is derived from the whole series, so the range picked by the chart below does not affect it.
  */
  // The report's data date doubles as "how fresh the daily file ought to be" —— see useDailySeries.
  const { status: dailyStatus, series: dailySeries } = useDailySeries(
    ticker,
    reloadKey,
    report?.dataDate,
    name,
  )
  const technicalLatest = useMemo(() => {
    if (!dailySeries || dailySeries.rows.length === 0) return null
    return buildTechnicalView(dailySeries.rows, '3m')?.latest ?? null
  }, [dailySeries])

  useEffect(() => {
    let alive = true
    setStatus('loading')
    setErrMsg('')
    setReport(null)
    ;(async () => {
      try {
        const stored = await fetchStoredReport(ticker)
        if (!alive) return
        if (stored) {
          setReport(stored)
          setStatus('ready')
          return
        }
        const fresh = await generateReport({ market: 'TPE', ticker, name, holding })
        if (alive) {
          setReport(fresh)
          setStatus('ready')
        }
      } catch (e: unknown) {
        if (alive) {
          setErrMsg(e instanceof Error ? e.message : '產生報告失敗')
          setStatus('error')
        }
      }
    })()
    return () => {
      alive = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, name, reloadKey])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void (async () => {
        try {
          const stored = await fetchStoredReport(ticker)
          if (stored) {
            setReport((prev) => (prev && stored.generatedAt !== prev.generatedAt ? stored : prev))
          }
          const f = await fetchFundamental(ticker)
          if (f) setFundamental((prev) => (prev && f.asOf !== prev.asOf ? f : prev))
        } catch {
        }
      })()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ticker])

  useEffect(() => {
    let alive = true
    setFundLoading(true)
    setFundamental(null)
    ;(async () => {
      try {
        let f = await fetchFundamental(ticker)
        if (!alive) return
        if (f) {
          setFundamental(f)
          setFundLoading(false)
        }
        const wantCore = needsCoreWarm(f)
        const wantHistory = !f || needsHistoryWarm(f)
        if (!wantCore && !wantHistory) {
          if (alive) setFundLoading(false)
          return
        }
        let coreComplete = false
        let coreOk = false
        if (wantCore) {
          const core = await warmStockCore(ticker, name)
          if (!alive) return
          coreOk = core.ok
          coreComplete = core.fundamentalComplete
          if (core.fundamentalSynced > 0 || core.backfilled > 0) {
            f = (await fetchFundamental(ticker)) ?? f
            if (alive) {
              setFundamental(f)
              setFundLoading(false)
            }
          } else if (alive && !f) {
            setFundLoading(false)
          }
        }
        const skipHistory = wantCore && coreOk && coreComplete
        const shouldHistory =
          !skipHistory &&
          (wantHistory || (wantCore && coreOk && !coreComplete) || Boolean(f && needsHistoryWarm(f)))
        if (shouldHistory) {
          const hist = await warmStockHistory(ticker, name)
          if (!alive) return
          if (hist.backfilled > 0 || hist.fundamentalSynced > 0) {
            f = (await fetchFundamental(ticker)) ?? f
            if (alive) setFundamental(f)
          }
        }
        if (alive) setFundLoading(false)
      } catch {
        if (alive) setFundLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker, name, reloadKey])

  return (
    <div className="section">
      <div className={selector ? 'detail-head detail-head-analysis' : 'detail-head'}>
        {selector}
        <div className="detail-title">
          <h2>
            {ticker} {name}
            {fundamental?.industry && (
              <span className="badge" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                {fundamental.industry}
              </span>
            )}
          </h2>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={status === 'loading' || fundLoading}
          title="重新抓取籌碼、技術面與基本面"
        >
          <RefreshCw size={14} className={status === 'loading' || fundLoading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      <nav className="subtabs" aria-label="個股分析分頁">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={tab === id ? 'subtab active' : 'subtab'}
            onClick={() => setTab(id)}
            aria-current={tab === id}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'analysis' ? (
        <div className="detail-stack">
          <section className="glass detail-card" aria-labelledby="sec-quote">
            <CardHead title="行情" meta={quoteMeta(quote)} />
            <div id="sec-quote">
              <QuoteTab
                quote={quote}
                latest={technicalLatest}
                ticker={ticker}
                name={name}
                holding={holding}
                history={report?.history ?? null}
              />
            </div>
          </section>

          <div className="section-tabs-container">
            <div className="section-tabs-header" role="tablist" aria-label="分析面向切換">
              {SECTION_TABS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSection === st.id}
                  className={`sec-tab-btn ${activeSection === st.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(st.id)}
                >
                  <span>{st.label}</span>
                </button>
              ))}
            </div>

            {activeSection === 'chips' && (
              <section className="glass detail-card" aria-labelledby="sec-chips">
                <CardHead title="籌碼" meta="三大法人 · 融資融券" />
                <div id="sec-chips">
                  {status === 'loading' && (
                    <div className="empty-state" style={{ padding: 32 }}>
                      <RefreshCw size={28} className="spin" />
                      <div style={{ marginTop: 10 }}>正在讀取盤後籌碼…</div>
                    </div>
                  )}
                  {status === 'error' && (
                    <div className="notice notice-warn" role="alert">
                      <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                      {errMsg}
                    </div>
                  )}
                  {status === 'ready' && report && <ChipsTab report={report} />}
                </div>
              </section>
            )}

            {activeSection === 'fundamental' && (
              <section className="glass detail-card" aria-labelledby="sec-fundamental">
                <CardHead title="基本面" meta="估值 · 獲利能力 · 月營收" />
                <div id="sec-fundamental">
                  <FundamentalTab fundamental={fundamental} loading={fundLoading} />
                </div>
              </section>
            )}

            {activeSection === 'technical' && (
              <section className="glass detail-card" aria-labelledby="sec-technical">
                <CardHead title="技術面" meta="日 K · 均線 · 布林 · 成交量 · KD" />
                <div id="sec-technical">
                  <TechnicalTab ticker={ticker} status={dailyStatus} series={dailySeries} />
                </div>
              </section>
            )}
          </div>
        </div>
      ) : tab === 'whatif' ? (
        <div className="glass detail-body">
          <WhatIfTab
            ticker={ticker}
            currentPrice={quote?.price ?? null}
            rawAvgCost={rawAvgCost}
            avgCost={avgCost}
            heldQty={holding?.qty ?? null}
          />
        </div>
      ) : (
        <div className="glass detail-body">
          <AiTab ticker={ticker} name={name} report={report} fundamental={fundamental} />
        </div>
      )}
    </div>
  )
}
