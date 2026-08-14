# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 101 — Fix BFI82U premature freezing & probe retirement protection + Reconcile historical market data (0.7.15)
- Status: **✅ Implemented and verified; all 63 test files / 950 tests pass; edge typecheck / build / oxlint clean; official release 0.7.15**
- Timestamp: 2026-08-14 11:55:00 Asia/Taipei

---

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

## 📅 Log: 2026-08-14 11:29:00 Asia/Taipei (Task 100: Redesign Macro "三大法人買賣超" table to vertical date matrix with footer sparklines and streak labels)

Adjusted Macro "三大法人買賣超" table per user request:
1. **Vertical Date Matrix (No Rightmost Trend Column)**:
   - Header: `日期 | 外資 | 外資自營商 | 投信 | 自營商（自行） | 自營商（避險） | 合計` (7 clean columns, no rightmost trend column).
   - Rows: 7 trading days ordered newest to oldest (`08/14, 08/13...`).
   - Summary Footer (`tfoot`): For each institutional column, displays the 7-day cumulative total, the streak label (`連 N 買` / `連 N 賣`), and the 15-day SVG `SparkCell` trendline.
2. **Component & CSS Updates**:
   - `TwMarketSection.tsx`: Clean vertical date layout with institutional footer sparklines and streak tags.
   - `index.css`: Added `.inst-matrix .tfoot-cum-trend` styling.
   - `TwMarketSection.test.tsx`: Updated tests to assert 7 headers and 6 footer sparklines.
3. **Verification**:
   - Unit tests: `TwMarketSection.test.tsx` (19 passed). Full suite: 63 files / 946 tests 100% passed.
   - Playwright E2E: `verify-macro-turnover.cjs` verified across Desktop, Tablet, and Mobile with 0 errors.
   - Build, edge typecheck, and lint clean (0 errors).
