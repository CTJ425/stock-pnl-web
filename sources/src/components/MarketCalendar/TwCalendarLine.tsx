/**
 * 台股開休市 for every user (0.10.26): a footnote at the bottom of 總經 → 國際指數, and the year
 * behind a disclosure. A footnote, not a line under the 台灣 group: the owner found a sentence
 * between the TW rows and 日本 broke the list (2026-10-04). The admin page has the operator's version
 * (why MIS is skipped, uncovered years in detail); this one only answers "is the market open, and when
 * is it next closed".
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

  const offText =
    off && off.ymd.startsWith(String(year))
      ? `下一個平日休市 ${md(off.ymd)} ${off.name}${t.kind === 'open' ? `，${daysBetween(today, off.ymd)} 天後` : ''}。`
      : '今年沒有其他平日休市了。'
  const todayText =
    t.kind === 'open'
      ? '今天開市。'
      : `今天休市（${t.kind === 'holiday' ? t.name : '週末'}），下一個交易日 ${md(nextTradingDay(today))}。`
  const status = `台股：${todayText}${covered ? offText : `${year} 年休市日還沒更新。`}`

  return (
    <div className="mcal-line" id="tw-calendar" ref={ref}>
      <p className="mcal-line-text">{status}</p>
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
