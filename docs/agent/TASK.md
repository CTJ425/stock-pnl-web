# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-05 21:05:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md §4.1) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📋 Active Tasks

### Task 72: Earlier BFI82U schedule, three UI merges, yearly search (0.6.38-dev.1)
- **Status**: ✅ Code done and verified; cron applied to **both** environments (user authorised). Not yet merged to `main`.
- **Agent**: Claude
- **Timestamp**: 2026-08-05 21:40:00 Asia/Taipei
- **1. `market-daily` 16:00 → 15:00, every half hour** (`0,30 7-10 * * 1-5`): applied with `cron.alter_job`
  (keeps the existing command, so the plaintext `CRON_SECRET` is not needed), verified with the target ref in the
  same query per the `supabase-ops` skill. Test at 21:2x, production right after; `schema.sql` §10b updated to match.
  **Open question for tomorrow**: whether the 15:00 round actually wins —— it needs FMTQIK to have published too,
  not just BFI82U. Read `market/daily.json`'s `asOf`.
- **2. 個股分析「報價」→「行情」, and 技術面's 指標摘要 merged into it**: dropped the summary's
  收盤 / 開高低 / 成交量 (the quote grid shows the same things live), kept 均線 / KD / RSI / MACD 柱 / 量比.
  ⚠️ The two halves can be **different days** —— that is why the summary keeps its own data date; do not "tidy" it away.
  `daily/{ticker}.json` moved up to `StockDetailPage` (`useDailySeries`) so two sections share one download.
- **3. 總經頁美國 chip 列與走勢表合併為一張卡**; **4. 年度收益搜尋欄位** (filters the aggregation, not just the rows).
- **Verification**: 879 tests across 57 files (added 2), `npm run build` and `npm run lint` clean (same 4 pre-existing
  fast-refresh warnings). Three tests that locked the old layout were rewritten to lock the new one.

### Task 71: Deploy the 0.6.37 `stock-price` fix to both environments
- **Status**: ✅ **Done — deployed to both environments** (dev v11 at 20:57, prod v15 at 20:58, user explicitly authorised)
- **Agent**: Claude
- **Timestamp**: 2026-08-05 21:05:00 Asia/Taipei
- **What is done**: 0.6.37 fixes BUG-011 (the after-close lock froze an intraday snapshot). Version is synchronised
  across `version.ts` / `package.json` / `README.md`, `main` and `dev` are both at `2dac793`, and the browser half
  went live with the push to `main`.
- **What is not done**: the fix also changed `supabase/functions/stock-price/{index.ts,quoteWindow.ts}`, and the
  Edge Function was never redeployed. Read-only check at 2026-08-05 20:51 —— prod `stock-price` **v14**
  (deployed 16:47) and dev **v10** (deployed 16:01) carry the **same** `ezbr_sha256 00ce1004…`, i.e. the 0.6.36 build;
  the 0.6.37 commit came later, at 17:06. So neither environment is running the fix.
- **Why it matters**: the two layers must agree (`SPEC.md`, "Taiwan stocks no longer price-catch after closing").
  With only the browser fixed, any device whose local cache expires still gets the locked snapshot from Edge.
- **What was run** (from `sources/`, dev first per §13.1; **`--no-verify-jwt` is for `stock-report` only**,
  `stock-price` keeps `verify_jwt: true` and did):
  ```bash
  supabase functions deploy stock-price --project-ref wqetxuhncvfidqnklyew   # v10 → v11, 20:57
  supabase functions deploy stock-price --project-ref kxnxadaghidwumqsqneu   # v14 → v15, 20:58
  ```
- **Evidence it is really the new code**: `ezbr_sha256` went from `00ce1004…` — the 0.6.36 build **both** environments
  were sharing — to `733891b768b2…`, again identical in both. The sha is the evidence; a bumped version number only
  proves that *something* was uploaded, and the `supabase-ops` skill records a case where a newer version was older code.
- **The skill's preferred audit was not available**: `functions download` still fails with "Access token not provided"
  in this environment, exactly as Task 69 found — `deploy` and `list` use a different auth path and work fine.
  The cross-environment sha match substitutes for the file-by-file diff.
- **Not verified at runtime**: that a `price_cache` row with a null `trade_time` now refreshes instead of staying frozen.
  It needs either a service key (only the anon key is in `sources/.env`) or `db query --linked`, and linking has global
  side effects. The rule itself is covered by the `quoteWindow` unit tests; the natural end-to-end check is Task 69
  item 2 tomorrow morning.
- ⚠️ `supabase link` still points at **production** (`kxnxadaghidwumqsqneu`) — see the `supabase-ops` skill;
  re-link before any command that relies on the linked project, especially any writing `db query --linked`.
- **Note on process**: 0.6.37 was committed straight to `main`, against CLAUDE.md §13.1 (dev first). The two branches
  are back in sync, so nothing needs unwinding — recorded so the next Agent does not read it as the norm.

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
     **Still blocked as of 2026-08-05 20:50** —— `STOCK_DAY_ALL` was re-checked seven hours after the close and its
     `Date` is *still* `1150804`, 2330 still at `ClosingPrice` 2320. So the endpoint lags by more than a full evening,
     not merely a couple of hours; reconcile against 08-05 once it finally publishes. Two extra facts worth keeping:
     that endpoint returns 1377 TWSE records only —— **6488 is not in it at all** (TPEx listing), so it could never have
     served as a single source anyway, and its `TradeVolume` is in **shares** (2330 on 08-04: 41,021,199), while the
     quote card's unit is lots. Convert before comparing.
  2. MIS actual returned `ip` / `t` during trial matching period (08:30–09:00), confirm "Estimate" cell displays as expected.
     Do this **after** Task 71 is deployed, otherwise Edge is still running 0.6.36 and the observation would not describe
     the shipped code.

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

