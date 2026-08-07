/**
 * The data source of "Data Fetch Status" in the administrator's backend.
 *
 * Use Edge Function's `admin-status` (read-only summary) instead of the front-ends to get it individually. There are two reasons:
 * 1. Scheduling (`cron` schema) and observation table (`batch_run_log` / `source_probe_log`)
 *    **The front end does not have permission to read**, those tables have RLS enabled but deliberately do not have any policy.
 *    It's not cost-effective to loosen those defenses for a read-only backend.
 * 2. The entire page requires more than a dozen pieces of information, and going back and forth one by one will be very slow; it takes about 1 second for the backend to retrieve it all at once.
 *
 * Authorization is the user JWT automatically brought by `functions.invoke`, and the backend then checks `app_metadata.role`.
 * **Not CRON_SECRET** - that key cannot be entered into the front end (if it is entered, it means it is public).
 */
import { supabase } from './supabase'

/** Freshness of a single source (aligned with Edge Function’s report.ts SourceStamp)*/
export interface SourceStamp {
  date: string | null
  fetchedAt: string | null
}

export interface ScheduleRow {
  jobid: number
  jobname: string
  schedule: string
  active: boolean
  action: string | null
  /** Which area does this schedule cover? BUG-003 is that when the cron in the test area hits the official area, it can only be blocked if it is displayed.*/
  targetRef: string | null
  lastRun: string | null
  lastStatus: string | null
  /**
   * Whether the winning `lastRun` came from pg_cron or the admin console (0.6.44-dev.3).
   * Null when there is no run in the look-back window.
   */
  lastSource?: 'cron' | 'manual' | null
  runsToday: number
  failsToday: number
}

export interface AdminMacroIndicator {
  id: string
  label: string
  unit: string
  latest: { period: string; value: number | null } | null
  previous: { period: string; value: number | null } | null
  /**
   * The release date of the next issue is calculated by the backend according to the official calendar (macroCalendar.ts).
   * The front-end deliberately does not prepare its own calendar - the two constants will drift sooner or later, and the symptoms of drift
   * (The screen says 8/12, but the backend judges it as 8/14) It’s almost invisible.
   * `estimated` is true, which means the calendar has been used up and the date is calculated by rules.
   */
  nextRelease: { date: string; period: string; estimated: boolean } | null
}

export interface AdminStatus {
  asOf: string
  todayYmd: string
  schedules: ScheduleRow[]
  manifest: { ymd?: string; dataDate?: string; generatedAt?: string } | null
  chip: {
    ymd: string
    dataDate: string | null
    sources: {
      institutional: SourceStamp | null
      margin: SourceStamp | null
      borrow: SourceStamp | null
    } | null
  } | null
  /** The number of files and the number of holding files in each Storage directory are used to calculate "how many files are there in N files"*/
  coverage: { daily?: number; fundamental?: number; held?: number }
  macro: { asOf: string; checkedAt: string | null; indicators: AdminMacroIndicator[] } | null
  fx: { asOf: string; count: number } | null
  /**
   * Total market volume and capture status of the three major legal entities (0.6.32).
   *
   * The three gaps are counted separately because they represent different issues: `missingInstitutional` is the amount of no legal person throughout the day
   * (The latest one or two days are missing is normal), `missingBuySell` is the replenishment progress of 0.6.32 buy/sell (will be reset to zero),
   * `missingCandle` is the number of days on which day K cannot be drawn. The decision rules are in the front end, and the back end only spits out facts.
   */
  market: {
    schema: number | null
    asOf: string | null
    days: number
    latestDate: string | null
    latestInstitutionalDate: string | null
    missingInstitutional: number
    missingBuySell: number
    missingCandle: number
  } | null
  batch: { runsToday?: number; runSig?: string | null } | null
  probe: {
    taipei_ymd?: string
    taipei_time?: string
    bwibbu_ok?: boolean
    bwibbu_date?: string
    bwibbu_rows?: number
    borrow_ok?: boolean
    borrow_date?: string
    borrow_rows?: number
  } | null
  durationMs: number
}

/** Whether the caller is an administrator (`app_metadata.role === 'admin'`).
 *
 * `app_metadata` can only be written by service role / Dashboard, users cannot change their own ——
 * This is the reason why it is more suitable as the authorization basis than email (email users can change it by themselves).
 * **This criterion must be consistent with `assertAdmin` of Edge Function**, drift on both sides will occur
 * "Pagination is visible on the screen but the API returns 403" is a difficult-to-check situation.
 */
export async function isAdmin(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return false
    const meta = data.user.app_metadata as Record<string, unknown> | undefined
    return meta?.role === 'admin'
  } catch {
    return false
  }
}

/** Read background summary. Check if there is no / no permission and return null (error will not be thrown, compare with other proxies)*/
export async function fetchAdminStatus(): Promise<AdminStatus | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-status' },
    })
    if (error || !data || (data as { ok?: boolean }).ok !== true) return null
    const d = data as Partial<AdminStatus>
    return {
      asOf: typeof d.asOf === 'string' ? d.asOf : '',
      todayYmd: typeof d.todayYmd === 'string' ? d.todayYmd : '',
      schedules: Array.isArray(d.schedules)
        ? d.schedules.map((raw) => {
            const s = raw as Partial<ScheduleRow>
            const src = s.lastSource
            return {
              jobid: typeof s.jobid === 'number' ? s.jobid : 0,
              jobname: typeof s.jobname === 'string' ? s.jobname : '',
              schedule: typeof s.schedule === 'string' ? s.schedule : '',
              active: s.active === true,
              action: typeof s.action === 'string' ? s.action : null,
              targetRef: typeof s.targetRef === 'string' ? s.targetRef : null,
              lastRun: typeof s.lastRun === 'string' ? s.lastRun : null,
              lastStatus: typeof s.lastStatus === 'string' ? s.lastStatus : null,
              lastSource: src === 'cron' || src === 'manual' ? src : null,
              runsToday: typeof s.runsToday === 'number' ? s.runsToday : 0,
              failsToday: typeof s.failsToday === 'number' ? s.failsToday : 0,
            } satisfies ScheduleRow
          })
        : [],
      manifest: d.manifest ?? null,
      chip: d.chip ?? null,
      coverage: d.coverage ?? {},
      macro: d.macro ?? null,
      fx: d.fx ?? null,
      market: d.market ?? null,
      batch: d.batch ?? null,
      probe: d.probe ?? null,
      durationMs: typeof d.durationMs === 'number' ? d.durationMs : 0,
    }
  } catch {
    return null
  }
}
