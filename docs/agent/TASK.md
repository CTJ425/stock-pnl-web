# Task Backlog & Tracking (TASK.md)

- Agent: Grok
- Status: ACTIVE
- Timestamp: 2026-08-07 15:39:33 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md §4.1) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-07 15:39)

- **Version 0.6.44-dev.1** (`dev` branch; official `0.6.44` only after merge to `main`):
  full-market search + `assertUser` / `warm_quota` gating.
- **DEV admin**: `zrchen0425@gmail.com` has `app_metadata.role = admin` (must re-login for JWT).
- **Self-hosted DEV is live**: `https://korq9tvdz0jd7yblr72p.ivan.lab` (Docker
  `stock-pnl-web-dev`). Schema, `take_warm_quota`, `reports` bucket, 5 cron jobs, Edge
  `stock-price` + `stock-report`, and CRON_SECRET (Edge env + cron jobs) are applied.
  Smoke green on DEV (price 200 / warm anon 401 / generate-all 200).
- **Former cloud test project** `wqetxuhncvfidqnklyew` is **not** the active DEV target.
- **Production** (`kxnxadaghidwumqsqneu`) still on the previous baseline until explicitly updated.
- **Open bugs: none.**
- **Task 76 items 1/3/4** still unrecorded.

⚠️ **Environment facts**:
1. **DEV** = self-hosted `korq9tvdz0jd7yblr72p.ivan.lab` at
   `/root/container/supabase/stock-pnl-web-dev` (not cloud `wqetxuhncvfidqnklyew`).
2. **PROD** = cloud `kxnxadaghidwumqsqneu` only — never freestyle; needs explicit user go-ahead.
3. Self-hosted Edge deploy is **volume copy** into `volumes/functions/` + recreate the
   `functions` container (CLI `supabase functions deploy` does not target this stack).
4. CRON_SECRET is set on Edge + embedded in pg_cron jobs (value not stored in git docs).
5. Remaining 0.6.44 checklist:
   - Prod: apply `warm_quota` + `take_warm_quota`, deploy `stock-report --no-verify-jwt`, smoke.
   - Push `dev` → Pages verify → merge `main` when prod is green.

## 📋 Active Tasks

### Task 78: Watchlist sub-tabs + early monthly revenue (0.6.44-dev.6)
- **Status**: 🔄 **DEV green; prod + frontend push still open**
- **Agent**: Grok
- **Timestamp**: 2026-08-07 17:10:00 Asia/Taipei

1. ~~Frontend: 我的持股 / 其他台股 subtabs, max 5 watchlist, prune vs holdings~~ ✅
2. ~~Schema: `tw_watchlist` + RLS + max-5 trigger in `schema.sql`~~ ✅
3. ~~Edge: `publishedMonths` always previous month; open-window through safety~~ ✅
4. ~~Tests: revenue history, twWatchlist, AnalysisPage~~ ✅
5. ~~**DEV**: `tw_watchlist` DDL + volume-copy `stock-report` + smoke (2059 July, max-5)~~ ✅
6. **Prod**: DDL + Edge when user authorizes —— ⏳
7. **Push `dev`** for frontend subtabs on Pages —— ⏳

### Task 77: Ship 0.6.44 (full-market analysis search)
- **Status**: 🔄 **DEV bootstrap + smoke done; prod deploy + push still open**
- **Agent**: Grok
- **Timestamp**: 2026-08-07 15:39:33 Asia/Taipei

1. ~~Frontend: search box, non-holding path, one-shot quote, stale daily re-warm~~ ✅
2. ~~Edge: `assertUser`, atomic `take_warm_quota`, unknown-ticker still runs `syncFundamental`, prune~~ ✅
3. ~~Schema: `warm_quota` table + `take_warm_quota` function in `schema.sql`~~ ✅
4. ~~Tests: `warmStock`, `AnalysisPage` search paths, `StockDetailPage` name passthrough~~ ✅
5. ~~Version / CHANGELOG / SPEC / PROGRESS~~ ✅
6. **DDL + Edge deploy** —— ✅ **self-hosted DEV** (2026-08-07 15:39); ⏳ **prod** still needs
   explicit go-ahead (CLAUDE.md §13.2)
7. **Push `dev` → verify Pages/test → merge main** —— ⏳ after prod half of 6

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Item 2 closed 2026-08-06; items 1, 3, 4 still unrecorded**
- **Agent**: Claude (last update) / Grok (carried forward)
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei (status text refreshed 2026-08-07)

1. **Did an early `market-daily` round actually land the day?** —— ⏳ still open as a written answer.
   Watch which round first carries the session day's row in `market/daily.json` `asOf` / content.
   Premise warning from 08-06 still holds: pre-08-06 run history was only three hourly rounds on 08-05.
2. ~~**The 成交量 discrepancy between the two sources**~~ —— ✅ **DONE 2026-08-06 10:00**. See SPEC 技術面.
3. **First post-BUG-018 T86 round `t86_revisions`** —— ⏳ expected one-off +1; query
   `batch_run_log` for the first day after the 0.6.42 Edge deploy (2026-08-06 16:30 onward).
4. **Trial-matching UI** —— ⏳ confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window
   (08:30–09:00 or 13:25–13:30). Needs a browser; data half is MIS `ip=1`.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why it is manual**: the BLS schedule page returns 403 for everything (changing the
  User-Agent does not help), so it cannot be synced automatically; BEA's page is fetchable.
  `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
- **If it is forgotten**: nothing breaks — once the calendar runs out the code falls back
  to rule-based estimation and marks the entry `stale`. Only precision drops, because the
  scan window no longer lines up with the actual release time.
