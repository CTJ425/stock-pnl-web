/**
 * Content area for individual stock analysis.
 *
 * 2026-09-27 statement redesign: the quote (the stock's letterhead, its price chart and 我的持股) stays on
 * top, and one tab row switches 籌碼 / 基本面 / 技術面 / 損益試算. Inside each tab the chart comes first
 * and the exact numbers sit one disclosure below it. (0.6.8 had merged the sections into one long page of
 * cards; AI analysis was removed in 0.9.68.)
 *
 * This is a pure presentation component: which level to look at and where the quote comes from are all determined by the caller (AnalysisPage).
 * The selector on the left side of the page is also passed in from the caller (currently it is a drop-down menu for switching individual stocks).
 *
 * Data flow: Storage-first reads the shared report of scheduled pre-production, and then clicks and produces fallback if there is no problem.
 * Fundamentals are loaded once at this layer and distributed to three places (the industry badge of the title and the fundamentals section).
 * Independent from chip reporting, failure of either does not affect the other.
 */
import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  fetchStoredReport,
  generateReport,
  type ReportData,
  type ReportHolding,
} from '../../services/reportProxy'
import { fetchFundamental, type FundamentalData } from '../../services/fundamentalProxy'
import { needsCoreWarm, needsHistoryWarm } from '../../services/needsFundamentalBackfill'
import { warmStockCore, warmStockHistory } from '../../services/warmStock'
import { ChipsTab } from './ChipsTab'
import { FundamentalTab } from './FundamentalTab'
import { QuoteTab } from './QuoteTab'
import { quoteMeta } from './quoteMeta'
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

type DetailTab = 'analysis' | 'whatif'
type AnalysisSectionTab = 'chips' | 'fundamental' | 'technical'
/**
 * One tab row since the 2026-09-27 statement redesign: the quote and 我的持股 always sit on top, and
 * 籌碼 / 基本面 / 技術面 / 損益試算 are siblings under it (they used to be two levels, 分析內容 ▸ three
 * sections, and 損益試算 beside 分析內容). The URL keeps its two params, so old links still land.
 */
type PageTab = AnalysisSectionTab | 'whatif'

const PAGE_TABS: Array<{ id: PageTab; label: string }> = [
  { id: 'chips', label: '籌碼' },
  { id: 'fundamental', label: '基本面' },
  { id: 'technical', label: '技術面' },
  { id: 'whatif', label: '損益試算' },
]

const PAGE_TAB_IDS = PAGE_TABS.map((t) => t.id)

function isDetailTab(v: string | null): v is DetailTab {
  return v === 'analysis' || v === 'whatif'
}

function isSectionTab(v: string | null): v is AnalysisSectionTab {
  return v === 'chips' || v === 'fundamental' || v === 'technical'
}

/** Initial tab level 1, read once from `?tab=`; falls back to the default when the value is unknown. */
function readTabFromUrl(): DetailTab {
  const v = new URLSearchParams(window.location.search).get('tab')
  return isDetailTab(v) ? v : 'analysis'
}

/** Initial tab level 2, read once from `?sub=`; falls back to the default when the value is unknown. */
function readSectionFromUrl(): AnalysisSectionTab {
  const v = new URLSearchParams(window.location.search).get('sub')
  return isSectionTab(v) ? v : 'chips'
}

/**
 * Writes query params via `history.replaceState`, preserving every other param. Building the
 * next URL from the full current href (never reading or writing the hash fragment directly)
 * carries it through untouched — Supabase auth redirects use that fragment, and rewriting it
 * would break sign-in.
 */
function setUrlParams(updates: Record<string, string>) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(updates)) url.searchParams.set(key, value)
  window.history.replaceState(null, '', url.toString())
}

/**
 * Arrow-key navigation shared by both tab levels: ArrowLeft/ArrowRight move to the
 * previous/next tab and focus it, Home/End jump to the first/last. Other keys pass through.
 */
function handleTabListKeyDown<T extends string>(
  e: KeyboardEvent<HTMLButtonElement>,
  ids: readonly T[],
  currentId: T,
  onSelect: (id: T) => void,
) {
  let nextIndex: number
  const currentIndex = ids.indexOf(currentId)
  if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + ids.length) % ids.length
  else if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % ids.length
  else if (e.key === 'Home') nextIndex = 0
  else if (e.key === 'End') nextIndex = ids.length - 1
  else return

  e.preventDefault()
  const nextId = ids[nextIndex]
  onSelect(nextId)
  const list = e.currentTarget.closest('[role="tablist"]')
  const buttons = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[nextIndex]?.focus()
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
  const [pageTab, setPageTab] = useState<PageTab>(() =>
    readTabFromUrl() === 'whatif' ? 'whatif' : readSectionFromUrl(),
  )
  const selectTab = (id: PageTab) => {
    setPageTab(id)
    setUrlParams(id === 'whatif' ? { tab: 'whatif' } : { tab: 'analysis', sub: id })
  }
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null)
  const [fundLoading, setFundLoading] = useState(true)
  const [fundError, setFundError] = useState(false)
  // +1 when the user clicks "Refresh" to string in the dependencies of each loaded effect to force a refetch.
  const [reloadKey, setReloadKey] = useState(0)
  // `tab`/`sub` describe this page's own tabs; once this page is gone, leaving them in the
  // address bar is stale clutter for whatever renders next, so drop them (and only them) on unmount.
  useEffect(() => {
    return () => {
      const url = new URL(window.location.href)
      url.searchParams.delete('tab')
      url.searchParams.delete('sub')
      window.history.replaceState(null, '', url.toString())
    }
  }, [])

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
    return buildTechnicalView(dailySeries.rows, '1m')?.latest ?? null
  }, [dailySeries])

  useEffect(() => {
    let alive = true
    setStatus('loading')
    setErrMsg('')
    setReport(null)
    ;(async () => {
      try {
        const stored = await fetchStoredReport(ticker, { forceRefresh: reloadKey > 0 })
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
          const stored = await fetchStoredReport(ticker, { forceRefresh: true })
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
    setFundError(false)
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
        if (alive) {
          setFundError(true)
          setFundLoading(false)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker, name, reloadKey])

  return (
    <div className="section sd-page">
      <div className={selector ? 'detail-head detail-head-analysis' : 'detail-head'}>
        {selector}
        <div className="detail-title">
          <h2>
            {ticker} {name}
            {fundamental?.industry && <span className="badge sd-industry">{fundamental.industry}</span>}
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

      {/* The quote and 我的持股 stay on screen under every tab: they answer the first question. */}
      <section className="sd-quote" aria-label={`行情・${quoteMeta(quote, 'TPE')}`} id="sec-quote">
        <QuoteTab
          quote={quote}
          latest={technicalLatest}
          ticker={ticker}
          name={name}
          holding={holding}
          dailySeries={dailySeries}
          dailyStatus={dailyStatus}
        />
      </section>

      <nav className="subtabs sd-tabs" role="tablist" aria-label="個股分析分頁">
        {PAGE_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pageTab === id}
            className={pageTab === id ? 'subtab active' : 'subtab'}
            onClick={() => selectTab(id)}
            onKeyDown={(e) => handleTabListKeyDown(e, PAGE_TAB_IDS, pageTab, selectTab)}
          >
            {label}
          </button>
        ))}
      </nav>

      {pageTab === 'chips' && (
        <section className="sd-section" id="sec-chips" aria-label="籌碼：三大法人 · 融資融券">
          <ChipsTab report={report} status={status} errMsg={errMsg} />
        </section>
      )}
      {pageTab === 'fundamental' && (
        <section className="sd-section" id="sec-fundamental" aria-label="基本面：估值 · 獲利能力 · 月營收">
          <FundamentalTab fundamental={fundamental} loading={fundLoading} error={fundError} />
        </section>
      )}
      {pageTab === 'technical' && (
        <section className="sd-section" id="sec-technical" aria-label="技術面：日 K · 均線 · 布林 · 成交量 · KD">
          <TechnicalTab ticker={ticker} status={dailyStatus} series={dailySeries} />
        </section>
      )}
      {pageTab === 'whatif' && (
        <section className="sd-section" id="sec-whatif" aria-label="損益試算">
          <WhatIfTab
            ticker={ticker}
            currentPrice={quote?.price ?? null}
            rawAvgCost={rawAvgCost}
            avgCost={avgCost}
            heldQty={holding?.qty ?? null}
          />
        </section>
      )}
    </div>
  )
}
