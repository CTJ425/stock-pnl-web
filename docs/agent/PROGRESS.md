# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.0 released (Tasks 170 + 171: statement redesign, chart-first pages); PROD DDL + Edge done
- Status: ✅ `main` = `dev` = 0.10.0 (f010f7d), Pages live; PROD `workspaces.fee_rebate` applied; PROD `stock-report` v19 = DEV bundle
- Timestamp: 2026-09-28 07:16:51 Asia/Taipei

---

## 📅 Log: 2026-09-28 07:16:51 Asia/Taipei (0.10.0 released)
- User approved DEV and asked to merge with version 0.10.0 and handle PROD Supabase. f010f7d `chore(release): 0.10.0` (0.9.72-dev.1 entry renamed 0.10.0 in CHANGELOG), ff `main`, `main:dev` synced; CI + Sync GitHub Releases success, Release 0.10.0 exists; Pages serves the new CSS.
- PROD DDL (authorized this time): Management API `database/query` with the PROD identity guard in the same DO block; check query → is_prod true, is_dev false, `fee_rebate` text, CHECK instant|monthly, 0 rows set; PROD REST `select=fee_rebate` → 200.
- PROD `stock-report`: deployed from clean `main` f010f7d with `--no-verify-jwt`; v18 → v19, ezbr `08606770…` → `27ef30af…` (same as DEV v31); POST `{}` → 400 Unknown action.

---

## 📅 Log: 2026-09-27 12:11:35 Asia/Taipei (Task 171, 0.9.72-dev.1)
- User approved the chart-first demo (v2) and asked for all five pages at once. Implemented: 個股分析 (one tab row; letterhead + price chart + 我的持股 strip; stacked 三大法人 bars; margin/short lines above the matrix; matrices in `details.chart-more`; 損益試算 price scale), 年度收益 (`YearlyOverview`: year bars with pick, contributions list, cumulative line; one number per cell, 未含費 and fee split only on sell rows; footnotes replace HelpTh), 總體經濟 (index rows with diverging bars; US indicators as small line charts), 外幣匯率 (currency rows with diverging bars), 後台 (probe arrival timeline, cards under a disclosure).
- Chart infra: `BarSeriesChart` gained `stacked`, `selectedIndex`, `onSelect` (ChartFrame click/Enter); `CATEGORICAL_COLORS` → `var(--chart-c1..4)` per theme (validated blue/yellow/violet/pink).
- Removed on purpose: the 2-day 法人 cards in the quote block (the chips chart shows the same numbers), dead CSS for section tabs and detail cards.
- Verify: vitest 149 files / 2,506 tests, 2,499 passed, 7 skipped; build, typecheck:edge, lint exit 0; detector 1 finding fixed (3px tab rule → 2px). Visual: vite on DEV env with Playwright routing auth/REST/admin-status to local fixtures and storage/stock-price to DEV (public reports, anon key); 1440 + 390, light + dark, no horizontal overflow, no page errors.
