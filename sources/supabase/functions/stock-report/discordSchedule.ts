/**
 * Discord send schedule (Task 165 Phase 2 step 2d, spec discord-admin-accounts.md §9.1,
 * overriding §3.1). Pure, dependency-free: imported by the Edge Function
 * (`discordAccounts.ts`, `discordMySettings.ts`) and by the browser — since Task 165 step 2g
 * (spec discord-admin-slim.md D1) the only browser importer is the per-account self-service
 * page `Settings/DiscordMySettings.tsx`; the admin console has no schedule dropdowns.
 */

export type ScheduleSlot = 'brief' | 'full'

/** cron.job names in schema.sql §13. `discord-holdings-daily` is retired (Task 165 step 2f,
 * D5) — its work moved to the per-account tick, which is not on this schedule. */
export const DISCORD_SCHEDULE_JOBS = {
  brief: 'discord-summary-brief',
  full: 'discord-summary-full',
} as const

/** No runtime caller since step 2g removed the admin console's drop-downs; kept as the written
 * definition of the two global times, and asserted against `SCHEDULE_OPTIONS` in the tests. */
export const DEFAULT_DISCORD_SCHEDULE = { brief: '17:30', full: '21:30' } as const

/** §9.1: every half hour. Brief 17:30–20:30 (17:05/17:00 no longer offered), full 21:00–23:30. */
function halfHourRange(startHour: number, startMinute: 0 | 30, endHour: number, endMinute: 0 | 30): readonly string[] {
  const options: string[] = []
  let hour = startHour
  let minute: 0 | 30 = startMinute
  while (hour < endHour || (hour === endHour && minute <= endMinute)) {
    options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    if (minute === 0) {
      minute = 30
    } else {
      minute = 0
      hour += 1
    }
  }
  return options
}

export const SCHEDULE_OPTIONS: Record<ScheduleSlot, readonly string[]> = {
  brief: halfHourRange(17, 30, 20, 30),
  full: halfHourRange(21, 0, 23, 30),
}

export function scheduleTimeParts(hhmm: string): { hour: number; minute: number } {
  const [hour, minute] = hhmm.split(':')
  return { hour: Number(hour), minute: Number(minute) }
}

export function isValidScheduleTime(slot: ScheduleSlot, hhmm: unknown): hhmm is string {
  if (typeof hhmm !== 'string') return false
  return (SCHEDULE_OPTIONS[slot] as readonly string[]).includes(hhmm)
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
}

/** `rows` is `discord_schedule_get()`'s result: `{ jobname, schedule }` for the two jobs
 * (and possibly unrelated jobs, which are ignored). A missing or unparsable job reads as `null`. */
export function scheduleFromJobs(rows: Array<{ jobname: string; schedule: string }>): ScheduleView {
  const byName = new Map(rows.map((r) => [r.jobname, r.schedule]))
  const read = (jobname: string): string | null => {
    const raw = byName.get(jobname)
    return raw != null ? cronToTaipeiTime(raw) : null
  }
  const brief = read(DISCORD_SCHEDULE_JOBS.brief)
  const full = read(DISCORD_SCHEDULE_JOBS.full)
  return { brief, full }
}
