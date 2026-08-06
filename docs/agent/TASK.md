# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-06 01:50:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md §4.1) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-08-06 01:50)

- **Version 0.6.43**, `main` = `origin/main` = `origin/dev` = `2e4103e`, working tree clean, Pages deployed.
- **Edge Functions are current in both environments** —— `stock-price` `2797ede37f0a` (prod v16 / test v12),
  `stock-report` `c8825b1f4908` (prod v30 / test v44), `verify_jwt` `true` / `false` respectively.
- **`market-daily` is scheduled Taipei 15:00–18:30 every half hour** in both environments (`0,30 7-10 * * 1-5`),
  but has **never actually run on that schedule** —— its only three runs ever were 2026-08-05 16:00/17:00/18:00,
  under the hourly schedule it was created with. 2026-08-06 is its first real day (Task 76 item 1).
- **890 tests across 57 files**; `npm run build` and `npm run lint` clean apart from four long-standing
  `only-export-components` warnings.
- The 2026-08-06 codebase audit is closed: all eight findings fixed (BUG-015 … BUG-022).

⚠️ **Two environment facts the next session must know**:
1. `supabase link` currently points at **production** (`kxnxadaghidwumqsqneu`). Re-link before any
   `db query --linked` against test.
2. The user pasted two project keys into the chat on 2026-08-05. They were never written to disk (repo and
   scratchpad both scanned, no match), but they are exposed and **rotation was advised and not confirmed done**.

## 📋 Active Tasks

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Item 2 closed 2026-08-06 10:00; items 1, 3, 4 still waiting on today's clock**
- **Agent**: Claude
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei
- **Lifted out of Task 69 before archiving it**, so that archiving would not bury them.

1. **Did the 15:00 `market-daily` round actually win?** (from 0.6.38) —— ⏳ **answerable from 15:03 today**.
   ⚠️ **The premise as first written is unsafe, do not reuse it.** `cron.job_run_details` (production, retained
   back to 07-27) shows jobid 15 has run **exactly three times ever**: 2026-08-05 at 16:00, 17:00, 18:00 Taipei.
   The job was created that afternoon on an hourly schedule and only later became `0,30 7-10 * * 1-5`, so
   **2026-08-06 is the first day the 15:00/15:30 rounds fire at all**. That makes the current
   `asOf = 2026-08-05T10:00:02Z` (= 18:00 Taipei) merely *the last round of a three-round day* —— it is **not**
   evidence about when FMTQIK publishes, and must not be read as such.
   The real test: `asOf` only moves when the content signature changes, so watch which of today's rounds first
   carries an `2026-08-06` row. If 15:03 already shows it, the early rounds earn their keep; if it first appears
   at 16:04 or later, the binding constraint is **FMTQIK**, not BFI82U.
2. ~~**The 成交量 discrepancy between the two sources**~~ —— ✅ **DONE 2026-08-06 10:00**. `STOCK_DAY_ALL` has
   published `1150805`, so it catches up overnight rather than lagging "more than an evening". Full numbers and
   provenance are in `SPEC.md` → Individual stock (技術面). The two conclusions:
   - **The app's own two sources agree to within 0.2%** (Yahoo 31,905,196 vs MIS 31,851,000 shares for 2330 on
     08-05). The recorded ~10% spread was an unsettled Yahoo bar —— Yahoo has since revised that day down from
     35,214 張, and it revises elsewhere too (`daily/2303.json` holds 181,531,926 for 08-04, Yahoo now 180,117,150).
     **`SPEC.md`'s "disagree by design, about 10%" claim was corrected, not deleted.**
   - **Both sit ~13% below TWSE's own daily figure** (36,782,301 shares), because `STOCK_DAY` counts sessions the
     regular-session feeds do not: 鉅額交易 1,464,000 verified, 盤後零股 42,196 verified, 盤後定價 nil for 2330.
     The ~3.4M residual is **inferred** to be 盤中零股 —— not proven, its per-stock report was not reachable.
   - Market-wide the app reconciles cleanly: 成交金額 within 0.33%, 筆數 within 2.3%; the 26% share gap is 權證/ETN,
     which `STOCK_DAY_ALL` omits.
3. **Also worth one glance**: the first post-deploy T86 round will report one extra `revisions`. That is the
   expected one-off from changing the fingerprint separator (BUG-018) —— do not open a bug for it.
   ⏳ **The first post-deploy T86 round is today's 16:30** (the deploy landed 08-06 01:2x; all of 08-05's rounds
   were pre-deploy and every one of them logged `t86_revisions = 0`). Query:
   `select taipei_time, t86_revisions, t86_unchanged, t86_frozen from batch_run_log where taipei_ymd='20260806'`.
4. **Trial-matching window**: confirm the 「試撮」 badge appears on the dashboard and the 「預估」 cell fills in on
   the quote card. This is the on-screen confirmation BUG-015 was fixed from reading, not seeing.
   ⏳ The 08:30–09:00 window was already past when this session started (09:17); **the 13:25–13:30 closing
   auction is the same code path** and is the next chance today. Note the on-screen half needs a browser and
   Playwright is not installed in this environment (see 0.3.3 log) —— the data half (MIS returning `ip=1`) is
   being sampled every 20s from 13:22 by `scratchpad/task76-capture.sh` into `task76-log.jsonl`.

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

