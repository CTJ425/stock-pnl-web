# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-12 12:06:18 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-12 12:06)

- **Version 0.7.13.** DEV Edge deployed 2026-08-12 10:50 (volume-copy at `ce3c220`, `diff -rq` clean,
  container recreated) and smoke-verified: anon 401/401/400, authenticated `probe` 200 with an empty
  in-window plan at 10:45, and two `generate-chips` calls advancing `runs_today` 1 → 2 — which is what
  proves the new `borrow_data_date` select in `readLastRun` works rather than degrading to `null`.
  PROD Edge is now deployed as `stock-report` v46 (`verify_jwt=false`, `ezbr_sha256`
  `000ea3b281868aa9…1b878ded`) and smoke-verified; PROD cron still has all 7 jobs and remains
  unchanged — see Task 87.
- **DEV cron count: 7 → 5** — `stock-report-nightly` (generate-chips) and `market-daily` (sync-market)
  removed from DEV's `cron.job` on 2026-08-12 (`schema.sql` §8d updated to match). Neither was a
  deliberate part of the probe-triggers-fetch design: 0.7.3 disabled them for the probe-only
  experiment, 0.7.7 restored them in an emergency because that era's probe never triggered a fetch,
  0.7.8 gave the probe that ability and they were never withdrawn. Measured 2026-08-11:
  `stock-report-nightly` ran 21:30/21:45, *before* the 22:15 borrow flip it was supposed to back up,
  and both passes were skipped by the same gate as the probe rounds — the "outer retry" it was kept
  for did not survive contact with the data. **PROD still has all 7** — removal there needs explicit
  go-ahead (Task 87 item 7).
- **The probe-only-trigger design is now actually enforced on DEV**, not just stated intent. The 5
  remaining DEV jobs: `source-probe` (the mechanism itself), `macro-daily`/`fx-daily` (kept
  permanently — `macro-daily` is itself a calendar-driven probe, `fx-daily` covers a source with no
  publication event to probe; see Task 87), `market-data-daily`/`history-daily`
  (kept for now, deferred — see Task 87 item 11 for why each survives).
- **BUG-026 fixed (0.7.13-dev.1)**: `decideSkip` had no borrow term, so from ~21:00 the gate answered
  `complete` and every invocation short-circuited before `loadBorrow` ever ran — borrow never landed
  on 2026-08-11, identically on both environments. Fixed with a `borrowLanded` term; see `FIXED_BUG.md`.
- **BUG-027 fixed (0.7.13-dev.1)**: `readFundamentalSnapshot` decided `bwibbu`/`mops_revenue`/
  `mops_profit` landing from an unordered 20-ticker sample — PROD's 26 holdings could hit the cap,
  DEV's 5 never could. Explains the `ac3177e` open question (below, Task 85 item 14). Fixed by reading
  all holdings; see `FIXED_BUG.md`.
- **`borrow` probe window retuned** 15:00–22:45 → 21:00–23:30, now that a full day of ticks
  (2026-08-11) measured the flip at 22:15 on both environments. `t86`/`margin`/`bwibbu`/MOPS windows
  deliberately left alone — see Task 87 item 4.
- **The probe now fetches.** A hit runs the matching ingest in the same invocation, and a source is
  retired for the day only once its data is **verifiably on disk** (`data_landed`, judged by
  `sourceLanded` against each artifact's self-reported date —— not by whether the fetch threw).
- **The hit → fetch → verify wiring is covered by tests** since 0.7.10 (`probeRound.ts`, I/O injected,
  9 cases, mutation-checked). Playwright E2E cannot reach it: pg_cron calls the Edge Function directly
  and the browser only ever reads the resulting rows. `readFundamentalSnapshot` and `summariseFollowUp`
  (both touched by 0.7.13) live in `index.ts` and get **no unit test** for the same reason — say so
  plainly rather than implying coverage.
- ✅ **All seven sources share one standard** (0.7.12): hit = the source published today; retire = what
  it published is in the artifact the frontend reads. Enforced by an audit test —— empty evidence, and
  evidence made of the fetch layer's own field names, must both answer 「沒到位」 for every source.
- ⚠️ **`supabase/functions/` had never been typechecked** —— the root tsconfig only covers `src`.
  `npm run typecheck:edge` now exists and is at 0 errors. **Run it after touching any Edge file**;
  `npm test` and `oxlint` will not catch a missing import there.
- **Open bugs: none.** BUG-026/BUG-027 fixed in 0.7.13; BUG-024 (估值每天都是前一交易日) fixed in 0.7.11
  —— see `FIXED_BUG.md`.

<details>
<summary>Superseded snapshot (2026-08-11 13:25) —— kept for the 0.7.3/0.7.4 experiment history</summary>

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
- **Open bugs: BUG-024** —— 估值 BWIBBU 每天存的都是前一個交易日（端點沒有日期參數 + readLatest 當日凍結 + 沒有 cron）。

</details>

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

### Task 86: Model routing made enforceable (replaced the `mad` plugin)
- **Status**: ✅ DONE
- **Agent**: Claude
- **Timestamp**: 2026-08-11 21:10:00 Asia/Taipei

Uninstalled `mad` Claude Code plugin. Added routing guard/observe/audit hooks, routing skill, and enforcement rules in CLAUDE.md. Updated agent files. All verification passed; unknown leftover plugin cache noted.

### Task 87: BUG-026 / BUG-027 + retune the `borrow` probe window + drop the two redundant crons (0.7.13)
- **Status**: 🔄 **code fixed, tested, released as 0.7.13, and deployed to both Edges; DEV cron table
  already down to 5; PROD cron cleanup and tonight's live borrow proof remain open**
- **Agent**: Claude
- **Timestamp**: 2026-08-12 12:06:18 Asia/Taipei

Trigger: reading 2026-08-11's probe ticks on both environments to answer the user's actual question
(「不要讓 generate-chips 從 15:00 開始跑」) turned up that `generate-chips` does **not** run from 15:00 —
it ran 15 times, mostly no-ops or manual — and that the real 15:00-start offender was the `borrow`
**probe window**, plus two defects that were hiding inside the "no-op" rounds. Full analysis:
`/root/.claude/plans/wobbly-jumping-lagoon.md`.

1. ~~**BUG-026**: `decideSkip` gained a `borrowLanded` term (`pollPlan.ts`), computed via `borrowHit`
   against `borrow_data_date` carried across rounds by `readLastRun`; `borrowDataDate` seeded from the
   previous row instead of `null` so a skipped round cannot erase the date that justified the skip~~ ✅
   — see `FIXED_BUG.md`
2. ~~**BUG-027**: `readFundamentalSnapshot` reads all holdings instead of `.slice(0, 20)` of an
   unordered query; `MAX_FUNDAMENTAL_SAMPLE` deleted~~ ✅ — see `FIXED_BUG.md`; **resolves item 14
   below**
3. ~~Diagnosability: `summariseFollowUp` for `generate-chips` now emits `跳過（reason）` /
   `無變動` / `產出 N 檔` instead of collapsing every outcome to one number — this is what let
   BUG-026 hide behind seven identical `產出 0 檔` notes~~ ✅
4. ~~`borrow` probe window `sourceProbePlan.ts`: 15:00–22:45 → **21:00–23:30** — measured flip is
   22:15 on both environments; front edge keeps 75 min margin (one day of samples), back edge
   *extended* past the old 22:45 close because the last fixed shift ran 21:45, before the flip~~ ✅ —
   **resolves the `borrow` half of item 15 below**. `t86` / `margin` / `bwibbu` / MOPS windows
   deliberately left untouched — see plan Part 3 (bwibbu's 08-11 ticks came from the superseded
   `BWIBBU_ALL` path; the other three are cheap and one day is not enough to narrow them)
5. ~~Tests: `pollPlan.test.ts` two new `decideSkip` cases (`borrowLanded:false`/`true`);
   `sourceProbePlan.test.ts` window-boundary cases at 20:55/21:00/22:15/23:00/23:30/23:35~~ ✅ —
   992/992 vitest, `typecheck:edge` 0 errors, `tsc -b` clean, `oxlint` clean
6. ~~Cron cleanup on **DEV**: `stock-report-nightly` (generate-chips) and `market-daily`
   (sync-market) `cron.unschedule`d — neither was a deliberate part of the probe-triggers-fetch
   design (0.7.3 disabled them; 0.7.7 restored them in an emergency because that era's probe never
   triggered a fetch; 0.7.8 gave the probe that ability and they were never withdrawn). Measured
   2026-08-11: `stock-report-nightly` ran 21:30/21:45, *before* the 22:15 borrow flip it was meant to
   back up, and both passes were skipped by the same gate as the probe rounds — the "outer retry"
   did not hold up. `public.admin_schedule_status()` re-checked afterward: 5 rows, `targetRef`
   intact~~ ✅ — `schema.sql` §8d updated to drop the "outer retry" rationale and record why each of
   the remaining five crons is kept
7. **Cron cleanup on PROD** — ⏳ needs explicit user go-ahead per CLAUDE.md; PROD still has all 7
8. ~~**DEV Edge deploy** of the changed function files (`pollPlan.ts`, `sourceProbePlan.ts`,
   `index.ts`)~~ ✅ 2026-08-12 10:50 — rsync into `volumes/functions/stock-report/`, `diff -rq` clean
   against the working tree, `docker compose up -d --force-recreate functions`, container healthy.
   Smoke: anon 401/401/400; authenticated `probe` 200 with `sources: []` at 10:45 (correct — nothing
   in-window at that hour); `generate-chips` ×2 giving `runs_today` 1 → 2 and `regenerated` true then
   false. **Tonight's read will therefore be against the new bundle, not the old one.**
9. **Live proof** — ⏳ after tonight's borrow flip (~22:15): `source_probe_tick` `borrow` should show
   no ticks before 21:00 and its hit round should reach `data_landed=true` then stop (retired)
   instead of repeating to window close; `batch_run_log` for that slot should read `skipped=f` with a
   non-null `borrow_data_date`
10. ~~**PROD Edge deploy**~~ ✅ 2026-08-12 12:02 — `stock-report` v46, `verify_jwt=false`,
    `ezbr_sha256=000ea3b281868aa9…1b878ded`; anonymous smoke `probe=401`, `admin-status=401`,
    unknown action `400`. Verified by checksum, not version number.
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
12. ~~**Make macro's probe decision visible** so the panel stops implying it is blind-scheduled~~ ✅
    0.7.13-dev.2 — `admin-status` returns `probeExperiment.macroScan` (`decideMacroScan` evaluated
    against the already-downloaded `macro/us.json`); the panel renders it as its own block, not a
    seventh row, because this source has no 5-minute ticks to claim. Read-only: the trigger did not
    move. Verified against DEV's live file: `scan=false, reason=satisfied, scansToday=1/16`.
    Also fixed the panel sentence 「固定盤後班表則作為最後的重試」, which step 6 had just made false.

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

**0.7.9**: retiring a source now needs `data_landed`, judged by `sourceLanded` reading the artifact's
own date —— not by whether the fetch threw. Validated against today's real DEV artifacts (the chips
report for 20260811 has a null `margin` stamp and an unflipped `borrow` while returning ok, which is
precisely what 0.7.8 would have mis-retired).

1. ~~`PROBE_FOLLOW_UP` / `followUpsFor`; 45s-budgeted follow-up loop in `handleProbe`; note write-back~~ ✅
   (was already in the tree, uncommitted)
2. ~~Close the gap the doc had already promised: retire a source only on **hit + fetch OK**~~ ✅
   `source_probe_tick.follow_up_ok` + `readDoneSourcesToday`; `pendingSources(planned, alreadyDone)`
3. ~~Admin paragraph 「探針本身不會觸發抓取」 is now false —— rewritten + test updated~~ ✅
4. ~~`SPEC.md` amendment (7 sources / hit retires / hit fetches / 0.6.1 gate no longer provable)~~ ✅
5. ~~Version 0.7.8-dev.1 + CHANGELOG~~ ✅ · ~~964/964 vitest, tsc, oxlint~~ ✅
6. ~~**DDL on DEV** `ALTER TABLE source_probe_tick ADD COLUMN IF NOT EXISTS follow_up_ok BOOLEAN;`~~ ✅ 18:33
   **must land before the Edge bundle**, else the probe degrades to re-probe + re-fetch every 5 min
7. ~~Commit + push `dev` (`9d69b58`)~~ ✅ · ~~DEV volume-copy + functions recreate~~ ✅ 18:34 · ~~release
   0.7.8 + merge `main`~~ ✅
8. ~~Landing check `sourceLanded` + `data_landed` column (0.7.9); DEV rename + redeploy~~ ✅ 18:52
9. **Watch one live round with a hit** —— ⏳ **no follow-up has fired yet.** Confirm a green cell's note
   reads `… · 已觸發 … · 資料已到位` and `data_landed = true`. Next chances: `margin` from 20:30,
   MOPS 21:00/21:05, then tomorrow's 15:00 open.
12. ~~Make the hit path testable without waiting for the market (0.7.10 `probeRound.ts`, 9 cases,
    mutation-checked)~~ ✅ —— **E2E was the wrong layer**: Playwright drives a browser and pg_cron calls
    the Edge Function directly, so no browser test can reach `handleProbe`. See PROGRESS 0.7.10.
13. ~~0.7.11: BUG-024, skip requires the data to be on the screen, the two missing crons, edge
    typecheck~~ ✅ —— mechanism observed end to end on DEV; PROD on v44. See PROGRESS 0.7.11.
14. ~~`mops_profit` on PROD答 `landed=false`，DEV 同版答 `true` —— 尚未查明~~ ✅ **resolved as BUG-027**
    (2026-08-12). Both were on v45, so the rule was identical; the difference was sampling.
    `readFundamentalSnapshot`'s `.slice(0, 20)` of an unordered `batchTwTickers()` query decided the
    verdict — candidate (a) below was the correct one. PROD holds 26 distinct TW tickers so the
    20-ticker cap could bite; DEV holds 5 so it structurally never could. The 2026-08-11 21:00 row
    order itself was never captured, so this is strongly supported rather than replayed — but the fix
    (read all holdings, `index.ts`) removes the failure mode either way. See `FIXED_BUG.md` BUG-027.
    <details><summary>original known facts (2026-08-11 21:05), kept for the record</summary>

    Known facts (2026-08-11 21:05, read from the public bucket exactly as the browser does):
    - PROD holdings `2303` / `2337` / `2344` **do** carry `2026-Q2`, and they sit inside the first 20
      of the ticker list —— so `readFundamentalSnapshot`'s `max` should have seen Q2 and landed.
    - `2330` / `2317` are still on `2026-Q1`; `2312` / `2382` have **no fundamental file at all**.
    - PROD fundamentals are generally days behind (`valuation` 2026-08-06/07) —— expected, since
      `generate-market-data` had no cron there until tonight.
    Two candidate explanations, not yet distinguished: (a) `batchTwTickers()` orders differently from
    the alphabetical list checked by hand, so the 20-ticker sample missed every Q2 holding;
    (b) `readFundamentalSnapshot` threw (20 storage reads in one round) and returned null, which the
    rule correctly treats as 「沒有證據」. **The failure direction is safe either way** —— it refuses to
    retire and retries —— and MOPS only has four slots a day, so the cost is bounded.
    </details>

15. **Retune the remaining windows** —— 🔄 partial. `t86` / `margin` / `bwibbu` / MOPS landing times
    are still un-measured — one day of ticks is not enough for the first three, and `bwibbu`'s
    2026-08-11 ticks came from the pre-0.7.11 superseded `BWIBBU_ALL` path so they cannot answer this
    yet. ~~`borrow` retuned 15:00–22:45 → 21:00–23:30 (0.7.13, measured flip 22:15 on both
    environments)~~ ✅ — see Task 87 item 4.
10. ~~**PROD** DDL + Edge~~ ✅ 2026-08-11 19:1x —— `stock-report` **v41 → v42**, sha
    `9194ae6f…` → `568a98da…`, `verify_jwt` false, anon 401/401/400. PROD went 0.7.4 → 0.7.9.
11. ~~**PROD crons all `active = false`** since the 0.7.3 experiment (0.7.7 only did DEV)~~ ✅ restored
    2026-08-11 19:2x, `market-daily` retuned to `15,30,45 7 * * 1-5`. CRON_SECRET preserved
    (`alter_job`, verified `has_secret` on all five). Both envs now on 0.7.9 with matching schedules.

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
