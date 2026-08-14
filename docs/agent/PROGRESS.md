# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 102 — Redesign Macro "每日成交量" table to vertical matrix format with footer sparklines and streaks (0.7.16-dev.1)
- Status: **✅ Implemented and verified; all 63 test files / 950 tests pass; Playwright E2E passed; build / typecheck / oxlint clean (0.7.16-dev.1)**
- Timestamp: 2026-08-14 13:28:00 Asia/Taipei

---

## 📅 Log: 2026-08-14 13:28:00 Asia/Taipei (Task 102: Redesign Macro "每日成交量" table to vertical matrix format with footer sparklines and streaks)

Redesigned Macro "每日成交量" table to match "三大法人買賣超" table layout:
1. **Vertical Date Matrix (No Rightmost Trend Column)**:
   - Header: `日期 | 成交金額（億元） | 成交股數（億股） | 成交筆數（萬筆） | 加權指數 | 指數漲跌` (6 clean columns, no rightmost rowspan trend column).
   - Rows: 7 trading days ordered newest to oldest (`08/14, 08/13...`).
   - Summary Footer (`tfoot`): For each metric column, displays the 7-day average / cumulative total, the streak label (`連 N 日增量` / `連 N 日上漲` / `7日累計漲跌`), and the 15-day SVG `SparkCell` trendline (width: 76, height: 20).
2. **Component & Testing Updates**:
   - `TwMarketSection.tsx`: Switched "每日成交量" to vertical matrix layout with footer sparklines and streak tags (`.tfoot-cum-trend`).
   - `TwMarketSection.test.tsx`: Updated tests to assert 6 headers and 5 footer sparklines (19/19 passed).
   - `verify-macro-turnover.cjs`: Updated E2E Playwright verification script for 6 headers, 6 footers, and 5 tfoot sparklines.
3. **Verification**:
   - Unit tests: Full vitest suite with 63 files / 950 tests 100% passed.
   - Playwright E2E: `verify-macro-turnover.cjs` verified across Desktop (1280x800), Tablet (768x1024), and Mobile (390x844) with 0 errors.
   - Build, edge typecheck, and oxlint clean (0 errors). Version: `0.7.16-dev.1`.

## 📅 Log: 2026-08-14 11:55:00 Asia/Taipei (Task 101: Fix BFI82U premature freezing & probe retirement protection + Reconcile historical market data)

Fixed BFI82U premature freezing and established probe retirement safety:
1. **Three Lines of Defense**:
   - `sourceLanded` & `isMarketSessionReady`: Added `taipeiHhmm < '15:40'` threshold. Preliminary 15:10 data is written immediately for fast frontend rendering, but does not retire or permanently short-circuit before 15:40, enabling automatic revision by TWSE 15:35 block trades & FX settlement.
   - `REQUIRED_LANDED_COUNTS` & `retiredSources`: Daily sources (`bfi82u`, `t86`, `margin`, `borrow`, `bwibbu`) require 3 landed confirmations before retirement; discrete MOPS files require 1.
   - `syncMarket` Signature Fix: Included real institutional amounts (`totalTwd`, `trustTwd`, `foreignTwd`, `buy.totalTwd`, `sell.totalTwd`) in `signature`, ensuring upstream revisions trigger Storage updates instead of false `unchanged`.
2. **Historical Data Reconciliation**:
   - Created and ran `reconcile-market-daily.cjs`, reconciling 2026-08-05 through 2026-08-13 against TWSE BFI82U API. Uploaded reconciled data to DEV storage and verified 0 mismatches.
3. **Verification**:
   - Added unit tests in `sourceProbePlan.test.ts`, `twMarket.test.ts`, and `probeRound.test.ts` (950 tests passed).
   - `npm run typecheck:edge`, `npm run build`, and `npx oxlint` 100% clean. Synced to `0.7.15`.
