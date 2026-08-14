# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 109 — Retune probe cycles: bwibbu 17:00–18:30 and bfi82u dual window (15:00–16:30 / 19:30–20:15) with 15:40 condition removed (0.7.17)
- Status: **✅ Implemented and verified; all 65 test files / 959 tests pass; edge typecheck / build / oxlint clean (0.7.17)**
- Timestamp: 2026-08-14 15:45:00 Asia/Taipei

---

## 📅 Log: 2026-08-14 15:45:00 Asia/Taipei (Task 109: Retune probe cycles: bwibbu 17:00–18:30 and bfi82u dual window with 15:40 condition removed)

Optimized probe cycle timings and schedules across TWSE sources:
1. **Valuation Probe (`bwibbu`) Window Narrowing**:
   - Window updated from `15:00 – 22:00` to `17:00 – 18:30` (5-min interval, 3 hits to retire).
   - Analysis of historical probe ticks proved TWSE consistently publishes `BWIBBU_d` between 17:15–17:20, eliminating ~24 daily no-op probes between 15:00–17:00.
2. **Total Market Institutional Probe (`bfi82u`) Dual Window & 15:40 Gate Removal**:
   - Expanded to dual-window schedule: `15:00 – 16:30` (afternoon initial release) and `19:30 – 20:15` (evening comprehensive accounts & block trade settlement).
   - Removed the `< 15:40` gating condition in `sourceLanded` and `isMarketSessionReady`, allowing afternoon data to mark landed immediately on 3 hits.
   - Updated `syncMarket` to re-fetch today's `BFI82U` during the evening window (`>= 19:30`) to merge final settlement numbers.
   - Updated `readDoneSourcesToday` to filter landed counts by active window so each window independently requires 3 landed ticks to retire.
3. **Admin UI & Documentation**:
   - Updated `MechanismGuide.tsx`, `AdminStatusPage.tsx`, `timeline.ts`, and `schema.sql` comments.
4. **Testing & Verification**:
   - Updated unit tests in `sourceProbePlan.test.ts`, `twMarket.test.ts`, `probeRound.test.ts`, and `timeline.test.ts`.
   - All 65 test files / 959 tests passed 100%. `typecheck:edge`, `build`, and `oxlint` clean. Version: `0.7.17`.

## 📅 Log: 2026-08-14 15:00:00 Asia/Taipei (Task 108: Redesign StockDetail TechnicalTab Volume table to vertical matrix layout with heat styling and footer sparklines)

Redesigned StockDetail TechnicalTab "每日成交量" table to unified `inst-matrix` format:
1. **Vertical Matrix Structure (`每日成交量矩陣`)**:
   - Header: `日期 | 成交量 | 量比 | 收盤價 | 漲跌幅` (5 columns with `inst-matrix` styling).
   - Rows: Displays visible slice (default 20 rows, expandable to full range) with relative heat styling (`heatStyle`) on volume, volume ratio, and price change percentage (`pnlClass`).
   - Summary Footer (`tfoot`): Displays `{N} 日統計`, daily average volume + dynamic streak badge (`連 N 日增量` / `連 N 日縮量`) + SVG SparkCell trendline, latest volume ratio + status badge (`量能放大` / `量能常態`) + SparkCell trendline, latest close price + high/low summary + SparkCell trendline, cumulative return + price streak badge (`連 N 日上漲` / `連 N 日下跌`) + SparkCell trendline (total 4 SVG SparkCells).
2. **Testing (TDD)**:
   - Created `TechnicalTab.test.tsx` verifying matrix layout, 5-column header, row cells with heat styling, footer streak badges, 4 SparkCells, and expand/collapse button toggle.
   - Vitest suite: 64 test files / 956 tests 100% passed.
3. **Verification**:
   - Playwright E2E: `verify-macro-turnover.cjs` verified across Desktop, Tablet, and Mobile with 0 errors.
   - Build, edge typecheck, and oxlint clean (0 errors). Version: `0.7.16-dev.1`.
