/**
 * Trading-session state for the foreign indices panel (task 162).
 *
 * Pure functions only: no fetch, no timers. `GlobalIndices.tsx` owns the poll loop and
 * calls these on every tick to decide which regions to fetch and what badge to show.
 *
 * DST correctness: the session bounds are always in each market's own local time
 * (Asia/Tokyo, Asia/Seoul, America/New_York). `Intl.DateTimeFormat` with an explicit
 * `timeZone` resolves the local wall-clock time for any instant, so no hardcoded UTC
 * offset is needed — America/New_York flips between EST and EDT on its own.
 */

export type MarketRegion = 'TW' | 'JP' | 'KR' | 'US'
export type SessionState = 'open' | 'break' | 'closed'

export interface SessionHours {
  /** Local trading hours, e.g. '09:00–15:30'. */
  local: string
  /** Same window in Taipei time, e.g. '08:00–14:30'. */
  taipei: string
  /** Lunch break in local time, or null. */
  breakLocal: string | null
}

export const SESSION_HOURS: Record<MarketRegion, SessionHours> = {
  TW: {
    local: '09:00–13:30',
    taipei: '09:00–13:30',
    breakLocal: null,
  },
  JP: {
    local: '09:00–15:30',
    taipei: '08:00–14:30',
    breakLocal: '11:30–12:30',
  },
  KR: {
    local: '09:00–15:30',
    taipei: '08:00–14:30',
    breakLocal: null,
  },
  US: {
    local: '09:30–16:00',
    taipei: '21:30–04:00（夏令）/ 22:30–05:00（冬令）',
    breakLocal: null,
  },
}

interface SessionRule {
  timeZone: string
  /** Minutes since local midnight. Open bound inclusive, close bound exclusive. */
  openMin: number
  closeMin: number
  /** Break bound, inclusive start / exclusive end. `null` when the market has no break. */
  breakStartMin: number | null
  breakEndMin: number | null
}

const RULES: Record<MarketRegion, SessionRule> = {
  TW: {
    timeZone: 'Asia/Taipei',
    openMin: 9 * 60,
    closeMin: 13 * 60 + 30,
    breakStartMin: null,
    breakEndMin: null,
  },
  JP: {
    timeZone: 'Asia/Tokyo',
    openMin: 9 * 60,
    closeMin: 15 * 60 + 30,
    breakStartMin: 11 * 60 + 30,
    breakEndMin: 12 * 60 + 30,
  },
  KR: {
    timeZone: 'Asia/Seoul',
    openMin: 9 * 60,
    closeMin: 15 * 60 + 30,
    breakStartMin: null,
    breakEndMin: null,
  },
  US: {
    timeZone: 'America/New_York',
    openMin: 9 * 60 + 30,
    closeMin: 16 * 60,
    breakStartMin: null,
    breakEndMin: null,
  },
}

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

/** Local weekday (short, e.g. 'Mon') and minutes since local midnight, in `timeZone`. */
function localParts(timeZone: string, now: Date): { weekday: string; minutes: number } {
  // hourCycle: 'h23' (not hour12: false) — hour12: false can still return hour '24' for midnight.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = get('weekday')
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  return { weekday, minutes: hour * 60 + minute }
}

/** Session state of `region` at instant `now` (local time of that market, DST-aware). */
export function marketSession(region: MarketRegion, now: Date): SessionState {
  const rule = RULES[region]
  const { weekday, minutes } = localParts(rule.timeZone, now)
  if (!WEEKDAYS.has(weekday)) return 'closed'
  if (minutes < rule.openMin || minutes >= rule.closeMin) return 'closed'
  if (
    rule.breakStartMin !== null &&
    rule.breakEndMin !== null &&
    minutes >= rule.breakStartMin &&
    minutes < rule.breakEndMin
  ) {
    return 'break'
  }
  return 'open'
}

/** True only for `'open'` — a lunch break is not "open" even though the market is not closed either. */
export function isMarketOpen(region: MarketRegion, now: Date): boolean {
  return marketSession(region, now) === 'open'
}

/** Regions currently open, in a fixed display order. */
export function openRegions(now: Date): MarketRegion[] {
  return (['TW', 'JP', 'KR', 'US'] as const).filter((region) => isMarketOpen(region, now))
}

/** True when at least one region is open. */
export function anyMarketOpen(now: Date): boolean {
  return openRegions(now).length > 0
}
