# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 108 — Redesign StockDetail TechnicalTab Volume table to vertical matrix layout with heat styling and footer sparklines (0.7.16)
- Status: **✅ Implemented and verified; all 64 test files / 956 tests pass; Playwright E2E passed; edge typecheck / build / oxlint clean (0.7.16)**
- Timestamp: 2026-08-14 15:00:00 Asia/Taipei

---

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

## 📅 Log: 2026-08-14 14:50:00 Asia/Taipei (Task 107: Redesign StockDetail FundamentalTab Monthly Revenue and Quarterly Profit tables to vertical matrices with YoY & TTM/summary sparklines)

Redesigned StockDetail FundamentalTab "月營收" and "獲利能力" tables into the unified `inst-matrix` format:
1. **Monthly Revenue Matrix (`月營收矩陣`)**:
   - Header: `月份 | 當月營收（千元） | 月增 (MoM) | 年增 (YoY) | 累計年增` (5 columns).
   - Rows: 12 months ordered newest to oldest with MoM, YoY, and Cumulative YoY signed numbers and `heatStyle` relative heat tinting.
   - Summary Footer (`tfoot`): 12-month total revenue amount (formatted in 兆/億/千元), latest MoM/YoY rates, streak badges (`連 N 月增`, `連 N 月年增`), and 4 SVG `SparkCell` trendlines with dynamic Red/Green colors.
2. **Quarterly Financials Matrix (`季報獲利能力矩陣`)**:
   - Header: `季別 | 單季營收（百萬元） | 營收年增 (YoY) | 每股盈餘 (EPS) | 毛利率 | 營益率 | 稅前純益率 | 稅後純益率` (8 columns with YoY revenue comparison).
   - Rows: Displays 2024~2026 quarters (using in-memory 2023 data as baseline for exact 2024 YoY calculations) with full `heatStyle` relative heat tinting across all columns (單季營收, 營收年增, EPS, 毛利率, 營益率, 稅前純益率, 稅後純益率) and `chipClass` (漲紅跌綠).
   - Summary Footer (`tfoot`): 4-quarter total revenue + sparkline, latest quarter YoY rate + `連 N 季年增` streak badge + sparkline, TTM rolling 4-quarter EPS + sparkline, 4-quarter average margin ratios + 4 sparklines matching multi-line chart colors (total 7 sparklines).
3. **Verification**:
   - Unit tests: Full vitest suite with 63 test files / 954 tests 100% passed (including new matrix assertions in `FundamentalTab.test.tsx` and `StockDetailPage.test.tsx`).
   - Playwright E2E: `verify-macro-turnover.cjs` verified across Desktop, Tablet, and Mobile with 0 errors.
   - Build, edge typecheck, and oxlint clean (0 errors). Version: `0.7.16-dev.1`.
