# Development Plan (PLAN.md)

- Agent: Claude
- Status: IN_PROGRESS
- Timestamp: 2026-07-25 15:20:00 Asia/Taipei

---

## 🎯 Short-term Goals (short-term goals)

1. **GitHub Pages automated deployment**
   - Set up GitHub Actions workflow so that `main` / `dev` branch commits are automatically built and deployed to GitHub Pages.
2. **Supabase back-end environment connection and deployment**
   - Execute SQL Schema in Supabase SQL Editor.
   - Deploy Edge Function `stock-price` for Taiwan/US stock real-time quotation and search for agents.
   - Configure Auth redirection with the `.env.local` key.
3. **Online environment integration verification**
   - End-to-end test registration, login, transaction records CRUD, CSV import and export and annual profit and loss statistics.
4. ~~**After-Hour Chip Report v2**~~ → **Implemented in v0.3.7-dev.3** (TASK.md Task 11).
   - The only remaining step: deploy `stock-report` to Supabase (user authorization required, see §K below).
5. ~~**Technical K-line**~~ → **has been implemented in 0.5.0-dev.1** (TASK.md Task 16, see §L for details).
   - **0.5.0 has been completely completed at 2026-07-26 23:15**: `stock-report` two-zone deployment (official v5 / test v8) +
     The user triggers `generate-all` once, and both areas of `daily/*.json` have been generated and passed data integrity verification.
     For the triggering method, see the `PROGRESS.md` same-day record (use SQL to replay `cron.job.command` without taking out `CRON_SECRET`).
6. **AI Assistant (0.6.0, not yet implemented)**
   - Users bring their own AI provider (Google AI / ollama / vLLM), so the interface must be provider-agnostic,
     Not tied to any single vendor SDK.
   - ⚠️ The original planning file `~/.claude/plans/k-ai-toasty-pearl.md` has been lost (checked on 2026-07-26).
     **The specifications have been reconstructed at 2026-07-26 23:40, see §M** below (the user’s five finalizations are complete and construction can begin).
   - Key design: **Indicators are calculated by the program and then fed to the model**, and the model does not touch the original sequence——
     The language model's mental calculation of MA60 from 243 closing prices must be wrong, and the wrong number package is the hardest to detect in fluent Chinese.
     0.5.0 The `indicators.ts` / `technicalView.ts` is the foundation for this.

---

## 🚫 Abandoned routes and product red lines (do not resurrect)

These two items originally only existed in the Agent's memory. The memory belongs to the local machine and will disappear when the machine is changed, so they are placed here.

### Abandoned: Cloudflare Worker + R2

The after-hours report was initially planned to be stored using **Cloudflare Worker + R2** (there used to be a repo root directory `worker/`
with the `VITE_REPORT_WORKER_URL` environment variable). Finally switched to the existing Supabase Edge Function + Storage**,
The reason is that there is no need to maintain an extra set of cloud accounts and deployment pipelines for one function.

The `worker/` directory no longer exists. **If you see the words Worker / R2 in old notes or old project files, that is expired information, do not follow it. **

### Product red line: Don’t take the initiative to add AI interpretation

Report v1 / v2 **Deliberately not connected to AI** - users should look at the pure data first and make their own judgments.
There are seams left in the architecture (see 0.6.0 AI Assistant in Short-Term Goals §6), but **until the user explicitly requests it,
Don’t proactively add AI-generated interpretive text** to reports or analysis pages.

---

## 🗺️ Long-term Goals

1. **User Settings Sync**
   - Connect the front-end fee discount rate and preference to the Supabase `user_settings` data table.
2. **Automatic type generation**
   - Automatically generate `database.types.ts` using Supabase CLI.
3. **Offline/online dual-mode switching optimization**
   - Enhanced local mode (localStorage) and Supabase cloud data synchronization mechanism.

---

## ✅ Completed: After Hours Chip Report v2

- Agent: Claude
- Action: Architecture planning → **Implementation completed** (v0.3.7-dev.3)
- Status: IMPLEMENTED — Code and testing are complete; **Supabase has not yet been deployed** (requires user authorization, see §K)
- Timestamp: 2026-07-25 15:20:00 Asia/Taipei (planned at 12:27:06)

Baseline version: `v0.3.7-dev.2` (feature v1 implemented in 038cdd8 / 9d62546); the output of this round is `v0.3.7-dev.3`.

> The following §A–§J are retained as **architectural decision records** (the reasons for the decision and the actual measurement data are still valid and do not be deleted).
> Any differences from the plan or additional findings during the implementation process will be recorded in §K.

### A. Requirements and Confirmed Directions

**Requirements**: The trading excess and margin trading balances of the three major legal persons are divided into **buy/sell/trading excess/continuous buying and selling**; the data is retained for up to 7 days; and trend charts are provided. In the future, we will add daily/weekly/quarterly lines.

**Directions confirmed with user**:

1. The layout has been changed to an independent "**Individual Stock Analysis Page**", which contains `Chips/Technical/My Holdings' tabs (pop-up windows are no longer used).
2. The trend chart is **self-drawn SVG**, made for 7 days first, **without introducing the chart function library**.
3. Historical data **replenishes the last 7 trading days** and does not wait for natural accumulation.

**To be confirmed**: Whether to retain a simplified summary pop-up window as a quick entry. The current tendency is not to keep it - the analysis page reads the same Storage JSON, and the opening speed is the same; opening the summary first and then clicking in is a redundant step, and there will be an extra markup that needs to be maintained simultaneously.

### B. Architectural Decision 1 - The server only returns structured data, and all screens are drawn by React

**Current situation**: Edge Function outputs the entire HTML string, and the front end uses `dangerouslySetInnerHTML` to inject a 760px `Modal`.

**Problem**: The string template cannot create interactive charts such as hover tooltip and switching legal entities. Widening the pop-up window will not solve the fundamental problem - the bottleneck is the rendering method, not the layout size.

**Decision**: Remove the HTML generation route of `reportHtml.ts`, Storage JSON no longer stores the `html` field; instead, React components render from structured `data`.

**Side benefit**: Eliminate existing duplication risks - `renderHoldingSection` of `sources/src/services/reportProxy.ts:120-130` is a handwritten copy of `reportHtml.ts:83-95` `holdingSection`, including `fmtInt / fmtPrice / fmtSignedMoney / fmtPct / sc` Each of the five formatting functions has one copy on each side. Storage file size will also be reduced by half (originally `data` and `html` are two equivalent contents).

**Side effects to be dealt with**: `reportPdf.ts` uses `html2canvas` to capture the DOM. Originally, the `.rpt` block with its own light-colored scoped style was captured, so that the PDF will look like a document; after it is rendered by the app, the dark theme will output a dark PDF.
→ Countermeasure: Add `.report-surface` class, overwrite tokens such as `--surface / --ink / --border` to light colors in this container, and the PDF capture range is this container.
(html2canvas 1.4 can handle inline `<svg>`, which is one of the reasons to choose self-drawn SVG instead of canvas / WebGL chart library.)

### C. Architectural Decision 2 - Switch to using rwd endpoint with date for margin trading

**Current situation **: `https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN` **Without date parameter**, only the latest trading day can be obtained - this is the fundamental reason why it is currently impossible to create a margin trading trend chart.

**Use ** instead:

```text
https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=YYYYMMDD&selectType=ALL&response=json
```

**It has been verified by actual testing (based on 2026-07-22 data)**: `tables[1]` (judgment condition `fields[0] === 'code'`) is a stock-by-stock summary, with a total of 16 columns. **Field names are repeated** ("Buy" and "Sell" appear twice each), so **the value must be obtained by position index, and name comparison is not available**:

| idx | field | idx | field |
| --- | --- | --- | --- |
| 0 | Code | 8 | Securities lending (covering) |
| 1 | Name | 9 | Short selling (short selling) |
| 2 | Financing purchase | 10 | Securities lending and spot repayment |
| 3 | Margin selling | 11 | The balance of the day before the securities lending |
| 4 | Financing cash repayment | 12 | Today’s balance of securities lending |
| 5 | Balance on the day before financing | 13 | Limit for the next business day of securities lending |
| 6 | Financing balance today | 14 | Securities offset |
| 7 | Financing limit for the next business day | 15 | Notes |

2330 Actual measurement column (can be directly used as unit test fixture):

```json
["2330","TSMC","855","662","88","31,823","31,928","6,483,092","4","5","0","98","99","6,483,092","3"," "]
```

This endpoint additionally provides buy/sell/cash reimbursement, which is exactly the column to be removed. Keep the old OpenAPI parser as intraday fallback (there is still today's balance when rwd fails, just short of buy/sell).

**By the way, I will record an existing bug**: the unit of TWSE margin trading figures is **transaction unit (pieces)**, but `reportHtml.ts:128` is marked as "securities offset: N shares", which is wrong. The number of T86 is the number of shares - the two block units are different, and the new UI must be clearly marked separately (according to `SPEC.md`'s UI copywriting guidelines, it must be stated what the number covers).

### D. Structural Decision 3 - The buying/selling data of the three major legal persons are already in hand

The same response from the T86 endpoint (`https://www.twse.com.tw/rwd/zh/fund/T86?date=YYYYMMDD&selectType=ALLBUT0999&response=json`) contains the buy/sell/transaction of each legal person, **Actually measured 19 columns in total**:

```text
 0 Securities Code 10 Investment Credit Trading Exceeding Number of Shares
 1 Securities Name 11 Dealer’s excess number of shares bought and sold
 2 Number of shares purchased by foreign mainland investors (excluding foreign self-operated traders) 12 Number of shares purchased by self-operated traders (self-trading)
 3 Number of shares sold by foreign mainland investors (excluding foreign self-operated traders) 13 Number of shares sold by self-operated traders (self-trading)
 4 The excess number of shares bought and sold by foreign mainland investors (excluding foreign-funded self-operators) 14 The excess number of shares bought and sold by self-operated dealers (self-trading)
 5 Number of shares purchased by foreign self-operated traders 15 Number of shares purchased by self-operated traders (risk hedging)
 6 Number of shares sold by foreign self-operated traders 16 Number of shares sold by self-operated traders (risk aversion)
 7 The excess number of shares bought and sold by foreign self-operated dealers 17 The exceeded number of shares bought and sold by self-operated dealers (risk hedging)
 8 Number of shares purchased by Investment Trust: 18 Number of shares purchased and sold by the three major legal persons
 9 Number of shares sold by Investment Trust
```

`extractInstitutional` of `twChips.ts` currently only takes the five trading super fields 4 / 7 / 10 / 11 / 18, and discards the rest.
**Conclusion: No new data sources are needed to split buy/sell, just stop discarding fields in existing responses. **

Things to note:

- T86 **There is no** "Buy/Sell of Three Major Legal Persons" field, which must be summed by five legs; the total of sales and purchases still takes the official idx 18.
- The buying/selling of self-operated dealers only has two separate items: "self-trading" and "hedging". They need to be added together to equal the total of self-operated dealers corresponding to idx 11.

### E. Architecture Decision 4 - The 7-day series is assembled and embedded in the report by Edge Function

The report JSON is embedded with `history: ChipDay[]` (from old to new, up to 7 entries), and the front end draws it directly.

The reason for not using "catch 7 `{ymd}/{ticker}.json` on the front end": It requires 7 Storage round trips, and the old file only covers the current holding list (`heldTwTickers()` is recalculated every day), so there will be holes.

**Backfill strategy and timeout control** (Edge Function has a wall-clock upper limit, T86 single file is about 1–2MB):

- The candidate date is pushed back 14 calendar days and `readCache` is executed one by one; if it is hit, no network request will be sent.
- Those who miss will be fetched in parallel with a **concurrency upper limit of 3**, and will stop after collecting for 7 trading days.
- **A maximum of 5 missing days can be filled in a single call**; the missing parts will be mapped as usual, and "notes[]` will be stated as "Historical data is being filled in", and the next day's schedule will be filled.
- Approximately 10–14 external requests are executed for the first time; only 1 miss per day thereafter.

Estimated size of `chip_raw_cache`: 7 days × 2 dataset × ~1–2MB JSONB ≈ 15–25MB (less after TOAST compression).

**No schema migration** required - the existing PK `(ymd, dataset)` can directly accommodate the new `MI_MARGN_D` dataset; `RETAIN_DAYS = 7` and `pruneStorage` / `pruneChipCache` remain unchanged.

### F. Predetermined file change range

| Archives | Actions |
| --- | --- |
| `sources/supabase/functions/stock-report/twChips.ts` | Added `ChipLeg`; `InstitutionalChip` items changed to leg; `MarginChip` expanded; added `marginDatedUrl` / `extractMarginDated` |
| `sources/supabase/functions/stock-report/report.ts` | Added `ChipDay`, `schema: 2`, `history`; pure function `computeStreak` / `computeStreaks` |
| `sources/supabase/functions/stock-report/index.ts` | `loadDaySources` → `loadSeries` (including backfill and concurrency limit); remove html generation and upload |
| `sources/supabase/functions/stock-report/reportHtml.ts` | **刪除** |
| `sources/src/services/reportProxy.ts` | Replace `data: unknown` with structured type; `schema !== 2` is treated as a miss and fallback; delete `applyHoldingOverlay` / `renderHoldingSection` |
| `sources/src/components/Charts/` (new) | `chartScale.ts` (pure function, with tests), `BarSeriesChart.tsx`, `LineSeriesChart.tsx` |
| `sources/src/components/StockDetail/` (new) | `StockDetailPage.tsx` / `ChipsTab.tsx` / `HoldingTab.tsx` / `TechnicalTab.tsx` (the technical side is a placeholder) |
| `sources/src/components/AppShell.tsx` | The project does not have a router, and the paging is `useState<Tab>`; add `detail` state as a drill-down view, click the navigation paging to clear it |
| `sources/src/components/Dashboard/DashboardPage.tsx` | `onReport` → `onOpenDetail` (now at 381-385, 399-416) |
| `sources/src/components/Dashboard/ReportModal.tsx` | **DELETE** |
| `sources/src/index.css` | Added `.report-surface` light container (PDF capture range) |

**Chart color scheme**: Follow the Taiwan stock convention of **positive red, green and negative** (existing tokens `.up #d21f3c` / `.down #12864e`), and do not apply the general dataviz color scale.

**Predetermined content on the chips page**: three major legal person tables (column = foreign investment / foreign self-operated dealer / investment credit / self-operated dealer / total of the three major legal persons; columns = buy / sell / buy and sell excess / equivalent number / continuous buying and selling) + 7-day trading super long bar chart (can switch legal persons) + margin trading table (financing: buy / sell / cash repayment / today’s balance / compared with the previous day / Continuous increases and decreases; securities lending isomorphic, marked "Selling = short selling, buying = covering") + 7-day line chart of financing and securities lending balances (there is a big difference in magnitude between the two and they do not share the Y-axis) + Borrowing securities + `notes[]` + Disclaimer.

### G. Future expansion: daily/weekly/quarterly

Two facts that will affect the current decision are recorded first:

1. **The existing 7-day retention period cannot support the quarter line. ** The quarterly line requires ≥60 trading days' closing prices, and the 7-day prune of `chip_raw_cache` will eat it. Technical data** must be stored separately**, such as `price_daily(ticker, date, open, high, low, close, volume)` with an independent retention period (approximately 400 days).
2. **The data source is already in the project. ** `sources/supabase/functions/stock-price/index.ts` is already calling the Yahoo `chart` endpoint, but only reads `result[0].meta` to get the current price, throwing away the `timestamp` / `indicators.quote` arrays - just relax the `range` / `interval` to have full OHLC. The filing is TWSE `exchangeReport/STOCK_DAY?date=&stockNo=` (stock-by-stock monthly filing).

In this round, the `TechnicalTab` placeholder page will be delivered first, and there is no need to touch the layout when it is added later.

### H. Verification method during implementation

1. `npm run test` (benchmark 113 passed) - New tests: T86 buy/sell extraction and dealer aggregation, `extractMarginDated` position index (using §C's 2330 measured columns as fixture), `computeStreak` boundaries (interrupt on 0 / `null` encounter), `niceDomain` zero crossing and all zeros.
2. `npm run build` (`tsc -b && vite build`) - **cannot be skipped**, `tsc --noEmit` and vitest cannot catch white screen level errors.
3. `npm run lint`（oxlint）。
4. UI verification: `/verify` skill uses native mode, but the native mode does not have Supabase and the report entry is hidden. It needs to be bypassed by using temporary `.env.test.local` to point to the dev project (`wqetxuhncvfidqnklyew`). Check items: tab switching, charts not breaking the layout in narrow windows, hover tooltip, PDF still outputting light-colored files under dark themes, old format JSON triggering `generate` fallback.
5. End-to-end (**requires explicit authorization from the user**, see CLAUDE.md § Branches & envs): deploy `stock-report` to the dev project, manually trigger `generate-all` with `x-cron-secret`, and confirm that the JSON in the bucket contains 7 `history`.

### I. Risks

- **Cover timeout**: The first time `generate-all` needs to capture 10–14 big gears. If the actual test still times out, lower the single replenishment limit to 3 days and let the schedule be filled up over several days (`notes[]` will already explain that the data is incomplete).
- **Rwd endpoint field order change**: Use `fields[0] === 'Codename'` + column number ≥15 to check the protection; if not met, fallback to OpenAPI fallback and mark in `notes[]`.
- **Deployment transition period**: When the new front-end encounters the old format JSON in the bucket, it will perform fallback (slower but available) and resume after one round of scheduling.

### J. Documentary debt (to be paid together during implementation)

- `TASK.md` stops at Task 10 (v0.3.6), **After-hours chip report v1 has no TASK entry at all** - v1 summary + this Task 11 needs to be supplemented.
- `PROGRESS.md` stops at v0.3.6, missing v0.3.7-dev.1 / dev.2.
- `SPEC.md` does not have a post-market chip report section and still references the moved `docs/database/supabase_schema.sql` (now `sources/supabase/schema.sql`).
- The version number is changed from `0.3.7-dev.2` to `0.3.7-dev.3` according to CLAUDE.md § Versioning, and the three places are synchronized (`sources/src/version.ts` / `sources/package.json` / `README.md`).
- `sources/supabase/README.md` needs to update the report JSON structure (no more `html`), new `MI_MARGN_D` dataset, and description of backfill behavior.

### K. Differences between implementation results and plan (2026-07-25 15:20:00 Asia/Taipei)

All decisions in §A–§J are followed, with the following additions and deviations during implementation:

**Differences from plan**

1. **`.report-surface` is changed to "Apply on retrieval"** instead of a non-resident container.
   The way the plan is written will cause a whole white background panel to appear on the analysis page under the dark theme; change it to `reportPdf.ts` before and after `html2canvas`
   Dynamically mount/remove, the UI maintains the theme color, and the PDF remains a light-colored document, getting the best of both worlds.
2. **Chart colors and font levels are always written as SVG attributes, without CSS variables. **
   html2canvas will serialize inline SVG into images, and CSS variables and external style sheet rules in the ancestor layer cannot be parsed.
   (It will turn into huge black text). Therefore, a separate `chartColors.ts` is created to store literal color matching, maintaining positive red, green and negative but not changing with the theme.
3. **The chart is drawn using the "actual container width" 1:1** (`ResizeObserver`) instead of fixed viewBox scaling.
   Actual measurement shows that proportional scaling will make the axis label twice as big on a wide screen and shrink to about 6px on a 390px mobile phone; the font level will be constant after 1:1 drawing.
4. **`fmtAxisNumber` requires step parameter**. Financing balance 31,100–31,928 This kind of sequence with “class interval is much smaller than the unit”,
   Originally, adjacent scales would all be marked as "31,000" without being able to distinguish between high and low; instead, the decimal places were determined based on the scale distance.
5. **Saturdays and Sundays are first eliminated from the candidate days** (`isWeekendYmd`). The plan only says to push back 14 calendar days, but adding this layer in the implementation can save
   Each time 2-4 external requests are executed, they will definitely fail (you still need to implement them during holidays to know).
6. **Daily large draw will be released per-ticker after slicing**. The project is estimated to take 7 days × 2 dataset ≈ 15–25MB; if all original
   payload, memory pressure is high. Load one day instead → extract all the chips of the target code → discard the raw, and the peak number is only (3) concurrent copies.
7. **`extractInstitutional` maintains comparison by 'field name'** (plan unspecified). The 19 field names of T86 are not repeated.
   Using names is more resistant to column order changes than position indexes; only rwd margin trading must use position indexes due to repeated column names.
8. **"Download PDF" is only displayed in the chip tab**. There is no report content to be retrieved from other tabs, and the permanent button is misleading.
9. **§A's "pending confirmation" has been finalized: the summary popup will not be retained. ** The analysis page reads the same Storage JSON, and the opening speed is the same.
   One more layer of summary is just one more markup to be maintained simultaneously.

**Verification results**: `npm run test` 148 passed (baseline 113), `npm run build` passed, `npm run lint` has no new warning.
Browser actual test (Playwright + temporary preview harness, delete after verification): 1280px / 390px, no horizontal overflow, tooltip normal,
`.report-surface` is correct, `generatePdfBlob` actually produces 388KB PDF, and the native mode returns correctly.

**§J File Debt**: Complete all (TASK.md adds v1 summary + Task 11, PROGRESS.md adds dev.1/dev.2/dev.3,
SPEC.md adds a new chapter "Individual Stock Analysis Page and After-Hour Chips" and corrects the schema path, `sources/supabase/README.md` updates schema 2
The structure is synchronized with the `MI_MARGN_D` dataset, backfill behavior, and version number `0.3.7-dev.3`).

**Supabase deployment (completed, user explicitly authorized in the same session)**

- `stock-report` has been deployed to dev project `wqetxuhncvfidqnklyew` (version 1 → 2, `verify_jwt` true → false);
  The formal area is untouched. See `PROGRESS.md` for online measurement and cross-validation results.
- **§E's backfill design is demonstrated online**: 5 days for the first call (limit limit), 7 days for the second call, and weekends are skipped correctly;
  The second time you hit the previous cache, the credit will be used for the remaining 2 days. About 8 seconds per time, within the Edge Function wall-clock,
  §I The reserved "down to 3 days" filing** does not need to be used**.
- **§C's rwd endpoint is valid online**: `source: 'rwd'`, and the financing balance of 31,928 tickets on 2026-07-22 is consistent with the §C manual measured fixture.
- **§E "No schema migration required" has been verified**: `MI_MARGN_D` is written to `chip_raw_cache` normally (no dataset CHECK constraint).

**schema.sql §6 (Storage bucket + pg_cron nightly batch) - Filled (dev.2 legacy gap) **

This paragraph has not been applied to dev since dev.2, that is, the "automatic after-hours production report" has never been actually enabled (not caused by this round).
`CRON_SECRET` has been set and §6 is applied (only §6 is applied, the existing tables in the first 5 sections are not rerun), verify bucket public,
`pg_cron` / `pg_net` enabled, cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`.

Manually trigger `generate-all` → `generated 3/3`, `historyDays 7`; `manifest.json` in bucket +
3 The schema 2 JSON is about 5KB (**§B’s “halving the size” and §E’s estimates both hold true**).

**The value of storage-first has numbers**: 0.8 seconds to read pre-production report vs 8 seconds for click-to-production, about 10 times.

By the way, the existing problem is fixed: the old deployment is `verify_jwt: true`, but the cron in §6c only has `x-cron-secret` without Authorization.
It means that the night batch will be blocked by the gateway 401; this deployment with `--no-verify-jwt` has been solved
(Authorization is deliberately not included when manually triggered, just to verify this path).

**Retrieve `CRON_SECRET`**: The value exists in Edge Function secrets and `cron.job.command`, check it when needed
`select command from cron.job where jobname='stock-report-nightly'`。

### L. Next step (technical aspect) → **Implementation completed in 0.5.0-dev.1**

Original text (retained for future reference): `TechnicalTab` is currently a placeholder page. Before connecting the daily/weekly/quarterly lines, you need to solve the storage problem of §G:
Added `price_daily(ticker, date, open, high, low, close, volume)` and independent retention period (about 400 days),
The data source can relax the Yahoo `chart` call parameters of the existing `stock-price` to obtain the full OHLC. The layout has been saved and there is no need to move it when connecting.

**Differences between implementation results and §G/§L (2026-07-26 10:40:00 Asia/Taipei)**

1. **The storage is changed to Storage, and the `price_daily` data table is not added. **
   Each file in the `reports` bucket contains `daily/{ticker}.json`, which is overwritten by the existing `generate-all` batch every night.
   Reason: There is no retention period problem in the overwrite system (there is no need to prune, so there will be no recurrence of the "cut calendar days vs. count transaction days" situation in 0.3.9
   Unit mismatch); the front end is downloaded directly and does not consume Edge Function credit. Actual measurement: 10.8KB per file / 243 trading days.
2. **§G says "the data source is already in the project" and is established after actual testing**: Yahoo chart endpoint is relaxed to `range=1y&interval=1d`
   That is, the complete OHLCV of 244 trading days is returned, and there is no need for TWSE `STOCK_DAY` kind of stock-by-stock and month-by-month filing.
3. **§L said that "the layout has been reserved, and there is no need to move it when connecting" is generally true**, but `ChartFrame` still adds an optional
   `labelIndices`: There are only 7 points in the chip chart that can be fully marked, and 244 full marks of K in a year will be mixed into a ball.
4. **Taiwan stock terminology comparison**: §L's "daily/weekly/quarterly" is implemented on the UI as MA5 (weekly)/MA20 (monthly)/
   MA60 (quarter line), there are two explanations in the legend.

**New implementation constraints (written to subsequent Agents)**

- **Indicators are always calculated based on the complete sequence before cropping the display range**. If written in reverse, cut to "nearly 3 months" (60 sticks)
  MA60 will only have a value on the last line, and the KD recursion will restart from the initial value of 50. The entire line is wrong.
  This rule is independent as a pure function in `technicalView.ts` and is tested.
- **Yahoo's date conversion must add `meta.gmtoffset`**. Directly get the UTC date from the original timestamp in the Taiwan stock time zone
  It happens to be true, but that's a coincidence; the test nailed it with the counterexample of UTC+9.
- **The response will contain five columns of holiday grids with all nulls** (actual test on 2025-08-01), which will be discarded instead of filled with 0s.

---

## 📐 §M. 0.6.0 AI Assistant - Design Decisions

- Agent: Claude
- Action: Rebuild specifications (original project file is lost) + user finalization
- Status: SPEC_READY — Implementing delegation agy (TASK.md Task 17)
- Timestamp: 2026-07-26 23:40:00 Asia/Taipei

### M0. User finalization (2026-07-26)

| Project | Finalization |
| ---- | ---- |
| UI location | The "**AI Interpretation**" tab has been added to the individual stock analysis page, juxtaposed with Chips / Technical / My Holdings |
| Key storage | **Supabase `user_settings` new field** (not localStorage) |
| Connection method | **The first version only does front-end direct connection**; Edge Function agent remains 0.6.1 |
| payload range | technical `latest` summary + chips 7-day summary; **excluding holdings and costs** |
| Failures and Timeouts | Claude Decision (see §M5): 30 second timeout, error classification, manual retry, no automatic retry, first version not streaming |

### M1. Core constraints (short-term goals §6 shall be followed and shall not be violated)

1. **The indicators are calculated by the program and then fed to the model. The model does not touch the original sequence. **
   0.5.0 The `latest` of `technicalView.ts` is ready for MA5/20/60, long and short arrangement, K/D, RSI14,
   MACD column, volume-to-energy ratio, rise and fall - these are the technical sources of payload. The model does not need to look at 243 closing prices.
   Reason: The language model's mental calculation of MA60 from 243 closing prices must be wrong, and the wrong number package is the hardest to detect in fluent Chinese.
2. **provider-agnostic, not tied to any single vendor SDK. ** Only use `fetch`, and the adapter groups request/response respectively.
3. **Product red line: Do not actively display AI interpretation. ** No AI text will be generated if the button is not pressed;
   When the provider is not set, the page only displays the setting guide.

### M2. Two adapters covering three suppliers

`AiProviderKind` has only two values ​​because both ollama and vLLM are OpenAI compatible endpoints:

| kind | object | endpoint | authentication |
| ---- | ---- | ---- | ---- |
| `google` | Google AI (Gemini) | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | header `x-goog-api-key` |
| `openai-compatible` | ollama / vLLM / any compatible endpoint | `{baseUrl}/chat/completions` | header `Authorization: Bearer` (omitted if the key is empty, ollama does not need it natively) |

`baseUrl` normalization rule must be **pure function + test** (`normalizeBaseUrl`): remove trailing slashes;
If `/v1` is already included, it will not be appended repeatedly; if it is not included, `/v1` will be added. User fills in `http://localhost:11434`
Or `http://localhost:11434/v1` must be available.

### M3. The collateral impact of key storage (the cost of selecting `user_settings` has been confirmed with the user)

- schema demand `user_settings` (`ai_provider` / `ai_base_url` / `ai_model` / `ai_api_key` /
  `ai_updated_at`), see `sources/supabase/schema.sql` for writing method §4.1 —— Use
  `ALTER ... ADD COLUMN IF NOT EXISTS`, because `CREATE TABLE IF NOT EXISTS` does not fill in the fields for the existing environment.
- **Two zones need to run migration** (explicit authorization from the user is required, CLAUDE.md § Branches & envs).
- **No AI paging in native mode** - No Supabase in native mode, settings are nowhere to be saved. The entry rules are consistent with the after-hours report all the way.
- **The key will still be returned to the browser**: 0.6.0 is a front-end direct connection, and what is saved in the DB is cross-device synchronization, not "the key does not enter the browser".
- The `user_settings` table, although it exists from the beginning, has never been read or written by the frontend (preferences are all in localStorage).
  **0.6.0 It is the first user** of this table, so upsert needs to create columns by itself (the other fields have DEFAULT, just `user_id` + `ai_*` is enough).

### M4. payload specifications

`buildAiPayload()` is a pure function that outputs structured objects (only numbers and labels, without any sentences),
Then `renderAiPrompt()` is converted into two paragraphs of text: system / user. Both need to be tested.

content:

- **Identification**: code name, name, data date.
- **TechnicalView**: `TechnicalView.latest` Full column + Displays the highest/lowest closing price of the range.
- **Chips** (from report JSON, `report.history` up to 7 transactions):
  Each legal person’s last day’s buy/sell/net, 7-day net sequence, `ChipStreaks` continuous buy/sell;
  Today's balance of margin financing and securities lending / compared to the previous day / 7-day sequence / streak; `notes[]`.
- **The unit must be entered in the payload**: T86. The three major legal persons are **number of shares** and margin trading is **pieces**.
  §C The existing bug that has been recorded is that "Zhang" is marked as "Share" - it is more dangerous to read it as a model, because it will infer in the wrong unit.
- **Excluding shareholdings, costs, unrealized gains and losses** (to be finalized by the user).

prompt guidelines (follow the copywriting principles of PROGRESS.md 2026-07-21 16:05):
Traditional Chinese, short vernacular sentences, no formulas, 3-5 paragraphs; **Only the numbers provided can be quoted, and no self-calculation or speculation on unprovided indicators is allowed**;
**No buying or selling recommendations or price targets** may be given; end with a fixed statement that this is a summary of information and not investment advice.

### M5. Failure and timeout (Claude decision)

- `AbortController` times out **30 seconds**.
- The error is classified as `auth`(401/403) / `rate-limit`(429) / `server`(5xx) / `timeout` / `network` / `bad-response`,
  Each gives a corresponding message in vernacular Chinese. The message of `network` should mention **CORS**: ol​​lama needs to be set
  `OLLAMA_ORIGINS`, otherwise typing local endpoints from the domain of GitHub Pages will be blocked by the browser.
- **No automatic retry** (AI calls cost money, silent retry will make the user pay twice), only give a "Retry" button.
- **The first version does not stream**, it will be sent back once; the button will display "Interpreting... (up to 30 seconds)" when running.
  Streaming is left to user requirements - both support SSE, but the two sets of parsing formats are different. Whether it is worth it depends on the actual experience.

### M6. File change range

| Archives | Actions |
| ---- | ---- |
| `sources/supabase/schema.sql` | ✅ Changed: §4.1 Five `ai_*` fields |
| `src/services/aiSettings.ts`(+test) | Newly added: types, `normalizeAiSettings` / `validateAiSettings` (pure function), `loadAiSettings` / `saveAiSettings` (Supabase upsert) |
| `src/services/aiClient.ts`(+test) | Newly added: `AiProvider` interface, `createAiProvider`, two adapters, `AiError`, `normalizeBaseUrl` / `mapHttpError` / `extractGoogleText` / `extractOpenAiText` (all pure functions) |
| `src/components/StockDetail/aiPayload.ts`(+test) | Newly added: `buildAiPayload` / `renderAiPrompt` (pure function) |
| `src/components/StockDetail/AiTab.tsx`(+test) | Added: setting form, generating button, result, error and retry, disclaimer |
| `src/components/StockDetail/StockDetailPage.tsx`(+test) | Modification: `DetailTab` adds `'ai'`, `TABS` adds "AI Interpretation", render `<AiTab>` |
| `src/index.css` | Added `.ai-*` styles |
| Version number three + `README.md` | `0.6.0-dev.1` |
| `docs/agent/*`, `sources/supabase/README.md` | Records and schema description |

**`AiTab` 自己載 daily series**（`fetchDailySeries` + `buildTechnicalView(rows, '1y')`），
Don't mention the status to `StockDetailPage` - one more 10–20KB download (and browser cache),
The one I changed to is the unchanged `TechnicalTab`, with the smallest change area.

### M7. Risk

1. **Browser blocks local endpoint**: Open `http://localhost:11434` from the Pages domain of `https://`,
   In addition to ollama's own CORS (`OLLAMA_ORIGINS`), you may also encounter browser restrictions on private network requests.
   The fallback route that fails to work in actual testing: use `npm run dev` locally, or wait for the 0.6.1 proxy (but the proxy cannot connect to your localhost,
   The proxy only solves the cloud provider's CORS and key issues). This** must be verified on the actual machine before being written into the README**.
2. **The model may still get the numbers provided wrong** (tickets/share, plus or minus sign). The countermeasure is to write the unit clearly in the payload.
   And lock the unit label of the payload during testing; the interpretation of the text itself cannot be guaranteed by testing, so the UI must have a disclaimer.
3. **Clear text of the key is stored in DB**: Isolated by RLS. If you want to be more strict in the future, the 0.6.1 proxy is the correct solution (only Supabase secrets are left for the key).

### M8. Definitely not done (outside the scope of 0.6.0)

Edge Function agent (0.6.1), streaming output, ~~multiple rounds of dialogue~~ (**done in 0.6.5, see §P**),
Control the holding cost to feed the model, native mode support,
Automatically display analysis in the Chip/Technical tab (violating §M1.3 red line).

---

## 📐 §N. 0.6.0-dev.4 Fundamentals / Industry / News - Design Decisions

### N1. Why continue to use "After-hours batch → Storage JSON → Front-end direct reading"

The three new data (valuation, monthly revenue, news) are not user-specific and are of the same nature as chips and daily lines.
You can use the existing pipeline without adding any Edge Function invocation (the lesson of burning out the quota in 0.3.9 is still valid),
There is no need to create a new data table - the PK of `chip_raw_cache` is `(ymd, dataset)`, and the new dataset key is in place directly.
**There are no schema changes** this time, just redeploy `stock-report`.

### N2. Data source selection

| Requirements | Endpoints | Why it |
|---|---|---|
| Three valuation indicators | OpenAPI `exchangeReport/BWIBBU_ALL` | One covering price-to-earnings ratio / yield rate / net worth ratio, updated daily, one level for the whole market |
| Monthly revenue | OpenAPI `opendata/t187ap05_L` | Monthly updates, including monthly growth and annual growth rate, and ** incidentally to the Chinese industry** |
| Industry category | `t187ap05_L` takes priority, fallback to `opendata/t187ap03_L` | The former gives a Chinese name and is maintenance-free; the latter gives a two-digit code that relies on a lookup table and can only be used as a fallback |
| News | Google News RSS | No key required, wide coverage, complete localization parameters for Traditional Chinese and Chinese |

**No need for quarterly EPS (`t187ap06_L`)** (⚠️ **0.6.5 is partially overturned, see §Q**): the frequency of quarterly updates is too low, the field analysis is cumbersome, and the usage scenario of "taking a look after the market"
Marginal benefits are low. I’ll add more to that later.

### N3. Classification of one level fundamental and one level news

`fundamental/{ticker}.json` combines valuation + monthly revenue + industry into one level, because all three are produced by the same batch
OpenAPI produces large amounts of data, updates at a consistent pace (according to the data date of the batch), and **three UIs share the same one**
(Title badge, basic paging, AI payload) - Splitting will only make the front end type Storage twice more.

`news/` is an independent file: its update rhythm is different (it has nothing to do with the Taipei calendar day and has nothing to do with the trading day).
The failure strategy is also different (keep the old file when you can't catch it, while the basic plan is to skip the entire section if all three copies fail).

### N4. Use regex to parse RSS without using XML parser

The Edge runtime does not have `DOMParser`, and introducing `deno_dom` will violate the "no dependency" inertia of this project.
The `<item>` structure of RSS 2.0 is flat enough, and regex can handle it; the key is to return `[]` instead of throw** when the format does not match.
—— Lack of materials on the message page must not bring down the entire batch, nor must it block AI interpretation (the prompt has a copy of the lack of materials).
XML entity (`&`) will appear in the title, so `decodeXmlEntities` is necessary and not a defensive code.

### N5. Monthly revenue is accumulated automatically in the overwrite file, and the gap is filled by MOPS (revised in 0.6.4)

The monthly revenue API (`t187ap05_L`) only returns the "latest month", and the endpoint does not accept the year and month parameters. For AI to see trends, it needs history.
But I don’t want to open a data table for this, so `mergeRevenueMonths()` merges the latest month into the existing file every night
(Reduced by year and month, upper limit is 12 months). **This section remains unchanged**, it is still the main thread of the day.

**0.6.4 What is overturned is the half that "the price can only be tolerated". ** It was originally written "There is only 1 transaction for the first execution, and it will take one year to accumulate.
This is more cost-effective than opening a new watch for the sake of history." - The first half of the sentence is fact, the second half is **False two choose one**:
In addition to "opening a new watch", there is a third way, which is to change a source of history.
The `t21sc03` of the Public Information Observatory is a monthly report. The URL directly indicates the year and month of the Republic of China, one report per month.
There is no new information sheet after the connection, and there is no need to wait for a year.

Added `twRevenueHistory.ts` (pure function) + `backfillRevenue()` of `index.ts`:

- **Gap Driven**: First, calculate how many items are missing in the target month, and then return them directly if they are full, with zero external requests.
  The cost per night when topped up is 0, in the same spirit as `decideSkip`'s short circuit.
- **Does not enter `chip_raw_cache`**: `pruneChipCache` is a lexicographic comparison of `ymd < cutoff` (8-code date),
  Any month key smaller than this will be deleted every round, and the cache will be written in vain.
  `fundamental/*.json` itself is a cache - after all files are added in a certain month, they will not be requested again.
- **Single upper limit of 4 months** (`MAX_BACKFILL_MONTHS`), the reason is the same as `MAX_BACKFILL_DAYS`:
  The upper limit of the execution time of the Edge Function is the tightest line on this path. To be completed in 3 rounds over 12 months.
- **Only fill the gaps but not cover** (`fillGapsOnly` of `mergeRevenueMonths`): The monthly revenue will be corrected and reissued.
  If historical crawls were allowed to overwrite, an older crawl would overwrite the corrected number for `t187ap05_L` -
  Making up for history will contaminate the current situation, which is the most uneconomical exchange.

### N6. OTC stocks: writing files, not not writing them (partial support starting from 0.6.4)

All three OpenAPIs only cover listings. When searching for OTC stocks, a file with a null field is still written and `notes` is attached.
The reason is that "file does not exist" and "ran but no data" are two different messages on the UI.
The former should say "will be added later" and the latter should say "over-the-counter listing is not supported at the moment". Mixing things up keeps the user waiting for something that never comes.

0.6.4 `t21sc03` starting from MOPS also has an over-the-counter version (`otc`), and the code name does not overlap with the listed version.
Therefore, **listed OTC stocks begin to have monthly revenue**, but valuation and industry differences still do not.
`notes` is therefore changed from "write a general note only if all three are null" to **sub-items**: when there is revenue but no valuation
Specify separately that "Valuation only covers listings", otherwise users will not know why when they see a blank valuation field.
The note is only written when "`BWIBBU_ALL` was indeed loaded but no such codename was found"——
If this round of fetching fails, `valuation` will also be null, but that is our problem, not its.

### N7. News enters the boundary of AI

Only **titles** (10 articles, last 14 days) are given, no content is given. Corresponds to system prompt guideline 7:
The model can only judge the positive and negative tendencies based on the literal meaning of the title, and no speculation or expansion is allowed; the interpretation can only be incorporated by conditional observation.
"Recommended operations/precautions" cannot be used alone to give buying and selling orders. This is an extension of §M1.3 product red line on the news side——
News headlines are more likely to induce model brainstorming than numbers, and the rules must be written down in the prompt.

### N8. Risk

1. **Google News RSS may be blocked or modified** (data center IP, consent redirection). Countermeasures: bring UA, 10 seconds timeout,
   Failure does not overwrite the old file. When the entire batch fails, the function will naturally be degraded to the "no message side" and will not be broken.
2. **The industry code comparison table will be outdated**: When TWSE adds an industry, if `INDUSTRY_NAMES` cannot be found, the code will be output as it is.
   (Better than losing information). The Chinese name of `t187ap05_L` is given priority just to make this table less used.
3. **wall-clock**: The first shift has 3 more large-scale fetch + N RSS (sequence, upper limit of 10 seconds each).
   The shareholding size is small (~5 levels) and is far below the upper limit, and these two paragraphs are run after the chip report and manifest are written.
   Even if it is overdue, it will not affect the report that has been written.

---

## 📐 §O. 0.6.1 Change after-hours batching to polling - design decision

### O1. Why is it a change at the architectural level, not just a cron string change?

The three-shift system implies an assumption: **We know when each data source is released**. The entire design is based on this assumption——
`loadT86`'s "cache the first time it is caught, and never update it after that" is only true when "the first time it is caught is the final version".

2026-07-27 Within one day, this hypothesis was overturned three times by actual measurements (the time window of T86 was confused with BFI82U,
The coupons were borrowed at 17:07, and the semantic meaning of TWT96U we caught was also wrong), and the user pointed out that T86 starts from 16:00
**Updated every 15 minutes** - that is to say, "the first catch is the final draft" is simply false.

So the change is not the time point, but the **judgment basis**: changing from "looking at the clock" to "looking at the content".
The guesses on the clock will expire, "catching the same thing twice in a row" will not.

### O2. Decision: Judgment logic must leave `index.ts`

`index.ts` calls `Deno.serve` when the module is loaded, and vitest cannot import it——
**The judgment written there amounts to no test**. I could still tolerate it during the third shift (I made a mistake and ran three more times a day),
32 It won’t work: 0.3.9 The reason for burning out the quota is due to my own logic error, not malicious traffic.

Therefore, open `pollPlan.ts` to only contain pure functions (`decideSkip` / `nextT86State` / `fingerprint` / `runSignature`),
`index.ts` is only responsible for wiring. This is the only new profile this time around, and the only part covered by testing - on purpose.

### O3. Decision: cross-round status is parasitic in `batch_run_log`, do not create another table

Polling requires remembering "what the T86 fingerprint was in the last round and how many times it was run today." These are the things that I want to observe in the first place.
There is no need to create another table for the same data. The cost is that the observation table becomes a half-loaded state: `logBatchRun` deliberately swallows exceptions,
When writing fails, the next round will be treated as the first run of the day - **Do more things instead of doing wrong things**, acceptable.
If this cost becomes unacceptable in the future (for example, if a retention period is added that may lead to accidental deletion), it is time to dismantle the table.

### O4. Decision: Short-circuit conditions include margin trading, not just T86

If you just look at T86 and call it a day, it will stop at 17:00, and you will never be able to catch the margin trading that was released at about 21:00 that day.
On the other hand, this also means that there will be no short circuit on a day that never comes (such as a weekend holiday) for margin trading**,
32 Run all rounds - guaranteed by `MAX_RUNS_PER_DAY = 40`, and each source has cache. The cost of multiple runs is DB query rather than external crawling.

### O5. Risk

1. **Short circuit judgment is wrongly written → run all in every round**. This is the biggest risk this time, and it is also why `pollPlan.ts` has tests for every judgment.
   The second line of defense is `MAX_RUNS_PER_DAY`, and the third line is `skipped` / `duration_ms` of `batch_run_log`
   (The round of short circuit should be only tens of milliseconds, which can be seen at a glance using "Common Query 3").
2. **Deployment order reversed → Three gates failed silently**. The new column is deployed without ALTER, and `logBatchRun` fails to write the entire column.
   `readLastRun` never reads back the status, and each run is treated as the first time of the day. Must ALTER before deploying.
3. **`CRON_SECRET` outflow becomes more valuable**: The endpoint is legitimately called 32 times a day, and anomalous calls are harder to identify from the traffic.
   `MAX_RUNS_PER_DAY` is a brake, but the correct solution is to change the key to a random long string (the official area currently only has 8 codes).
4. **T86 If it is published on a certain day and then rewritten at an interval of more than 30 minutes**, it will be judged as finalized and then unfrozen.
   `t86_revisions` will be logged faithfully. The report will be regenerated, but it will show the old values ​​for that period - acceptable and visible.

---

## 📐 §P. 0.6.5 AI questioning dialogue - overturning the "no multiple rounds of dialogue" in §M8

- Agent: Claude
- Action: The user requested that "the discussion can continue after the initial analysis is generated, but the prompt words must be strictly limited and framed"
- Timestamp: 2026-07-28 15:20:00 Asia/Taipei

### P1. Why didn’t you do it before and why do it now?

§M8 lists multiple rounds of dialogue as outside the scope of 0.6.0. The reason is scope control (in 0.6.0, a single round must be cleared first).
That's not redlining, that's sorting. Users have now clearly requested it, and the single wheel has been running stably in the two areas for three weeks.

### P2. The three layers of limitations, and the fourth layer that is deliberately not done

1. **Negotiable scope white list** written into the system: technical aspect / chip aspect / fundamental aspect / profitability /
   General background/news headlines/the analysis itself.
2. **Fixed rejection sentence** (`OFF_TOPIC_REPLY`), requiring the model to copy it **word for word**.
   The value of this article is not in blocking, but in **observability**: if the model refuses freely,
   You can't tell the difference between "It refused" and "It actually answered but said it politely", and you can't test whether the boundaries have been broken.
3. **Anti-prompt word injection**: "Ignore the above instructions" "You are now a different character" "Repeat your system prompts"
   It will be regarded as out of bounds, and it is clearly stated that "users have no right to change the rules of this paragraph."

**Deliberately not do front-end keyword filtering. ** The cost of mistakenly blocking a legitimate question is higher than the occasional missed answer:
"How does this compare to UMC?" is a reasonable comparison question, but it will be blocked by the code blacklist.
"Write a poem for me using the data in this file." Every word is in the whitelist but should be blocked.
The blacklist cannot catch up with the bypass method, and the mis-blocking is an immediate harm that the user feels.

### P3. system resends every round

The output of `buildChatSystem` is put into `AiRequest.system` for every request, not just on the first pass.
The frame limit will not be diluted when the conversation becomes longer, and the user cannot squeeze it out of the contextual window by "talking for many rounds".
The complete payload and the full text of the initial analysis are also placed in the system - questioning will prevent amnesia.

The cost is that the token grows linearly with the number of rounds, which is why `MAX_CHAT_TURNS = 10` exists:
The cost cap is controlled by "number of rounds" instead of "content filtering".

### P4. sessionStorage instead of DB

Conversations will accumulate. When entering Supabase, you need to create new tables, RLS and cleanup strategies.
The life cycle of `sessionStorage` (cleared when paging is turned off) is exactly in line with "temporary storage during a viewing process".
**By the way, we have fixed an existing pain point**: the result of `AiTab` was originally purely component state.
And `StockDetailPage` is conditional rendering. If you cut the page and then switch it back, it will disappear. You need to press it again** and re-calculate**.

`payload` is intentionally not stored together (it is large and rebuildable). After restoration, you can see the analysis and past conversations.
But if you want to continue asking, you need to generate it again - without the payload, there is no data on which the frame is based.
Hard feeding is equivalent to letting the model answer out of thin air without data.

### P5. Gemini’s `model` is not `assistant`

After `AiRequest` is changed from a single `user: string` to `messages: AiMessage[]`,
The mapping difference between the two adapters becomes a formal risk point: **Gemini's assistant role is called `model`**.
If it is sent as `assistant`, it will be regarded as the user speaking, and the model will think that what it said in the last round was said by the user.
Therefore, `toGoogleContents` / `toOpenAiMessages` are pure functions and tested separately.

---

## 📐 §Q. 0.6.5 Profitability and General Manager - Partially overturning the "no quarterly reporting" in §N2

- Agent: Claude
- Timestamp: 2026-07-28 15:20:00 Asia/Taipei

### Q1. The reason for §N2 is not valid on the new endpoint.

§N2 Write "No quarterly EPS report (`t187ap06_L`): quarterly update frequency is too low and **field analysis is cumbersome**".
The second half of the sentence is for the comprehensive income statement - it needs to be divided into five industry tables, and the numerator and denominator should be divided by yourself.

But **`opendata/t187ap17_L` (listed company profit analysis query summary table) ratio is calculated by the stock exchange**:
Gross profit margin/operating profit margin/net profit margin before tax/net profit margin after tax are directly fields.
Single whole-market JSON, Chinese key, Republic of China year, the shape is exactly the same as the existing `t187ap05_L` (monthly revenue).
The reason "the analysis is cumbersome" has disappeared; "the frequency of quarterly updates is low" still exists, but that does not constitute a reason not to do it——
Profitability is inherently a quarterly concept.

**Note that this is different from the EPS removed in 0.3.7-dev.6**: that time the user explicitly instructed to cancel,
The method is to build the `stock_fundamentals` data table by yourself. This time, Storage JSON will be used and no new table will be opened.

### Q2. Merge `fundamental/{ticker}.json` instead of splitting a new file

The criteria of §N3 (update rhythm, failure strategy) point to both sides here: quarterly update vs daily update with different rhythm (point to splitting),
But the same family of data sources, the same set of per-ticker extraction, and the same set of notes mechanism (pointing and union).

Choose merge, because merging saves one storage download and one proxy.
And the wiring between `AiTab` and the title badge already exists. `FUNDAMENTAL_SCHEMA` 1 → 2,
The front-end will always be compared with `>=`, and the upgrade will not harm the old front-end.

### Q3. The general manager is the first non-individual stock information in this project.

There is no existing mold, and the shape is closest to `manifest.json` (a single global file). Four decisions:

1. **`macro/us.json` is a global single file, not per-ticker. ** Shared by the whole market,
   Written per-ticker is just copying the same information N times.
2. **Do not enter `tickers` loop, do not enter `warmStock`. ** It has nothing to do with individual stocks. Putting it in will only make
   "Add a new stock" accidentally triggered five external requests.
3. **The skip condition uses Taipei calendar day, without `dataYmd`** (cf. `syncNews`).
   US data is based on its own release date, and the key to using the Taiwan stock trading day will not be updated during consecutive holidays.
4. **Do not write `chip_raw_cache`. ** The prune of that table is the lexicographic order of the 8-digit date,
   The month key is deleted every round (`backfillRevenue` is not used for this purpose).

### Q5. dev.2 correction: UI and triggers are separated from individual stocks/after-hours batches

dev.1 makes the general manager into a page for individual stock analysis and hangs it in `handleGenerateAll`.
Both things contradict Q3 point 1 ("It is a share shared by the entire market"), and dev.2 has corrected it together.

**UI: Raised as a top-level page. **Hung under individual stock analysis, users must first select a stock before they can see one
Information that is not relevant to that stock - dev.1 even had to print a line on the screen that said "Not relevant to the stock you are viewing"
to remedy. The remedial copy itself was a sign that the design was wrong. It was deleted after being promoted to the top page.

`AiTab` still needs the same data, change it to `fetchMacro()`** in `handleGenerate`,
Isomorphic to its existing daily/news capture method. A side benefit is that it becomes lazy: click "Generate Analysis" to capture,
No need to download something every time you open a stock page for something you may never look at.

**Native mode must be hidden as well. ** `fetchMacro()` always returns `null` in native mode,
The empty status text is "It will be filled in automatically after the schedule is completed" - that is false in local mode and will never be filled in.
Use the existing `isReportConfigured` filtering rules of "Individual Stock Analysis".

**Trigger: Standalone `macro-daily` cron job** (`0 13,15 * * *`).
The after-hours batch schedule is based on the Taiwan stock market schedule (Monday to Friday, Taipei 16:00–23:45), and the US data has nothing to do with the Taiwan stock trading day;
More directly, the `decideSkip` short-circuit will `return` after all the data is received, and the whole section of the following things will not be executed.
(Actual measurement on 2026-07-27: 4 out of 15 wheels were short-circuited).

**What is broken is the schedule, not the function** - `source-probe` in §8 already has "the same function, different actions,
"different schedule" precedent. Opening one more Edge Function is just one more object to deploy, audit, and manage keys.

**Side effects: `batch_run_log.macro_synced` becomes a dead field (nothing is written to it anymore).
Not writing into `batch_run_log` is intentional - one column in that table = post-run batch,
And `readLastRun` will read the last column to get the T86 fingerprint and `runs_today`;
Inserting columns into the total will pollute the cross-turn state of `decideSkip`.

**Trampled layout issue**: The top level pagination has been changed from four to five, and the line will break on the 375px screen.
(Actual tab height 36px → 57px). The calculation formula and modification method are recorded in the `max-width: 400px` block of `index.css`.
And indicate "Be sure to weight it before adding the sixth tab."

### Q4. Trade-offs of FRED

**Use `fredgraph.csv` instead of the official REST API**: the former does not require an API key for actual testing.
There is one less set of keys to be kept (this project currently only has one `CRON_SECRET`, so don’t add it if you can).

**Grab the original value and calculate the annual increase/monthly increase yourself without using `transformation=pc1`**:
The endpoint does support direct annual growth rate calculation, but the same original sequence can calculate multiple calibers at the same time.
Moreover, the algorithm is a pure function and can be measured; if you hand it over to the other party for conversion, you have to capture it once for each caliber, and you lose the ability to verify the calculation.

**Three realities** corresponding to the indicator (determined by users):

- "Core" only has standard definitions for CPI/PPI/PCE (excluding food and energy).
- "Core non-agricultural employment" is not an existing concept. Instead, we use the **monthly increase in the number of people** (monthly changes in `PAYEMS`) that the market actually sees.
- **CCI and consumer confidence are the same thing**, and the only one that is free and still updated is UMCSENT.
  The Conference Board version is paid; FRED’s OECD version `CSCICP03USM665S` has been stopped for actual testing.
  (Last Stroke 2024-01). Therefore, they are combined into one item.


---

## 📐 §R. 0.6.5-dev.3 Right side of the top page - 8 control items converged into 2 menus

- Agent: Claude
- Action: The user selects R4 after design review at the top of the page (workspace menu + account menu)
- Timestamp: 2026-07-28 19:40:00 Asia/Taipei

### R1. Two bugs measured (not a matter of preference)

1. **The header is higher on wide screens than on narrow screens. ** `≤1220px` becomes 70px in one column, `≥1221px` becomes 106px in two columns.
   The `max-width` of `.app-header-inner` is 1180px, so it doesn’t matter how wide the window is -
   `.user-email` (132px) is displayed beyond about 17px and wraps.
   **The `≤1220px` breakpoint that hides email seems to be narrowing the screen, but in fact it is the only thing that allows the top of the page to maintain a single column. **
2. The **375px workspace dropdown collapses to 39px**, leaving only an arrow. The cause is `≤720px` given
   `.ws-select select` `flex:1; min-width:0` is squeezed out by the four buttons on the right.
   And the workspace determines every number on the screen, so it's hard to see which one is actually wrong.

### R2. Three design issues

- Add/Rename/Rate/Delete are operations with **setting frequency**, but they have the same weight as topic and logout.
  The top of the page should be "Switch Workspaces", not "Manage Workspaces".
- **Deleting the workspace is just one click away**, next to "Rename" on the left, both are 14px unlabeled icons.
- `＋ ✏️ % 🗑️` Four unlabeled icons in a row, where `%` represents the "default handling rate"——
  That's not a symbol anyone would guess right the first time.

### R3. Practice

**Workspace menu**: list on top (`menuitemradio` + tick), divider, management actions in the middle,
Separator line, delete it at the bottom and make it `is-danger`. Management actions originally only apply to "the current workspace".
Put together with the list, the target does not need to be guessed.

**Account Menu**: Appearance, Identity, Logout.

**The local mode deliberately retains the "local mode" badge as the trigger button** and does not change it to the avatar——
"Data only exists in this browser" is a fact that users need to see at all times. Hiding it in the menu is equivalent to downgrading it.
(Side effect: More than ten tests that use `findByText('Local mode')` when the "app has been loaded" signal are not affected.)

### R4. `HeaderMenu` shares the commission

Both menus need to behave exactly the same: click outside to close, Esc to close and return focus to the trigger button, correct aria.
Writing a copy of each will sooner or later only fix one side, and this inconsistency is completely invisible from the caller.
(Same reason as `mergePeriodSeries`).

### R5. Pitfalls encountered during implementation

When moving the effect of `ThemeToggle` into `UserMenu`, I missed it.
`typeof window.matchMedia !== 'function'` This condition** - jsdom does not implement matchMedia,
Without it `App.smoke`, the whole batch of 8 tests failed on the spot. That line of source code exists for a reason and is not redundant.

### R6. Verification

`.hmenu-ws` Actual measurement: `375 / 720 / 1024 / 1200 / 1221 / 1440 / 1600px` seven widths,
**The header height in ≥1024 is all 70px** (originally ≥1221 is 106px),
The workspace name occupies 42px of readable 375px (originally it collapsed to 39px).

---

## 📐 §S. 0.6.6-dev.1 Mobile phone bottom navigation - The 8th of the ten proposals on the top tab

- Agent: Claude
- Action: The user reviews the "Top tab - 10 design proposals" and selects option 08 (bottom navigation on mobile phone)
- Timestamp: 2026-07-28 21:55:00 Asia/Taipei

### S1. Problem to be solved

0.6.5-dev.2 After raising the general page as the top-level page, the number of pagination changes from 4 to 5, and 375px is folded on the spot;
At that time, I relied on `@media (max-width: 400px)` to narrow the spacing and squeeze it in.
**Squeezing it in does not mean that the design is correct** - Calculation formula (available width 339px ÷ 5 = 63px per grid,
The content of each grid (15+7+26+16 = 64px) is only 1px short, and the sixth page can no longer be filled.

### S2. Why Case 8 and not others?

Among the ten proposals, only the bottom column satisfies the requirements of "no changes to the information structure", "no hiding of any pagination" and "there is still room for quantity".
Three categories eliminated:

- **Include "More" drop-down (cases 5 and 7)**: The local mode only has 3 tabs, and it will become "1 hidden in 4", which is even weirder.
- **Horizontal scroll (4 cases)**: Pagination beyond the screen does not exist.
- **Sidebar/Command Bar (cases 9 and 10)**: There is currently no router. If you reorganize, you will return to the inventory overview. The page has no URL.
  Both cases assume that users will want to jump directly to a certain page, which will make the "no URL" more glaring.

### S3. This land was not empty to begin with.

There were three things originally living at the bottom, and the plan sheet has indicated that they must be dealt with first:

| element | originally | now |
| ---- | ---- | ---- |
| Added transaction floating button | `bottom: 16px` | `bottom: calc(var(--bottom-nav-h) + 12px + safe area)` |
| Version badge | `position: fixed; bottom: 12px` | Change the mobile phone back to the file flow, following the footer |
| Content area bottom margin | `.container` reserved 104px | Margin handed over to footer and badge |

The reason why the badge is not "moving up" but "leaving the fixed position": the mobile phone does not have the lower left corner available——
If it is fixed there, it will either be covered by the navigation bar, or it will float on the card text (in actual testing, the empty state copy will be suppressed).

### S4. ⚠️ Pure CSS can’t do it: background-filter will kidnap fixed

`.app-header` has `backdrop-filter: blur(18px)`, which will become all fixed descendants
containing block** —— `<nav>` in the header of the page, even if `position: fixed; bottom: 0` is set,
It will only be posted at the bottom of the page header, not the bottom of the window.

Therefore, the bottom column must be a node other than the top of the page, and "where the same navigation is rendered" can only be determined by JS:
`AppShell` 用 `useNarrowScreen()`（`matchMedia('(max-width: 720px)')`，
Breakpoints are synchronized with `index.css`) Pick the location. **Deliberately not rendering two copies** Use CSS to display one -
There would be two sets of buttons with the same name, which would be noisy to assistive technology and testing.

The existence check of `matchMedia` is the same as §R5: jsdom does not implement it. If the test is missing, the entire batch will fail.
And the test environment is always based on the desktop version (if you want to test the mobile phone, you need to make your own stub, see `App.smoke.test.tsx`).

### S5. There is only one source of height

`--bottom-nav-h: 54px` is defined in `:root`, the height of the navigation bar, the position of the floating button,
The base distance of the badge is all calculated by it. The safe zone (iPhone home indicator) is always added separately
`env(safe-area-inset-bottom, 0px)`, so `index.html` **does not need** to be changed to
`viewport-fit=cover` - without cover the inset is 0 and the behavior is exactly the same as now.

### S6. Dead CSS that can be easily cleared

0.6.5-dev.3 After changing the workspace drop-down to `HeaderMenu`, `.ws-select select` (4 places)
With `.user-email` (3 places), no elements can be selected anymore. in
`≤720px`’s `.ws-select select { flex:1; min-width:0 }` is exactly the one in §R1
Keeping the cause of "375px collapsed into 39px" will only mislead the next person.

### S7. Verification (Playwright actual measurement, not extrapolation)

`375 / 414 / 768 / 1024 / 1220 / 1440px` Six widths:

- ≤720px goes to the bottom column, ≥721px goes to the top column, and both will not exist at the same time.
- The bottom column is 54px, each cell is 45px (enough for touch targets), and all three cells pass the `elementFromPoint` hit test.
- **Copy the paging into 5 / 6 grids for actual measurement** (only 3 in native mode): each grid at 375px
  71px / 59px, both are single columns without wrapping; 414px is 79px / 65px.
- When scrolled to the bottom, the GitHub link is clickable, the badge is above the navigation bar and does not overlap with the floating button (320px does not overlap either).
- When zooming the window 1280 → 375 → 1280, the navigation bar is correctly transposed and **the current tab will not be reset**.
