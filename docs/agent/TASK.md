# Task Backlog & Tracking (TASK.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-09-09 18:05:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-09 18:05)

- **Version 0.9.38 — released and live on PROD.** `main` and `dev` are synchronized at `0.9.38`.
  - Implemented: 修復資料表漲跌紅綠與未實現損益顏色覆蓋（0.9.38）、全站 IBM Carbon Design 轉換與 21 項 UI/UX 稽核修正（0.9.37）、帳號頭像重構為現代扁平人像圖標（0.9.36）、全域錯誤捕捉 `app_log` 與後台檢視頁（0.9.35）、融券借券費精準計算與 PostgREST 1000 筆截斷修復（0.9.34）。
  - Verification: 108 test files / **1,760** vitest tests, exit 0; `npm run typecheck:edge` exit 0; `npm run build` exit 0; `npx oxlint` 0 errors on changed files.
  - Edge Functions: `stock-price` is **v6** (deployed 2026-09-10 from commit `290f9d3`, ezbr_sha256 `90e9dc2c28836a3a…`), `stock-report` is **v8**, `backup-transactions` is **v4** on both cloud environments (`zyebvayngwrqzoaicbwd` DEV, `hrilemueiqyaoiwnkeuu` PROD).
  - Database: DEV and PROD schemas synchronized (including `app_log` table, indexes, RPCs, and 7 pg_cron jobs on each).
  - Known and not done: end-to-end Playwright run for the 融券 flow; `.inst-matrix tfoot td` hardcoded white overlay inverted under light theme.

## 📋 Active Tasks

### Task 154: 個股走勢圖區間擴充為八個
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-10 12:26:19 Asia/Taipei
- **Spec**: `docs/agent/specs/chart-range-eight.md`
- **Done**: items 1-5 — full text in `TASK_ARCHIVE.md`.
- **What is this**: 技術面日 K 圖的區間選擇器改為 `近 1 月 / 近 6 月 / 本年迄今 / 近 1 年 / 近 5 年 / 全部`，盤中圖的 `一日 / 五日` 不動，合計八個區間。`近 5 年` 與 `全部` 走線路 A：不落地 Storage，由 `stock-price` 新增的 `daily` action 即時代理 Yahoo。

6. **部署 `stock-price` 到 DEV 並在瀏覽器驗證 `近 5 年` 與 `全部`** —— ⏳ 需使用者同意
7. **定版 0.9.41、合併 `main`、發 GitHub Release** —— ⏳

### Task 145: Codebase Deep Audit Remediation (P0 Calculation Bugs, PostgREST Truncations & Optimizations)
- **Status**: ⏳ **OPEN — Specified & Handover Ready (Spec 145)**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-04 23:05:00 Asia/Taipei
- **Spec**: `docs/agent/specs/145-codebase-bugs-and-optimizations-audit.md`
- **What is this**: Comprehensive audit across calculation engines, Edge Functions, data parsers, and UI components:
  1. **P0 Data & Calculation Integrity**: Fix CSV export/import losing borrow fee (`csv.ts:262, 325`), `proposeFeeCorrections` omitting borrow fee on short sales and leaving `fee_rate` desynced (`fees.ts:163`, `RecalcFeesModal.tsx:55`), and `StockSplitModal` miscalculating short-cover buys and ignoring short sells (`StockSplitModal.tsx:50`). (Fixed in 0.9.34 BUG-063..065).
  2. **P1 Capacity & Availability**: Address PostgREST 1000-row silent query truncation across 7 locations (`dataProvider.ts:312`, `backup-transactions`, `stock-report`); fix `AnalysisPage.tsx:84` rowKey collision preventing selection of short positions; fix pure short position passing `qty: 0` to What-If tab; guard `stock-report` manifest publication on complete batch failure (`index.ts:3111`).
  3. **P2 & Optimizations**: Timing-safe comparison in `backup-transactions`; duplicate key & sell label fix in `YearlyPage.tsx`; route-level `React.lazy()` code splitting for `AdminConsolePage`, `MacroPage`, and `FxPage` in `AppShell.tsx`; memo stabilization in `IntradayChart.tsx`.
- **Roadmap**: Ready for implementation of remaining phases per `Spec 145`.

### Task 144: Admin Enhancements, Execution Logs, Resource Usage & Multi-Target Backups
- **Status**: ⏳ **OPEN — Specified & Handover Ready (Spec 144)**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-04 16:30:00 Asia/Taipei
- **Spec**: `docs/agent/specs/144-admin-enhancements-and-backups.md`
- **What is this**: 4 interrelated system feature additions requested by user:
  1. ~~**Uniform Account Icon**~~: ✅ Completed in 0.9.36 (Modern Flat Persona Style 06 in `AppShell.tsx`).
  2. **Admin Cron & Probe Execution Logs**: Add detailed execution log viewer in Admin Console for `cron.job_run_details`, `source_probe_tick` anomalies, and batch run errors (shares `logs` panel in `LogsSection.tsx` added in Spec 146).
  3. **Supabase Cloud Usage & Limit Monitor**: Expose database size, storage usage, and plan thresholds (Free 500MB DB / 1GB Storage) directly in the Admin Console.
  4. **Multi-Target Backups**: Add Cloudflare R2 (S3-compatible, zero egress) offsite backup target in `backup-transactions` and provide local backup download/export options (bulk admin download, user self-service JSON export, and local backup script).
- **Remaining**: Implementation of Features 2, 3, 4 across frontend and backend RPCs.

### Task 85: 0.7.8 / 0.7.9 探針命中直接觸發抓取，且要確認資料到位
- **Status**: 🔄 **shipped everywhere and proven live; landing windows measured, retune needed**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 19:00:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 — full text in `TASK_ARCHIVE.md`.
- **Remaining work**: Retune configured windows in `sourceProbePlan.ts` to match measured timings:
  - mops_profit: 12:00
  - bfi82u: 15:05-19:40
  - t86: 16:05-16:45
  - twt38u: 17:00-17:10
  - bwibbu: 17:05-17:35
  - margin: 20:45-21:00
  - borrow: 22:15-23:30

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Items 1, 2, 3 answered; item 4 remains open**
- **Agent**: Claude / Grok
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei
- **Done**: items 1 (market-daily landing confirmed), 2 (volume discrepancy resolved in SPEC), 3 (t86 stabilization confirmed).
- **Remaining work**: Item 4: Trial-matching UI — confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window (08:30–09:00 or 13:25–13:30).

### quote-yahoo-a data source: stats grid omits 均價 / 成交金額 / 昨量
- **Status**: ⏳ **OPEN — Code shipped, data source decision pending**
- **Agent**: —
- **Timestamp**: 2026-08-25 15:41:49 CST
- **What is this**: 0.9.17 shipped the 個股分析 quote tab with a redesigned stats grid. The design mockup (`docs/design/quote-redesign-mockups.html`) shows three additional cells (均價, 成交金額, 昨量) beyond the current seven. The shipped grid omits these three because `PriceQuote` has no data source for them today.
- **Open work**: Data source decision (schema table, batch service, or external API integration) for the three omitted columns.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.

### Task 132 & Task 133: Supabase Redirect URLs allow-list & DEV auth URLs
- **Status**: ⏳ **OPEN — configuration required**
- **Timestamp**: 2026-08-31 16:45:40 CST
- **What is this**:
  - Add app origin to Supabase Redirect URLs allow-list (`authRedirect.ts`).
  - In DEV compose `.env`, update `ADDITIONAL_REDIRECT_URLS` and `SITE_URL` once frontend deploy target is determined.
