/**
 * 國際指數 subtab (task 162, 164): 9 indices across 4 regions (台灣/日本/韓國/美國),
 * refreshed every 60 s while that region is in session.
 *
 * Each row is a drill-down entry point to IndexDetail (task 164).
 *
 * 2026-09-27 statement redesign: the cards became one list whose rows carry a diverging bar of the
 * day's move (right = up, left = down, one scale across every market), so "which market is up
 * today" is read from lengths before any number.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchIndexQuotes, type IndexQuote } from '../../services/indexQuotes'
import {
  openRegions,
  marketSession,
  SESSION_HOURS,
  SESSION_LABELS,
  type ClosedDates,
  type MarketRegion,
  type SessionState,
} from './sessionHours'
import { TwCalendarLine } from '../MarketCalendar/TwCalendarLine'
import { pnlClass } from '../../utils/formatters'

export interface IndexDef {
  region: MarketRegion
  label: string
  ticker: string
}

const INDICES: IndexDef[] = [
  { region: 'TW', label: '加權指數', ticker: '^TWII' },
  { region: 'JP', label: '日經 225', ticker: '^N225' },
  { region: 'KR', label: 'KOSPI', ticker: '^KS11' },
  { region: 'KR', label: 'KOSDAQ', ticker: '^KQ11' },
  { region: 'US', label: '道瓊', ticker: '^DJI' },
  { region: 'US', label: 'S&P 500', ticker: '^GSPC' },
  { region: 'US', label: '那斯達克', ticker: '^IXIC' },
  { region: 'US', label: '費城半導體', ticker: '^SOX' },
  { region: 'US', label: '羅素 2000', ticker: '^RUT' },
]

const ALL_TICKERS = INDICES.map((i) => i.ticker)
const REGION_ORDER: MarketRegion[] = ['TW', 'JP', 'KR', 'US']
const REGION_LABELS: Record<MarketRegion, string> = {
  TW: '台灣',
  JP: '日本',
  KR: '韓國',
  US: '美國',
}

const POLL_INTERVAL_MS = 60 * 1000

const taipeiClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const asOfFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function fmtIndexNum(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtAsOf(asOf: string): string {
  const d = new Date(asOf)
  if (Number.isNaN(d.getTime())) return ''
  const parts = asOfFormat.formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

function changePctOf(quote: IndexQuote | undefined): number | null {
  if (!quote || quote.prevClose === null || !quote.prevClose) return null
  return ((quote.price - quote.prevClose) / quote.prevClose) * 100
}

function IndexCard({
  def,
  quote,
  sessionState,
  maxPct,
  onSelect,
}: {
  def: IndexDef
  quote: IndexQuote | undefined
  sessionState: SessionState
  /** Largest |move| on screen, so every bar shares one scale. */
  maxPct: number
  onSelect?: (def: IndexDef, quote?: IndexQuote) => void
}) {
  const change = quote && quote.prevClose !== null ? quote.price - quote.prevClose : null
  const changePct = changePctOf(quote)
  const asOf = quote?.asOf ?? null
  const stamp = asOf ? fmtAsOf(asOf) : ''
  const width = changePct === null ? 0 : Math.min(50, (Math.abs(changePct) / maxPct) * 50)

  return (
    <button
      type="button"
      className="gix-card gix-row"
      data-testid={`gix-card-${def.ticker}`}
      onClick={() => onSelect?.(def, quote)}
    >
      <span className="k">{def.label}</span>
      <span className="gix-track" aria-hidden="true">
        {changePct !== null && (
          <i className={changePct >= 0 ? 'pos' : 'neg'} style={{ width: `${width}%` }} />
        )}
      </span>
      <span className={`gix-pct ${pnlClass(change)}`}>
        {changePct === null ? '—' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
      </span>
      <span className="gix-level">
        <span className="v">{quote ? fmtIndexNum(quote.price) : '—'}</span>
        <span className={`gix-change ${pnlClass(change)}`}>
          {change === null ? '—' : `${change >= 0 ? '▲' : '▼'} ${fmtIndexNum(Math.abs(change))}`}
        </span>
      </span>
      {stamp !== '' && (
        <span className="gix-stamp" data-testid={`gix-stamp-${def.ticker}`}>
          {stamp}・{SESSION_LABELS[sessionState]}
        </span>
      )}
    </button>
  )
}

export function GlobalIndices({
  onSelect,
  closedDates,
  calendarOpen = false,
}: {
  onSelect?: (def: IndexDef, quote?: IndexQuote) => void
  closedDates?: ClosedDates
  /** Open the 台股開休市 disclosure and scroll to it (the dashboard's 「休市」 link) */
  calendarOpen?: boolean
}) {
  const [quotes, setQuotes] = useState<Record<string, IndexQuote>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [now, setNow] = useState(() => new Date())
  // Request-sequence guard, kept PER TICKER (Task 193 M10). The point of a guard is that an older
  // response must not overwrite a newer quote already on screen. A single shared counter did more:
  // the poll tick (open regions only) discarded the still-running full load wholesale, so the closed
  // markets stayed 「—」 for good. Now each ticker remembers the newest request that asked for it, and a
  // response only writes the tickers it is still the newest answer for.
  const nextReqId = useRef(0)
  const latestReqFor = useRef(new Map<string, number>())

  // Merge, never replace: a symbol the poll could not answer (per-symbol drop, or a whole
  // failed request that resolves to `{}`) keeps whatever card value was already on screen.
  const load = useCallback(async (tickers: string[]) => {
    if (tickers.length === 0) return
    const id = ++nextReqId.current
    for (const t of tickers) latestReqFor.current.set(t, id)
    const result = await fetchIndexQuotes(tickers)
    const current: Record<string, IndexQuote> = {}
    for (const [t, q] of Object.entries(result)) {
      if (latestReqFor.current.get(t) === id) current[t] = q
    }
    if (Object.keys(current).length === 0) return
    setQuotes((prev) => ({ ...prev, ...current }))
    setLastUpdated(new Date())
  }, [])

  useEffect(() => {
    void load(ALL_TICKERS)
  }, [load])

  useEffect(() => {
    const tick = () => {
      const current = new Date()
      setNow(current)
      const regions = openRegions(current, closedDates)
      if (regions.length === 0) return // no market open: skip the network call, keep the timer
      const tickers = INDICES.filter((i) => regions.includes(i.region)).map((i) => i.ticker)
      void load(tickers)
    }
    // A hidden tab has nobody to show a quote to: skip the timer's tick, and catch up the moment the
    // tab is visible again (Task 193 M15, same rule as useStockPrices).
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, closedDates])

  const anyOpen = openRegions(now, closedDates).length > 0
  const maxPct = Math.max(0.5, ...INDICES.map((d) => Math.abs(changePctOf(quotes[d.ticker]) ?? 0)))

  return (
    <div className="section gix-section">
      <div className="rpt-section-head">
        <h3 className="head-tight">國際指數</h3>
        {lastUpdated && (
          <span className="source-tag section-stamp">
            {anyOpen ? '' : '已收盤・'}更新於 {taipeiClock.format(lastUpdated)}
          </span>
        )}
      </div>

      <div className="gix-groups">
        {REGION_ORDER.map((region) => {
          const session = marketSession(region, now, closedDates)
          const hours = SESSION_HOURS[region]
          return (
            <div key={region}>
              <div className="rpt-section-head gix-group-head">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div className="chart-title">{REGION_LABELS[region]}</div>
                  <span className="gix-hours" data-testid={`gix-hours-${region}`}>
                    {hours.local}
                    {hours.breakLocal ? `（午休 ${hours.breakLocal}）` : ''}
                    {region !== 'TW' ? `・台北 ${hours.taipei}` : ''}
                  </span>
                </div>
                <span className="badge" data-testid={`gix-session-${region}`}>
                  {SESSION_LABELS[session]}
                </span>
              </div>
              <div className="gix-rows">
                {INDICES.filter((i) => i.region === region).map((def) => (
                  <IndexCard
                    key={def.ticker}
                    def={def}
                    quote={quotes[def.ticker]}
                    sessionState={session}
                    maxPct={maxPct}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <TwCalendarLine defaultOpen={calendarOpen} />
    </div>
  )
}
