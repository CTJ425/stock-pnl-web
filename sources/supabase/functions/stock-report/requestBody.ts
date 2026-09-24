import type { HoldingContext } from './report.ts'

export interface GenerateReportRequestBody {
  action?: string
  market?: string
  ticker?: string
  name?: string
  /**
   * warm only (0.6.46-dev.4). `core` | `history` | `full` (default).
   * See handleWarm header comment.
   */
  phase?: string
  holding?: HoldingContext | null
  /** admin-set-role is used: the account to be changed and whether to give it to the administrator*/
  userId?: string
  admin?: boolean
  /**
   * admin-run: which batch job(s) to fire. Same handlers as pg_cron / x-cron-secret,
   * but gated by assertAdmin so the console never needs CRON_SECRET in the browser.
   * `'all'` or a list of: generate-all | sync-market | sync-macro | sync-fx | probe
   */
  jobs?: string[] | 'all'
  /** Singular alias for a one-job admin-run */
  job?: string
  /** admin-backup-url / admin-backup-restore: the storage object path, `<uuid>/<YYYY-MM-DD>.json` */
  path?: string
  /** admin-backup-restore: false/omitted = preview only, true = actually write the missing rows */
  apply?: boolean
  /** app-logs: paging/filter passed through to admin_recent_app_logs() */
  limit?: number
  level?: string
  source?: string
  before?: string
  /** app-logs (AD-07): paired with `before` to break ties when two rows share the same `at`. */
  beforeId?: number
  /** discord-summary (x-cron-secret): which edition to send, see schema.sql's two `discord-summary-*` cron jobs */
  edition?: string
}
