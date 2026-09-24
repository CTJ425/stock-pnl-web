/** Admin console actions (`admin-*`, `app-logs`). Every one sits behind assertAdmin in index.ts's route table. */
import { db, json } from './runtime.ts'
import type { GenerateReportRequestBody } from './requestBody.ts'
import { REPORTS_BUCKET, downloadJson, heldTwTickers, pagedSelect, readLastRun } from './dataAccess.ts'
import { logEvent } from '../_shared/log.ts'
import { dashDate, taipeiYmd } from './report.ts'
import { MAX_SCANS_PER_DAY, decideMacroScan, nextReleaseFor } from './macroCalendar.ts'
import type { MacroFile } from './usMacro.ts'
import type { MarketFile } from './twMarket.ts'
import type { FxFile } from './fxRates.ts'
import { PROBE_SOURCE_LABELS, PROBE_SOURCE_ORDER } from './sourceProbePlan.ts'
import {
  isValidBackupPath,
  parseBackupDocument,
  restoreFailureMessage,
  rowsToInsert,
  summarizeAccountBackups,
} from './backupAdmin.ts'

/**
 * The data source of "Data Fetch Status" in the administrator's backend.
 *
 * Get everything you need from the entire page at once. The reason is that it will turn into more than a dozen round trips on the front end to type them one by one.
 * And some of them (cron schedule, observation table) the front end does not have permission to read at all——
 * `batch_run_log` / `source_probe_log` has RLS enabled but deliberately does not have any policy.
 * The `cron` schema is also not among PostgREST's exposed schemas.
 * Instead of loosening those defense lines for a read-only backend, it is better to let the service role be read here and then spit out.
 *
 * ⚠️ The returned content is selected, **does not contain any key**: the schedule only takes jobname/schedule/action/
 * Target ref (see `admin_schedule_status` in schema.sql §11 for a more complete description).
 */
export async function handleAdminStatus(): Promise<Response> {
  const startedAt = Date.now()
  const now = new Date()
  const todayYmd = taipeiYmd(now)

  // Each paragraph is independent of each other. If any paragraph fails, the entire page should not be blank. The missing paragraph is represented by null:
  // The items that will be thrown (rpc / readLastRun / direct table lookup) are each linked to .catch(() => null),
  // downloadJson and latestChipSources/storageCoverage themselves swallow exceptions and return null.
  // Last ~2 Taipei calendar days for probe experiment (yyyyMMdd)
  const ymdDash = dashDate(todayYmd)
  const d0 = new Date(`${ymdDash}T12:00:00+08:00`)
  d0.setDate(d0.getDate() - 1)
  const yestYmd = taipeiYmd(d0)

  const [schedules, manifest, macro, fx, lastRun, probe, probeTicks, chip, coverage, market] =
    await Promise.all([
      db
        .rpc('admin_schedule_status')
        .then((r: { data: unknown }) => r.data ?? null)
        .catch(() => null),
      downloadJson<{ ymd?: string; dataDate?: string; generatedAt?: string }>('manifest.json'),
      downloadJson<MacroFile>('macro/us.json'),
      downloadJson<FxFile>('fx/twd.json'),
      readLastRun(todayYmd).catch(() => null),
      db
        .from('source_probe_log')
        .select(
          'taipei_ymd, taipei_time, bwibbu_ok, bwibbu_date, bwibbu_rows, borrow_ok, borrow_date, borrow_rows, probed_at',
        )
        .order('id', { ascending: false })
        .limit(1)
        .then((r: { data: unknown[] | null }) => r.data?.[0] ?? null)
        .catch(() => null),
      // BUG-066: `.limit(2000)` here is dead — PostgREST's server-side max_rows (1000) caps the
      // response before a client-side `.limit()` above it can have any effect, so this used to
      // read as though the cap had been raised when it hadn't. Page through pagedSelect instead.
      pagedSelect<Record<string, unknown>>((from, to) =>
        db
          .from('source_probe_tick')
          .select(
            'taipei_ymd, taipei_time, source, hit, ok, data_ymd, fingerprint, rows, note, duration_ms, probed_at',
          )
          .in('taipei_ymd', [todayYmd, yestYmd])
          .order('id', { ascending: true })
          .range(from, to),
      )
        .then((r) => (r.error ? [] : r.data))
        .catch(() => [] as unknown[]),
      latestChipSources(),
      storageCoverage(),
      downloadJson<MarketFile>('market/daily.json'),
    ])

  return json({
    ok: true,
    asOf: now.toISOString(),
    todayYmd,
    schedules,
    manifest,
    chip,
    coverage,
    macro: macro
      ? {
          asOf: macro.asOf,
          checkedAt: macro.checkedAt ?? null,
          indicators: (macro.indicators ?? []).map((i) => ({
            id: i.id,
            label: i.label,
            unit: i.unit,
            latest: i.latest,
            previous: i.previous,
            // Calculated by the backend, the frontend no longer prepares its own calendar (the two constants will drift sooner or later)
            nextRelease: nextReleaseFor(i.id, i.latest?.period ?? null, now),
          })),
        }
      : null,
    fx: fx ? { asOf: fx.asOf, count: fx.currencies?.length ?? 0 } : null,
    market: marketStatus(market),
    batch: lastRun,
    probe,
    /** 0.7.3 multi-source probe experiment (hit/miss per 5-min slot) */
    probeExperiment: {
      mode: 'probe-only',
      labels: PROBE_SOURCE_LABELS,
      order: PROBE_SOURCE_ORDER,
      ticks: Array.isArray(probeTicks) ? probeTicks : [],
      /*
        0.7.13 —— macro is **not** a `source_probe_tick` source, but it is a probe. Its hit rule lives
        inside `sync-macro` as `decideMacroScan`: the official BLS/BEA release calendar decides
        「這一輪到底該不該問 FRED」, 「once caught, don't catch」 retires it for the day, and a round that
        decides not to ask makes zero external requests. That is the same shape as `pendingSources`,
        just carried by `macro-daily`'s every-30-minute tick instead of `source-probe`'s 5-minute one.

        The panel showed six sources and silently omitted this one, which made macro look
        schedule-driven-and-blind next to sources that visibly wait for publication. Surfacing the
        decision here costs nothing: `decideMacroScan` is pure, and `macro/us.json` is already
        downloaded above for the `macro` block. Deliberately **read-only** —— this reports what the
        next `sync-macro` round would decide; it does not move the trigger.
      */
      macroScan: macro
        ? (() => {
            const scansToday =
              macro.scansToday?.ymd === todayYmd ? (macro.scansToday?.n ?? 0) : 0
            const d = decideMacroScan({
              now,
              indicators: (macro.indicators ?? []).map((i) => ({
                id: i.id,
                latestPeriod: i.latest?.period ?? null,
              })),
              scansToday,
              lastScanYmd: macro.scansToday?.ymd ?? null,
            })
            return {
              scan: d.scan,
              reason: d.reason,
              dueIds: d.dueIds,
              scansToday,
              cap: MAX_SCANS_PER_DAY,
              checkedAt: macro.checkedAt ?? null,
            }
          })()
        : null,
    },
    durationMs: Date.now() - startedAt,
  })
}

/**
 * The crawling status of all market data (0.6.32).
 *
 * The three gaps are numbered separately because they represent different problems:
 * - `missingInstitutional`: No legal entity amount throughout the day. The latest one or two days are normal (announced only at 15:00, supplemented daily),
 *   But if even the old days are missing, it means that the replenishment schedule is not running.
 * - `missingBuySell`: There is a difference and no buying/selling. This is the replenishment progress bar of 0.6.32,
 *   It will be reset to zero every 5 days in each round; once it reaches zero, it should not be increased.
 * - `missingCandle`: The days when the opening high and low are missing and the day K cannot be drawn.
 *
 * There is no determination of "delay or not" here - the determination rules are all left in the front-end timeline.ts (pure function, with tests).
 * The backend just spits out facts. Sooner or later, both sides will be inconsistent.
 */
export function marketStatus(m: MarketFile | null) {
  if (!m) return null
  const days = Array.isArray(m.days) ? m.days : []
  const withInst = days.filter((d) => d?.institutional)
  return {
    schema: m.schema ?? null,
    asOf: m.asOf ?? null,
    days: days.length,
    /** The latest trading day (regardless of whether there is a legal person amount)*/
    latestDate: days[days.length - 1]?.date ?? null,
    /** The latest trading day with legal person amount**. One or two days difference from the previous item is a normal compensation time difference.*/
    latestInstitutionalDate: withInst[withInst.length - 1]?.date ?? null,
    missingInstitutional: days.length - withInst.length,
    missingBuySell: withInst.filter((d) => !d.institutional?.buy).length,
    missingCandle: days.filter((d) => d?.taiexOpen == null).length,
  }
}

/**
 * The data dates and capture times of the three chip sources in the latest report.
 *
 * Just point the manifest to **any file** of that day - `sources` is shared by the entire batch (written in the same round of batches),
 * Not per-ticker information. Picking the first file is much cheaper than downloading all 18 files back.
 */
export async function latestChipSources(): Promise<unknown> {
  const manifest = await downloadJson<{ ymd?: string }>('manifest.json')
  const ymd = manifest?.ymd
  if (!ymd) return null
  const { data } = await db.storage.from(REPORTS_BUCKET).list(ymd, { limit: 1 })
  const first = data?.[0]?.name
  if (!first) return null
  const rep = await downloadJson<{ dataDate?: string; sources?: unknown; notes?: unknown }>(
    `${ymd}/${first}`,
  )
  const inner = (rep as { data?: { dataDate?: string; sources?: unknown; notes?: unknown } })?.data ?? rep
  return inner ? { ymd, dataDate: inner.dataDate ?? null, sources: inner.sources ?? null } : null
}

/**
 * The number of files in each Storage directory is used to calculate "how many files are there among the 18 files."
 *
 * Just count the quantity, do not download the content - download 18 JSONs file by file just to see the timestamp.
 * This will change the endpoint from 2 seconds to more than ten seconds, and the only thing on the screen is the numerator and denominator.
 */
export async function storageCoverage(): Promise<Record<string, number | null>> {
  const dirs = ['daily', 'fundamental']
  const out: Record<string, number | null> = {}
  await Promise.all(
    dirs.map(async (d) => {
      // `list()` fails without throwing — { data: null, error }. Reading only `data` turned a failed
      // lookup into "0 files", which an operator cannot tell apart from a genuinely empty directory
      // (AUDIT-2026-09-04 #5). `null` here means "lookup failed", not "empty".
      const { data, error } = await db.storage.from(REPORTS_BUCKET).list(d, { limit: 1000 })
      out[d] = error
        ? null
        : (data ?? []).filter((f: { name: string }) => f.name.endsWith('.json')).length
    }),
  )
  try {
    out.held = (await heldTwTickers()).length
  } catch {
    out.held = null
  }
  return out
}

/**
 * Account list in the management background (0.6.19).
 *
 * **Why you must use Edge Function**: `auth.users` is not in the exposed schemas of PostgREST.
 * The front end cannot find the user's JWT no matter how you look it up; there is no profiles table for the project to map.
 * Only service role can be read, so read it here and then spit it out.
 *
 * ⚠️ The returned content is selected: only id/email/creation time/recent activities/whether you are an administrator.
 * **Do not return the full text of `app_metadata` or `user_metadata` - there may be other fields in there,
 * Always forwarding it means making future additions public.
 *
 * ⚠️ **`lastActiveAt` takes `updated_at`, not `last_sign_in_at`** (0.6.20 fix).
 * `last_sign_in_at` is only updated when "really logging in again", and accounts that rely on refresh tokens to survive
 * It will always stop at a very old time - actual test official area: a certain account `last_sign_in_at` stopped at 08-02 17:17,
 * But the `auth.sessions.refreshed_at` for the same account is 08-04 12:53, so the screen looks broken.
 * `updated_at` will be updated along with the session (the difference between actual measurement and `refreshed_at` is 0.02 seconds),
 * Moreover, `listUsers()` already returns it, so there is no need to check `auth.sessions`.
 */
export async function handleAdminUsers(): Promise<Response> {
  const startedAt = Date.now()
  // DB-03: `listUsers` pages independently of PostgREST's max_rows — hardcoding page: 1 silently
  // drops every account past perPage once the project grows past one page, same bug
  // handleAdminBackups already guards against (BUG-066). Loop upward until a page comes back short.
  const perPage = 1000
  const rawUsers: Array<{
    id: string
    email?: string | null
    created_at?: string | null
    updated_at?: string | null
    app_metadata?: unknown
  }> = []
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) return json({ error: error.message }, 500)
    const batch = data?.users ?? []
    rawUsers.push(...batch)
    if (batch.length < perPage) break
  }
  const users = rawUsers.map((u) => ({
    id: u.id,
    email: u.email ?? '',
    createdAt: u.created_at ?? null,
    lastActiveAt: u.updated_at ?? null,
    admin: (u.app_metadata as Record<string, unknown> | undefined)?.role === 'admin',
  }))
  // New accounts are listed first, and administrators usually look for "the one who just registered"
  users.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return json({ ok: true, users, durationMs: Date.now() - startedAt })
}

/**
 * Assign or revoke administrator privileges (0.6.19).
 *
 * What is written is `app_metadata.role`, which is the same field that `assertAdmin` and data table RLS interpret.
 * **Must write `app_metadata` instead of `user_metadata`** - the latter can be changed by the user.
 * Using it as a basis for permissions means that anyone can turn themselves into an administrator.
 *
 * ⚠️ **After the change is completed, the account will not take effect until you log in again**: The permissions are baked in the issued JWT.
 * The old token will still carry the old identity until it expires. The front end must write this thing on the screen,
 * Otherwise, it will be regarded as "no response after pressing".
 *
 * ⚠️ **You are not allowed to cancel your own administrator privileges**: This is the only operation that will lock people out——
 * You may be the only administrator left in the entire site. After the recovery, you will not even be able to enter the backend, so you can only go back to the SQL Editor and make manual changes.
 */
/**
 * AD-02: how many of `listUsers`'s pages are administrators right now. `listUsers` pages
 * independently of PostgREST's max_rows, same as handleAdminBackups already guards for. Used both
 * to gate a revoke before it runs and, after it runs, to catch a lost-update race between two
 * concurrent revokes of two *different* admins that could each individually pass the pre-check.
 */
export async function countAdmins(): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const perPage = 1000
  let adminCount = 0
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) return { ok: false, message: error.message }
    const batch: Array<{ app_metadata?: unknown }> = data?.users ?? []
    adminCount += batch.filter(
      (u) => (u.app_metadata as Record<string, unknown> | undefined)?.role === 'admin',
    ).length
    if (batch.length < perPage) break
  }
  return { ok: true, count: adminCount }
}

export async function handleAdminSetRole(req: Request, body: GenerateReportRequestBody): Promise<Response> {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return json({ error: 'userId is required' }, 400)
  const makeAdmin = body.admin === true

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  const caller = await db.auth.getUser(token)
  if (!makeAdmin && caller.data.user?.id === userId) {
    return json({ error: '不能取消自己的管理員權限' }, 400)
  }

  const { data: target, error: readErr } = await db.auth.admin.getUserById(userId)
  if (readErr || !target?.user) return json({ error: 'User not found' }, 404)

  const targetIsAdmin =
    (target.user.app_metadata as Record<string, unknown> | undefined)?.role === 'admin'

  // AD-02: never let the admin count fall to zero — that locks everyone out of the console with
  // no way back short of a manual SQL Editor edit (see the header comment above). This is a
  // best-effort guard, not a lock: two concurrent revokes of two *different* admins can each pass
  // it before either write lands. The re-count after the write below catches that race.
  if (!makeAdmin && targetIsAdmin) {
    const count = await countAdmins()
    if (!count.ok) return json({ error: count.message }, 500)
    if (count.count <= 1) {
      return json({ error: '無法取消最後一位管理員的權限（目前僅剩一位管理員）' }, 409)
    }
  }

  // Integrate the existing app_metadata, do not overwrite the entire package - there are also Supabase's own fields such as provider.
  const meta = { ...(target.user.app_metadata as Record<string, unknown>) }
  if (makeAdmin) meta.role = 'admin'
  else delete meta.role

  const { error } = await db.auth.admin.updateUserById(userId, { app_metadata: meta })
  if (error) return json({ error: error.message }, 500)

  // AD-02: the pre-revoke count above already passed by the time this write landed — re-count now
  // to catch the race it cannot: a second concurrent revoke of a different admin that also passed
  // its own pre-check. If this revoke is what tipped the count to zero, undo it and fail instead
  // of leaving the site with no administrator.
  if (!makeAdmin && targetIsAdmin) {
    const recount = await countAdmins()
    if (recount.ok && recount.count === 0) {
      await db.auth.admin.updateUserById(userId, { app_metadata: { ...meta, role: 'admin' } })
      await logEvent(db, {
        level: 'warn',
        action: 'admin-set-role',
        message: '偵測到管理員人數歸零，已還原此帳號的管理員權限',
        userId: caller.data.user?.id ?? null,
        detail: {
          code: caller.data.user?.id ?? 'unknown',
          hint: userId,
          name: 'restore',
        },
      })
      return json({ error: '無法取消最後一位管理員的權限（目前僅剩一位管理員）' }, 409)
    }
  }

  // AD-02: every role change is security-relevant — log actor/target/new-role using only
  // _shared/log.ts's allowlisted keys (it has no dedicated "actor"/"target" key, so this reuses
  // `code` / `hint` / `name` the same way discordRun.ts already reuses them for other labels).
  await logEvent(db, {
    level: 'info',
    action: 'admin-set-role',
    message: makeAdmin ? '授予管理員權限' : '取消管理員權限',
    userId: caller.data.user?.id ?? null,
    detail: {
      code: caller.data.user?.id ?? 'unknown',
      hint: userId,
      name: makeAdmin ? 'admin' : 'user',
    },
  })

  return json({ ok: true, userId, admin: makeAdmin })
}

export const BACKUPS_BUCKET = 'backups'

/**
 * Admin backup console (task 130, phase 2): per-account summary of `backups` storage objects
 * plus the newest `backup_run_log` row, so an admin can see who is/isn't getting backed up
 * without opening the Supabase dashboard.
 *
 * Same service-role client as everywhere else in this file — the `backups` bucket is private,
 * only service_role can list it, and there is no self-service download path for ordinary users.
 */
export async function handleAdminBackups(): Promise<Response> {
  // `listUsers` is a GoTrue Admin API with its own page/perPage, independent of PostgREST's
  // max_rows — hardcoding page: 1 silently dropped every account past perPage (BUG-066). Loop
  // upward until a page comes back short.
  const perPage = 1000
  const users: { id: string; email?: string | null }[] = []
  for (let page = 1; ; page++) {
    const { data: usersData, error: usersError } = await db.auth.admin.listUsers({ page, perPage })
    if (usersError) return json({ error: usersError.message }, 500)
    const batch = usersData?.users ?? []
    users.push(...batch)
    if (batch.length < perPage) break
  }

  const { data: runRows, error: runError } = await pagedSelect<Record<string, unknown>>((from, to) =>
    db
      .from('backup_run_log')
      .select('user_id, run_date, status, error, transaction_count')
      .order('run_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )
  if (runError) return json({ error: runError.message }, 500)

  // Rows are newest-first: `run_date` is a DATE with no (user_id, run_date) unique key, so a
  // failed scheduled run plus a successful manual re-run can land two rows on the same date —
  // `id` (BIGSERIAL PRIMARY KEY) is the tiebreak that makes the ordering a total order, so the
  // first row seen per user_id is unambiguously that account's newest run.
  const lastRunByUser = new Map<
    string,
    {
      runDate: string
      status: string
      error: string | null
      transactionCount: number
    }
  >()
  for (const r of runRows ?? []) {
    const uid = r.user_id as string
    if (lastRunByUser.has(uid)) continue
    lastRunByUser.set(uid, {
      runDate: r.run_date as string,
      status: r.status as string,
      error: (r.error as string | null) ?? null,
      transactionCount: (r.transaction_count as number | null) ?? 0,
    })
  }

  const accounts = await Promise.all(
    users.map(async (u) => {
      const { data: objects } = await db.storage.from(BACKUPS_BUCKET).list(u.id, { limit: 1000 })
      const summary = summarizeAccountBackups(
        u.id,
        u.email ?? '',
        (objects ?? []).map((o: { name: string; metadata: unknown; created_at: string | null }) => ({
          name: o.name,
          size: (o.metadata as { size?: number } | null)?.size ?? 0,
          createdAt: o.created_at ?? null,
        })),
      )
      return { ...summary, lastRun: lastRunByUser.get(u.id) ?? null }
    }),
  )

  return json({ ok: true, accounts })
}

/**
 * Mint a short-lived signed URL for one backup object (task 130, phase 2).
 *
 * `isValidBackupPath` must pass before the path reaches Storage: `createSignedUrl` will happily
 * sign whatever path it is given, so an unvalidated path here is an arbitrary-object read for
 * anyone who can reach this action (i.e. any admin — still narrower than "anyone").
 */
export async function handleAdminBackupUrl(body: GenerateReportRequestBody): Promise<Response> {
  const path = typeof body.path === 'string' ? body.path : ''
  if (!isValidBackupPath(path)) return json({ error: '備份路徑格式不正確' }, 400)

  const { data, error } = await db.storage.from(BACKUPS_BUCKET).createSignedUrl(path, 60)
  if (error || !data) return json({ error: '找不到備份檔' }, 404)
  // This client is built from the container-internal SUPABASE_URL, so `signedUrl` may be an
  // absolute URL on an internal hostname (e.g. `http://kong:8000`) that no browser can resolve.
  // Strip it down to path + query; the browser knows the public origin and re-attaches it.
  const relativeUrl = data.signedUrl.startsWith('http')
    ? data.signedUrl.slice(new URL(data.signedUrl).origin.length)
    : data.signedUrl
  return json({ ok: true, url: relativeUrl, expiresIn: 60 })
}

/** Key field per table for the additive restore below — matches the primary/unique key each table's schema actually uses. */
export const BACKUP_TABLE_KEYS: Record<'workspaces' | 'transactions' | 'user_settings', string> = {
  workspaces: 'id',
  transactions: 'id',
  user_settings: 'user_id',
}

/**
 * Restore the missing rows of one backup file back into the account it belongs to
 * (task: backup-restore).
 *
 * Additive only: a row whose key already exists is left untouched, and `apply !== true` never
 * writes anything — it only reports what an apply would do. `parseBackupDocument` is the safety
 * gate: it aborts before any read of "what's missing" if the file's account does not match the
 * path, or if a single row inside it belongs to someone else.
 */
export async function handleAdminBackupRestore(body: GenerateReportRequestBody): Promise<Response> {
  const path = typeof body.path === 'string' ? body.path : ''
  if (!isValidBackupPath(path)) return json({ error: '備份路徑格式不正確' }, 400)
  const apply = body.apply === true

  const expectedUserId = path.split('/')[0]
  const { data: fileData, error: downloadError } = await db.storage.from(BACKUPS_BUCKET).download(path)
  if (downloadError || !fileData) return json({ error: '找不到備份檔' }, 404)

  let raw: unknown
  try {
    raw = JSON.parse(await fileData.text())
  } catch {
    return json({ error: '備份檔格式無法辨識' }, 400)
  }

  const parsed = parseBackupDocument(raw, expectedUserId)
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const { doc } = parsed

  // Parents before children: transactions has a composite FK (workspace_id, user_id) onto
  // workspaces, so inserting in any other order fails.
  const tableOrder: (keyof typeof BACKUP_TABLE_KEYS)[] = ['workspaces', 'transactions', 'user_settings']
  const tables: Record<string, { inFile: number; present: number; missing: number }> = {}
  // No transaction spans the three writes below, so a later failure can leave earlier
  // tables already committed. Track what actually landed so the error message is honest.
  const writtenSoFar: Array<{ table: string; count: number }> = []

  for (const name of tableOrder) {
    const keyField = BACKUP_TABLE_KEYS[name]
    const fileRows = doc.tables[name]
    // `.range()` is OFFSET/LIMIT, and Postgres guarantees no row order across separate queries
    // without an ORDER BY —— so an unordered paged read can repeat or skip a row between pages,
    // which is exactly the >1000-row case this paging exists to get right. Order by the key.
    const { data: existingRows, error: existingError } = await pagedSelect((from, to) =>
      db
        .from(name)
        .select(keyField)
        .eq('user_id', expectedUserId)
        .order(keyField, { ascending: true })
        .range(from, to),
    )
    if (existingError) return json({ error: existingError.message }, 500)
    const existingKeys = (existingRows ?? []).map((r) => String((r as Record<string, unknown>)[keyField]))
    const toInsert = rowsToInsert(fileRows, existingKeys, keyField)

    let missing = toInsert.length
    if (apply && toInsert.length > 0) {
      // BUG-066: `.upsert(...).select()` writes every row, but its RETURNING payload is capped
      // at max_rows (1000) same as any select — a restore past that many rows under-reported
      // `missing` even though every row landed. Chunk the write so each batch's RETURNING stays
      // under the cap, and sum the batches.
      const UPSERT_BATCH = 1000
      let written = 0
      for (let i = 0; i < toInsert.length; i += UPSERT_BATCH) {
        const batch = toInsert.slice(i, i + UPSERT_BATCH)
        const { data: inserted, error: insertError } = await db
          .from(name)
          .upsert(batch, { onConflict: keyField, ignoreDuplicates: true })
          .select(keyField)
        if (insertError) {
          // A failure on a later batch must still report what the earlier batches committed.
          if (written > 0) writtenSoFar.push({ table: name, count: written })
          return json({ error: restoreFailureMessage(writtenSoFar, insertError.message) }, 500)
        }
        written += inserted?.length ?? 0
      }
      missing = written
      writtenSoFar.push({ table: name, count: missing })
    }

    tables[name] = { inFile: fileRows.length, present: existingKeys.length, missing }
  }

  return json({ ok: true, applied: apply, backupDate: doc.backup_date, tables })
}

/**
 * Admin console reader over `public.app_log` (Spec 146). The table has no SELECT policy —
 * only `admin_recent_app_logs()` (SECURITY DEFINER, service_role only) can read it, so this
 * goes through the same `db` service-role client every other admin action already uses.
 */
/** DB-04: `admin_recent_app_logs` defaults to 100 rows but takes whatever `p_limit` the caller sends. */
export const APP_LOGS_MAX_LIMIT = 200

export async function handleAppLogs(body: GenerateReportRequestBody): Promise<Response> {
  const p_limit = typeof body.limit === 'number' ? Math.min(body.limit, APP_LOGS_MAX_LIMIT) : undefined
  const p_before_id = typeof body.beforeId === 'number' && Number.isFinite(body.beforeId) ? body.beforeId : null
  const { data, error } = await db.rpc('admin_recent_app_logs', {
    p_limit,
    p_level: body.level ?? undefined,
    p_source: body.source ?? undefined,
    p_before: body.before ?? undefined,
    p_before_id,
  })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, logs: data ?? [] })
}
