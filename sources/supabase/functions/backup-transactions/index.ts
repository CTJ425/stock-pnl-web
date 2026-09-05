/**
 * Supabase Edge Function: backup-transactions (phase 1 — daily backup only).
 *
 * Deployment method (need to install Supabase CLI and log in):
 *   supabase functions deploy backup-transactions --no-verify-jwt
 *
 * Triggered by pg_cron job `backup-daily` (schema.sql §12) at Taipei 02:00. For every auth
 * account, dumps `workspaces` / `transactions` / `user_settings` into one JSON object under
 * the private `backups` bucket, keeps the newest 7 dated objects per account, and writes one
 * `backup_run_log` row per account. Admin UI / download endpoint are phase 2, out of scope here.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  backupObjectPath,
  buildBackupPayload,
  describeError,
  prunablePaths,
  rowCounts,
  taipeiYmd,
  type BackupRow,
  type BackupTables,
} from './backupPlan.ts'
import { secretsMatch } from './cronSecret.ts'

const BACKUPS_BUCKET = 'backups'
const KEEP_DAYS = 7

// One transient 401 on a single PostgREST call lost a whole account's backup on 2026-08-25
// (the two sibling requests in the same Promise.all returned 200). Nothing retried it and the
// next chance was 24 hours later, so an account is now re-attempted before it is declared failed.
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 500

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatically injected by the Supabase execution
// environment. Service role bypasses RLS — required to read every account's rows and to write
// backup_run_log, which has no INSERT policy for anyone else.
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// Same shape as stock-report/cronSecret.ts — shared secret between pg_cron and this function.
function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || !secretsMatch(got, expected)) return json({ error: 'Unauthorized' }, 401)
  return null
}

interface BackupLogRow {
  run_date: string
  user_id: string
  workspace_count: number
  transaction_count: number
  settings_count: number
  bytes: number
  object_path: string | null
  pruned: number
  status: 'ok' | 'error'
  error: string | null
}

/**
 * PostgREST caps a single response at `max_rows` (1000, see `supabase/config.toml`). Same shape
 * as `pagedSelect` in stock-report/index.ts — this function cannot import from that directory,
 * an Edge function bundles only its own directory, so it is copied rather than shared.
 */
async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) return { data: rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return { data: rows, error: null }
}

async function backupAccount(userId: string, backupDate: string, exportedAt: Date): Promise<BackupLogRow> {
  try {
    // `.range()` is OFFSET/LIMIT, and Postgres guarantees no row order across separate queries
    // without an ORDER BY, so order by `id` before paging — otherwise a page boundary can repeat
    // or skip a row.
    const [workspaces, transactions, userSettings] = await Promise.all([
      db.from('workspaces').select('*').eq('user_id', userId),
      pagedSelect<BackupRow>((from, to) =>
        db.from('transactions').select('*').eq('user_id', userId).order('id', { ascending: true }).range(from, to),
      ),
      db.from('user_settings').select('*').eq('user_id', userId),
    ])
    if (workspaces.error) throw workspaces.error
    if (transactions.error) throw transactions.error
    if (userSettings.error) throw userSettings.error

    const tables: BackupTables = {
      workspaces: workspaces.data ?? [],
      transactions: transactions.data ?? [],
      user_settings: userSettings.data ?? [],
    }
    const payload = buildBackupPayload({ userId, backupDate, exportedAt, tables })
    const body = JSON.stringify(payload)
    const bodyBytes = new TextEncoder().encode(body).length
    const path = backupObjectPath(userId, backupDate)

    const { error: uploadError } = await db.storage.from(BACKUPS_BUCKET).upload(path, body, {
      contentType: 'application/json',
      upsert: true,
    })
    if (uploadError) throw uploadError

    const counts = rowCounts(tables)
    const row: BackupLogRow = {
      run_date: backupDate,
      user_id: userId,
      workspace_count: counts.workspaces,
      transaction_count: counts.transactions,
      settings_count: counts.user_settings,
      bytes: bodyBytes,
      object_path: path,
      pruned: 0,
      status: 'ok',
      error: null,
    }

    // Prune failure does not fail the account — the backup itself already succeeded.
    try {
      // Explicit limit: Storage list() defaults to 100, which would hide older objects
      // once a prefix accumulates past that (e.g. after a sustained prune failure).
      const { data: listed, error: listError } = await db.storage
        .from(BACKUPS_BUCKET)
        .list(userId, { limit: 1000 })
      if (listError) throw listError
      const names = (listed ?? []).map((f) => f.name)
      const toDelete = prunablePaths(names, KEEP_DAYS)
      if (toDelete.length > 0) {
        const { error: removeError } = await db.storage
          .from(BACKUPS_BUCKET)
          .remove(toDelete.map((name) => `${userId}/${name}`))
        if (removeError) throw removeError
        row.pruned = toDelete.length
      }
    } catch (pruneErr) {
      row.error = describeError(pruneErr)
    }

    return row
  } catch (err) {
    return {
      run_date: backupDate,
      user_id: userId,
      workspace_count: 0,
      transaction_count: 0,
      settings_count: 0,
      bytes: 0,
      object_path: null,
      pruned: 0,
      status: 'error',
      error: describeError(err),
    }
  }
}

/**
 * Retries the whole account only when it failed. A prune-only failure returns `status='ok'` and
 * is not retried — the object is already uploaded, and re-uploading it would not fix the prune.
 */
async function backupAccountWithRetry(
  userId: string,
  backupDate: string,
  exportedAt: Date,
): Promise<BackupLogRow> {
  let row = await backupAccount(userId, backupDate, exportedAt)
  let attempts = 1
  while (row.status === 'error' && attempts < MAX_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempts))
    row = await backupAccount(userId, backupDate, exportedAt)
    attempts++
  }
  if (row.status === 'error') row.error = `${row.error} (failed ${attempts} attempts)`
  return row
}

async function handleBackup(): Promise<Response> {
  const exportedAt = new Date()
  const backupDate = taipeiYmd(exportedAt)

  // `listUsers` is a GoTrue Admin API with its own page/perPage, independent of PostgREST's
  // max_rows — hardcoding page: 1 silently dropped every account past perPage (BUG-066). Loop
  // upward until a page comes back short. perPage upper limit is 1000.
  const perPage = 1000
  const users: { id: string }[] = []
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) return json({ error: error.message }, 500)
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < perPage) break
  }

  let ok = 0
  let failed = 0
  for (const user of users) {
    const row = await backupAccountWithRetry(user.id, backupDate, exportedAt)
    if (row.status === 'ok') ok++
    else failed++
    // A dropped log row makes the account look like it was never attempted, which reads as a
    // scheduling problem rather than a backup problem. Nothing can be written about it but the
    // function log, so at least put it there.
    const { error: logError } = await db.from('backup_run_log').insert(row)
    if (logError) console.error('backup_run_log insert failed', user.id, describeError(logError))
  }

  return json({ backup_date: backupDate, accounts: users.length, ok, failed })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  const denied = assertCronSecret(req)
  if (denied) return denied
  return handleBackup()
})
