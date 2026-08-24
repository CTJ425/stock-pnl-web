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
