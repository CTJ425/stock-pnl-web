/**
 * Loads `daily/{ticker}.json` once per stock detail page.
 *
 * Lifted out of `TechnicalTab` in 0.6.38: the indicator summary moved to the 行情 card, so two sections of the
 * same page now need the same series. Leaving the fetch inside the technical section would have meant either
 * downloading it twice or letting one card reach into another's state.
 *
 * A warm call is made when the file is missing —— newly added stocks are not covered by the nightly batch yet;
 * `warmStock` throttles that to one attempt per session per ticker.
 *
 * …and when the file is **stale**, which since 0.6.44 is a case that actually happens. The nightly
 * batch only refreshes `daily/*.json` for tickers somebody holds, and `pruneStorage` only touches
 * `^\d{8}$` report folders, so a stock you merely searched for keeps the file written on the day you
 * searched it —— for ever. Without this check, coming back a week later draws a week-old chart with
 * no indication that it is old, which is worse than drawing nothing.
 */
import { useEffect, useState } from 'react'
import { fetchDailySeries, type DailySeries } from '../../services/dailyProxy'
import { warmStock } from '../../services/warmStock'

export type DailyStatus = 'loading' | 'ready' | 'empty' | 'error'

/**
 * @param freshThrough Trading day the series is expected to reach (`YYYY-MM-DD`, normally the chip
 *   report's `dataDate`). Undefined while the report is still loading —— the staleness check simply
 *   waits for it rather than guessing from the clock, which would have to know the trading calendar.
 */
export function useDailySeries(
  ticker: string,
  reloadKey = 0,
  freshThrough?: string,
  /** Optional display name forwarded to warm (0.6.44: server no longer looks it up) */
  name?: string,
): {
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
          const warmed = await warmStock(ticker, name)
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
    // name is only forwarded into warm; a rename must not re-download the series
    // eslint-disable-next-line react-hooks/exhaustive-deps -- name is warm payload, not a fetch key
  }, [ticker, reloadKey])

  /*
    Separate effect rather than a condition inside the one above: `freshThrough` arrives later than
    the file does (it comes from the chip report, which loads in parallel), so folding it into the
    dependency list would download the series twice on every single page open.

    Cannot loop. If the warm advances the file, the new `lastDate` satisfies the guard. If it does
    not —— Yahoo has not published the bar yet —— `warmStock` has already sealed the ticker for this
    session and answers `dailySynced: 0`, so nothing is set and nothing re-runs.
  */
  useEffect(() => {
    if (!series || !freshThrough || series.lastDate >= freshThrough) return
    let alive = true
    void (async () => {
      const warmed = await warmStock(ticker, name)
      if (!alive || warmed.dailySynced === 0) return
      const s = await fetchDailySeries(ticker)
      if (alive && s) setSeries(s)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- name is warm payload only
  }, [ticker, series, freshThrough])

  return { status, series }
}
