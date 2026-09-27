# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 171 — chart-first redesign of the five remaining pages on `dev` as 0.9.72-dev.1
- Status: 🔄 `dev` = 0.9.72-dev.1, `main` = 0.9.71. Waiting for the user's DEV review before `main`. Still owed from Task 170: PROD DDL `fee_rebate` (user, `docs/agent/prod-0.9.71-migration.sql`)
- Timestamp: 2026-09-27 12:11:35 Asia/Taipei

---

## 📅 Log: 2026-09-27 12:11:35 Asia/Taipei (Task 171, 0.9.72-dev.1)
- User approved the chart-first demo (v2) and asked for all five pages at once. Implemented: 個股分析 (one tab row; letterhead + price chart + 我的持股 strip; stacked 三大法人 bars; margin/short lines above the matrix; matrices in `details.chart-more`; 損益試算 price scale), 年度收益 (`YearlyOverview`: year bars with pick, contributions list, cumulative line; one number per cell, 未含費 and fee split only on sell rows; footnotes replace HelpTh), 總體經濟 (index rows with diverging bars; US indicators as small line charts), 外幣匯率 (currency rows with diverging bars), 後台 (probe arrival timeline, cards under a disclosure).
- Chart infra: `BarSeriesChart` gained `stacked`, `selectedIndex`, `onSelect` (ChartFrame click/Enter); `CATEGORICAL_COLORS` → `var(--chart-c1..4)` per theme (validated blue/yellow/violet/pink).
- Removed on purpose: the 2-day 法人 cards in the quote block (the chips chart shows the same numbers), dead CSS for section tabs and detail cards.
- Verify: vitest 149 files / 2,506 tests, 2,499 passed, 7 skipped; build, typecheck:edge, lint exit 0; detector 1 finding fixed (3px tab rule → 2px). Visual: vite on DEV env with Playwright routing auth/REST/admin-status to local fixtures and storage/stock-price to DEV (public reports, anon key); 1440 + 390, light + dark, no horizontal overflow, no page errors.

---

## 📅 Log: 2026-09-27 06:10:00 Asia/Taipei (Task 170, 0.9.71 released)
- User approved the DEV build (「目前這個版本看起來不錯」) and asked to archive old handoff items and finish the new task. TASK.md: every task opened before Task 170 moved verbatim to `TASK_ARCHIVE.md` (`## Archived 2026-09-27 —— unfinished tasks before Task 170`); Task 47 (recurring) kept.
- Icons: favicon.svg, apple-touch-icon (180), icon-192/512, maskable-512 re-rendered from the statement mark (Playwright, white tile; maskable at 50% for the safe circle); manifest background/theme `#ffffff`. 02e2642 (0.9.71-dev.2).
- Release: 495d974 `chore(release): 0.9.71`, ff to `main`, `main:dev` synced. CI + Sync GitHub Releases success, Release 0.9.71 exists; Pages serves the new bundle (`fee_rebate` present) and the new favicon.
- PROD DDL via the Management API was **denied** by the permission classifier ([Production Deploy]); not retried. SQL for the SQL Editor: `docs/agent/prod-0.9.71-migration.sql` (PROD identity guard + check query). PROD `stock-report` not redeployed (type-only engine change).
- Verify before release: vitest 2,495 passed / 7 skipped / 0 failed; build, typecheck:edge, lint exit 0.

