# Task Backlog & Tracking (TASK.md)

- Agent: Grok
- Status: ACTIVE
- Timestamp: 2026-08-10 18:40:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md §4.1) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-10 18:40)

- **Version 0.6.46-dev.4** on `dev` (local; commit/push pending user).
- **0.6.46-dev.1–3** committed as `f03ade5` (prefetch + FOMC meetings + macro UI).
- **dev.4**: progressive warm core/history — code local; DEV Edge volume-copy still open.
- **PROD**: do not deploy until user authorizes.
- **Open bugs: none.**
- **Task 76 items 1/3/4** still unrecorded.

⚠️ **Environment facts**:
1. **DEV** = self-hosted `korq9tvdz0jd7yblr72p.ivan.lab` at
   `/root/container/supabase/stock-pnl-web-dev` (not cloud `wqetxuhncvfidqnklyew`).
2. **PROD** = cloud `kxnxadaghidwumqsqneu` only — never freestyle; needs explicit user go-ahead.
3. Self-hosted Edge deploy is **volume copy** into `volumes/functions/` + recreate the
   `functions` container (CLI `supabase functions deploy` does not target this stack).
4. CRON_SECRET is set on Edge + embedded in pg_cron jobs (value not stored in git docs).

## 📋 Active Tasks

### Task 81: Progressive warm core → history (0.6.46-dev.4)
- **Status**: 🔄 **Committed + DEV Edge live; manual UI timing then push**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 18:55:00 Asia/Taipei

1. ~~Edge `phase=core|history|full`; history no second quota~~ ✅
2. ~~Frontend `warmStockCore` / `warmStockHistory` / progressive `warmStock`~~ ✅
3. ~~StockDetailPage paint after core; useDailySeries uses core only~~ ✅
4. ~~Unit tests 933/933~~ ✅
5. ~~**DEV**: volume-copy `stock-report` + recreate functions (healthy); anon warm 401; index.ts SHA match~~ ✅
6. **Manual**: open cold ticker on local vite → DEV; measure time-to-valuation vs full history —— ⏳
7. ~~Commit `f89de86`~~ ✅ · **push `dev`** —— ⏳ after local OK
8. **Prod** deploy when authorized —— ⏳

### Task 80: FOMC meeting points (0.6.46-dev.2)
- **Status**: 🔄 **Code committed in f03ade5; push + prod open**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 09:47:00 Asia/Taipei

1. ~~`meetingRatePoints` + syncMacro calendar wiring~~ ✅
2. ~~Tests + force rebuild for legacy step-only files~~ ✅
3. ~~DEV deploy + sync-macro → latest 2026-07-29~~ ✅
4. ~~Commit (bundled in f03ade5)~~ ✅ · **push `dev`** —— ⏳
5. **Prod** deploy + sync-macro —— ⏳

### Task 79: Prefetch + night batch for new / watched stocks (0.6.46-dev.1)
- **Status**: 🔄 **Code committed in f03ade5; push + prod still open**
- **Agent**: Grok
- **Timestamp**: 2026-08-09 13:40:00 Asia/Taipei

1. ~~Edge: `batchTwTickers` = holdings ∪ `tw_watchlist`; generate-all / backfill use it~~ ✅
2. ~~Frontend: `prefetchStockData` on watchlist add + first TPE buy~~ ✅
3. ~~UI: 「歷史補齊中」 when short of 12/12~~ ✅
4. ~~Tests; version trail through dev.3~~ ✅
5. ~~**DEV**: volume-copy `stock-report` + restart functions; warm anon 401~~ ✅
6. ~~Commit (bundled in f03ade5)~~ ✅ · **push `dev`** —— ⏳ user go-ahead
7. **Prod**: deploy `stock-report --no-verify-jwt` when authorized —— ⏳

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
