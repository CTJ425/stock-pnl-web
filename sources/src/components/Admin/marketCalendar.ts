/**
 * Day lookups for the admin 開休市日 calendar. Every answer comes from `quoteWindow.ts` —— the same
 * `TW_HOLIDAYS` the quote path uses —— so the calendar shows exactly what decides whether MIS is asked.
 */
import {
  TW_HOLIDAYS,
  TW_HOLIDAY_YEARS,
  twIsClosedDate,
} from '../../../supabase/functions/stock-price/quoteWindow'

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

export type DayKind = 'open' | 'weekend' | 'holiday'

export interface DayInfo {
  ymd: string
  day: number
  kind: DayKind
  /** The TWSE name of a `holiday` day */
  name?: string
}

/** `YYYYMMDD` of the Taipei day containing `now` */
export function taipeiToday(now: Date = new Date()): string {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '')
}

function toUtc(ymd: string): Date {
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))))
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export function weekdayOf(ymd: string): string {
  return WEEKDAYS[toUtc(ymd).getUTCDay()]
}

export function dayInfo(ymd: string): DayInfo {
  const day = Number(ymd.slice(6, 8))
  const name = TW_HOLIDAYS.get(ymd)
  if (name) return { ymd, day, kind: 'holiday', name }
  return { ymd, day, kind: twIsClosedDate(ymd) ? 'weekend' : 'open' }
}

/** Is `year` in `TW_HOLIDAYS`? Outside it only weekends count as closed. */
export function yearCovered(year: number): boolean {
  return TW_HOLIDAY_YEARS.has(year)
}

/** Whole days from `from` to `to` (both `YYYYMMDD`) */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS)
}

/** The first trading day strictly after `ymd` (bounded: a year can never be all closed) */
export function nextTradingDay(ymd: string): string {
  let d = toUtc(ymd)
  for (let i = 0; i < 366; i++) {
    d = new Date(d.getTime() + DAY_MS)
    if (!twIsClosedDate(fromUtc(d))) return fromUtc(d)
  }
  return fromUtc(d)
}

/** The first `TW_HOLIDAYS` day strictly after `ymd`, or null when the list has none left */
export function nextHoliday(ymd: string): DayInfo | null {
  const next = [...TW_HOLIDAYS.keys()].sort().find((d) => d > ymd)
  return next ? dayInfo(next) : null
}

/** `TW_HOLIDAYS` days of one year, in date order */
export function holidaysOf(year: number): DayInfo[] {
  return [...TW_HOLIDAYS.keys()]
    .filter((d) => d.startsWith(String(year)))
    .sort()
    .map(dayInfo)
}

/**
 * One month as calendar weeks, Sunday first. Leading and trailing cells outside the month are null.
 * `month` is 1–12.
 */
export function monthWeeks(year: number, month: number): Array<Array<DayInfo | null>> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<DayInfo | null> = Array(first.getUTCDay()).fill(null)
  for (let d = 1; d <= days; d++) {
    cells.push(dayInfo(`${year}${String(month).padStart(2, '0')}${String(d).padStart(2, '0')}`))
  }
  while (cells.length % 7) cells.push(null)
  const weeks: Array<Array<DayInfo | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** `20261009` → `10月9日` */
export function fmtMonthDay(ymd: string): string {
  return `${Number(ymd.slice(4, 6))}月${Number(ymd.slice(6, 8))}日`
}
