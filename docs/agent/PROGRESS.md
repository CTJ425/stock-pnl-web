# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 102 — Redesign Macro "每日成交量" table to vertical matrix format with Day-over-Day DoD heat styling (0.7.16-dev.1)
- Status: **✅ Implemented and verified; all 63 test files / 951 tests pass; Playwright E2E passed; build / typecheck / oxlint clean (0.7.16-dev.1)**
- Timestamp: 2026-08-14 13:40:00 Asia/Taipei

---

## 📅 Log: 2026-08-14 13:40:00 Asia/Taipei (Task 102: Redesign Macro "每日成交量" table to vertical matrix format with Day-over-Day DoD heat styling)

Redesigned Macro "每日成交量" table to match "三大法人買賣超" table layout with Day-over-Day (DoD) relative heat styling:
1. **Vertical Date Matrix & Dynamic Footer Sparklines**:
   - Header: `日期 | 成交金額（億元） | 成交股數（億股） | 成交筆數（萬筆） | 加權指數 | 指數漲跌` (6 clean columns, no rightmost rowspan trend column).
   - Rows: 7 trading days ordered newest to oldest (`08/14, 08/13...`).
   - Summary Footer (`tfoot`): For all volume & index columns (Amount, Shares, Txns, Taiex, Change), displays the 7-day average / cumulative total, dynamic streak labels (`連 N 日增量` / `連 N 日增筆` / `連 N 日上漲` / `7日累計漲跌`), and 15-day SVG `SparkCell` trendlines with matching dynamic Red/Green trend colors.
2. **Day-over-Day (DoD) Red/Green Coloring & Heat Tinting**:
   - Compared to previous trading day (`days[i - 1]`):
     - 成交金額 / 股數 / 筆數 / 加權指數: Increased > 0 $\rightarrow$ Red (`pnl-up` ＋ `heatStyle` relative to 7-day max delta); Decreased < 0 $\rightarrow$ Green (`pnl-down` ＋ `heatStyle`).
     - 指數漲跌: Point change > 0 $\rightarrow$ Red; Point change < 0 $\rightarrow$ Green.
3. **Component & Testing Updates (TDD)**:
   - `TwMarketSection.tsx`: Generalized `metricTrendStreak` to dynamically calculate streak and Red/Green trendline color for Amount, Shares (`增量`/`縮量`), and Transactions (`增筆`/`減筆`).
   - `TwMarketSection.test.tsx`: Followed TDD (RED $\rightarrow$ GREEN $\rightarrow$ REFACTOR) to assert shares and transactions streak labels and sparkline stroke colors (20/20 passed).
   - `verify-macro-turnover.cjs`: Verified E2E rendering with 0 console/page errors.
4. **Verification**:
   - Unit tests: Full vitest suite with 63 files / 951 tests 100% passed.
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
