/**
 * 國際指數 subtab (task 162, 164): 9 indices across 4 regions (台灣/日本/韓國/美國),
 * refreshed every 60 s while that region is in session.
 *
 * Each card is a drill-down entry point to IndexDetail (task 164).
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchIndexQuotes, type IndexQuote } from '../../services/indexQuotes'
import {
  openRegions,
  marketSession,
  SESSION_HOURS,
  type MarketRegion,
  type SessionState,
} from './sessionHours'
import { pnlClass } from '../../utils/formatters'

export interface IndexDef {
  region: MarketRegion
  label: string
  ticker: string
}

export const INDICES: IndexDef[] = [
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
const SESSION_LABELS: Record<SessionState, string> = {
  open: '盤中',
  break: '午休',
  closed: '已收盤',
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

function IndexCard({
  def,
  quote,
  sessionState,
  onSelect,
}: {
  def: IndexDef
  quote: IndexQuote | undefined
  sessionState: SessionState
  onSelect?: (def: IndexDef, quote?: IndexQuote) => void
}) {
  const change = quote && quote.prevClose !== null ? quote.price - quote.prevClose : null
  const changePct = change !== null && quote?.prevClose ? (change / quote.prevClose) * 100 : null
  const asOf = quote?.asOf ?? null
  const stamp = asOf ? fmtAsOf(asOf) : ''

  return (
    <button
      type="button"
      className="rpt-card gix-card"
      data-testid={`gix-card-${def.ticker}`}
      onClick={() => onSelect?.(def, quote)}
    >
      <div className="k">{def.label}</div>
      <div className={`v ${pnlClass(change)}`}>{quote ? fmtIndexNum(quote.price) : '—'}</div>
      <div className={`gix-change ${pnlClass(change)}`}>
        {change === null ? '—' : `${change >= 0 ? '▲' : '▼'} ${fmtIndexNum(Math.abs(change))}`}
        {changePct === null
          ? ''
          : `　${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
      </div>
      {stamp !== '' && (
        <div className="gix-stamp" data-testid={`gix-stamp-${def.ticker}`}>
          {stamp}・{SESSION_LABELS[sessionState]}
        </div>
      )}
    </button>
  )
}

export function GlobalIndices({ onSelect }: { onSelect?: (def: IndexDef, quote?: IndexQuote) => void }) {
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
                <span className="badge">{SESSION_LABELS[session]}</span>
              </div>
              <div className="rpt-cards">
                {INDICES.filter((i) => i.region === region).map((def) => (
                  <IndexCard
                    key={def.ticker}
                    def={def}
                    quote={quotes[def.ticker]}
                    sessionState={session}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
