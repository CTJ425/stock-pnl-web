/**
 * Pure logic for the daily transaction backup (phase 1).
 *
 * Kept free of Supabase/Deno imports so it can be unit tested with plain vitest —
 * see backupPlan.test.ts.
 */

export interface BackupRow {
  [key: string]: unknown
}

export interface BackupTables {
  workspaces: BackupRow[]
  transactions: BackupRow[]
  user_settings: BackupRow[]
}

export interface BackupPayload {
  version: 1
  user_id: string
  backup_date: string
  exported_at: string
  tables: BackupTables
}

/** YYYY-MM-DD in Taipei. Fixed +8, no DST — same approach as stock-report/report.ts:92. */
export function taipeiYmd(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, '0')
  const day = String(t.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Object path inside the `backups` bucket. */
export function backupObjectPath(userId: string, backupDate: string): string {
  return `${userId}/${backupDate}.json`
}

/** Deterministic payload: rows pass through verbatim, only the order is fixed. */
export function buildBackupPayload(input: {
  userId: string
  backupDate: string
  exportedAt: Date
  tables: BackupTables
}): BackupPayload {
  const { userId, backupDate, exportedAt, tables } = input

  const workspaces = [...tables.workspaces].sort((a, b) =>
    String(a.id ?? '').localeCompare(String(b.id ?? '')),
  )
  const transactions = [...tables.transactions].sort((a, b) => {
    const dateCmp = String(a.tx_date ?? '').localeCompare(String(b.tx_date ?? ''))
    if (dateCmp !== 0) return dateCmp
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
  const userSettings = [...tables.user_settings].sort((a, b) =>
    String(a.user_id ?? '').localeCompare(String(b.user_id ?? '')),
  )

  return {
    version: 1,
    user_id: userId,
    backup_date: backupDate,
    exported_at: exportedAt.toISOString(),
    tables: {
      workspaces,
      transactions,
      user_settings: userSettings,
    },
  }
}

const DATED_JSON_RE = /^\d{4}-\d{2}-\d{2}\.json$/

/** Object names (not full paths) inside one account prefix -> the ones to delete. */
export function prunablePaths(names: string[], keepDays: number): string[] {
  const dated = names.filter((n) => DATED_JSON_RE.test(n))
  // Newest first by date; the object name is the date so string sort works.
  const sorted = [...dated].sort((a, b) => b.localeCompare(a))
  return sorted.slice(keepDays)
}

/**
 * A human-readable reason for a failed step.
 *
 * `String(err)` is not enough: PostgREST returns a **plain object**
 * (`{ message, code, details, hint }`), not an Error, so stringifying it yields the literal
 * "[object Object]" — which is exactly what backup_run_log recorded on 2026-08-25 instead of
 * the 401 that caused the failure. Storage and network errors do extend Error and keep working.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    const parts = [o.message, o.code, o.details, o.hint]
      .filter((v) => typeof v === 'string' && v.length > 0)
      .map((v) => v as string)
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

export function rowCounts(tables: BackupTables): {
  workspaces: number
  transactions: number
  user_settings: number
} {
  return {
    workspaces: tables.workspaces.length,
    transactions: tables.transactions.length,
    user_settings: tables.user_settings.length,
  }
}
