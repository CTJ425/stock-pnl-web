# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: BUG-036 fix recorded in FIXED_BUG.md; Task 132 open items recorded; PROD deploy and recovery pending
- Status: **✅ RECORDED**
- Timestamp: 2026-08-25 10:16:08 Asia/Taipei

---

## 📅 Log: 2026-08-25 10:16:08 Asia/Taipei (BUG-036 backup cron 401; four defects fixed in 0.9.13)

- **Bug discovered**: 2026-08-25 02:00 Asia/Taipei backup-daily cron, one account, one of three simultaneous PostgREST requests returned 401 (`GET /rest/v1/workspaces`) while the other two (transactions, user_settings) returned 200. Same service-role client, same API key. No retry logic, so entire account's backup skipped; `backup_run_log` recorded `status='error'` with message `[object Object]` because PostgREST errors are plain objects, not `Error` instances.
- **Root cause**: three separate defects: (1) no `describeError()` for PostgREST plain objects (2) no retry on transient failures (3) no log verification of `backup_run_log` insert result (4) admin UI showed prune failures as bare success.
- **Four defects fixed in 0.9.13 (commit 84502c6)**:
  1. `sources/supabase/functions/backup-transactions/backupPlan.ts` — new `describeError()` function handles plain-object errors and serializes for logging.
  2. `sources/supabase/functions/backup-transactions/index.ts` — retry failed accounts up to 3 attempts (500ms/1000ms backoff); prune-only failure stays `status='ok'`, not retried.
  3. `sources/supabase/functions/backup-transactions/index.ts` — check and log insert result to catch dropped rows.
  4. `src/components/Admin/BackupsSection.tsx` — `statusLabel` now shows error text on `ok` row; prune failures visible.
- **Tests**: `backupPlan.test.ts` +4 cases for `describeError()`; `BackupsSection.test.tsx` +1 case. Total: `npm test` 81 files / 1239 tests exit 0.
- **Verification**: `npm test` exit 0; `npx tsc --noEmit` exit 0; `npx tsc --noEmit -p tsconfig.edge.json` exit 0; `npm run build` exit 0; `npx oxlint` 5 pre-existing warnings, no new.
- **Deployed**: code on both `dev` and `main` (commit 84502c6, version 0.9.13). Pages deploy covers admin UI. **Edge Function `backup-transactions` on PROD not deployed** — awaits explicit authorization.
- **Open work recorded in Task 132**: (1) PROD Edge deploy (2) DEV Edge redeploy (3) affected account manual re-run (4) CRON_SECRET rotation (exposed in transcript during postgres_logs query, seven PROD cron jobs embed it).
- **Unfinished**: All four PROD/DEV/recovery/security items above.

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

---
