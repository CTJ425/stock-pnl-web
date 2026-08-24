# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.11 shipped to both environments; backup-transactions phase 2 completed; RISK-001 closed
- Status: **✅ RECORDED**
- Timestamp: 2026-08-24 17:35:44 CST

---

## 📅 Log: 2026-08-24 17:35:44 CST (0.9.11 shipped to dev and main; backup-transactions phase 2 complete; PROD deploy open)

- **Release 0.9.11**: Shipped to both `dev` (commit 8003b6a) and `main` (fast-forward, identical). GitHub Release 0.9.11 published, GitHub Pages deploy succeeded.
- **Task 130 phase 2 completion**: Admin console sixth panel 備份 (restore/download UI). Frontend service `adminBackups.ts`, backend pure logic `stock-report/backupAdmin.ts`, two new `stock-report` actions `admin-backups` (list backup status per account) and `admin-backup-url` (return signed download URL), both protected by existing `assertAdmin`. Individual users cannot download their own backups (admin-only access per user decision).
- **Decision reversal recorded**: Original Task 130 spec proposed a new Edge Function for admin operations. Implementation instead added actions to existing `stock-report` because: (1) all admin calls already route through it, (2) a second function would add a PROD deploy target whose `verify_jwt` setting could drift. Decision and rationale recorded in `docs/agent/specs/backup-admin-console.md` to prevent re-implementation of rejected design in future.
- **Signed URL defect found and fixed**: `createSignedUrl` returned root-relative URLs (`/storage/v1/...`). Browser client (built from container-internal `SUPABASE_URL`) interpreted these as `http://kong:8000/...` on self-hosted DEV. Made URLs absolute. Unit tests could not catch this; DEV live verification did (valid signed link downloaded real 20510-byte backup; tampered signature returned 400).
- **RISK-001 closed**: Probe round timeout (per-source loop deadline/budget). Fixed by adding optional `probeDeadline` to `probeRound.ts`, `deferred` result field (distinct from `skipped`), and `PROBE_BUDGET_MS = 30_000` in `index.ts`. Probe loop defers a source before starting it once budget is gone, never interrupts in-flight probe. See `FIXED_BUG.md`.
- **Verification**: `npm test` 81 files / 1204 tests exit 0; `tsc --noEmit` exit 0; `tsc --noEmit -p tsconfig.edge.json` exit 0; `npm run build` exit 0; `oxlint` 5 pre-existing warnings, no new ones. DEV live checks: anon and non-admin rejected 401; five malformed paths returned 400; valid signed link downloaded real 20510-byte backup; tampered signature returned 400.
- **Review outcomes**: Phase 2 implementation PASS with one RISK (undefined CSS class `adm-toggle-row`, fixed by using existing `link-btn` class). RISK-001 + signed-URL review returned FAIL on scope technicality: flagged two test files as outside builders' Files list. Main session wrote those tests before dispatch (documented Lane 2 flow); builders did not touch them. Adjudicated PASS on substance; no correctness defect found.
- **Pre-existing limitation (out of scope)**: Probe follow-up starting before 45s `PROBE_FOLLOW_UP_BUDGET_MS` deadline has no cap on its own execution time. Recorded in PROGRESS for next agent.
- **PROD deployment**: GitHub Pages (main branch) deployed. Cloud database and Edge Functions not deployed — see new Task 131 in TASK.md for PROD checklist. Until complete: PROD produces no backups, admin 備份 panel reads empty.
- **Records finalized**: Task 130 moved to TASK_ARCHIVE.md marked done (0.9.11). New Task 131 added to TASK.md (PROD deploy, OPEN). RISK-001 moved to FIXED_BUG.md. This 0.9.11 entry added to PROGRESS.md.
- **Unfinished**: None — 0.9.11 recording complete. PROD deployment awaits explicit user authorization.

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


