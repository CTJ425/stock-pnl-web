/**
 * Loads `daily/{ticker}.json` once per stock detail page.
 *
 * Lifted out of `TechnicalTab` in 0.6.38: the indicator summary moved to the 行情 card, so two sections of the
 * same page now need the same series. Leaving the fetch inside the technical section would have meant either
 * downloading it twice or letting one card reach into another's state.
 *
 * A warm call is made when the file is missing —— newly added stocks are not covered by the nightly batch yet;
 * `warmStock` throttles that to one attempt per session per ticker.
 */
import { useEffect, useState } from 'react'
import { fetchDailySeries, type DailySeries } from '../../services/dailyProxy'
import { warmStock } from '../../services/warmStock'

export type DailyStatus = 'loading' | 'ready' | 'empty' | 'error'

export function useDailySeries(ticker: string, reloadKey = 0): {
  status: DailyStatus
  series: DailySeries | null
} {
  const [status, setStatus] = useState<DailyStatus>('loading')
  const [series, setSeries] = useState<DailySeries | null>(null)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    setSeries(null)
    ;(async () => {
      try {
        let s = await fetchDailySeries(ticker)
        if (!s) {
          const warmed = await warmStock(ticker)
          if (warmed.dailySynced > 0) s = await fetchDailySeries(ticker)
        }
        if (!alive) return
        setSeries(s)
        setStatus(s ? 'ready' : 'empty')
      } catch {
        if (alive) setStatus('error')
      }
    })()
    return () => {
      alive = false
    }
    // reloadKey: force a re-fetch when the user clicks "重新整理" (no cache in this layer nor in dailyProxy)
  }, [ticker, reloadKey])

  return { status, series }
}
