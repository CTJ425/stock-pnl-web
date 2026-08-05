# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-05 16:55:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md §4.1) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📋 Active Tasks

### Task 69: Move individual stock analysis to quote card; Stop fetching prices after Taiwan stock market closes (0.6.36-dev.1)
- **Status**: ✅ **Done, deployed to both environments** (Test at 16:10, Prod at 16:47; 0.6.36 merged to main)
- **Agent**: Claude
- **Timestamp**: 2026-08-05 16:05:00 Asia/Taipei
- **Requirement**: The user wants to "remove my holdings card from individual stock analysis, replace it with open / high / volume / previous close / low / estimate / current close", and hopes to "update to current price once the daily closing price is fetched, and stop calling API thereafter, until 8:25 next day before trial matching resumes". The reason is to prevent price baseline confusion when checking overnight.
- **Original idea rejected by actual test**: The user originally wanted to use TWSE `STOCK_DAY_AVG_ALL` to define today's close.
  Tested at 2026-08-05 15:23 (two hours after close), the `Date` for that endpoint and `STOCK_DAY_ALL` were still `1150804` (previous trading day), 2330 returned 2320 —— that was yesterday's close; the actual closing price for the day was 2405 from MIS, a 3.6% difference.
  Following the original idea would use yesterday's close as today's close and lock it for 17 hours, creating exactly the confusion the user wanted to avoid.
  **Switched to MIS as single source** (same response includes `o/h/l/v/y/z/d/t/ip`), user confirmed adoption.
- **Closing detection based on clock instead of data arrival**: `twQuoteTtlMs` in `quoteWindow.ts` is a stateless pure function,
  does not check trading calendar —— after 13:30 on weekends and holidays it naturally falls into long TTL. See `SPEC.md` "Quote Card and TWSE Fetching Hours".
- **What is kept**: The holding data flow in `buildHoldingRows` and `generateReport` remains the same
  (dropdown needs to list holdings, click-to-generate needs context), just that the holding numbers are no longer displayed on screen.
- **Verification**: `npm test -- --run` all 869 tests across 56 files passed (added 9 tests in `quoteWindow.test.ts`,
  10 tests in `QuoteTab.test.tsx`, expanded misParse / priceProxy); `npm run build`, `npm run lint` are clean.
- **Test environment deployment record (2026-08-05 16:00–16:10, user explicitly authorized)**:
  1. `supabase functions deploy stock-price --project-ref wqetxuhncvfidqnklyew`
     → v9 upgraded to **v10**, `verify_jwt` remains `true` (**without** `--no-verify-jwt`, which is for `stock-report` only).
  2. `price_cache` completed with 7 new columns, column order:
     `key,price,updated_at,prev_close,open,high,low,volume,trade_date,trade_time,trial`.
  3. End-to-end test (hitting test env Edge): 2330 and 6488 returned all 7 columns
     (`tradeDate: 20260805`, `tradeTime: 13:30:00`, `trial: false`);
     AAPL's `tradeDate/tradeTime` are null, `volume` 67779 shares (Yahoo's shares already divided by 1000), all as designed.
  4. **Close lock test successful**: Rolled back `updated_at` of `TPE:2330` by 5 minutes and fetched again,
     the returned `asOf` stayed at 5 minutes ago —— old 60s TTL would definitely refetch, this is conclusive evidence.
- **Operating environment side effects**: `supabase link` is now pointing to **Test environment** `wqetxuhncvfidqnklyew`
  (link is global, see `supabase-ops` skill). Must re-link before touching the production environment.
- **Exception to audit method**: The skill requires using `functions download` for file-by-file comparison, but `download` in this environment
  cannot get access token (`projects list` / `deploy` work fine, using different auth paths).
  Substituted with "online version update time (v9 = 08-05 11:35, matches 0.6.34 deployment schedule)" + "end-to-end returns new columns"
  —— the latter is more powerful than file comparison because it proves **the actual running behavior online**.
- **Pending verification (cannot confirm after hours, need to check next day during market hours)**:
  1. There is an approx 10% discrepancy between MIS `v` and TWSE daily report `TradeVolume` (31,851 shares vs Yahoo's 35,214 shares),
     speculated to be after-hours fixed-price trading not included —— unit is confirmed as "shares", discrepancy source to be reconciled next day with `STOCK_DAY_ALL`.
  2. MIS actual returned `ip` / `t` during trial matching period (08:30–09:00), confirm "Estimate" cell displays as expected.

### Task 70: Fix backend timeline base date (0.6.36-dev.2)
- **Status**: ✅ **Done and deployed** (0.6.36 merged to main) —— pure frontend, no Edge Function deployment needed
- **Agent**: Claude
- **Timestamp**: 2026-08-05 16:35:00 Asia/Taipei
- **Cause**: User asked "After the 16:00 batch started, the status of 'TWSE After-Hours 2026-08-04' is still old, is this a BUG?".
  Investigation revealed two things:
  1. **Data source timing, not a bug**: The batch `T86?selectType=ALLBUT0999` is not yet published at 16:00 / 16:15
     (same API with `selectType=ALL` has data, but that dataset includes warrants/ETFs totaling 16575 records,
     which is a different dataset from the 1339 stock records needed for batch, production times are not synchronized). In the 16:30 batch, `t86_today` becomes true,
     `data_ymd` advances to 20260805, exactly as documented by actual tests in `timeline.ts` comments.
  2. **But uncovered a real bug (BUG-010)**: Overall market institutional data arrived by 16:00 but was judged as delayed and drawn off-axis.
- **Fix**: Base date changed to take the maximum data date across sources (`roundBaseYmd`), see `FIXED_BUG.md` BUG-010.
- **User decision**: Base date takes max (instead of using quote's tradeDate to determine trading day —— that would require Edge changes to add columns);
  Fix it now, append to 0.6.36-dev.2.
- **Verification**: `npm test -- --run` all **874 tests across 57 files passed**; `npm run build` is clean.

### Task 68: Change US Macro layout to Taiwan Institutional table format (0.6.35)
- **Status**: ✅ **Done** —— pure frontend, no Edge Function deployment needed, no Supabase changes
- **Agent**: Claude
- **Timestamp**: 2026-08-05 13:20:00 Asia/Taipei
- **Requirement**: Looking at the Taiwan institutional table, the user asked to "change CPI and other indices to be similar to the three major institutional net buys/sells",
  and settled on the design after viewing two templates.
- **Transposition instead of copying**: The trend/streak in the institutional table describes the "Total" series, but the five macro indicators have no total
  (units are %, thousands, indices). Changed to one indicator per row so trend/streak has something to describe.
- **Slimming cards to a single chip line** (only name and latest value); period, description, and lagging badge are all moved into the table row.
- ⚠️ **Semantic color changes (intentional)**: The entire table unifies on "Red = higher than previous, Green = lower than previous",
  Non-farm payrolls are no longer colored based on the sign of the value —— "+57k but 72k less than previous" is now green.
  The hint below the table, `IndicatorRow` comments, and a test are locked to this behavior; **DO NOT DELETE**.
- **`Charts/SparkCell.tsx`**: The mini trend line is extracted as a shared component, used by both tables;
  streak determination is kept separate for each (sign vs ascending/descending are two different things).

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why it is manual**: the BLS schedule page returns 403 for everything (changing the
  User-Agent does not help), so it cannot be synced automatically; BEA's page is fetchable.
  `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
- **If it is forgotten**: nothing breaks — once the calendar runs out the code falls back
  to rule-based estimation and marks the entry `stale`. Only precision drops, because the
  scan window no longer lines up with the actual release time.

