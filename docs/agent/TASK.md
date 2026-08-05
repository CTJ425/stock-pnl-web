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
- **`market-daily` runs Taipei 15:00–18:30 every half hour** in both environments (`0,30 7-10 * * 1-5`).
- **890 tests across 57 files**; `npm run build` and `npm run lint` clean apart from four long-standing
  `only-export-components` warnings.
- The 2026-08-06 codebase audit is closed: all eight findings fixed (BUG-015 … BUG-022).

⚠️ **Two environment facts the next session must know**:
1. `supabase link` currently points at **production** (`kxnxadaghidwumqsqneu`). Re-link before any
   `db query --linked` against test.
2. The user pasted two project keys into the chat on 2026-08-05. They were never written to disk (repo and
   scratchpad both scanned, no match), but they are exposed and **rotation was advised and not confirmed done**.

## 📋 Active Tasks

### Task 76: Two checks that can only be made during market hours
- **Status**: ⏳ **Waiting for a trading session** —— first opportunity 2026-08-06
- **Agent**: Claude
- **Timestamp**: 2026-08-06 01:50:00 Asia/Taipei
- **Lifted out of Task 69 before archiving it**, so that archiving would not bury them.

1. **Did the 15:00 `market-daily` round actually win?** (from 0.6.38)
   Read `market/daily.json`'s `asOf`: if it lands near 15:00 the early round works; if it stays at 16:00 or later,
   the binding constraint is **FMTQIK**, not BFI82U —— today's institutional amount is only fetched once today's
   date exists in the merged day list, and that list comes from FMTQIK. Nothing is broken either way; the answer
   decides whether the 15:00/15:30 rounds are worth keeping.
2. **The 成交量 discrepancy between the two sources** (Task 69's original item).
   Measured 2026-08-05 on 2330: daily batch **35,214 張** vs MIS **31,851 張**, about 10%. Both are now visible on
   the same page (the 行情 card is MIS, the new 成交量 table is the batch). Reconcile against `STOCK_DAY_ALL` once
   it publishes —— re-checked at 20:50 on 08-05 it was **still** on `1150804`, so it lags by more than an evening.
   Two facts already established: that endpoint carries 1377 TWSE records only (**6488 is absent**, TPEx), and its
   `TradeVolume` is in **shares**, not lots.
3. **Also worth one glance**: the first post-deploy T86 round will report one extra `revisions`. That is the
   expected one-off from changing the fingerprint separator (BUG-018) —— do not open a bug for it.
4. **Trial-matching window (08:30–09:00)**: confirm the new 「試撮」 badge appears on the dashboard and the 「預估」
   cell fills in on the quote card. This is the on-screen confirmation BUG-015 was fixed from reading, not seeing.

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

