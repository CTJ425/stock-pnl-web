/**
 * Trade-value Top 30 (official TWSE codes, ETFs included).
 * Reads public `meta/top_tickers.json` — written by stock-report generate-all / sync-top-tickers.
 * Keeps at most today + previous snapshot (e.g. Monday still shows Friday until re-ranked).
 */
import { downloadReportsJson } from './reportsBucket'

export interface TopTickerRow {
  ticker: string
  name: string
  rank: number
  tradeValue: number
}

export interface TopTickersDayView {
  ymd: string
  sourceDate: string | null
  asOf: string
  tickers: TopTickerRow[]
}

export interface TopTickersData {
  days: TopTickersDayView[]
  /** Newest day (or only day). */
  latest: TopTickersDayView | null
}

function parseDay(raw: unknown): TopTickersDayView | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const ymd = String(d.ymd ?? '').trim()
  if (!/^\d{8}$/.test(ymd)) return null
  const tickersIn = Array.isArray(d.tickers) ? d.tickers : []
  const tickers: TopTickerRow[] = []
  for (const t of tickersIn) {
    if (!t || typeof t !== 'object') continue
    const row = t as Record<string, unknown>
    const ticker = String(row.ticker ?? '').trim()
    if (!ticker) continue
    tickers.push({
      ticker,
      name: String(row.name ?? '').trim(),
      rank: typeof row.rank === 'number' ? row.rank : tickers.length + 1,
      tradeValue: typeof row.tradeValue === 'number' ? row.tradeValue : 0,
    })
  }
  if (tickers.length === 0) return null
  return {
    ymd,
    sourceDate: d.sourceDate == null ? null : String(d.sourceDate),
    asOf: String(d.asOf ?? ''),
    tickers,
  }
}

/** Format YYYYMMDD → YYYY-MM-DD for UI. */
export function formatTopYmd(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

/** Trade value TWD → e.g. 579.5 億 */
export function formatTradeValueYi(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  const yi = v / 1e8
  if (yi >= 100) return `${yi.toFixed(0)} 億`
  if (yi >= 10) return `${yi.toFixed(1)} 億`
  return `${yi.toFixed(2)} 億`
}

export async function fetchTopTickers(): Promise<TopTickersData | null> {
  const raw = await downloadReportsJson<Record<string, unknown>>('meta/top_tickers.json')
  if (!raw) return null

  // schema 2: days[]
  if (Array.isArray(raw.days)) {
    const days: TopTickersDayView[] = []
    for (const d of raw.days) {
      const parsed = parseDay(d)
      if (parsed) days.push(parsed)
    }
    days.sort((a, b) => b.ymd.localeCompare(a.ymd))
    const slim = days.slice(0, 2)
    if (slim.length === 0) return null
    return { days: slim, latest: slim[0] ?? null }
  }

  // schema 1 fallback
  if (!Array.isArray(raw.tickers)) return null
  let ymd = '19700101'
  if (typeof raw.asOf === 'string' && raw.asOf) {
    try {
      const d = new Date(raw.asOf)
      const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
      const p = (n: number) => String(n).padStart(2, '0')
      ymd = `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`
    } catch {
      /* keep */
    }
  }
  const day = parseDay({
    ymd,
    sourceDate: raw.sourceDate,
    asOf: raw.asOf,
    tickers: raw.tickers,
  })
  if (!day) return null
  return { days: [day], latest: day }
}
