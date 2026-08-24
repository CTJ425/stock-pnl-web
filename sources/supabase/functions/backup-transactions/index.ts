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
  prunablePaths,
  rowCounts,
  taipeiYmd,
  type BackupTables,
} from './backupPlan.ts'

const BACKUPS_BUCKET = 'backups'
const KEEP_DAYS = 7

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

// Same shape as stock-report/index.ts:848 — shared secret between pg_cron and this function.
function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || got !== expected) return json({ error: 'Unauthorized' }, 401)
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

async function backupAccount(userId: string, backupDate: string, exportedAt: Date): Promise<BackupLogRow> {
  try {
    const [workspaces, transactions, userSettings] = await Promise.all([
      db.from('workspaces').select('*').eq('user_id', userId),
      db.from('transactions').select('*').eq('user_id', userId),
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
      row.error = pruneErr instanceof Error ? pruneErr.message : String(pruneErr)
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
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleBackup(): Promise<Response> {
  const exportedAt = new Date()
  const backupDate = taipeiYmd(exportedAt)

  // perPage upper limit 1000 — same cap already used at stock-report/index.ts:3531.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return json({ error: error.message }, 500)
  const users = data?.users ?? []

  let ok = 0
  let failed = 0
  for (const user of users) {
    const row = await backupAccount(user.id, backupDate, exportedAt)
    if (row.status === 'ok') ok++
    else failed++
    await db.from('backup_run_log').insert(row)
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
