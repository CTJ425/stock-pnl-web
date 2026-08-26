# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Full DEV+PROD verification scan; PROD cron cleanup; DEV backup-transactions redeploy
- Status: **✅ RECORDED**
- Timestamp: 2026-08-26 14:35:00 Asia/Taipei

---

## 📅 Log: 2026-08-26 14:35:00 Asia/Taipei (DEV+PROD Verification Scan; PROD Cron Cleanup; DEV backup-transactions Redeploy)

- **Verification Scope**:
  1. **PROD Edge Functions**: All three current, deploy timestamps later than last source commit. `backup-transactions` v3 (sha 32d4facac1f755db, deployed 2026-08-25 10:56:36), `stock-report` v60 (sha ad41843daa7bf5f3, deployed 2026-08-25 11:59:46), `stock-price` v20 (sha bac85eb3edcf1fc7, deployed 2026-08-25 17:52:35).
  2. **DEV Edge volume**: `stock-price` and `stock-report` byte-identical to repo; `backup-transactions` stale (dated 2026-08-24 16:53, missing describeError and backupAccountWithRetry).
  3. **BUG-036 (PostgREST 401) status**: Fully closed on PROD. Affected account recovered 2026-08-25 10:57 after manual re-run post-deploy. Both accounts healthy as of 2026-08-26 02:00.
  4. **0.9.15 borrow retune proof**: PROD 20260824 (31 ticks / 13 hits / 0 landed) → 20260825 (19 ticks / 3 hits / 3 landed); DEV shows identical transition.
  5. **0.9.14 MOPS probe fix proof**: PROD 20260824 (1 tick, retired on first landing) → 20260825 (6 ticks spanning 12:00-21:05, all six slots); DEV identical.
  6. **PROD DDL**: All 14 public tables present and identical to DEV set.
  7. **0.9.18 live**: GitHub Pages Actions runs 32836339050/32836339007 succeeded; served bundle reports 0.9.18, click-to-analyze feature present.
  8. **Probe landing windows**: mops_profit 12:00; bfi82u 15:05-19:40; t86 16:05-16:45; twt38u 17:00-17:10; bwibbu 17:05-17:35; margin 20:45-21:00; borrow 22:15-23:30. Measured 2026-08-18..2026-08-26 (data Task 85 was waiting for).
- **Changes Made**:
  1. **PROD cron cleanup (user-authorised)**: `cron.unschedule(11)` "stock-report-nightly" and `cron.unschedule(15)` "market-daily". Both returned true. PROD cron now 6 jobs, matching DEV's 6. Verified by re-query with batch_run_log identity field (565).
  2. **DEV Edge backup-transactions redeployed**: Copied `index.ts` and `backupPlan.ts` into `volumes/functions/backup-transactions/` with `/bin/cp -f`, then `docker compose up -d --force-recreate functions`. Container healthy in ~9s. Boot verified by POST with wrong `x-cron-secret`: HTTP 401 Unauthorized, no compile errors.
- **Files Modified**: Only `docs/agent/` bookkeeping files (PROGRESS.md, TASK.md, BUG_FIX.md, archives).

---

## 📅 Log: 2026-08-25 18:12:00 Asia/Taipei (Holdings Table: Direct Click-to-Analyze for Taiwan Stocks, 0.9.18; 1295 tests PASS)

- **Feature Implemented**:
  1. **Direct Click-to-Analyze for Taiwan Stock Holdings** (`DashboardPage.tsx`):
     - Wired `onSelectTicker` prop to `<HoldingsTable rows={twRows} currency="TWD" onSelectTicker={onSelectTicker} />`.
     - Clickable `<tr>` rows for Taiwan stocks with `cursor: pointer` style and `title="點擊查看個股分析"`.
     - US stocks remain non-clickable (standard cursor, no title, no action) as Stock Analysis focuses on Taiwan market chips/fundamentals/technical data.
  2. **Safe Mode / Offline Guard** (`AppShell.tsx`):
     - Guarded `onSelectTicker` in `AppShell.tsx` with `isReportConfigured` so local/offline mode gracefully leaves rows non-interactive.
  3. **Unit Tests Added** (`DashboardPage.test.tsx`):
     - Verified clicking Taiwan stock rows triggers `onSelectTicker` with `(ticker, name)`.
     - Verified US stock rows do not trigger `onSelectTicker`.
     - Verified offline / undefined `onSelectTicker` handling and empty state display.
- **Verification & Test Suite**:
  - Full Vitest suite: **84 test files / 1295 tests passed** (100% PASS), exit 0.
  - Linter & Typecheck: `npm run lint` (0 errors), `npm run typecheck:edge` (0 errors), `npm run build` (`tsc -b && vite build` exit 0).
- **Files Modified**:
  - `sources/src/components/Dashboard/DashboardPage.tsx`
  - `sources/src/components/AppShell.tsx`
  - `sources/src/components/Dashboard/DashboardPage.test.tsx` (new)
  - `sources/src/version.ts`, `sources/package.json`, `sources/package-lock.json`, `README.md` (bumped to 0.9.18)

