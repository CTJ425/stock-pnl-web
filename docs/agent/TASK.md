# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-11 18:08:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-11 13:25)

- **Version 0.7.4**: probe-only experiment continues, but 0.7.3's hit rule was wrong for
  `borrow` / `mops_revenue` / `mops_profit` (all three read 中 from the first probe of every window).
  Fixed — see PROGRESS 0.7.4. **The 0.7.3 ticks for those three sources are not usable data.**
- Admin probe panel: one row per source + hit progress bar + expandable log. 「排程」table removed.
- **Fixed after-hours crons restored on DEV 2026-08-11 15:14** (0.7.7). They had been off since 0.7.3
  and nothing was ingesting: a probe hit only writes `source_probe_tick`, it never triggers a fetch.
  `sync-market` retuned to Taipei 15:15/15:30/15:45 (`15,30,45 7 * * 1-5` UTC) —— the probe measured
  BFI82U as 尚未齊 at 15:00/15:05 and green at **15:10**. `source-probe` `*/5 * * * *` stays on.
  **PROD crons not touched** —— needs explicit go-ahead.
- **0.7.7: probe stops re-asking a source once it hits that day** (`pendingSources`). DEV Edge deployed
  2026-08-11 15:28 (volume copy + container recreate) and confirmed on the scheduled 15:30 flight.
  ⚠️ **PROD Edge still runs the 0.7.4 bundle (v41)** —— merging `main` ships Pages only.
- **0.7.8-dev.1: a hit now triggers the fetch itself**, and only a hit whose fetch succeeded retires the
  source (`follow_up_ok`). Code + tests green **in the working tree only** —— not committed, not deployed.
  Needs a DDL before the Edge half: see Task 85.
- PROD Edge stock-report **v41** (0.7.4 bundle, deployed 2026-08-11 13:24).
- ~~After validation: restore generate/market/macro/fx schedules~~ ✅ DEV only (see above); PROD pending.
- **Open bugs: none.**

### Task 84: 0.7.4 ship
- **Status**: ✅ shipped DEV+PROD; only the two-day read-out remains
- **Agent**: Claude
- **Timestamp**: 2026-08-11 13:25:00 Asia/Taipei

1. ~~Fix `borrowHit` / `mopsIssueRocYmd`; widen borrow window to 15:00~~ ✅
2. ~~`schema.sql`: `source_probe_tick` DDL + real cron expression~~ ✅
3. ~~Admin: one row per probe, progress bar, expandable log; delete 排程 table~~ ✅
4. ~~Tests (959 passed) + live-endpoint check of all four predicates~~ ✅
5. ~~DEV volume-copy + functions restart + probe fires 200~~ ✅
6. ~~PROD Edge `stock-report` v40 → **v41** (`--no-verify-jwt`); anon smoke 401/401/400~~ ✅
7. ~~Merge `main` + push (Pages ships the admin rework)~~ ✅ `ac3911b`
8. **Read the 15:00–22:45 windows** and decide the real schedule —— 🔄 partial: `bfi82u` answered
   (2026-08-11 first hit 15:10 → `sync-market` moved to 15:15/15:30/15:45). `t86` / `bwibbu` /
   `margin` / `borrow` / MOPS windows still un-measured; their schedules were restored unchanged and
   should be retuned once a full day of ticks is on record.

> Observability lost with the 排程 table: no screen now shows which environment a cron targets
> (`targetRef`). That column was BUG-003's tripwire. Re-add somewhere if a cron ever misfires again.

⚠️ **Environment facts**:
1. **DEV** = self-hosted `korq9tvdz0jd7yblr72p.ivan.lab` at
   `/root/container/supabase/stock-pnl-web-dev` (not cloud `wqetxuhncvfidqnklyew`).
2. **PROD** = cloud `kxnxadaghidwumqsqneu` only — never freestyle; needs explicit user go-ahead.
3. Self-hosted Edge deploy is **volume copy** into `volumes/functions/` + recreate the
   `functions` container (CLI `supabase functions deploy` does not target this stack).
4. CRON_SECRET is set on Edge + embedded in pg_cron jobs (value not stored in git docs).

## 📋 Active Tasks

### Task 85: 0.7.8 探針命中直接觸發抓取
- **Status**: 🔄 **code + tests green in tree; uncommitted, undeployed**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 18:08:00 Asia/Taipei

1. ~~`PROBE_FOLLOW_UP` / `followUpsFor`; 45s-budgeted follow-up loop in `handleProbe`; note write-back~~ ✅
   (was already in the tree, uncommitted)
2. ~~Close the gap the doc had already promised: retire a source only on **hit + fetch OK**~~ ✅
   `source_probe_tick.follow_up_ok` + `readDoneSourcesToday`; `pendingSources(planned, alreadyDone)`
3. ~~Admin paragraph 「探針本身不會觸發抓取」 is now false —— rewritten + test updated~~ ✅
4. ~~`SPEC.md` amendment (7 sources / hit retires / hit fetches / 0.6.1 gate no longer provable)~~ ✅
5. ~~Version 0.7.8-dev.1 + CHANGELOG~~ ✅ · ~~964/964 vitest, tsc, oxlint~~ ✅
6. **DDL on DEV** `ALTER TABLE source_probe_tick ADD COLUMN IF NOT EXISTS follow_up_ok BOOLEAN;` —— ⏳
   **must land before the Edge bundle**, else the probe degrades to re-probe + re-fetch every 5 min
7. **Commit `dev`** —— ⏳ · **DEV volume-copy + functions recreate** —— ⏳ · **watch one live round** —— ⏳
8. **PROD** (still on the 0.7.4 bundle v41) —— ⏳ explicit go-ahead only

### Task 83: 0.7.0 remove 搜尋個股 + TOP20
- **Status**: 🔄 **code in tree; tests then commit/push/deploy when authorized**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 17:04:08 Asia/Taipei

1. ~~Frontend holdings-only AnalysisPage; delete Top30/watchlist modules~~ ✅
2. ~~Edge holdings-only batch; restore generate/warm whitelist; drop TOP actions~~ ✅
3. ~~Admin jobs/timeline/labels; version 0.7.0 + CHANGELOG~~ ✅
4. ~~Run unit tests (942 passed)~~ ✅
5. ~~Commit + merge main `944548c`~~ ✅
6. ~~push main/dev~~ ✅ · ~~PROD Edge stock-report v38~~ ✅ · ~~DEV volume-copy~~ ✅

### Task 81: Progressive warm core → history (0.6.46-dev.4–dev.6) — kept under holdings path
- **Status**: 🔄 **dev.6 fixes thin quarters; commit; push after you OK**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 19:15:00 Asia/Taipei

1. ~~Edge `phase=core|history|full`; history no second quota~~ ✅
2. ~~Frontend progressive warm + BUG-A last-result seal~~ ✅
3. ~~DEV cold 2881 TTFP metrics~~ ✅
4. ~~**dev.6**: `needsHistoryWarm` when quarters &lt; 6; history-only path~~ ✅
5. ~~DEV: history-only fill 2330 2→12q, 2408 1→11q, 2344 5→12q~~ ✅
6. **Commit 0.6.46-dev.5 + dev.6** —— ⏳
7. **push `dev`** —— ⏳ after you OK
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
   explicit go-ahead (CLAUDE.md § Branches & envs)
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
