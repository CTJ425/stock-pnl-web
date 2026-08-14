# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 104 — Redesign StockDetail ChipsTab "三大法人買賣超" table to vertical matrix format with footer sparklines and streak labels (0.7.16-dev.1)
- Status: **✅ Implemented and verified; all 63 test files / 951 tests pass; Playwright E2E passed; build / typecheck / oxlint clean (0.7.16-dev.1)**
- Timestamp: 2026-08-14 13:53:00 Asia/Taipei

---

## 📅 Log: 2026-08-14 13:53:00 Asia/Taipei (Task 104: Redesign StockDetail ChipsTab "三大法人買賣超" table to vertical matrix matching Macro layout)

Redesigned StockDetail ChipsTab "三大法人買賣超" table to match Macro's vertical matrix format:
1. **Vertical Date Matrix (No Rightmost Trend Column)**:
   - Header: `日期 | 外資（不含自營） | 外資自營商 | 投信 | 自營商 | 三大法人合計` (6 clean columns, no rightmost `走勢` column).
   - Rows: 7 trading days ordered newest to oldest (`[...instDays].reverse()`).
   - Summary Footer (`tfoot`): Displays the 7-day cumulative total, dynamic streak labels (`連 N 買` / `連 N 賣`), and 15-day SVG `SparkCell` trendlines with dynamic Red/Green trend colors (`.tfoot-cum-trend`).
2. **Component & Testing Updates (TDD)**:
   - `ChipsTab.tsx`: Removed rowspan trend column; added footer sparkline & streak rendering for all 5 institutional units; updated sparkline dimensions (`TFOOT_SPARK_W=76`, `TFOOT_SPARK_H=20`).
   - `StockDetailPage.test.tsx`: Updated assertions for 6-column header and 5 footer sparklines (34/34 passed).
   - `StockDetail` suite: 9 test files / 143 tests passed.
3. **Verification**:
   - Unit tests: Full vitest suite with 63 files / 951 tests 100% passed.
   - Playwright E2E: `verify-macro-turnover.cjs` verified layout on Desktop, Tablet, Mobile with 0 errors.
   - Build, edge typecheck, and oxlint clean (0 errors). Version: `0.7.16-dev.1`.

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
   - `npm run typecheck:edge`, `npm run build`, and `npx oxlint` 100% clean. Synced to `0.7.15`.
