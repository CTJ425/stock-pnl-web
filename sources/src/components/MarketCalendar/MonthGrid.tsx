/**
 * One ruled month of the TW market calendar, and the legend that reads it. Shared by the admin
 * 開休市日 page and the 總經 台股 disclosure, so both draw the same `TW_HOLIDAYS`.
 */
import { WEEKDAYS, fmtMonthDay, monthWeeks, weekdayOf, type DayInfo } from './marketCalendar'

export function dayLabel(d: DayInfo): string {
  const base = `${fmtMonthDay(d.ymd)}（${weekdayOf(d.ymd)}）`
  if (d.kind === 'holiday') return `${base} 休市：${d.name}`
  if (d.kind === 'weekend') return `${base} 休市：週末`
  return `${base} 開市`
}

export function MonthGrid({ year, month, today }: { year: number; month: number; today: string }) {
  return (
    <table className="mcal-month">
      <caption>{month} 月</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((w) => (
            <th key={w} scope="col" className={w === '日' || w === '六' ? 'mcal-wkend' : undefined}>
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthWeeks(year, month).map((week, i) => (
          <tr key={i}>
            {week.map((d, j) =>
              d ? (
                <td
                  key={j}
                  className={`mcal-day mcal-${d.kind}${d.ymd === today ? ' mcal-today' : ''}`}
                  title={dayLabel(d)}
                  aria-label={dayLabel(d) + (d.ymd === today ? '（今天）' : '')}
                  aria-current={d.ymd === today ? 'date' : undefined}
                >
                  {d.day}
                </td>
              ) : (
                <td key={j} aria-hidden="true" />
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function CalendarLegend() {
  return (
    <ul className="mcal-legend" aria-label="圖例">
      <li>
        <span className="mcal-swatch mcal-holiday" aria-hidden="true" />
        平日休市
      </li>
      <li>
        <span className="mcal-swatch mcal-weekend" aria-hidden="true" />
        週末
      </li>
      <li>
        <span className="mcal-swatch mcal-today" aria-hidden="true" />
        今天
      </li>
    </ul>
  )
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export function YearGrid({ year, today }: { year: number; today: string }) {
  return (
    <div className="mcal-grid">
      {MONTHS.map((m) => (
        <MonthGrid key={m} year={year} month={m} today={today} />
      ))}
    </div>
  )
}
