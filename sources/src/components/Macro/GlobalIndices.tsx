/**
 * 國際指數 subtab (task 162): 8 foreign indices in 3 region groups (日本/韓國/美國),
 * refreshed every 60 s while that region is in session.
 *
 * Polling shape copied from `useStockPrices.ts` (mount fetch + interval + visibilitychange),
 * but this panel talks to `indexQuotes.ts` directly instead of `priceProxy.fetchPrices` —
 * see the spec's "why a new service" note. `MacroPage` only mounts this component while the
 * subtab is active, so unmounting it is what stops the timer; there is no manual pause here.
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchIndexQuotes, type IndexQuote } from '../../services/indexQuotes'
import { openRegions, marketSession, type MarketRegion, type SessionState } from './sessionHours'
import { pnlClass } from '../../utils/formatters'

interface IndexDef {
  region: MarketRegion
  label: string
  ticker: string
}

const INDICES: IndexDef[] = [
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
const REGION_ORDER: MarketRegion[] = ['JP', 'KR', 'US']
const REGION_LABELS: Record<MarketRegion, string> = { JP: '日本', KR: '韓國', US: '美國' }
const SESSION_LABELS: Record<SessionState, string> = { open: '盤中', break: '午休', closed: '已收盤' }

const POLL_INTERVAL_MS = 60 * 1000

const taipeiClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function fmtIndexNum(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function IndexCard({ def, quote }: { def: IndexDef; quote: IndexQuote | undefined }) {
  const change = quote && quote.prevClose !== null ? quote.price - quote.prevClose : null
  const changePct = change !== null && quote?.prevClose ? (change / quote.prevClose) * 100 : null
  return (
    <div className="rpt-card">
      <div className="k">{def.label}</div>
      <div className={`v ${pnlClass(change)}`}>{quote ? fmtIndexNum(quote.price) : '—'}</div>
      <div className={`gix-change ${pnlClass(change)}`}>
        {change === null ? '—' : `${change >= 0 ? '▲' : '▼'} ${fmtIndexNum(Math.abs(change))}`}
        {changePct === null
          ? ''
          : `　${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
      </div>
    </div>
  )
}

export function GlobalIndices() {
  const [quotes, setQuotes] = useState<Record<string, IndexQuote>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Merge, never replace: a symbol the poll could not answer (per-symbol drop, or a whole
  // failed request that resolves to `{}`) keeps whatever card value was already on screen.
  const load = useCallback(async (tickers: string[]) => {
    if (tickers.length === 0) return
    const result = await fetchIndexQuotes(tickers)
    if (Object.keys(result).length === 0) return
    setQuotes((prev) => ({ ...prev, ...result }))
    setLastUpdated(new Date())
  }, [])

  useEffect(() => {
    void load(ALL_TICKERS)
  }, [load])

  useEffect(() => {
    const tick = () => {
      const regions = openRegions(new Date())
      if (regions.length === 0) return // no market open: skip the network call, keep the timer
      const tickers = INDICES.filter((i) => regions.includes(i.region)).map((i) => i.ticker)
      void load(tickers)
    }
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const now = new Date()

  return (
    <div className="section glass" style={{ padding: '18px 20px' }}>
      <div className="rpt-section-head">
        <h3 className="head-tight">國際指數</h3>
        {lastUpdated && (
          <span className="source-tag section-stamp">
            更新於 {taipeiClock.format(lastUpdated)}
          </span>
        )}
      </div>

      <div className="gix-groups">
        {REGION_ORDER.map((region) => {
          const session = marketSession(region, now)
          return (
            <div key={region}>
              <div className="rpt-section-head gix-group-head">
                <div className="chart-title">{REGION_LABELS[region]}</div>
                <span className="badge">{SESSION_LABELS[session]}</span>
              </div>
              <div className="rpt-cards">
                {INDICES.filter((i) => i.region === region).map((def) => (
                  <IndexCard key={def.ticker} def={def} quote={quotes[def.ticker]} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
