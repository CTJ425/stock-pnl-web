# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task analysis-picker-watch-group completed — 個股分析 stock picker lists watched stocks again (持股 / 觀察 groups with separator); reversal note appended to spec
- Status: **✅ RECORDED**
- Timestamp: 2026-08-24 13:33:13 Asia/Taipei

---

## 📅 Log: 2026-08-24 16:44:44 Asia/Taipei (backup-transactions phase 1 completed — daily per-account backup to Supabase Storage)

- **Task**: backup-transactions phase 1 — Implement daily per-account backup of transaction records to Supabase Storage (private `backups` bucket).
- **Outcome**: 4 new files + 1 schema modification landed. Edge Function `backup-transactions/index.ts` is cron-triggered at 18:00 Taipei (02:00 UTC), x-cron-secret gated, performs per-account dump of workspaces/transactions/user_settings to JSON, uploads to `backups/<user_id>/<YYYY-MM-DD>.json` with upsert, prunes to newest 7 objects, logs one `backup_run_log` row per account. Pure logic split into `backupPlan.ts` (taipeiYmd, backupObjectPath, buildBackupPayload, prunablePaths, rowCounts).
- **Files changed**: NEW `sources/supabase/functions/backup-transactions/index.ts`, NEW `sources/supabase/functions/backup-transactions/backupPlan.ts`, NEW `sources/supabase/functions/backup-transactions/backupPlan.test.ts`, NEW `docs/agent/specs/backup-transactions.md`, MODIFIED `sources/supabase/schema.sql` section 12 (private `backups` bucket, `backup_run_log` table + admin-only SELECT RLS, run_date index, pg_cron `backup-daily` at '0 18 * * *').
- **Testing**: `npx vitest run supabase/functions/backup-transactions/backupPlan.test.ts` — 17 passed, exit 0. `npx tsc --noEmit -p tsconfig.edge.json` — exit 0.
- **Review**: **PASS with one RISK, then fixed**. Risk was: (1) schema.sql not re-runnable → added DROP POLICY IF EXISTS; (2) Storage list() default 100-limit could truncate retention → explicit { limit: 1000 }; (3) bytes via String.length → TextEncoder.
- **Known limitations (accepted, not bugs)**: listUsers capped at 1000 (matches `stock-report/index.ts:3531`); retention keeps newest 7 dated objects not "older than 7 days" (deliberate — outage cannot wipe backups); backup_run_log insert failures not retried.
- **Deployment**: Not deployed. DEV needs SQL section 12 run + function volume-copy + container recreate; PROD only after DEV verify + explicit user OK.
- **Phase 2 (OPEN task)**: Admin backend listing backup status + admin-only download path (second Edge Function, verify_jwt=true, checks app_metadata.role === 'admin', signed URL for private `backups` bucket; individual users cannot download per user decision). UI in `sources/src/components/Admin/`.
- **Records finalized**: This entry added to PROGRESS.md. New OPEN task 130 added to TASK.md for phase 2. Oldest PROGRESS entry (0.9.9 / 11:37:39) rolled to PROGRESS_ARCHIVE.md. BUG_FIX.md unchanged (no new bugs; known limitations accepted).
- **Unfinished**: None — backup-transactions phase 1 recording complete.

---

## 📅 Log: 2026-08-24 13:33:13 Asia/Taipei (Task completed: analysis-picker-watch-group — stock picker watchlist restored)

- **Task**: analysis-picker-watch-group — Restore watched stocks listing in 個股分析 stock picker dropdown.
- **Outcome**: The picker now displays watched stocks grouped under `觀察` below `持股`, separated with existing `.hmenu-head` / `.hmenu-sep` classes (no new CSS). Held tickers override watched duplicates, so no stock appears twice. Selection resolution order preserved: holdings win, then watchlist, then fallback.
- **Files changed**: `sources/src/components/StockDetail/AnalysisPage.tsx` (render holdings + watched groups), `sources/src/components/StockDetail/AnalysisPage.test.tsx` (new test case for grouped picker render).
- **Testing**: AnalysisPage 21 tests passed. Full suite: 77 files / 1147 tests passed, exit 0. `tsc --noEmit -p tsconfig.app.json` exit 0 — no regressions.
- **Review**: Skipped per policy — a previously failing test (picker without watched stocks) now passes, and changes touch no persistence, auth, API boundary, or calculation. Proof: git diff shows only selector logic and test assert, no fee/math/schema changes.
- **Lane**: 1 (bounded — selector reordering only).
- **Version**: NOT bumped, no commit made (bookkeeping only per Scribe role).
- **Spec revision**: `docs/agent/specs/watchlist-ux-overhaul.md` line 24 recorded "Stock picker: **holdings only.**" and line 49-50 repeated this constraint. Appended dated revision note stating the holdings-only picker decision was reversed by this task; watched stocks now appear in picker grouped as `觀察`, so a later agent does not restore the old behaviour. Original text unchanged, revision note added.
- **Records finalized**: This entry added to PROGRESS.md. New open task added to TASK.md for ETF constituents investigation. Spec revision note written. No entries moved this dispatch.
- **Unfinished**: None — analysis-picker-watch-group recorded complete.

---

