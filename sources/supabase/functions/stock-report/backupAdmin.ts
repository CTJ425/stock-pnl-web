/**
 * Pure helpers for the admin backup console (phase 2, task 130).
 *
 * Kept separate from `index.ts` so the traversal gate (`isValidBackupPath`) and the summary
 * math (`summarizeAccountBackups`) can be unit-tested without spinning up Deno / the Edge runtime.
 */

export interface BackupObject {
  name: string
  size: number
  createdAt: string | null
}

export interface BackupFileEntry {
  name: string
  date: string
  size: number
  createdAt: string | null
}

export interface AccountBackupSummary {
  userId: string
  email: string
  fileCount: number
  newestDate: string | null
  totalBytes: number
  files: BackupFileEntry[]
}

// `<uuid>/<YYYY-MM-DD>.json` and nothing else — this is the traversal gate for
// `admin-backup-url`. A signed URL is minted for whatever path passes this check, so
// anything looser than an exact match turns into an arbitrary-object read.
const BACKUP_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d{4}-\d{2}-\d{2}\.json$/

/** `<uuid>/<YYYY-MM-DD>.json` and nothing else. */
export function isValidBackupPath(path: string): boolean {
  return BACKUP_PATH_RE.test(path)
}

// Matches the file name convention `taipeiYmd()` produces in backup-transactions/backupPlan.ts.
const BACKUP_FILE_NAME_RE = /^(\d{4}-\d{2}-\d{2})\.json$/

/** Ignores anything that is not a dated backup object; newest first. */
export function summarizeAccountBackups(
  userId: string,
  email: string,
  objects: BackupObject[],
): AccountBackupSummary {
  const files: BackupFileEntry[] = objects
    .map((o) => {
      const m = BACKUP_FILE_NAME_RE.exec(o.name)
      if (!m) return null
      const size = typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : 0
      return { name: o.name, date: m[1], size, createdAt: o.createdAt ?? null }
    })
    .filter((f): f is BackupFileEntry => f !== null)
    .sort((a, b) => b.date.localeCompare(a.date))

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

  return {
    userId,
    email,
    fileCount: files.length,
    newestDate: files[0]?.date ?? null,
    totalBytes,
    files,
  }
}

export type BackupRow = Record<string, unknown>

export interface BackupDocument {
  version: number
  user_id: string
  backup_date: string
  exported_at: string
  tables: { workspaces: BackupRow[]; transactions: BackupRow[]; user_settings: BackupRow[] }
}

const BACKUP_TABLE_NAMES = ['workspaces', 'transactions', 'user_settings'] as const

/**
 * Validates shape, version and — critically — that every row belongs to `expectedUserId`.
 *
 * This is the gate that stops a tampered or mismatched-account file from ever reaching a write:
 * `admin-backup-restore` must call this before touching any table.
 */
export function parseBackupDocument(
  raw: unknown,
  expectedUserId: string,
): { ok: true; doc: BackupDocument } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '備份檔格式無法辨識' }
  }
  const obj = raw as Record<string, unknown>
  const tables = obj.tables
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    return { ok: false, error: '備份檔格式無法辨識' }
  }

  if (obj.version !== 1) return { ok: false, error: '備份檔版本不支援' }

  const tablesObj = tables as Record<string, unknown>
  for (const name of BACKUP_TABLE_NAMES) {
    if (!Array.isArray(tablesObj[name])) return { ok: false, error: `備份檔缺少資料表：${name}` }
  }

  if (obj.user_id !== expectedUserId) return { ok: false, error: '備份檔的帳號與路徑不符' }

  for (const name of BACKUP_TABLE_NAMES) {
    const rows = tablesObj[name] as BackupRow[]
    for (const row of rows) {
      if (row.user_id !== expectedUserId) return { ok: false, error: '備份檔內有不屬於該帳號的資料列' }
    }
  }

  return {
    ok: true,
    doc: {
      version: obj.version as number,
      user_id: obj.user_id as string,
      backup_date: typeof obj.backup_date === 'string' ? obj.backup_date : '',
      exported_at: typeof obj.exported_at === 'string' ? obj.exported_at : '',
      tables: {
        workspaces: tablesObj.workspaces as BackupRow[],
        transactions: tablesObj.transactions as BackupRow[],
        user_settings: tablesObj.user_settings as BackupRow[],
      },
    },
  }
}

/**
 * Restore writes `workspaces`, `transactions`, `user_settings` as three separate calls with no
 * transaction across them. When one fails partway, the admin needs to know what already landed
 * instead of a bare Postgres error that implies nothing happened.
 */
export function restoreFailureMessage(
  written: Array<{ table: string; count: number }>,
  reason: string,
): string {
  const landed = written.filter((w) => w.count > 0)
  if (landed.length === 0) return `還原失敗：${reason}。尚未寫入任何資料。`
  const list = landed.map((w) => `${w.table} ${w.count} 筆`).join('、')
  return `還原失敗：${reason}。已寫入 ${list}，請重新預覽確認目前狀態。`
}

/** Rows from the file whose key is not already present. Order is preserved. */
export function rowsToInsert(fileRows: BackupRow[], existingKeys: string[], keyField: string): BackupRow[] {
  const existing = new Set(existingKeys)
  return fileRows.filter((row) => {
    const key = row[keyField]
    if (key === undefined || key === null) return false
    return !existing.has(String(key))
  })
}
