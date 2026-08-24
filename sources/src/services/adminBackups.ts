/**
 * Admin backup console (task 130, phase 2): per-account backup summary + short-lived download
 * link, both served by `stock-report`'s `admin-backups` / `admin-backup-url` actions.
 *
 * Same shape as `adminUsers.ts`: `supabase.functions.invoke`, defensive `typeof` parsing on every
 * field, swallow errors into `null` for the summary read, but let the download call report a
 * real message — the user just pressed a button and needs to know whether it worked.
 */
import { supabase, supabaseUrl } from './supabase'

export interface BackupFile {
  name: string
  date: string
  size: number
  createdAt: string | null
}

export interface BackupRunInfo {
  runDate: string
  status: string
  error: string | null
  transactionCount: number
}

export interface AccountBackups {
  userId: string
  email: string
  fileCount: number
  newestDate: string | null
  totalBytes: number
  files: BackupFile[]
  lastRun: BackupRunInfo | null
}

function parseFile(raw: unknown): BackupFile {
  const f = raw as Partial<BackupFile>
  return {
    name: typeof f.name === 'string' ? f.name : '',
    date: typeof f.date === 'string' ? f.date : '',
    size: typeof f.size === 'number' ? f.size : 0,
    createdAt: typeof f.createdAt === 'string' ? f.createdAt : null,
  }
}

function parseLastRun(raw: unknown): BackupRunInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<BackupRunInfo>
  if (typeof r.runDate !== 'string') return null
  return {
    runDate: r.runDate,
    status: typeof r.status === 'string' ? r.status : '',
    error: typeof r.error === 'string' ? r.error : null,
    transactionCount: typeof r.transactionCount === 'number' ? r.transactionCount : 0,
  }
}

/** Read every account's backup summary. Not logged in / no permission / any error -> null.*/
export async function fetchAdminBackups(): Promise<AccountBackups[] | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-backups' },
      timeout: 20_000,
    })
    if (error || !data || (data as { ok?: boolean }).ok !== true) return null
    const rows = (data as { accounts?: unknown }).accounts
    if (!Array.isArray(rows)) return []
    return rows.map((r) => {
      const a = r as Partial<AccountBackups>
      return {
        userId: typeof a.userId === 'string' ? a.userId : '',
        email: typeof a.email === 'string' ? a.email : '',
        fileCount: typeof a.fileCount === 'number' ? a.fileCount : 0,
        newestDate: typeof a.newestDate === 'string' ? a.newestDate : null,
        totalBytes: typeof a.totalBytes === 'number' ? a.totalBytes : 0,
        files: Array.isArray(a.files) ? a.files.map(parseFile) : [],
        lastRun: parseLastRun(a.lastRun),
      }
    })
  } catch {
    return null
  }
}

/**
 * Mint a signed download URL for one backup object.
 *
 * Return either `{ url }` or `{ error }` — never throws — so the caller always has a message
 * for the user, whether the failure is "bad path", "not found" or "network broke".
 */
export async function requestBackupUrl(path: string): Promise<{ url: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase 未設定' }
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-backup-url', path },
      timeout: 20_000,
    })
    if (error) return { error: (await httpErrorMessage(error)) ?? error.message }
    const res = data as { ok?: boolean; url?: string; error?: string } | null
    if (!res || res.ok !== true || typeof res.url !== 'string') return { error: res?.error ?? '取得下載連結失敗' }
    return { url: res.url.startsWith('/') ? `${supabaseUrl}${res.url}` : res.url }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '取得下載連結失敗' }
  }
}

export interface RestoreTableStat {
  inFile: number
  present: number
  missing: number
}

export interface RestoreResult {
  applied: boolean
  backupDate: string
  tables: { workspaces: RestoreTableStat; transactions: RestoreTableStat; user_settings: RestoreTableStat }
}

function parseTableStat(raw: unknown): RestoreTableStat {
  const s = raw as Partial<RestoreTableStat> | null | undefined
  return {
    inFile: typeof s?.inFile === 'number' ? s.inFile : 0,
    present: typeof s?.present === 'number' ? s.present : 0,
    missing: typeof s?.missing === 'number' ? s.missing : 0,
  }
}

async function invokeBackupRestore(path: string, apply: boolean): Promise<RestoreResult | { error: string }> {
  if (!supabase) return { error: 'Supabase 未設定' }
  try {
    const { data, error } = await supabase.functions.invoke('stock-report', {
      body: { action: 'admin-backup-restore', path, apply },
      timeout: 20_000,
    })
    if (error) return { error: (await httpErrorMessage(error)) ?? error.message }
    const res = data as { ok?: boolean; applied?: boolean; backupDate?: string; tables?: Record<string, unknown>; error?: string } | null
    if (!res || res.ok !== true) return { error: res?.error ?? '還原失敗' }
    return {
      applied: res.applied === true,
      backupDate: typeof res.backupDate === 'string' ? res.backupDate : '',
      tables: {
        workspaces: parseTableStat(res.tables?.workspaces),
        transactions: parseTableStat(res.tables?.transactions),
        user_settings: parseTableStat(res.tables?.user_settings),
      },
    }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : '還原失敗' }
  }
}

/** Preview only — computes what a restore would write, never writes. */
export function previewBackupRestore(path: string): Promise<RestoreResult | { error: string }> {
  return invokeBackupRestore(path, false)
}

/** Actually inserts the missing rows (additive only — see backupAdmin.ts). */
export function applyBackupRestore(path: string): Promise<RestoreResult | { error: string }> {
  return invokeBackupRestore(path, true)
}

/** Same dig-out-the-real-message helper as `adminUsers.ts:83`. */
async function httpErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown })?.context
  if (!(ctx instanceof Response)) return null
  try {
    const body = (await ctx.clone().json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
