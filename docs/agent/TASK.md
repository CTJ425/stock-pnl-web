# Task Backlog & Tracking (TASK.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-08-14 13:28:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-24 11:37)

- **Version 0.9.9**:
  - Code: Finalized. Features: 儀表板觀察清單區塊（圖卡/條列雙視圖、localStorage 記憶、N/30 容量）、設計翻轉完稿（初稿庫存總覽駁回 → 0.9.0 發布個股分析 tab 4 → 0.9.9 儀表板）、死碼清理。Tests: 1145 passed (77 files, −3 from 0.9.8's 1148 via +10 WatchSection −13 WatchTab).
  - Schema: No changes in 0.9.9.
  - Unfinished: (1) PROD merge (dev → main) — **in progress by user**; (2) Deferred design variants scheduled for later.
- **Version 0.7.26**:
  - Releases: All 84 versions (`0.2` to `0.7.18`) backfilled to GitHub Releases; `.github/workflows/release.yml` created for automatic release sync on push to `main`.
  - Probe: Narrowed `t86` probe window from `15:30–17:30` to `16:00–17:00` (saving 6 daily no-op probes).
  - UI: `MechanismGuide` and `ProbeWarRoom` updated with T86 16:00–17:00 window description.
- **DEV cron count: 5**: `source-probe`, `macro-daily`, `fx-daily`, `market-data-daily`, `history-daily`.
- **All tests green**: 66 test files / 963 vitest tests 100% passed; `typecheck:edge`, `build`, `oxlint` 0 errors.

## 📋 Active Tasks

### Task 132: BUG-036 fix deployment and affected account recovery (0.9.13)
- **Status**: ⏳ **OPEN — Fix implemented and verified; deployment and recovery pending**
- **Agent**: —
- **Timestamp**: 2026-08-25 10:16:08 Asia/Taipei
- **What is this**: BUG-036 (transient 401 on PostgREST, no retry, [object Object] logging) fixed in 0.9.13 commit 84502c6. Four defects corrected in backup-transactions Edge Function and admin UI; all tests pass. PROD Edge Function deployment and recovery of affected account's missing backup remain open.
- **Open items**:
  1. **PROD Edge Function deploy** — `supabase functions deploy backup-transactions --project-ref kxnxadaghidwumqsqneu` must be run to move PROD from old code (no retry, [object Object] logging) to fixed code (retry up to 3×, proper error messages). Pages deploy to `main` covers admin UI display only.
  2. **DEV Edge Function redeploy** — volume copy `sources/supabase/functions/backup-transactions/` to `volumes/functions/` and recreate functions container.
  3. **Affected account manual re-run** — account that failed on 2026-08-25 02:00 has no `2026-08-25.json` backup object. Manual trigger for that date once PROD Edge deploy completes.
  4. **Security: CRON_SECRET rotation** — PROD `CRON_SECRET` exposed in plaintext in agent transcript on 2026-08-25 during postgres_logs query (`event_message` of `cron job 18 starting:` contains full command with `x-cron-secret` header). Seven PROD cron jobs (jobid 12–18) embed this secret. Rotation pending.
- **Unfinished**: All four items above.

### Task 129: ETF constituents in 個股分析 (deferred after investigation)
- **Status**: ⏳ **OPEN — Investigated, deferred; research documented**
- **Agent**: Scribe
- **Timestamp**: 2026-08-24 13:33:13 Asia/Taipei
- **What is this**: Explore adding ETF constituent holdings display to 個股分析 page, showing what a selected ETF owns.
- **Investigation outcome**:
  - **Taiwan Stock Exchange has NO official ETF constituent API.** `openapi.twse.com.tw/v1` has two ETF-related endpoints: `/opendata/t187ap47_L` (fund master data — fund code, tracking index, whether it holds foreign constituents, establishment/listing dates) and `/ETFReport/ETFRank` (monthly regular-savings account counts). Neither provides holdings detail.
  - **Daily PCF (實物申購買回清單) published by each issuer, not TWSE.** TWSE ETF section only links out to issuer sites.
  - **Three candidate data sources if this is built later**:
    1. **MoneyDJ** — uniform URL pattern `https://www.moneydj.com/etf/x/basic/basic0007.xdjhtm?etfid=<ticker>.tw`, server-rendered HTML; verified working for 0050. Gives ticker / weight % / shares held / as-of date. One parser covers all TW ETFs, but it is a third-party site and breaks on redesign.
    2. **Per-issuer PCF pages** (元大 / 國泰 / 富邦 / 群益 / 統一 …) — most authoritative, but needs 10+ parsers plus a ticker→issuer mapping table.
    3. **Paid APIs** — TEJ "ETF 持股(日)" — authoritative but requires subscription.
  - **ETF detection** — no new data needed: `sources/src/utils/fees.ts:59` already infers ETF from ticker starting with `00`; authoritative list available at `t187ap47_L`.
  - **Data layer constraint** — No per-ticker metadata table exists in schema; building this feature requires: new table (holdings index) + new Edge Function proxy (browser CORS blocked) + caching strategy. Pattern exists (`supabase/functions/stock-price/` and `supabase/functions/stock-report/`). Lane classification: **Lane 2 (backend, schema, Edge)**.
- **Next step**: If user decides to build this, start with data source validation (which MoneyDJ parser is robust enough, or evaluate issuer pages), then design schema, then Edge Function.
- **Unfinished**: Everything (architecture through implementation).

### Task 125: Deferred watchlist card design variants (Sparkline / Chips & PE / Range Bar)
- **Status**: ⏳ **OPEN — Design documented, implementation deferred by scope**
- **Agent**: —
- **Timestamp**: 2026-08-24 11:37:39 Asia/Taipei
- **What is this**: During 0.9.9 implementation, three advanced card variants were designed but deferred due to scope constraints (basic card 股代 / 股名 / 價格 / % 變化 shipped; richer variants held for later).
- **Three variants documented in** `docs/architecture/watchlist_6_design_variants.md` **+ .html**:
  1. **Sparkline card** — 7-day price trend miniature line chart, visual at-a-glance trend without numbers.
  2. **Chips & PE card** — Institutional flow badges (籌碼) with buying/selling icons, P/E badge, 機構法人 buy/sell flow indicator.
  3. **Range Bar card** — Intraday high/low range bar (open/close markers), today's trading envelope without historical context.
- **Scope decision**: All three variants add complexity (data fetch, rendering, state management, testing) without changing core watchlist UX. Ship basic card first, validate user interaction, then evaluate demand for variants.
- **Next step**: When scheduling variants, start with design finalization (existing docs are draft), then estimate implementation effort, decide priority relative to other features.
- **Unfinished**: Everything (design validation to implementation).

### Task 87: BUG-026 / BUG-027 + retune the `borrow` probe window + drop the two redundant crons (0.7.13)
- **Status**: 🔄 **code fixed, tested, released as 0.7.13, and deployed to both Edges; DEV cron table
  already down to 5; PROD cron cleanup and tonight's live borrow proof remain open**
- **Agent**: Claude
- **Timestamp**: 2026-08-12 12:06:18 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 8, 10, 12 — full text in `TASK_ARCHIVE.md`.

Trigger: reading 2026-08-11's probe ticks on both environments to answer the user's actual question
(「不要讓 generate-chips 從 15:00 開始跑」) turned up that `generate-chips` does **not** run from 15:00 —
it ran 15 times, mostly no-ops or manual — and that the real 15:00-start offender was the `borrow`
**probe window**, plus two defects that were hiding inside the "no-op" rounds. Full analysis:
`/root/.claude/plans/wobbly-jumping-lagoon.md`.

7. **Cron cleanup on PROD** — ⏳ needs explicit user go-ahead per CLAUDE.md; PROD still has all 7
9. **Live proof** — ⏳ after tonight's borrow flip (~22:15): `source_probe_tick` `borrow` should show
   no ticks before 21:00 and its hit round should reach `data_landed=true` then stop (retired)
   instead of repeating to window close; `batch_run_log` for that slot should read `skipped=f` with a
   non-null `borrow_data_date`
11. **Deferred, not forgotten** (see plan Part 4): `market-data-daily` cron — retire once a full day of
    `bwibbu` ticks on the dated endpoint (post-0.7.11) proves the probe catches it inside its window;
    `history-daily` cron — retire only together with widening `MOPS_SLOTS` beyond its current four
    daily attempts. `macro-daily` / `fx-daily` are **kept permanently, and this is now settled, not
    an open question**: `macro-daily` is *already* a probe — `macroCalendar.decideMacroScan`
    (`macroCalendar.ts:322`) gates on the official BLS/BEA release calendar, retires on
    「once caught, don't catch」, caps at `MAX_SCANS_PER_DAY = 16`, and returns `reason:'skipped'` with
    zero external requests otherwise, so the `*/30` cron is that probe's tick exactly as `*/5` is
    `source-probe`'s. `fx-daily` is the one genuinely blind schedule and correctly so: `syncFx`
    (`index.ts:1848`) has no gate because FX has no publication event — a rolling `range=1y` series
    plus a twice-daily BOT CSV means the endpoint always has data, so a probe would ask a question
    that is always true (the 「永遠為真」 trap 0.7.4 fixed for `borrow` and MOPS).

**Operational note, act on this**: while inspecting `cron.job` commands during this task, a
redaction regex failed to match the actual header format (`'x-cron-secret', 'VALUE'`, comma-separated,
not JSON colon syntax) and the **DEV self-hosted `CRON_SECRET` was printed into the session
transcript**. PROD's secret was not exposed. **Recommend rotating the DEV `CRON_SECRET`.** Lesson for
next time: when inspecting `cron.job.command`, select only structural predicates
(`command LIKE '%x-cron-secret%'`) or extract just the action/url with a narrow `regexp_match` —
never select the command text, redacted or otherwise.

### Task 85: 0.7.8 / 0.7.9 探針命中直接觸發抓取，且要確認資料到位
- **Status**: 🔄 **shipped everywhere and proven live; step 14 resolved, step 15 half-done (see Task 87)**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 19:00:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14 — full text in `TASK_ARCHIVE.md`.

**0.7.9**: retiring a source now needs `data_landed`, judged by `sourceLanded` reading the artifact's
own date —— not by whether the fetch threw. Validated against today's real DEV artifacts (the chips
report for 20260811 has a null `margin` stamp and an unflipped `borrow` while returning ok, which is
precisely what 0.7.8 would have mis-retired).

9. **Watch one live round with a hit** —— ⏳ **no follow-up has fired yet.** Confirm a green cell's note
   reads `… · 已觸發 … · 資料已到位` and `data_landed = true`. Next chances: `margin` from 20:30,
   MOPS 21:00/21:05, then tomorrow's 15:00 open.
15. **Retune the remaining windows** —— 🔄 partial. `t86` / `margin` / `bwibbu` / MOPS landing times
    are still un-measured — one day of ticks is not enough for the first three, and `bwibbu`'s
    2026-08-11 ticks came from the pre-0.7.11 superseded `BWIBBU_ALL` path so they cannot answer this
    yet. ~~`borrow` retuned 15:00–22:45 → 21:00–23:30 (0.7.13, measured flip 22:15 on both
    environments)~~ ✅ — see Task 87 item 4.

### Task 83: 0.7.0 remove 搜尋個股 + TOP20
- **Status**: 🔄 **code in tree; tests then commit/push/deploy when authorized**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 17:04:08 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6 — full text in `TASK_ARCHIVE.md`. ⚠️ **No sub-item is still
  open**; the `🔄` status line predates that and has never been reconciled. Confirm before archiving
  the whole entry.

### Task 81: Progressive warm core → history (0.6.46-dev.4–dev.6) — kept under holdings path
- **Status**: 🔄 **dev.6 fixes thin quarters; commit; push after you OK**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 19:15:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5 — full text in `TASK_ARCHIVE.md`.

6. **Commit 0.6.46-dev.5 + dev.6** —— ⏳
7. **push `dev`** —— ⏳ after you OK
8. **Prod** deploy when authorized —— ⏳

### Task 80: FOMC meeting points (0.6.46-dev.2)
- **Status**: 🔄 **Code committed in f03ade5; push + prod open**
- **Agent**: Grok
- **Timestamp**: 2026-08-10 09:47:00 Asia/Taipei
- **Done**: items 1, 2, 3 — full text in `TASK_ARCHIVE.md`.

4. ~~Commit (bundled in f03ade5)~~ ✅ · **push `dev`** —— ⏳
5. **Prod** deploy + sync-macro —— ⏳

### Task 79: Prefetch + night batch for new / watched stocks (0.6.46-dev.1)
- **Status**: 🔄 **Code committed in f03ade5; push + prod still open**
- **Agent**: Grok
- **Timestamp**: 2026-08-09 13:40:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5 — full text in `TASK_ARCHIVE.md`.

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

### Task 128: CI workflow must gate deployments on test/lint/typecheck (discovered in audit 2026-08-23)
- **Status**: ⏳ **OPEN — User deferred; CI gate not added this round**
- **Agent**: Scribe
- **Timestamp**: 2026-08-23 18:52:37 Asia/Taipei
- **Finding**: `.github/workflows/deploy.yml` runs only `npm ci` → `npm run build` → deploy to GitHub Pages; no `npm test`, `npm run lint`, or `npm run typecheck:edge`. A push to `main` deploys to production while CI type-checks via the build but runs no tests and no lint. The P0 finding from this audit (test summary said "all passed", but exit code was 1) is exactly the failure mode a test gate misses.
- **User decision**: Explicitly chose NOT to add CI gate in this round. Recording as open task, not as a deferred decision to revisit unprompted.

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
