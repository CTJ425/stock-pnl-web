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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import {
  fetchStoredReport,
  generateReport,
  type ReportData,
  type ReportHolding,
} from '../../services/reportProxy'
import { fetchFundamental, type FundamentalData } from '../../services/fundamentalProxy'
import { needsCoreWarm, needsHistoryWarm } from '../../services/needsFundamentalBackfill'
import { warmStockCore, warmStockHistory } from '../../services/warmStock'
import { downloadBlob, generatePdfBlob } from '../../services/reportPdf'
import { AiTab } from './AiTab'
import { ChipsTab } from './ChipsTab'
import { FundamentalTab } from './FundamentalTab'
import { QuoteTab, quoteMeta } from './QuoteTab'
import { TechnicalTab } from './TechnicalTab'
import { WhatIfTab } from './WhatIfTab'
import { WatchTab } from './WatchTab'
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
  /** The control items on the left side of the top of the page (AnalysisPage passes in the drop-down menu for switching stocks)*/
  selector?: ReactNode
  /** Fired when a row in the 觀察股票 tab is clicked. Carries both the ticker and its display name. */
  onSelectTicker?: (ticker: string, name: string) => void
  /** Fired after the 觀察股票 tab successfully adds or removes a watched ticker. */
  onWatchlistChanged?: () => void
}

type DetailTab = 'analysis' | 'whatif' | 'ai' | 'watch'

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'analysis', label: '分析內容' },
  { id: 'whatif', label: '損益試算' },
  { id: 'ai', label: 'AI 分析' },
  { id: 'watch', label: '觀察股票' },
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
  selector,
  onSelectTicker,
  onWatchlistChanged,
}: StockDetailPageProps) {
  const [tab, setTab] = useState<DetailTab>('analysis')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null)
  const [fundLoading, setFundLoading] = useState(true)
  // +1 when the user clicks "Refresh" to string in the dependencies of each loaded effect to force a refetch.
  // It is needed because: reports and fundamentals are only captured once when the page is opened (ticker changes), and batches are captured after the opening
  // The data will be updated while the user is looking at it - without this button, you would have to reload the entire page to see the new information.
  const [reloadKey, setReloadKey] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const surfaceRef = useRef<HTMLDivElement>(null)

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
  const technicalLatest = useMemo(
    () => (dailySeries ? (buildTechnicalView(dailySeries.rows, '3m')?.latest ?? null) : null),
    [dailySeries],
  )

  useEffect(() => {
    let alive = true
    setStatus('loading')
    setReport(null)
    ;(async () => {
      try {
        // Storage-first: Shared report for after-hours scheduled production (quick, no need to type TWSE)
        const stored = await fetchStoredReport(ticker)
        if (alive && stored) {
          setReport(stored)
          setStatus('ready')
          return
        }
        // Fallback: Click to deliver when the delivery is not scheduled (not in the list/not yet produced on the day/old format)
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
    // Holding is not included in the dependency: the current holding context when opening the page is enough to avoid duplication caused by refreshing the current price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, name, reloadKey])

  // Check whether the comparison report has been changed when switching back to the foreground after pagination (0.6.2).
  //
  // The above effect is only captured once when the page is opened. In the three-shift era, it was only updated three times a day, which was pretty usable;
  // After 0.6.1, the batch is changed to 16:00–23:45 and polling every 15 minutes. **The report will be updated while the user is watching**.
  // If it is turned on, it will always stop at the snapshot of the moment when the page is opened - what actually happened: the batch of 20:15 has written the report for the day,
  // The tab opened before 20:15 still displays the chips of the previous trading day.
  //
  // The method follows the visibilitychange of useStockPrices without opening another timer:
  // The timer of background paging will be throttled by the browser, and switching back to the foreground is the time when the user wants to see the data.
  //
  // The fundamentals starting from 0.6.8 are also compared together. After merging four paragraphs into one page, "Only the chips will update themselves"
  // The asymmetry has changed from invisible to visible to the naked eye - on the same picture, the chips jumped to today, but the monthly revenue stayed at yesterday.
  // The technical side is not dealt with here: it is managed by its own effect, and the daily line only changes once a day.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void (async () => {
        const stored = await fetchStoredReport(ticker)
        if (stored) {
          // Only change generatedAt if it really changes: if it doesn’t change, don’t change state.
          // Otherwise, it will be redrawn every time you switch back to the foreground, and the scroll position and expanded state will be washed away.
          setReport((prev) => (prev && stored.generatedAt !== prev.generatedAt ? stored : prev))
        }
        const f = await fetchFundamental(ticker)
        // Also setState only when a copy is actually changed (than asOf, that's when we write the file)
        if (f) setFundamental((prev) => (prev && f.asOf !== prev.asOf ? f : prev))
      })()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ticker])

  /*
    Fundamentals load independently of the chip report.

    Progressive warm (0.6.46-dev.4+) with phase split (0.6.46-dev.6):
    1. Storage-first — paint immediately when a file exists.
    2. needsCoreWarm → warmStockCore only (quota). Skipped when months+quarters already exist
       so reopening a stock with full months / thin quarters does not burn quota.
    3. needsHistoryWarm (months < 6 or quarters < 6) or core incomplete → warmStockHistory
       (no second quota). Fixes thin quarterly history after revenue-first budget.
    4. ETF / unknownTicker: core complete=true → no history.
  */
  useEffect(() => {
    let alive = true
    setFundLoading(true)
    setFundamental(null)
    ;(async () => {
      let f = await fetchFundamental(ticker)
      if (!alive) return

      // Paint Storage snapshot right away so partial files are usable while warm runs.
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

      // History: skip when core proved unknown/ETF (complete). Otherwise run if soft history
      // need, or core said incomplete, or sealed-core path still has a thin file.
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
    })()
    return () => {
      alive = false
    }
  }, [ticker, name, reloadKey])

  async function handleDownload() {
    if (!surfaceRef.current) return
    setPdfBusy(true)
    setPdfNote('')
    try {
      const blob = await generatePdfBlob(surfaceRef.current)
      // The file name is no longer called "After-hours chips": 0.6.8 The starting range is chips + fundamentals + technicals.
      downloadBlob(blob, `個股分析-${ticker}-${report?.dataDate ?? ''}.pdf`)
    } catch {
      setPdfNote('PDF 產生失敗，請再試一次。')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="section">
      {/*
        With a selector (AnalysisPage): column of subtabs + a stable row
        [menu tools | stock title | actions]. Search-only controls sit under that row so
        switching holdings does not shove the title around.
      */}
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
        {/*
          Since 0.6.8 this is no longer tied to a "chips tab" (that tab no longer exists); export is available as
          soon as the chip report has loaded. The capture range is chips + fundamentals + technicals,
          **excluding holdings** (see where surfaceRef is mounted).
        */}
        {status === 'ready' && tab === 'analysis' && (
          <button className="btn btn-sm" onClick={() => void handleDownload()} disabled={pdfBusy}>
            <Download size={14} className={pdfBusy ? 'spin' : undefined} />
            {pdfBusy ? '產生 PDF 中…' : '下載 PDF'}
          </button>
        )}
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

      {pdfNote && <div className="detail-note">{pdfNote}</div>}

      {tab === 'analysis' ? (
        /*
          The order is the user's (行情 → 籌碼 → 基本面 → 技術面). Do not rearrange it.
          Since 0.6.36 the first section is the quote (public market data) and all four sit inside surfaceRef, so
          all four go into the PDF; before that the first section was holdings, excluded from export because it
          is personal data —— which is why there used to be an extra wrapper here.
        */
        <div className="detail-stack" ref={surfaceRef}>
          <section className="glass detail-card" aria-labelledby="sec-quote">
            <CardHead title="行情" meta={quoteMeta(quote)} />
            <div id="sec-quote">
              <QuoteTab quote={quote} latest={technicalLatest} />
            </div>
          </section>

          <section className="glass detail-card" aria-labelledby="sec-chips">
            <CardHead title="籌碼" meta="三大法人 · 融資融券" />
            <div id="sec-chips">
              {/* Chip loading / errors only affect this card; the other three sections render as usual */}
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

          <section className="glass detail-card" aria-labelledby="sec-fundamental">
            <CardHead title="基本面" meta="估值 · 獲利能力 · 月營收" />
            <div id="sec-fundamental">
              <FundamentalTab fundamental={fundamental} loading={fundLoading} />
            </div>
          </section>

          <section className="glass detail-card" aria-labelledby="sec-technical">
            <CardHead title="技術面" meta="日 K · 均線 · 布林 · 成交量 · KD" />
            <div id="sec-technical">
              <TechnicalTab ticker={ticker} status={dailyStatus} series={dailySeries} />
            </div>
          </section>
        </div>
      ) : tab === 'whatif' ? (
        <div className="glass detail-body">
          <WhatIfTab
            ticker={ticker}
            currentPrice={quote?.price ?? null}
            avgCost={holding?.avgCost ?? null}
            heldQty={holding?.qty ?? null}
          />
        </div>
      ) : tab === 'ai' ? (
        <div className="glass detail-body">
          <AiTab ticker={ticker} name={name} report={report} fundamental={fundamental} />
        </div>
      ) : (
        <div className="glass detail-body">
          <WatchTab onSelectTicker={(t, n) => onSelectTicker?.(t, n)} onChanged={onWatchlistChanged} />
        </div>
      )}
    </div>
  )
}
