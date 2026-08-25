# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 133 probe code completed and tested; PROD deployment and new finding recorded
- Status: **✅ RECORDED**
- Timestamp: 2026-08-25 11:33:57 Asia/Taipei

---

## 📅 Log: 2026-08-25 11:33:57 Asia/Taipei (Task 133: MOPS probe sources never retire; code complete, deployment open)

- **Task 133 completion**: MOPS sources now probe all six daily slots, never retiring. Root cause: `REQUIRED_LANDED_COUNTS` set both MOPS sources to 1, so they retired on first landing at 12:00 slot. The MOPS aggregate tables re-issue throughout the day as companies file, so a source stopping after first landing misses later, larger issues.
- **Fix implemented**: `REQUIRED_LANDED_COUNTS.mops_revenue` and `.mops_profit` now set to `Number.POSITIVE_INFINITY`. `retiredSources()` compares `counts[id] >= required[id]`, so infinite requirement is never met — both sources probe all six slots every weekday. Daily sources (t86, bwibbu, margin, twt38u, bfi82u, borrow) keep existing `REQUIRED_LANDED_COUNTS = 3` and trailing-run retirement rule.
- **Files changed** (production code): `sources/supabase/functions/stock-report/sourceProbePlan.ts`, `sources/src/components/Admin/ProbeWarRoom.tsx`, `sources/src/components/Admin/MechanismGuide.tsx`.
- **UI updates**: MOPS cards now show `n/6 槽` progress (slots probed, not hits or landings); states flow `⏳ 待機中` → `🟢 探測中 (n/6 槽)` → `✅ 六槽跑完` (never `退休`). Daily source cards unchanged (still `n/3 次到位` → `✅ 已退休`). Summary tag `已退休 N 源` becomes `收工 N 源` (unifies retirement and 六槽跑完). MechanismGuide MOPS rows updated to show `不退休 (六槽全跑)`.
- **Verification**: From `sources/`: `npm test -- sourceProbePlan.test.ts ProbeWarRoom.test.tsx MechanismGuide.test.tsx` — all test cases pass. Full suite: `npm test -- --run` exit 0 (81 files / 1243 tests passed). `npm run lint` and `npm run typecheck:edge` exit 0.
- **Accepted cost** (trade-off, not risk): On a MOPS publication day, a hit now fires `generate-history` on each of six slots instead of once. Within existing envelope: `borrow` fires `generate-chips` 13× on a PROD day; `bfi82u` fires `sync-market` 6×.
- **Deployment status**: Code complete and tested. **Not deployed to PROD or DEV Edge** — awaits explicit user authorization.
- **New finding recorded**: PROD `borrow` probe on 2026-08-24 logged 31 ticks / 13 hits / 0 landed (never satisfies `sourceLanded`, never retires, probes full 21:00–23:30 window daily, fires `generate-chips` 13×). Added as new open finding to BUG_FIX.md; not investigated, no owner decision yet.
- **Unfinished**: Edge Function deployment to DEV and PROD.

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

---
