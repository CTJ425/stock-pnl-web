/**
 * International index closes for the Discord summary (Task 165), fetched from Yahoo at send time.
 * Only a **completed** session is ever reported — a bar whose session is still open is dropped.
 */

export interface IndexSpec {
  symbol: string
  label: string
}

/** Same set as the 國際指數 page, minus `^TWII` (the summary has its own TAIEX block). */
export const SUMMARY_INDICES: readonly IndexSpec[] = [
  { symbol: '^N225', label: '日經225' },
  { symbol: '^KS11', label: 'KOSPI' },
  { symbol: '^KQ11', label: 'KOSDAQ' },
  { symbol: '^DJI', label: '道瓊' },
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: '那斯達克' },
  { symbol: '^SOX', label: '費半' },
  { symbol: '^RUT', label: '羅素2000' },
]

export interface IndexChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        gmtoffset?: number
        currentTradingPeriod?: { regular?: { start?: number; end?: number } }
      }
      timestamp?: number[]
      indicators?: { quote?: Array<{ close?: Array<number | null> }> }
    }> | null
  }
}

export interface CompletedClose {
  /** 'MM/DD' in the exchange's own timezone */
  date: string
  close: number
  changePct: number | null
}

export function indexChartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
}

export function lastCompletedClose(resp: IndexChartResponse, nowSec: number): CompletedClose | null {
  const result = resp.chart?.result?.[0]
  if (!result) return null
  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []

  const bars: Array<{ t: number; close: number }> = []
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i]
    if (typeof c === 'number' && Number.isFinite(c)) bars.push({ t: timestamps[i], close: c })
  }
  if (bars.length === 0) return null
  bars.sort((a, b) => a.t - b.t)

  const regular = result.meta?.currentTradingPeriod?.regular
  if (regular && typeof regular.start === 'number' && typeof regular.end === 'number' && nowSec < regular.end) {
    const last = bars[bars.length - 1]
    if (last.t >= regular.start) bars.pop()
  }
  if (bars.length === 0) return null

  const last = bars[bars.length - 1]
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null
  const changePct = prev && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null

  const gmtoffset = result.meta?.gmtoffset ?? 0
  const local = new Date((last.t + gmtoffset) * 1000)
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(local.getUTCDate()).padStart(2, '0')

  return { date: `${mm}/${dd}`, close: last.close, changePct }
}
