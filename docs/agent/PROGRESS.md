# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.11 shipped to both environments; backup-transactions phase 2 completed; RISK-001 closed
- Status: **✅ RECORDED**
- Timestamp: 2026-08-24 17:35:44 CST

---

## 📅 Log: 2026-08-24 20:13:32 CST (0.9.12 shipped to dev and main; backup restore feature released)

- **Release 0.9.12**: Shipped to both `dev` and `main` branches (identical at commit a4306e7). GitHub Release 0.9.12 published, body force-synced after PROD deploy to state real deployment status. Pages deploy succeeded.
- **Feature: backup restore** answers the gap the user found — downloaded JSON had no consumer. Restore is additive-only, never deletes or overwrites; first click only previews.
- **Design decision**: Account a backup may write into is taken from validated object path, never from the document itself — checking document against itself would be circular.
- **Three-table writes**: Workspaces → transactions → user_settings. No transaction across tables; half-finished restore names what already landed and is safe to re-run. Recorded as accepted trade-off, not defect.
- **Review outcome**: Implementation PASS with one RISK (partial-apply state not disclosed), fixed by adding `restoreFailureMessage`.
- **Verification**: npm test 81 files / 1234 tests exit 0; tsc --noEmit exit 0; tsc -p tsconfig.edge.json exit 0; npm run build exit 0; oxlint 5 pre-existing warnings.
- **DEV disaster drill**: Three real transactions deleted, preview reported 62/59/3 rows missing and wrote nothing, apply restored them, FULL-TABLE checksum matched pre-deletion exactly (every column, not just row count). Re-run reported zero missing. Two tampered documents (user_id changes in document and in one row) both refused with expected messages, left no trace.
- **PROD deploy**: `stock-report` v56 → v57 (ezbr_sha256 changed, verify_jwt=false unchanged); `stock-price` and `backup-transactions` hashes unchanged; no schema change. Verified without restoring: 401 for unauthenticated and garbage-bearer calls; five malformed paths refused by our gate; read-only previews for both accounts reported no missing rows; PROD row counts unchanged (110 transactions, 5 workspaces).
- **WAF note**: A `../../etc/passwd` probe against PROD never reached our code — Cloudflare's WAF blocked it and returned HTML block page. Testing our own path gate on PROD requires payloads that do not trip the WAF.
- **Records finalized**: Release 0.9.12 added to PROGRESS.md. Oldest entry (backup-transactions phase 1, 2026-08-24 16:57:07) moved to PROGRESS_ARCHIVE.md to keep hot file at header + 2 newest entries.
- **Unfinished**: None — 0.9.12 shipped and verified.

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

## PROD Deploy

- **Deployment executed 2026-08-24 17:48:50 CST** against cloud database project `kxnxadaghidwumqsqneu`:
  1. **Schema section 12** applied: `backups` bucket `public=false`, `backup_run_log` table RLS + admin-only SELECT, run_date index, `backup-daily` cron at '0 18 * * *'.
  2. **Edge Function `backup-transactions`** deployed with `supabase functions deploy backup-transactions --no-verify-jwt`; verified `verify_jwt=false`.
  3. **Edge Function `stock-report`** deployed with `supabase functions deploy stock-report --no-verify-jwt`; verified `verify_jwt=false`. Function `stock-price` untouched at `verify_jwt=true`.
- **Cron secret handling** (technique for reuse): x-cron-secret extracted server-side from existing job's command, formatted directly into new job. Plaintext never reached client or any file.
- **Database identity trap** (supabase-ops hazard): `supabase db query` defaults LOCAL; `--linked` required for cloud. First attempt hit ECONNREFUSED on 127.0.0.1:54322 (self-hosted default), the target-misidentification failure mode.
- **PROD verification**: No secret 401, wrong secret 401, GET 405; `admin-backups` and `admin-backup-url` both 401 without auth. Server-triggered run status=ok for both accounts: 57+53=110 transactions, 4+1=5 workspaces, exactly matching pre-deploy counts. Two storage objects at correct path, `application/json`, sizes matching logged bytes. Public URL returns 400; anon reads `backup_run_log` as []; anon lists bucket as []; ordinary `transactions` endpoint still 200 (RLS did not break normal use).
- **API key validation**: Local sources/.env holds DEV anon key; testing PROD with it returns "Invalid API key". PROD anon key sourced from `supabase projects api-keys --project-ref`.
- **Cron schedule**: `backup-daily` runs daily at Taipei 02:00 from now on.

---
