import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISCORD_SCHEDULE,
  DISCORD_SCHEDULE_JOBS,
  SCHEDULE_OPTIONS,
  cronToTaipeiTime,
  isValidScheduleTime,
  scheduleFromJobs,
  scheduleTimeParts,
} from './discordSchedule.ts'

describe('schedule options', () => {
  it('names the two cron jobs and the defaults', () => {
    expect(DISCORD_SCHEDULE_JOBS).toEqual({
      brief: 'discord-summary-brief',
      full: 'discord-summary-full',
    })
    expect(DEFAULT_DISCORD_SCHEDULE).toEqual({ brief: '17:30', full: '21:30' })
  })

  it('offers every half hour: brief 17:30–20:30, full 21:00–23:30', () => {
    expect(SCHEDULE_OPTIONS.brief).toEqual(['17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'])
    expect(SCHEDULE_OPTIONS.full).toEqual(['21:00', '21:30', '22:00', '22:30', '23:00', '23:30'])
  })

  it('offers both defaults', () => {
    expect(SCHEDULE_OPTIONS.brief).toContain(DEFAULT_DISCORD_SCHEDULE.brief)
    expect(SCHEDULE_OPTIONS.full).toContain(DEFAULT_DISCORD_SCHEDULE.full)
  })
})

describe('isValidScheduleTime', () => {
  it.each(['17:30', '18:00', '20:30'])('accepts brief %s', (t) => {
    expect(isValidScheduleTime('brief', t)).toBe(true)
  })

  it.each(['21:00', '21:30', '23:30'])('accepts full %s', (t) => {
    expect(isValidScheduleTime('full', t)).toBe(true)
  })

  it.each(['17:00', '17:05', '16:30', '21:00', '18:05', '18:15', '20:55'])('refuses brief %s', (t) => {
    expect(isValidScheduleTime('brief', t)).toBe(false)
  })

  it.each(['20:30', '21:05', '21:15', '23:55', '24:00', '00:00'])('refuses full %s', (t) => {
    expect(isValidScheduleTime('full', t)).toBe(false)
  })

  it.each([null, undefined, 1730, '', '7:30', '17:3', '17:30 ', ' 17:30', '17-30', '17:30:00', '１７:３０'])(
    'refuses malformed %j',
    (t) => {
      expect(isValidScheduleTime('brief', t)).toBe(false)
    },
  )
})

describe('scheduleTimeParts', () => {
  it('splits HH:MM into numbers', () => {
    expect(scheduleTimeParts('17:05')).toEqual({ hour: 17, minute: 5 })
    expect(scheduleTimeParts('21:30')).toEqual({ hour: 21, minute: 30 })
  })
})

describe('cronToTaipeiTime', () => {
  it('reads the deployed weekday jobs as Taipei time', () => {
    expect(cronToTaipeiTime('5 9 * * 1-5')).toBe('17:05')
    expect(cronToTaipeiTime('30 13 * * 1-5')).toBe('21:30')
    expect(cronToTaipeiTime('15 9 * * 1-5')).toBe('17:15')
    expect(cronToTaipeiTime('55 15 * * 1-5')).toBe('23:55')
    expect(cronToTaipeiTime('0 1 * * 1-5')).toBe('09:00')
  })

  it.each(['*/15 8-15 * * 1-5', '5 9 * * *', '5 9 * * 1-6', '60 9 * * 1-5', '5 24 * * 1-5', '5 16 * * 1-5', '', 'x 9 * * 1-5'])(
    'returns null for %j',
    (expr) => {
      expect(cronToTaipeiTime(expr)).toBeNull()
    },
  )
})

describe('scheduleFromJobs', () => {
  const BRIEF = { jobname: 'discord-summary-brief', schedule: '5 9 * * 1-5' }
  const FULL = { jobname: 'discord-summary-full', schedule: '30 13 * * 1-5' }

  it('reads brief and full in any row order', () => {
    // Task 165 step 2f (D5): `discord-holdings-daily` is retired, and a row for it must simply be
    // ignored rather than contribute a third field.
    const rows = [FULL, { jobname: 'discord-holdings-daily', schedule: '5 9 * * 1-5' }, BRIEF]
    expect(scheduleFromJobs(rows)).toEqual({ brief: '17:05', full: '21:30' })
  })


  it('reports a missing or unreadable job as null', () => {
    expect(scheduleFromJobs([])).toEqual({ brief: null, full: null })
    const rows = [{ jobname: 'discord-summary-brief', schedule: '*/5 * * * *' }, FULL]
    expect(scheduleFromJobs(rows)).toEqual({ brief: null, full: '21:30' })
  })

  it('ignores unrelated jobs', () => {
    const rows = [BRIEF, FULL, { jobname: 'app-log-prune', schedule: '20 3 * * *' }]
    expect(scheduleFromJobs(rows).brief).toBe('17:05')
  })
})
