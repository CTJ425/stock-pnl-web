# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: backup-transactions phase 1 deployed and verified on DEV; CHANGELOG.md 0.9.11 bullet finalized
- Status: **✅ RECORDED**
- Timestamp: 2026-08-24 16:57:07 Asia/Taipei

---

## 📅 Log: 2026-08-24 16:57:07 Asia/Taipei (backup-transactions phase 1 deployed & verified on DEV — self-hosted https://korq9tvdz0jd7yblr72p.ivan.lab)

- **Deployment action**: Version 0.9.11-dev.1 (commit 4c70ad6, pushed to origin/dev) deployed to DEV self-hosted Supabase environment.
- **DEV deployment steps completed**:
  - Function volume-copied to `volumes/functions/backup-transactions/` (index.ts + backupPlan.ts), functions container force-recreated.
  - Schema section 12 applied: `backups` bucket created with `public=false`, `backup_run_log` table with RLS enabled, admin-only SELECT policy, run_date index, pg_cron job `backup-daily` scheduled at '0 18 * * *'.
  - No router changes needed: DEV runs `FUNCTIONS_VERIFY_JWT=false` globally, so hardcoded stock-report skip list did not require updates. **PROD note**: cloud deployment will require `supabase functions deploy backup-transactions --no-verify-jwt`, same as stock-report.
- **DEV verification evidence (all passed)**:
  - Auth: no secret → 401; wrong secret → 401; GET valid secret → 405; POST valid secret → 200.
  - Live backup run returned `{"backup_date":"2026-08-24","accounts":1,"ok":1,"failed":0}`.
  - backup_run_log row: workspace_count 2, transaction_count 62, settings_count 0, bytes 20510, pruned 0, status ok — exact match to live tables.
  - Storage object: `backups/<user_id>/2026-08-24.json`, 20510 bytes, mimetype application/json, size matches logged byte count.
  - Payload verified: version 1, 12 transaction columns, sorted by tx_date ascending.
  - Retention integration test: seeded 8 dummy dated objects + 1 decoy `notes.txt`; function re-run kept newest 7 dated objects, deleted 2 oldest (pruned=2), left `notes.txt` untouched, upserted same-day real backup; all dummies and decoy removed; bucket now holds only the one real backup.
  - Access control verified: anon reading `backup_run_log` via PostgREST returns []; public storage URL returns HTTP 400; anon listing bucket returns []; storage.objects RLS enforced with zero policies, only service_role can read.
- **Operational finding** (doc hazard, not bug): supabase-ops skill's project-identity heuristic is stale. It states "batch_run_log: official area 2 / test area 0", but DEV now has 211 rows and can no longer distinguish environments by this criterion; would give false confidence. This deployment used explicit `docker compose exec` against self-hosted compose file, where target is unambiguous by construction. Recommend future ops leverage explicit compose paths, not environment heuristics.
- **Still open**: (1) CHANGELOG.md 0.9.11 deployment bullet finalized in this dispatch. (2) PROD (cloud kxnxadaghidwumqsqneu) not deployed; requires `main` branch, explicit user OK, `supabase functions deploy backup-transactions --no-verify-jwt`, schema section 12 execution. (3) Task 130 (phase 2: admin status page + download) remains open, untouched.
- **Records finalized**: Oldest PROGRESS entry (2026-08-24 13:33:13 analysis-picker-watch-group) moved to PROGRESS_ARCHIVE.md. This new entry added to PROGRESS.md. CHANGELOG.md 0.9.11 updated. Operational note appended to BUG_FIX.md. No further entries moved.
- **Unfinished**: None — backup-transactions DEV deployment & verification recorded.

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

