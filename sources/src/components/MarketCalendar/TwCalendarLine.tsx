/**
 * 台股開休市 for every user (0.10.26): one line under the 台股 group on 總經 → 國際指數, and the year
 * behind a disclosure. The admin page has the operator's version (why MIS is skipped, uncovered years
 * in detail); this one only answers "is the market open, and when is it next closed".
 */
import { useEffect, useRef } from 'react'
import {
  dayInfo,
  daysBetween,
  fmtMonthDay,
  holidaysOf,
  nextHoliday,
  nextTradingDay,
  taipeiToday,
  weekdayOf,
  yearCovered,
} from './marketCalendar'
import { CalendarLegend, YearGrid } from './MonthGrid'

function md(ymd: string): string {
  return `${fmtMonthDay(ymd)}（${weekdayOf(ymd)}）`
}

export function TwCalendarLine({ now, defaultOpen = false }: { now?: Date; defaultOpen?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Arriving from the dashboard's 「休市」 link: bring the opened calendar into view.
  useEffect(() => {
    if (defaultOpen) ref.current?.scrollIntoView?.({ block: 'start' })
  }, [defaultOpen])

  const today = taipeiToday(now)
  const year = Number(today.slice(0, 4))
  const covered = yearCovered(year)
  const t = dayInfo(today)
  const off = nextHoliday(today)
  const upcoming = holidaysOf(year).filter((d) => d.ymd >= today)

  let status: string
  if (t.kind === 'open') {
    status = !covered
      ? `今天開市・${year} 年休市日還沒更新`
      : off && off.ymd.startsWith(String(year))
        ? `今天開市・下一個休市日 ${md(off.ymd)} ${off.name}・${daysBetween(today, off.ymd)} 天後`
        : '今天開市・今年沒有其他平日休市了'
  } else {
    const why = t.kind === 'holiday' ? t.name : '週末'
    status = `今天休市（${why}）・現價停在前一個交易日收盤・下一個交易日 ${md(nextTradingDay(today))}`
  }

  return (
    <div className="mcal-line" id="tw-calendar" ref={ref}>
      <p className="mcal-line-text">
        <span className="mcal-line-label">開休市</span>
        {status}
      </p>
      <details className="chart-more" open={defaultOpen}>
        <summary>看 {year} 年休市日</summary>
        {covered ? (
          <>
            <CalendarLegend />
            <YearGrid year={year} today={today} />
            {upcoming.length > 0 && (
              <table className="mcal-list">
                <caption>還沒到的平日休市</caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">名稱</th>
                    <th scope="col" className="mcal-list-rel">距今</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((d) => (
                    <tr key={d.ymd}>
                      <td>{md(d.ymd)}</td>
                      <td>{d.name}</td>
                      <td className="mcal-list-rel">
                        {d.ymd === today ? '今天' : `${daysBetween(today, d.ymd)} 天後`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mcal-line-foot">依證交所公告的市場開休市日期；週末一律休市，不另列。</p>
          </>
        ) : (
          <p className="mcal-line-foot">
            {year} 年的休市日還沒更新，目前只把週末當休市。證交所公布後會補上。
          </p>
        )}
      </details>
    </div>
  )
}
