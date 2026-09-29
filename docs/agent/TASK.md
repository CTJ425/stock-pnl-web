# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-29 14:50:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-27)

- 2026-09-27: every task opened before Task 170 (167, 166, 165, 164, 160, 159, 158, 144, 85, 76, the quote-yahoo data source, 132/133) was moved verbatim to `TASK_ARCHIVE.md` → `## Archived 2026-09-27 —— unfinished tasks before Task 170 (user request)`. Their open items are **not** done; `grep` that section before picking any of them up again.
- Front end deploys from `main` via Cloudflare Pages; Edge Functions and DDL never travel with a push (see CLAUDE.md § Release workflow).

## 📋 Active Tasks

### Task 175: Same-day buy — align unrealized P&L / break-even with the broker (BUG-087)
- **Status**: 🔄 IN PROGRESS (waiting on the user's broker check, 2026-09-30)
- **Agent**: Claude
- **Timestamp**: 2026-09-29 14:50:00 Asia/Taipei
- **Background**: BUG-087 in `BUG_FIX.md`. PROD workspace 玉山證卷 recomputed with the current engine: 0050 +49,555, 2303 +208, 6560 −389, total **49,374** vs broker **49,423** — the whole gap is 6560's tax (97 at 0.3% vs 48 at 0.15%). All 78 release tags 0.9.0 → 0.10.4 give −389 / 32.79 for 6560, so it is not a regression.
- **Items**:
  1. User: on 2026-09-30 read the broker's 6560 break-even (price-independent). 32.80 → broker estimates same-day buys at the 現股當沖 rate; still 32.75 → something else, collect the broker's cost / fee / tax breakdown. ⏳
  2. If (1) confirms: user decides whether open lots bought today use 0.15% (`estimateUnrealized`, `breakEvenPrice`; only while the lot's `date` is the current Taipei trading day and `tx_nature` is not SHORT). ⏳
  3. Break-even is not rounded up to a valid tick: 6560 shows 32.79 (sellable 32.80), 2303 shows 153.4 (tick 0.5 → 153.5); broker shows tick prices. Fix with the TW tick table, rounding up. ⏳ (needs user OK)

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
