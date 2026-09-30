# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-30 02:30:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-27)

- 2026-09-27: every task opened before Task 170 (167, 166, 165, 164, 160, 159, 158, 144, 85, 76, the quote-yahoo data source, 132/133) was moved verbatim to `TASK_ARCHIVE.md` → `## Archived 2026-09-27 —— unfinished tasks before Task 170 (user request)`. Their open items are **not** done; `grep` that section before picking any of them up again.
- Front end deploys from `main` via Cloudflare Pages; Edge Functions and DDL never travel with a push (see CLAUDE.md § Release workflow).

## 📋 Active Tasks

### Task 176: 年度收益「區間收益」—— 自選時間區間看哪幾檔落袋多少
- **Status**: 🔄 IN PROGRESS (code done and on `dev`; only the `main` release is left)
- **Agent**: Claude
- **Timestamp**: 2026-09-30 02:30:00 Asia/Taipei
- **What it is**: a block between the charts and the yearly tables on 年度收益. Presets 近 1 個月 / 近 3 個月 / 近 1 年 / 今年以來 / 去年 / 全部 / 自訂 (default 近 1 年, both ends inclusive), 台股／美股 toggle, per-ticker rows sorted by total return, expandable to the sell legs inside the window, plus a totals row.
- **Scope rule the user set**: only money already realized — the window's sells (incl. 融券回補) and cash dividends. Open positions are never counted, so a buy-only ticker does not appear.
- **Where it lives**: `YearlyReport/rangeRows.ts` (arithmetic), `RangeSection.tsx` (UI), `pnlMath.ts` / `cells.tsx` (shared with the yearly table), `utils/taipeiDate.ts`, `pnlEngine.ts` (`dividendLegs`). Tests: `rangeRows.test.ts`, `RangeSection.test.tsx`. Details in `PROGRESS.md` 2026-09-30 02:30:00.
- **Items**:
  1. ~~Engine: per-leg cash dividends (`DividendLeg` / `dividendLegs`) + `npm run sync:edge-engine`~~ ✅
  2. ~~Pure aggregation + tests (anchor: 區間 = 整個年度 equals that year's row)~~ ✅
  3. ~~UI, CSS, multi-viewport screenshot pass (1440 light/dark, 390 light; overflow 0 px)~~ ✅
  4. ~~0.10.7-dev.1 bump + zh-TW CHANGELOG + commit `dev`~~ ✅
  5. **Release to `main`** —— ⏳ needs the user's OK (CLAUDE.md § Release workflow step 4). No DDL and no Edge deploy required.

### Task 175: Same-day buy — align unrealized P&L / break-even with the broker (BUG-087)
- **Status**: ⏸️ ON HOLD (user chose to keep 0.3% for now, 2026-09-29)
- **Agent**: Claude
- **Timestamp**: 2026-09-29 14:50:00 Asia/Taipei
- **Background**: BUG-087 in `BUG_FIX.md`. PROD workspace 玉山證卷 recomputed with the current engine: 0050 +49,555, 2303 +208, 6560 −389, total **49,374** vs broker **49,423** — the whole gap is 6560's tax (97 at 0.3% vs 48 at 0.15%). All 78 release tags 0.9.0 → 0.10.4 give −389 / 32.79 for 6560, so it is not a regression.
- **Items**:
  1. ~~Confirm the broker's tax on the same-day lot~~ ✅ 2026-09-29: broker screenshots show 6560 預估收入 32,306 = 32,400 − 46 − 48 (0.15%), 2303 on the same screen at 0.3%. Original plan was: on 2026-09-30 read the broker's 6560 break-even (price-independent). 32.79 (same as the dashboard) → broker estimates same-day buys at the 現股當沖 rate; still 32.75 → something else, collect the broker's cost / fee / tax breakdown.
  2. User decided 2026-09-29: not now (keep 0.3%). If revisited: open lots bought today use 0.15% (`estimateUnrealized`, `breakEvenPrice`; only while the lot's `date` is the current Taipei trading day and `tx_nature` is not SHORT). ⏳
  3. ~~Round break-even up to a valid tick~~ ✅ dropped 2026-09-29: the broker also shows cent-level break-even (user: 0050 105.1, 2303 153.4, both equal to the dashboard). Both search the lowest cent price whose floored fee/tax still covers cost; 6560 at 0.15% → 32.75, at 0.3% → 32.79.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
