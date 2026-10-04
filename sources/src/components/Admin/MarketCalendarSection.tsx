/**
 * 台股開休市日（管理員後台，0.10.26）。
 *
 * 現價要不要向證交所 MIS 抓，看的是 `quoteWindow.ts` 的 `TW_HOLIDAYS`（BUG-110：休市日 MIS 會送出測試盤假價格）。
 * 這頁把那份清單原樣攤開：今天開不開市、下一個交易日、整年的休市日，以及清單還沒涵蓋的年份。
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  WEEKDAYS,
  dayInfo,
  daysBetween,
  fmtMonthDay,
  holidaysOf,
  monthWeeks,
  nextHoliday,
  nextTradingDay,
  taipeiToday,
  weekdayOf,
  yearCovered,
  type DayInfo,
} from './marketCalendar'

const SOURCE_URL = 'https://www.twse.com.tw/zh/trading/holiday.html'
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

function dayLabel(d: DayInfo): string {
  const base = `${fmtMonthDay(d.ymd)}（${weekdayOf(d.ymd)}）`
  if (d.kind === 'holiday') return `${base} 休市：${d.name}`
  if (d.kind === 'weekend') return `${base} 休市：週末`
  return `${base} 開市`
}

function relative(today: string, ymd: string): string {
  const n = daysBetween(today, ymd)
  if (n === 0) return '今天'
  return n > 0 ? `${n} 天後` : '已過'
}

function MonthGrid({ year, month, today }: { year: number; month: number; today: string }) {
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

export function MarketCalendarSection({ now }: { now?: Date } = {}) {
  const today = taipeiToday(now)
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)

  const t = dayInfo(today)
  const closed = t.kind !== 'open'
  const nextOpen = nextTradingDay(today)
  const nextOff = nextHoliday(today)
  const holidays = holidaysOf(year)
  const covered = yearCovered(year)

  return (
    <div className="section glass mcal">
      <div className="rpt-section-head">
        <h3 className="head-tight">台股開休市日</h3>
        <span className="source-tag">依證交所「市場開休市日期」</span>
      </div>

      <div className="mcal-today-block">
        <div className="mcal-today-main">
          <span className="mcal-label">今天</span>
          <span className="mcal-date">
            {fmtMonthDay(today)}（{weekdayOf(today)}）
          </span>
          <span className={closed ? 'mcal-state mcal-state-closed' : 'mcal-state'}>
            {closed ? `休市・${t.kind === 'holiday' ? t.name : '週末'}` : '開市'}
          </span>
          <p className="mcal-effect">
            {closed
              ? '今天不向證交所即時報價抓價，現價停在上一個交易日的收盤。'
              : '08:25–13:30 每分鐘向證交所即時報價更新現價。'}
          </p>
        </div>
        <dl className="mcal-next">
          <div>
            <dt>下一個交易日</dt>
            <dd>
              {fmtMonthDay(nextOpen)}（{weekdayOf(nextOpen)}）
              <span className="mcal-sub">{relative(today, nextOpen)}</span>
            </dd>
          </div>
          <div>
            <dt>下一個平日休市</dt>
            <dd>
              {nextOff ? (
                <>
                  {fmtMonthDay(nextOff.ymd)}（{weekdayOf(nextOff.ymd)}）
                  <span className="mcal-sub">
                    {nextOff.name}・{relative(today, nextOff.ymd)}
                  </span>
                </>
              ) : (
                <>
                  —<span className="mcal-sub">清單裡沒有更晚的休市日</span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mcal-yearbar">
        <button
          type="button"
          className="btn btn-sm btn-icon btn-ghost"
          onClick={() => setYear(year - 1)}
          aria-label="上一年"
        >
          <ChevronLeft size={16} />
        </button>
        <h4 className="mcal-year" aria-live="polite">
          {year} 年
        </h4>
        <button
          type="button"
          className="btn btn-sm btn-icon btn-ghost"
          onClick={() => setYear(year + 1)}
          aria-label="下一年"
        >
          <ChevronRight size={16} />
        </button>
        {year !== thisYear && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setYear(thisYear)}>
            回到今年
          </button>
        )}
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
      </div>

      {!covered && (
        <div className="notice notice-warn mcal-notice" role="status">
          <span>
            {year} 年的休市日還沒放進清單，這一年只把週末當休市：平日休市那天仍會向證交所抓價，可能抓到測試盤的假價格。
            證交所公布後更新 <code>quoteWindow.ts</code> 的 <code>TW_HOLIDAYS</code>（每年 12 月）。
          </span>
        </div>
      )}

      <div className="mcal-grid">
        {MONTHS.map((m) => (
          <MonthGrid key={m} year={year} month={m} today={today} />
        ))}
      </div>

      {covered && (
        <table className="mcal-list">
          <caption>{year} 年平日休市（{holidays.length} 天）</caption>
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">星期</th>
              <th scope="col">名稱</th>
              <th scope="col" className="mcal-list-rel">距今</th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((d) => (
              <tr key={d.ymd} className={d.ymd < today ? 'mcal-past' : undefined}>
                <td>{fmtMonthDay(d.ymd)}</td>
                <td>{weekdayOf(d.ymd)}</td>
                <td>{d.name}</td>
                <td className="mcal-list-rel">{relative(today, d.ymd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="ast-note mcal-foot">
        清單來源：<a href={SOURCE_URL} target="_blank" rel="noreferrer">證交所市場開休市日期</a>。
        只列平日不交易的日子；證交所表上的「開始交易日」「最後交易日」照常開市，不列入；落在週末的國定假日本來就休市，也不另列。
        「市場無交易，僅辦理結算交割作業」那幾天沒有交易，算休市。
      </p>
    </div>
  )
}
