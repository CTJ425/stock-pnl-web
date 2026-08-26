# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.19 release and deployment recorded (當日大盤 panel in 總體經濟 > 台股); DEV+PROD deployed and verified
- Status: **✅ RECORDED**
- Timestamp: 2026-08-26 17:05:00 Asia/Taipei

---

## 📅 Log: 2026-08-26 17:05:00 Asia/Taipei (0.9.19 Release: 當日大盤 Panel in 總體經濟 > 台股; DEV+PROD Deployed)

- **Feature Released**:
  1. **當日大盤 Panel** at the top of 總體經濟 > 台股, reusing IntradayChart component (`TwIndexToday.tsx`).
  2. Shows intraday OHLC data, volume, and price change visualization for Taiwan Index (^TWII).
  3. Integrated into `TwMarketSection.tsx` workflow.

- **Route Completed**: Spec → failing tests (main session) → builder → reviewer → main-session adjudication → release → deploy both environments.

- **Test & Quality Verification**:
  - Full Vitest suite: **85 test files / 1313 tests passed** (100% PASS), exit 0.
  - Linter: `npm run lint` exit 0.
  - Typecheck: `npm run typecheck:edge` exit 0.
  - Build: `npm run build` exit 0.
  - Reviewer: PASS with one RISK fixed (`pnlClass(changePct)` instead of `pnlClass(change)` in TwIndexToday.tsx; harmless while `prevClose` > 0, which is always true for index, but was a slip rather than trade-off).
  - Edge `index.ts` diff: doc comment + widened `SymbolItem['market']` to include `'IDX'` — zero runtime change.

- **Deployment Completed**:
  1. **DEV Edge** (`stock-price`): Volume copy with `/bin/cp -f` into `volumes/functions/stock-price/`, then `docker compose up -d --force-recreate functions`; healthy in ~9s. `diff -rq` all files identical.
  2. **PROD Edge** (`stock-price`): `supabase functions deploy stock-price --project-ref kxnxadaghidwumqsqneu`, no `--no-verify-jwt`. Version 20 → 21, ezbr_sha256 changed from `bac85eb3edcf1fc7` to `a1a7920dddf42417` (proof new code landed).
  3. **Live Behaviour Verified**: `^TWII` returns dayOpen/dayHigh/dayLow from OHLC arrays. Stock path `2330.TW` unchanged (271 points, prevClose=2400, interval=1m, point keys t/c/v).
  4. **GitHub Pages**: Deploy run 32948412913 succeeded; served bundle reports 0.9.19.

- **Files Changed**: 17 total (+666/−48) — `sources/supabase/functions/stock-price/intradayParse.ts`, `sources/supabase/functions/stock-price/index.ts`, `sources/src/services/intradayProxy.ts`, `sources/src/components/StockDetail/IntradayChart.tsx`, `sources/src/components/Macro/TwIndexToday.tsx` (new), `sources/src/components/Macro/TwMarketSection.tsx`, `sources/src/index.css`, plus four test files and version/README/CHANGELOG set.

- **Commits**: `7dae025` (feature, 0.9.19-dev.1) and `329fb95` (chore(release): 0.9.19). Branches: `dev`, `main`, `origin/dev`, `origin/main` all at `329fb95`.

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

