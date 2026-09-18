/**
 * Discord send schedule (Task 165 Phase 2 step 2d, spec discord-admin-accounts.md §3.1).
 * Pure, dependency-free: imported by the Edge Function (`discordAccounts.ts`) and by the
 * browser (the admin console's schedule dropdowns).
 */

export type ScheduleSlot = 'brief' | 'full'

/** cron.job names in schema.sql §14/§13; `holdings` always moves together with `brief`. */
export const DISCORD_SCHEDULE_JOBS = {
  brief: 'discord-summary-brief',
  holdings: 'discord-holdings-daily',
  full: 'discord-summary-full',
} as const

export const DEFAULT_DISCORD_SCHEDULE = { brief: '17:05', full: '21:30' } as const

/** D2: brief 17:05–20:55 (17:00 refused, `fx/twd.json` is not ready yet), full 21:00–23:55. */
export const SCHEDULE_HOURS: Record<ScheduleSlot, readonly number[]> = {
  brief: [17, 18, 19, 20],
  full: [21, 22, 23],
}

/** Five-minute steps within an allowed hour; brief's first hour starts at :05, not :00. */
export function scheduleMinuteOptions(slot: ScheduleSlot, hour: number): number[] {
  if (!SCHEDULE_HOURS[slot].includes(hour)) return []
  const start = slot === 'brief' && hour === 17 ? 5 : 0
  const options: number[] = []
  for (let m = start; m <= 55; m += 5) options.push(m)
  return options
}

export function scheduleTimeParts(hhmm: string): { hour: number; minute: number } {
  const [hour, minute] = hhmm.split(':')
  return { hour: Number(hour), minute: Number(minute) }
}

export function isValidScheduleTime(slot: ScheduleSlot, hhmm: unknown): hhmm is string {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return false
  const { hour, minute } = scheduleTimeParts(hhmm)
  return scheduleMinuteOptions(slot, hour).includes(minute)
}

const CRON_RE = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/

/** Reads a deployed `'<minute> <UTC hour> * * 1-5'` job as Taipei ('HH:MM'), or `null`. */
export function cronToTaipeiTime(expr: string): string | null {
  const m = CRON_RE.exec(expr)
  if (!m) return null
  const minute = Number(m[1])
  const utcHour = Number(m[2])
  if (minute > 59 || utcHour > 23) return null
  const taipeiHour = utcHour + 8
  if (taipeiHour > 23) return null
  return `${String(taipeiHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export interface ScheduleView {
  brief: string | null
  full: string | null
  holdingsAligned: boolean
}

/** `rows` is `discord_schedule_get()`'s result: `{ jobname, schedule }` for the three jobs
 * (and possibly unrelated jobs, which are ignored). A missing or unparsable job reads as `null`. */
export function scheduleFromJobs(rows: Array<{ jobname: string; schedule: string }>): ScheduleView {
  const byName = new Map(rows.map((r) => [r.jobname, r.schedule]))
  const read = (jobname: string): string | null => {
    const raw = byName.get(jobname)
    return raw != null ? cronToTaipeiTime(raw) : null
  }
  const brief = read(DISCORD_SCHEDULE_JOBS.brief)
  const full = read(DISCORD_SCHEDULE_JOBS.full)
  const holdings = read(DISCORD_SCHEDULE_JOBS.holdings)
  return { brief, full, holdingsAligned: holdings != null && holdings === brief }
}
