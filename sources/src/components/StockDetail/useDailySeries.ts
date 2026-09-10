/**
 * Loads `daily/{ticker}.json` once per stock detail page.
 *
 * Lifted out of `TechnicalTab` in 0.6.38: the indicator summary moved to the 行情 card, so two sections of the
 * same page now need the same series. Leaving the fetch inside the technical section would have meant either
 * downloading it twice or letting one card reach into another's state.
 *
 * A warm-core call is made when the file is missing —— newly added stocks are not covered by the
 * nightly batch yet; `warmStockCore` throttles that to one attempt per session per ticker and does
 * not wait on MOPS history (0.6.46-dev.4).
 *
 * …and when the file is **stale**, which since 0.6.44 is a case that actually happens. The nightly
 * batch only refreshes `daily/*.json` for tickers somebody holds, and `pruneStorage` only touches
 * `^\d{8}$` report folders, so a stock you merely searched for keeps the file written on the day you
 * searched it —— for ever. Without this check, coming back a week later draws a week-old chart with
 * no indication that it is old, which is worse than drawing nothing.
 */
import { useEffect, useState } from 'react'
import { fetchDailySeries, fetchRemoteDaily, type DailySeries } from '../../services/dailyProxy'
import { warmStockCore } from '../../services/warmStock'

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
      let s: DailySeries | null = null
      let hadError = false
      try {
        s = await fetchDailySeries(ticker)
        if (!s) {
          const warmed = await warmStockCore(ticker, name)
          if (warmed.dailySynced > 0) s = await fetchDailySeries(ticker)
        }
      } catch {
        // Storage or warm failed. No longer fatal on its own —— the Edge fallback below answers
        // for any ticker, so the failure only decides which message a total miss ends up showing.
        hadError = true
        s = null
      }

      /*
       * Third fallback, added in 0.9.43: ask the Edge Function for five years of daily bars.
       *
       * Measured on PROD 2026-09-10: `daily/` held **9** files —— exactly the tickers somebody
       * holds. Every other stock, `2330` included, has no file at all, because the nightly batch
       * only refreshes holdings and `warmStockCore` does not always produce one either. That was
       * survivable while only 技術面 read this series. It stopped being survivable in 0.9.42, when
       * 行情 gained four ranges (近 1 月 / 近 6 月 / 本年迄今 / 近 1 年) that read the same file:
       * opening any non-holding stock made all four fail while 一日/五日 and 近 5 年/全部 —— both
       * of which go to Yahoo through the Edge —— kept working.
       *
       * `5y` is deliberately a superset: one request serves all four local ranges and makes a later
       * click on 近 5 年 free, since `fetchRemoteDaily` caches per ticker and range. It needs no
       * Edge change, because the `daily` action shipped in 0.9.41 already accepts it.
       */
      if (!s) {
        const remote = await fetchRemoteDaily(ticker, '5y')
        if (remote && remote.rows.length > 0) {
          s = {
            ticker,
            asOf: new Date().toISOString(),
            lastDate: remote.rows[remote.rows.length - 1][0],
            rows: remote.rows,
          }
        }
      }

      if (!alive) return
      setSeries(s)
      setStatus(s ? 'ready' : hadError ? 'error' : 'empty')
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
    not —— Yahoo has not published the bar yet —— `warmStockCore` has already sealed the ticker for
    this session and answers `dailySynced: 0`, so nothing is set and nothing re-runs.
  */
  useEffect(() => {
    if (!series || !freshThrough || series.lastDate >= freshThrough) return
    let alive = true
    void (async () => {
      try {
        const warmed = await warmStockCore(ticker, name)
        if (!alive || warmed.dailySynced === 0) return
        const s = await fetchDailySeries(ticker)
        if (alive && s) setSeries(s)
      } catch {
        // Background top-up only; a failure just leaves the previous series on screen.
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- name is warm payload only
  }, [ticker, series, freshThrough])

  return { status, series }
}
