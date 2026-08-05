# System Specification (SPEC.md)

- Agent: Gemini
- Timestamp: 2026-07-21 15:30:00 Asia/Taipei

---

## 🚀 Project Overview

**Stock PnL Web** is a set of individual stock holding and profit and loss management web applications designed specifically for Taiwanese and US stock investors. Supports multi-workspace switching, moving average cost calculation, historical realized profit and loss statistics, and unrealized profit and loss estimation of withholding taxes.

---

## 🛠️Technology Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS / Custom CSS
- **Backend / Database**: Supabase (PostgreSQL, Row Level Security, Edge Functions)
- **Deployment**: GitHub Pages (SPA static bundle) + Supabase Edge Functions
- **State & Storage**:
  - Local mode: LocalStorage (no need to log in, instant experience)
  - Cloud mode: Supabase Auth + Database (sync across devices)

---

## Core Business Logic

1. **Cost and Profit and Loss Calculation (PnL Calculation Engine)**:
   - Use Moving Average Cost.
   - Buy transaction: The buying fee is included in the total cost of holding shares.
   - Sell ​​transaction: Calculate the realized profit and loss of the current batch; in case of oversold condition, calculate it at 0 cost and display a warning.
   - Annual income: Remove the field sorting, add a third layer of transaction-by-transaction details (moving average cost caliber); add KPI transaction number and split of handling fees/transaction taxes, and change the handling fees in the annual form to display in two rows of fees and taxes.
   - Calculation and independent statistics of Taiwan stocks and US stocks.
2. **Fees & Taxes**:
   - Taiwan stock handling fees/securities taxes are unconditionally rounded to the nearest whole number.
   - ETF (starting with 00) securities tax is 0.1%, and general stocks are 0.3%.
   - Unrealized gains and losses on inventory are withheld for selling fees and securities taxes (estimated net value).
3. **Inventory Overview Aligned with Brokers**:
   - The inventory summary table only calculates the "unrealized net profit and loss" and "unrealized return rate" of the currently held positions (return rate = unrealized net profit and loss ÷ total cost of the current position).
   - The UI is always named after "Unrealized **Net** Profit and Loss" (v0.3.3), emphasizing that the figures have included transaction costs: including buying fees, and selling fees and securities taxes are withheld for Taiwan stocks; selling fees are not withheld for U.S. stocks. The description of the cost calculus is contained in the field "?" and the KPI title tooltip, and does not occupy additional space.
   - Historical settled profits and losses are displayed independently on the "Annual Revenue" page.

---

## 📑References

- Architecture and system design document: [system_design.md](file:///home/ivan/stock-pnl-web/docs/architecture/system_design.md)
- Database Schema: `sources/supabase/schema.sql` (moved here from `docs/database/` since v0.3.7-dev.1)
- Backend deployment and reporting JSON structure: `sources/supabase/README.md`

## UI Copywriting Guidelines (v0.3.4)
Description text on the screen (field `?`, tooltip, field-hint, empty state) **Readers are unfamiliar with stocks**, writing rules:
1. An explanation is 1–2 sentences, short and in plain language.
2. Instead of using formulas, talk about results in vernacular.
3. There is no need to use jargon such as "moving average cost method", "same caliber" and "pure spread".
4. Cut out minor provisos and cross-page cross-references, leaving only the information needed for immediate decision-making.
5. But it must be retained: whether fees have been accounted for, whether the data is delayed, and what the numbers cover.

This guideline does not apply to code comments - those are written for developers and subsequent agents.

- Version mark (from v0.3.3): The single source is `src/version.ts`, which is displayed in the fixed badge in the lower left corner of the screen. The badge only shows the version number itself (without the `v` prefix and without the author).
- The service status function has been completely removed in 0.3.8-dev.1 (including `serviceHealth.ts`).

---

## New modules: individual stock analysis page and after-hours chips (v0.3.7)

### Entry point and scope
- Only available in **Taiwan stocks**. **"Individual Stock Analysis" is an independent navigation page** (from 0.3.8-dev.1; previously it was a drill-down view from the stock overview).
  Use the drop-down menu to switch between individual stocks on the page. **The menu only lists Taiwan stocks held** - after-hours chips only cover listed Taiwan stocks.
  Putting U.S. stocks into the menu will only make you realize that there is nothing after choosing it. If there are no Taiwan stocks holding, it will show empty status.
- When Supabase (native mode) is not set, **the entire page is hidden** (the data source is Edge Function and cannot be read by this machine).
- The holding figures and the inventory overview share the same `buildHoldingRows` of `utils/holdingRows.ts`, and the two pages do not count as one copy each.
- `StockDetailPage` is a pure presentation component (which stock to look at and where the stock holdings come from are determined by the caller);
  The `selector` prop on the left side of the page is passed in from `AnalysisPage` to switch the drop-down menu of individual stocks.
- Five tabs: **Chips** (post-market information), **Technical** (substantial content starting from 0.5.0),
  **Fundamentals** (0.6.0-dev.4), **Quotes** (0.6.36, replacing the original "My Holdings"), **AI Interpretation** (0.6.0).
- The **Industry Badge** is displayed next to the title (0.6.0-dev.4, the data comes from the fundamental file, and is not displayed when there is none).

### Data responsibility boundaries
- **The server (Edge Function `stock-report`) only returns structured data**, `schema: 2`; does not generate any HTML.
  When the front-end reads `schema !== 2`, it will be regarded as a miss, and a fallback will be generated when the click is changed.
- The after-hours schedule generates a **shared** report (shared by the three major legal persons/margin and securities lending/securities lending market), **not including personal information**.
  0.6.36 From this page **No shareholding figures are displayed on the screen at all**; the shareholding context will still be generated immediately (`generateReport`)
  It is brought to the backend at the same time, and the drop-down menu originally lists the Taiwan stocks held, so the `buildHoldingRows` layer is calculated accordingly.
- The report embeds the `history` of the last **7 trading days** (oldest to newest). A maximum of 5 missing days can be captured in a single call.
  If it is insufficient, the picture will be produced as usual and "historical data is being replenished" in `notes[]`.

### Numeric caliber (must be marked on UI)
- **The unit of the three major legal persons is "share"**, and the unit of margin trading is "**pieces** (trading unit, 1 piece = 1,000 shares)". The two areas cannot be mixed and are marked separately.
- The buying and selling excess = buying − selling; the dealer's buying/selling is the sum of "self-trading" + "risk hedging", and the buying and selling excess is the official disclosed value.
- The total buying/selling of the three major legal persons is the sum of the five legs; the buying and selling exceeds the official disclosed value (non-summing).
- The "selling" of securities lending means **short selling**, and the "buying" means **covering**. The direction is opposite to financing, and the UI must be written out.
- Continuous buying and selling/continuous increasing and decreasing: counting the number of consecutive days with the same number from the latest day, **will be interrupted if it encounters 0 or there is no data on that day**.
- Borrowing bonds shows the "number of shares available for sale" (the amount that can be lent for sale), not the amount that has been sold.

### Daily review
- The three major legal person tables can be switched to view **any trading day** in the history (the latest by default), and the date button is listed next to the block title.
- "Continuous buying and selling" refers to the number of consecutive days up to the day being viewed, and does not always count only the latest day -
  Therefore, the front-end calculates based on history (`chipStreak.ts`) and does not use the server `report.streaks` (that only has the latest date).
  The behavior of this function must be consistent with the `computeStreak` of Edge Function, and both sides must be tested.

### chart
- **Self-drawn inline SVG, without introducing chart library** (`components/Charts/`). Reason: html2canvas can capture inline SVG, but PDF can retain its fidelity.
- **Color and font size are written as literal values ​​to SVG properties** (no CSS variables, no external style sheets) -
  html2canvas will serialize SVG into images, and the CSS variables and style sheet rules of the ancestor layer cannot be parsed.
- viewBox width = measured container width (1:1 drawing), the font level is fixed in any view window width.
- There is a big gap in the magnitude of the balance between financing and securities lending, **each has an independent vertical axis** and is drawn into two graphs; on days when data is lacking, the line is disconnected and no interpolation is performed**.
- **Color only does one thing at a time**:
  - Single sequence → Color expresses **polarity** (Taiwan stocks convention is red, green, and negative).
  - Multiple sequences side by side → Color expresses **identity** (one category color for each legal person), and positive and negative are expressed by the direction of the bar above and below the zero axis.
  - The two cannot be stacked on the same set of marks. Category colors are taken from the fixed order of `chartColors.ts`, **assigned in order without looping**,
    And it must be a group that passes both the shallow and deep checks (a single group of literal values ​​must serve both themes and PDF at the same time).
- **Two or more sequences must be accompanied by a legend** (identification cannot be based solely on color). The legend text uses normal text color and does not use sequence color. The color is borne by the color block.
- **The total is not side by side with its components**: The total of the three legal persons = the sum of the four legal persons. Drawing them together equals the same amount being counted twice.

### Information source indication
- The header (`.rpt-head`) of the chip report must indicate **code/name, data date, report update time**,
  And **put it within the PDF extraction range** - the downloaded PDF must be able to tell which stock, which trading day and when it was produced.
- The "data date" is after the closing of the latest trading day (to which day the data is covered), and the "report update time" is the time when this report was actually generated.
  (After-hours schedule or immediate production). The difference is that the report may not be generated until the day after the data date. Times are displayed in the viewer's time zone.
- The header (`.detail-head`) does not repeat this information - they are properties of the chip report, not the entire analysis page.

### PDF
- The front-end `html2canvas` + `jsPDF` is dynamically loaded (without entering the main bundle), and the server does not store PDF.
- Dynamically mount/remove `.report-surface` before and after capturing (overwrite the design token to light color), **dark themes also output light-colored files**.
- "Download PDF" only appears in the chip tab. **Note: There is substantial technical content starting from 0.5.0.
  But PDF still only covers chip paging** - it has not been decided whether to expand it to technical aspects, it is not an oversight.

---

## Technical (0.5.0)

### Data sources and storage
- Daily OHLCV comes from **Yahoo Finance chart endpoint** (`interval=1d&range=1y`, measured back to 244 trading days).
  Fetched incidentally from the existing post-market batch `generate-all`, **not an independent Edge Function**.
- **`daily/{ticker}.json` stored in the public `reports` bucket, overwritten in full every night** (measured 10.8KB/file).
  The `price_daily` data table is intentionally not created: there is no retention issue with overwriting, and no need to prune.
- The front-end **directly downloads Storage** without going through Edge Function (for quota consideration, see PROGRESS 0.3.9).
- **No instant fallback**: The technical side only serves the individual stock analysis page, and this page only lists the user’s Taiwan stock holdings.
  That’s exactly what the nightly batch covers. When no files are found, an empty status of "It will be automatically added later" is displayed.

### Numeric caliber (must be marked on UI)
- **Use the original closing price and do not restore ex-rights and dividends**. This is the moving average convention of Taiwan stock market reading software. Switching to the reduction price will be different from the
  The moving averages that users see on the brokerage app do not match up; the gap on the day of ex-dividend is a real fact, and the UI is not modified.
- Comparison of terminology for Taiwan stocks: ** Weekly line = MA5, monthly line = MA20, quarterly line = MA60**, the two versions are presented together in the legend.
- Trading volume is presented in "**tickets**" (1 tick = 1,000 shares), which is consistent with the market-reading software.
- KD adopts the usual formula (9,3,3) for Taiwanese stocks, and the initial value of K/D is 50; when the highest value in n days is equal to the lowest value, RSV takes 50
  (A denominator of zero cannot be treated as 0 or 100, as that would create an oversold/overbought signal out of thin air).
- The MACD column adopts the international convention of DIF − DEA, which is not multiplied by 2.

### Calculation rules (three, violation of any one will produce lines that appear reasonable but are wrong)
1. **Indicators are always calculated based on the complete sequence before cropping the display range**. If you cut it first and calculate it later, "nearly 3 months" (60 pieces)
   The MA60 will only have a value on the last bar, and the KD recursion will start again from the initial value.
2. **Output and input are of equal length**, the early part with insufficient warm-up period is `null`, and the chart will be disconnected accordingly and will not be interpolated.
3. **null should not be treated as 0**, and the recursive state will not be updated if it encounters null - treating the missing value as 0 will cause the moving average to collapse to close to zero instantly.

### chart
- Three daily K + MA5/20/60 overlay charts, trading volume, and KD (with 20/80 reference line attached), following the existing self-drawn SVG system.
- The candle's red rise and green fall are determined by "**Closing vs. Opening**" (consistent with the solid/empty logic of the market-reading software),
  Not compared to the previous one. Moving averages use category colors (identity codes) - colors can only do one thing at a time.
- The X-axis labels are sparsely labeled with `labelIndices` (it is impossible to label every 244 labels in a year), and the hit area is still established point by point.

---

## Fundamentals (0.6.0-dev.4)

The "**Fundamentals**" page of the individual stock analysis page, the data comes from `fundamental/{ticker}.json` which is pre-produced in batches after the market opens.
(Storage is read directly, and there is no fallback at the click of a button. The reason is the same as the technical aspect).

- **Three valuation indicators**: Price to earnings ratio / Yield rate (%) / Stock price to net value ratio, source TWSE OpenAPI `BWIBBU_ALL` (daily).
  The price-to-earnings ratio of a loss-making company is `—` (not passed off as 0).
- **Monthly revenue**: current month’s revenue (**unit: thousand yuan**), monthly growth %, annual growth %, cumulative annual growth %,
  Source `t187ap05_L` (monthly). The archives have been accumulated for up to 12 months and are presented from newest to oldest.
  0.6.4 The missing months will be filled in by the monthly report `t21sc03` of the Public Information Observation Station, so you don’t have to wait another year for it to be full**;
  Backfill only fills the gap and does not overwrite the existing value (the existing value is the corrected number).
- **Industry Category**: The Chinese industry name of `t187ap05_L` is given priority, and `t187ap03_L` is returned to the code lookup table. The badge that appears next to the page title.
- **Profitability** (0.6.5): gross profit margin / operating profit rate / pre-tax net profit rate / after-tax net profit rate (**unit: %**),
  Source `t187ap17_L` (listed company profit analysis query summary table, the ratio is calculated by the stock exchange).
  Only the latest season is returned, so the sequence is accumulated season by season, up to 8 seasons, and no historical backfilling is performed.
- **Partial support for OTC stocks** (from 0.6.4): The three OpenAPIs only cover listings, but `t21sc03` also has an OTC version,
  Therefore, OTC stocks have monthly revenue, no valuation and industry classification. The batch will still be written and attached with `notes`:
  When there is no complete search, it is explained that "ETFs and listed targets are not included in the three TWSE information."
  When there is revenue but no valuation, state separately that "the valuation only covers listings."
  Accordingly, the UI displays "not supported yet" instead of "will be added later" - the two are different messages and cannot be confused.

A complete description of the sources and batch behavior can be found in `sources/supabase/README.md`, and the design rationale can be found in `PLAN.md §N`.

## After-hours batch scheduling (0.6.1)

`generate-all` is triggered by pg_cron, **every 15 minutes from 16:00–23:45 on each trading day** (Taipei, 32 rounds in total).
0.6.1 Previously, there were three fixed shifts (17:30/22:30/23:30).

### `market-daily` runs on its own clock (0.6.28, moved earlier in 0.6.38)

Market-wide volume and the institutional **amounts** (BFI82U) are not part of `generate-all` —— they have nothing to do
with the holdings list and must not be short-circuited by it. Since 0.6.38 the schedule is
**`0,30 7-10 * * 1-5` (UTC) = Taipei 15:00–18:30 every half hour**, previously 16:00 / 17:00 / 18:00.

- **Why it can start at 15:00**: TWSE announces BFI82U around 15:00–15:30. The old fear was that an early round
  would be "a wasted trip", but `syncMarket` compares a content signature and, when nothing changed, returns
  `synced: false` **without touching `asOf`** —— an early miss writes nothing and leaves no false "arrived" mark on
  the admin timeline. It costs 2 GETs.
- ⚠️ **An early round depends on FMTQIK too**: today's institutional amount is only fetched when today's date is
  already in the merged day list, and that list comes from FMTQIK. 15:00 wins only when **both** have published.
  `market/daily.json`'s `asOf` tells you which round actually won.
- `dueBy` for the 全市場 row on the timeline stays 3 hours: the last round is still within it, and tightening it
  before the real availability time is measured would just light a red lamp every day.

### Why change to polling

The time point for Class 3 was set based on "the approximate time each data source will be announced", and that understanding is wrong——
2026-07-27 The actual measurement overturned three points in one day (the time window of T86 is confused with BFI82U,
The coupon was available at 17:07, and the semantic meaning of the TWT96U we caught was also wrong).
**The guesses on the clock will expire, "catching the same thing twice in a row" will not. ** Therefore, it is changed to intensive polling + content judgment.

### Three gates (pure logic is concentrated in `pollPlan.ts`, each one has tests)

| Gate | Rules | What happens without it |
|---|---|---|
| Short circuit | Today's T86 has arrived** and has been finalized**, and today's margin trading has arrived → No external requests will be issued in this round | All 32 rounds will be really caught |
| T86 Rewriting Detection | Re-capture and compare fingerprints in each round before finalizing, and freeze only if the content is the same 2 times in a row | Catching early will lock the 16:00 first version as the answer for the day, which is worse than catching late |
| Execution upper limit for the day | `MAX_RUNS_PER_DAY = 40` (cron is only ranked 32 and cannot be touched normally) | There is an error in the judgment logic or there is no brake when `CRON_SECRET` is outflow |

Short-circuit conditions **must include margin trading**: If you just look at T86 and call it a day, it will stop at 17:00.
Margin lending that is posted only around 21:00 that day will never be caught.

### heavy production gate

The fingerprint entered in the report (data date + T86 content + margin trading data date + bond borrowing data date + shareholding list) will not change if it does not change.
The purpose is not to save space, but to make the "update time" of the report only jump when there is a real change——
Otherwise, 32 rounds will wash out the signal of "when did it change". The holding list is also an input: when adding a new stock, it is not included in the old report.

### Data source probe (0.6.3)

`source_probe_log` answers only one question: **"When was this source actually updated?"**

**Why `batch_run_log` cannot answer**: `bwibbu_date` remembers the **fast value**.
`readLatest` uses "the day we went to catch" as the cache key, and after the first round of catching that day, we will eat the cache all day long——
2026-07-27 Those 12 rounds are all recorded as the same `1150724`, **that is not 12 observations, but the same one that was read 12 times**;
A short circuit in batch 1 is completely ignored. Using it to judge the release time will lead to false answers.
And "guessing the release time with fake answers" is the reason for the 0.6.1 rework.

- **Independent path** (`action: 'probe'` + exclusive cron job). Deliberately not writing cache, not writing Storage,
  Does not touch any state of the batch - the three gates of 0.6.1 (including "short circuit = zero external requests") are therefore still provable.
- **Only two are explored**: `BWIBBU_ALL` (valuation, daily) and borrowing bond `TWT96U`.
  They are currently the only two sources of "if you have a cache, don't look at it all day". T86 and margin trading have been
  `t86_revisions` / `margin_today` is recorded truthfully; monthly revenue and company information are updated monthly, so there is no point in exploring it.
- **Fingerprints are always sorted first and then calculated** (`rowsFingerprint`) - TWSE endpoint does not guarantee stable column order (lesson from 0.6.2).
- Authorization also goes through `CRON_SECRET`: it will send a request to TWSE. Exposing the endpoint undefended is equivalent to giving away a proxy tool.
- Cost is approximately 11.5MB/day. After getting the answer, `SELECT cron.unschedule('source-probe');` can be stopped.
  No need to redeploy.

### Front-end re-catch timing (0.6.2)

The direct consequence of polling is that the report will be updated while the user is watching it. The individual stock analysis page was originally only captured once when the page was opened.
If the paging is turned on, it will always stop at the snapshot when the page is opened (actual encounter: the batch at 20:15 has written out the chips for the day,
20:15 The tab opened before still displays the previous trading day).

- Triggered when: `visibilitychange` and `visibilityState === 'visible'`. Sharing the same convention as the current price,
  **Do not open another timer** - the timer for background paging will be throttled by the browser, and switching back to the foreground is the time when you want to read the data.
- Replacement condition: **`generatedAt` is different from `setReport`**. If the state does not change, the state will remain unchanged.
  Otherwise, it will be redrawn every time you switch back to the foreground, and the scroll position and expanded state will be washed away.
- When there is no report (or the file is produced by clicking on it), the existing copy on the screen will be retained and will not be cleared.
- Known limitation: Does not trigger when user never switches tabs. To cover this situation, a timer must be added.
  The price is throttling and extra requests for background paging, which is currently not worth it.

### Observation(`batch_run_log`)

TWSE's openapi and rwd endpoints are all `Cache-Control: no-cache`, **do not give `Last-Modified` / `ETag`**
(Tested on 2026-07-27). So I can’t remember “what time it was put on the shelves.” All I can remember is “what day it said it was when we went to see it.”
One column is recorded for each round, including the data date of each report, the number of T86 rewrites and the finalization time, whether there is a short circuit and the reason for the short circuit.
This is the only factual basis for any future "whether to adjust the polling window" - stop making decisions based on impressions.

---

## AI Assistant (0.6.0)

### Entry point and premise

The fifth tab of the individual stock analysis page is labeled "**AI Interpretation**". Three premises:

1. **Only appears in Supabase mode** (the entire stock analysis page is originally) - the settings exist in `app_settings`, and there is nowhere to save them in native mode.
2. **You need to apply the `app_settings` global single list of `sources/supabase/schema.sql` §4.1** first (from 0.6.0-dev.2;
   dev.1 was once placed in the fifth column of `user_settings.ai_*`, and it will be cleared easily by re-running the schema).
3. **User brings his or her own AI provider**: The project does not have any built-in keys and does not pay any fees.

### Set scope and permissions (0.6.0-dev.2)

AI is set to **shared by the whole site**: regardless of account or workspace, all login accounts read the same copy (the front-end is directly connected to the supplier,
The key has to be entered into the browser, so it is an architectural necessity that everyone can read it). **Write to Admins Only** - RLS checks for JWT's
`app_metadata.role = 'admin'`; tag is set by Dashboard/SQL (see schema.sql §4.1 comment for syntax),
After posting the tag, the account will not take effect until you log in again. The UI for non-administrators does not have a configuration form and only sees a read-only summary.
(provider/model, key is not displayed) and "Only administrators can modify" prompt; when not set, "Please contact administrator" is displayed.

### product red line

**Does not actively generate AI text. ** When the supplier is not set, the page only has the setting form; after the setting is completed, the user also needs to click
The model will be called only when "Generate Interpretation". There will be no AI-generated content in the chips and technical pages.

### Output structure with recommended bounds (0.6.0-dev.3)

The output is fixed to "3-5 paragraphs of data interpretation + "Recommended actions" + two sections of "Precautions" + disclaimer".
"Recommended operations" are limited to neutral and conditional observational references** (such as "if it falls below the monthly line, pay attention to whether the support is held"),
prompt is expressly prohibited from giving clear buy/sell/add/clear orders, target prices, entry and exit prices or reward expectations;
"Notes" must point out the visible risk signals and data limitations of the data. Ending disclaimer text is fixed and has test lock.
(Before dev.2, any operation suggestions were completely prohibited; starting from dev.3, it will be relaxed to the above conditional reference, subject to the user’s decision.)

### User operation framework (0.6.9-dev.2)

system prompt brings in the four batched entry and exit frameworks adopted by the user, allowing the model to have a common vocabulary in "recommended actions"
It can describe "which situation the current data falls in": **Pyramid position** (increased 10→20→30→50% for declines),
**Inverted pyramid stop profit** (sell in batches when rising 10→20→30→40→100%), **non-equidistant grid**, **Martinale variant**.

**This is not a relaxation of the boundaries of advice. ** Criterion 10 clearly states “This does not relax Criterion 5”——
The model is still not allowed to specify the increase/decrease ratio, the price, or say "it is time to buy/it is time to sell";
The percentages in the framework are only examples illustrating the method and should not be taken as specific instructions for this document.

**Martingale labels the premise alone, not in conjunction with the other three. ** Pyramid/Inverted Pyramid/Grid are all
**Position management with a cap**, while Martingale is by definition unlimited (doubled after losses).
Its statement that "all the losses can be solved with just one rebound" is based on the fact that "the target does not return to zero and the funds are unlimited."
Neither is true for a real account, and the funds required grow exponentially when there is a continuous decline.
prompt forces the model to state this premise every time it is mentioned, otherwise it will read like a sure-fire way to make money.

Guideline 11 also requires that whenever batch overweighting/flattening/left-hand trading is mentioned, "notes" must be pointed out
**Flattening will enlarge the position and does not mean reducing the risk**.

The above words are all tested and locked (`aiPayload.test.ts`).

### Output upper limit (0.6.9-dev.5)

**Both paths must explicitly send the output cap. ** Google always delivers
（`maxOutputTokens: GOOGLE_MAX_OUTPUT_TOKENS = 8192`），
OpenAI compatibility was not provided at all originally - it uses endpoint default values, and many endpoint defaults only have a few hundred tokens.
The output will be cut off in the middle by `finish_reason: length`, leaving only the first one or two paragraphs plus a line of "unfinished" on the screen.
`OPENAI_MAX_TOKENS` takes the same 8192: the output requires about 1500–2500 tokens, leaving enough margin;
This is the upper limit, not the reservation amount, and increasing it will not increase actual usage or costs.

### Processing of inferential models (0.6.9-dev.4)

**This job does not require reasoning**: the numbers are all calculated by the program, and the model is only responsible for writing them down in vernacular.
The inferential model will spend the output quota on thinking, without writing a word in the text - the user has actually encountered it.

Three treatments, from front to back:

1. **Ask to turn off thinking when requesting. ** Google has been doing this for a long time (`thinkingConfig.thinkingBudget: 0`);
   0.6.9-Starting from dev.4, OpenAI compatible endpoints are also included. Because there is no switch that can be used across different families, all three are included together.
   Take what you need from each endpoint: `reasoning_effort: 'none'` (OpenAI o series and most compatible endpoints),
   `think: false`（Ollama）、`chat_template_kwargs.enable_thinking: false`
   (Qwen3 on vLLM/SGLang, etc.).
   If the endpoint does not recognize it and returns **400, it will return to the minimum set and resend it once** (the same mode as Google, only try once).
   What is returned is the entire set of compatibility fields (including `max_tokens`) instead of trying one by one -
   400 I won't tell you which column is different. Trying one by one means you have to play several rounds.
2. **`content` is sandwiched with `<think>…</think>`, so peel it off**, leaving only the main text.
   Some endpoints do not split thinking into independent columns. If not, a large section of self-talk will first appear on the screen.
3. **When you can't turn it off and you can only think about the content, use it instead but force a warning** to avoid total failure.
   The warning (`REASONING_FALLBACK_NOTICE`) clearly states that "this is a thinking process, not a formal conclusion",
   "Numbers and judgments may be what it later negates" - **This sentence cannot be omitted or downplayed**,
   Thinking is a draft of derivation, and reading it as a formal analysis will be misleading. It is a pitfall that users have actually stepped on.

### Supported vendors

| Settings | Object | Authentication |
| ---- | ---- | ---- |
| `google` | Google AI (Gemini) | `x-goog-api-key` |
| `openai-compatible` | Ollama / vLLM / any OpenAI compatible endpoint | `Authorization: Bearer` (optional, no need to fill in for native Ollama) |

`baseUrl` can be filled in with `http://host:11434` or `http://host:11434/v1`, and the program will be normalized.

### Information fed to the model (the caliber must be indicated)

- **Technical**: `TechnicalView.latest` Calculated indicators - closing / opening high and low, up and down,
  MA5 (weekly line)/MA20 (monthly line)/MA60 (quarterly line), moving average arrangement, K / D, RSI14, MACD column,
  The volume-to-energy ratio (how many times the 20-day average volume), the highest and lowest closing price in the past year. **Does not include any original closing price series. **
- **Chips**: The buying/selling/trading excess of each of the three major legal persons (**unit: number of shares**),
  Today's balance of financing and securities lending compared with the previous day (**Unit: Zhang**), number of consecutive days, sequence of the last 7 trading days, and report notes.
- **Fundamentals** (0.6.0-dev.4): Industry, three valuation indicators, monthly revenue in the past 12 months (**Unit: thousand yuan**, including monthly growth and annual growth %).
- **Excluding shareholdings, costs, unrealized gains and losses. **
- When the fundamentals are short of information, the user prompt prints alternative text ("Please do not speculate on any fundamental data").
  The interpretation function operates as usual and is not blocked.

> **The entire news page was removed on 0.6.29** (Google News RSS, `news/{ticker}.json`, and prompt paragraphs were all deleted).
> What was removed in 0.6.13 was only the news tracking in the management background. The function itself was still there - this time the function was removed together.

There are three things that must be clearly marked when feeding the model, otherwise the model will make mistakes:

1. **Increase and decrease**: `changePct` The original value is a decimal ratio (0.0148), and the payload field is
   `changePctPercent` has been multiplied by 100, otherwise the model will tell a change that is 100 times smaller.
2. **The positive and negative sign of the number of consecutive days**: positive = continuous buying/continuous increase, negative = continuous selling/continuous decrease. The payload is attached with `streakNote` description,
   Otherwise `-3` will be read as "-3 days added".
3. **Two types of units coexist**: the three major legal persons are shares, and margin trading and securities lending are Zhang. prompt explicitly states that the model cannot be converted by itself.

### Output length and truncation (0.6.0-dev.6)

Google's `maxOutputTokens` is `GOOGLE_MAX_OUTPUT_TOKENS = 8192`, and ends with
`thinkingConfig.thinkingBudget: 0` turns off thinking. **Reason: Thinking tokens are included starting from Gemini 2.5
`maxOutputTokens`**, the original 1200 was almost eaten up by thinking, and the text was truncated after writing only one sentence (actually tested).
If the model does not accept `thinkingConfig` (HTTP 400), it will automatically remove this field and resend it——
The support level is not estimated based on the model name, because the control fields of each generation are different and will change again.
(This does not violate "no automatic retry": that prohibits re-running failed attempts for the user to avoid repeated billing.
Here is the parameter negotiation for the same request, and it is only tried once. )

**Truncation must always be visible to the user. ** `finishReason` (Google) and `finish_reason`
(OpenAI compatible, including ollama's `num_predict`) Both check:
Contains content but truncated → keep text and append `TRUNCATION_NOTICE`;
No text at all (thinking about eating up the quota) → Throw `bad-response` and indicate the reason in the message.
Never return half text as a complete result.

### failure behavior

180 seconds timeout (as of 0.6.0-dev.2, relaxed from 30 seconds to support native local model; **includes reading response body**,
Not only the connection stage; the values ​​​​are concentrated in `AI_TIMEOUT_MS` of `aiClient.ts`, and the UI words are derived from it); errors are divided into
auth / rate-limit / server / timeout / network / bad-response six categories and each gives vernacular messages;
**No automatic retry**, only a "Retry" button is provided (AI calls require payment, and silent retry is equivalent to asking the user to pay twice).

### What the UI must explain

The result area always has a disclaimer, and clearly states that "AI may still give wrong numbers, please refer back to the technical and chip pages for important numbers"——
Model output cannot be guaranteed by testing, this sentence is the only line of defense.

---

## Data crawl status page (0.6.12, admin only)

The top-level page "Crawling Status" is only visible to accounts with `app_metadata.role === 'admin'`.
The data comes from the `admin-status` (read-only summary) of Edge Function and is not collected by the front-ends individually.

### Why use Edge Function instead of front-end direct reading?

The schedule (`cron` schema) and observation table (`batch_run_log` / `source_probe_log`) front ends do not have permissions:
The former is not in PostgREST's exposed schemas, and the latter has RLS enabled but deliberately does not have any policy.
It is not cost-effective to loosen those defense lines for a read-only backend, so the service role reads the data in the backend and then spits it out.
Measured aggregation takes about 0.9–1.2 seconds.

### Authorization (three layers, all are indispensable)

| Layers | Mechanisms |
| ---- | ---- |
| Paginated display | `ADMIN_ONLY_TABS`, **Only interface organization, not security boundaries** |
| API | `assertAdmin()` validates user JWT and `app_metadata.role === 'admin'` |
| RPC | `admin_schedule_status()` only `GRANT` to service_role |

- **Unavailable CRON_SECRET check**: That key cannot enter the front end (if it enters, it means it is public, and anyone can trigger the entire batch of crawling). Actual measurement: CRON_SECRET returns 401 when calling `admin-status`.
- **Unavailable email comparison**: email users can change it themselves; `app_metadata` can only be written in service role / Dashboard. The criterion must be consistent with `isAiAdmin()` of `aiSettings.ts`.
- ⚠️ **`cron.job.command` contains `x-cron-secret` plain text**, the SQL function only selects jobname / schedule / active / action / target ref, and ** must not return the full text of the command ** (see `schema.sql` §11 for details).

### Decision rules

**The benchmark is "the first batch after the end of the announcement window", not the source announcement time. **
The three major legal persons were announced between 15:00 and 15:30, and the batch was caught at 16:15. Based on the announcement time, it will become "45 minutes late"——
However, the after-hours batch originally started at 16:00, which is due to the schedule design and not an abnormality; on the contrary, the ticket borrowing night was running for 32 rounds but no one was caught.
Just make up for it the next day, then turn on the light. Same origin as BUG-008: use the external release schedule as the benchmark,
You will only get a yellow light that is always on, and an alarm that is always on means no alarm.

- Didn’t get it and **not arrived** `dueBy` → `idle` (waiting), not late. There is a regular gap every evening.
- The monthly frequency indicator's lagging determination is compared with other indicators in the same group, without checking the release calendar (which is a constant table that will inevitably expire).
- Determination and coordinate calculation are all in `src/components/Admin/timeline.ts` (pure function, 29 tests).

### Layout

Timeline (15:00 on the current day → 10:00 on the next day) → Schedule → Total menstrual period → Exchange rate and file coverage.
The total period of the monthly frequency is not placed on the daily axis: its rhythm is "which period arrives" rather than "what time it arrives".

## General Economy Page (0.6.5)

**Top-level page** "General Economy" (from 0.6.5-dev.2; dev.1 was once a page for individual stock analysis),
The data comes from `macro/us.json` (**global single file, not per-ticker**).

| Indicators | Source Series (FRED) | Presentation |
| ---- | ---- | ---- |
| Core CPI | `CPILFESL` | Annual % growth |
| Core PPI | `PPIFES` | Annual % growth |
| Core PCE | `PCEPILFE` | Annual % growth |
| Non-agricultural employment | `PAYEMS` | Increase or decrease from the previous month (thousands of people) |
| Consumer Confidence | `UMCSENT` | Index Value |

- **This page has nothing to do with individual stocks**, so it is a top-level page rather than a pagination for individual stock analysis (`PLAN.md §Q5`).
- "Core" only has standard definitions for CPI / PPI / PCE; the monthly increase in the number of non-agricultural buyers,
  Consumer confidence is combined with the CCI into the UM Index (see `PLAN.md §Q4` for the rationale).
- **Triggered by an independent `macro-daily` cron job** (two shifts per day 13:00 / 15:00 UTC, non-Taiwan stock schedules),
  Trends in the last 12 periods.
- **The idempotent key is the content fingerprint, not the date** (from 0.6.11, fixes BUG-008). Really ask FRED every class,
  Compare `macroFingerprint` (covering the entire points, because FRED will go back and correct the historical values),
  The file is rewritten only when the content has changed. Using the date as a key will cause the success of the first shift to silence the second shift -
  Monthly data often enters FRED after the first shift, and in winter it is even released after 13:00.
- **The file has two time fields with different semantics**: `asOf` is the last change time of the data (it will not move if there is no new data.
  Monthly data only jumps once a month, which is normal); `checkedAt` is the last time FRED was asked (updated every shift).
  The screen will only display "(last check...)" when the two dates are different - the display on the same day will only repeat `asOf`.
  **To check the health of the schedule, look at `checkedAt`, and to check whether the data is old or new, look at `asOf`. **
- **This page is not displayed in local mode**: The data source requires Supabase, which has the same entry rule as "Individual Stock Analysis".

## Fundamental monthly revenue trend chart (0.6.8)

Monthly revenue is in the **Fundamentals** page (not technical), and a `LineSeriesChart` is added above the table.

- **The graph uses `revenueMonths` (from old to new), and the table uses `months` (from new to old) after reversed. **
  If you take the wrong one, the entire line will be reversed, and it will look real (the trend is completely opposite).
  This is the least likely error to detect - the direction has been pinned directly using the y-coordinate test.
- The X-axis label uses `2026/06` instead of "June 2026": the latter is about 100px wide at an 11px font size.
  And 12 months is only about 39px per square. **The year cannot be omitted**, and the two spaces crossing the New Year will not be able to tell which year it is.
  12 Mark one label every other month (6 labels, spacing about 78px); mark all labels if less than 8 months.
- 12 points ≤ `DOT_LIMIT`, so the circle is drawn point by point; months with missing revenue will not be interpolated.
- The copywriter should remind ** that monthly revenue is seasonal**. To determine the direction, please look at the annual growth rate in the table——
  Highs and lows in absolute amounts do not necessarily represent operating changes.

## Individual Stock Analysis: Single Long Page (0.6.8)

The number of paginations has been reduced from 5 to **2**: "Analysis Content" and "AI Analysis".
The analysis content is from one page to the end, and the order is fixed as **Quotation → Chip → Fundamental → Technical** (specified by the user;
0.6.36 The first paragraph above is "My shareholdings").

Adopt **card grouping** (bill version D): one `.glass .detail-card` for each section, with the boundaries defined by the white space between cards.
I chose it because there is zero interaction and there is no problem of "things being put away and cannot be found".
The group title `.card-head h3` is 16px, which is deliberately one level higher than the `.rpt-section h3` (14px) in the paragraph ——
There are 14 titles on the same page, all at the same level, which means there is no hierarchy.

**AI analysis is not integrated: it has an API Key input box and dialog state, and the content is triggered by buttons and is not always there.

### PDF retrieval scope and personal information (modified in 0.6.36)

`surfaceRef` **encloses all four segments**, the exported file = the content seen on the screen.
0.6.35 In the past, the first section was for shareholding, which relied on "ranking outside `surfaceRef`" to block the inflow and outflow of individual capital;
0.6.36 The card was replaced with a quotation (open market data), and the number of holdings did not appear on the screen at all**. ——
The test pins are also changed to the latter (`captured.textContent` must not contain unrealized profits and losses and "shareholding overview").
The file name prefix was also changed from "After-hours chips-" to "Individual stock analysis-".

**Change the capture magnification to automatically adjust based on the content area (`pdfScaleFor`):
iOS Safari has a hard upper limit of about 16.7M px² for a single canvas. If it exceeds it, it will fail silently.
(`toDataURL` returns blank, the user only sees "PDF generation failed").
The actual measured capture range after merging is 1140×3885 CSS px, and under scale 2 it is **17.7M px²**, which is just over.
Now it will automatically drop to just within 16M (measured scale 1.901), with a lower limit of 1 to maintain readable text.

### Chart focus changed to roving tabindex

`ChartFrame` originally created `<rect tabIndex={0}>` **point by point**, and the number of days and days in a year is 244 invisible ones.
tab stop; after merging four paragraphs into one page, the maximum number of pages on the same page is 765. Change to **The whole picture is one tab stop**
(`<svg tabIndex={0} role="group">`), after focusing, use the left and right arrow keys to move point by point, Home / End to jump to the beginning and the end, and Esc to cancel.
The measured number of tabs on the entire page has been reduced from 213 to 765 to **24**.

### Tried but discarded: technical delayed loading

Use `IntersectionObserver` to let the technical aspects roll in before loading, and then remove them after measuring:
At the moment of mounting, the chips and fundamentals are still loading, each has only one spinner, and the entire page is less than 500px high.
The technical side is already in the window, and the observer immediately determines that it is visible and loads it anyway.
To make it really delayed, you have to reserve a false height of one or two thousand pixels in the upper two sections. That's just guessing;
What is actually saved is only a Storage request of about 17KB
(The session quota of `warmStock` has long been used by the fundamental path).
**It's not worth changing to a mechanism that "claims to be delayed but actually loads every time". **

### Correction by the way

The redraw of `visibilitychange` originally only covered chips. After merging into one page, "Only the chips will update themselves"
From invisible to visible asymmetry (on the same picture, the chips jumped to today, but the monthly revenue stayed at yesterday),
Therefore, compare the fundamental `asOf` together.

---

## Quotation card and Taiwan stock price grabbing period (0.6.36)

### The card is called 行情 since 0.6.38, and carries the indicator summary

The first section of the individual-stock page holds two blocks under one title:

1. the seven quote cells below (live, from MIS);
2. **指標摘要（{data date}）** —— moving averages, KD, RSI(14), MACD histogram and the volume ratio,
   moved here from the technical section.

What the merge removed are the summary's 收盤 / 開高低 / 成交量 cells: the quote grid already shows them and shows
them live. ⚠️ **The two blocks can describe different days and that is correct** —— the quote is real time, the
summary comes from the after-hours daily batch (`daily/{ticker}.json`), which only lands in the evening. During the
session the summary still describes the previous trading day, which is why it keeps its own date in the heading.

`daily/{ticker}.json` is therefore loaded by `StockDetailPage` (`useDailySeries`) and passed down, instead of being
fetched inside the technical section: two sections need the same file and it must only be downloaded once.
`latest` is derived from the full series, so the range picker on the chart does not move it.

### Quotation card (first paragraph of individual stock analysis)

Seven grids: **opening, highest, trading volume, yesterday's closing, lowest, estimated, today's closing** (the order is specified by the user).
All from the same TWSE MIS response** (`o/h/l/v/y/z/d/t/ip`) that the current price would have returned, with zero additional requests.

- **Today's close/deal**: When `t >= 13:30:00`, the box is called "today's close" (the closing value), otherwise it is called "deal".
  There is no intraday closing price yet, so using the same word will be misunderstood. The coloring benchmark is yesterday's closing (red up, green down).
- **Estimation**: Only `ip === '1'` (trial pinch) is displayed, and "—" is displayed for the rest.
  The trial period is 08:30–09:00 and 13:25–13:30.
- The unit of **Trading Volume** is **tickets**. Yahoo's backup path returns the number of shares, which is divided by 1000 before being written in.
  Both paths must be of the same diameter. `0` sheets (no transaction yet) and `null` (cannot be obtained) are shown as `0` and `—` respectively on the screen.
- The right side of the card title is marked with "Transaction Date·Status·Matching Time", and "·Cache" is added to the cache price.

⚠️ **Today’s closing deliberately does not use the daily closing endpoint of TWSE OpenAPI** (`STOCK_DAY_AVG_ALL` / `STOCK_DAY_ALL`).
2026-08-05 15:23 According to actual measurement (two hours after the market close), the `Date` of both endpoints is still `1150804` (the previous trading day).
2330 Return to `ClosingPrice` 2320 - that was actually yesterday's closing price. The real closing price that day was MIS's 2405, a difference of 3.6%.
Using it as "today's closing" will display yesterday's closing and today's closing, and it will be locked all night.

### Taiwan stocks no longer price-catch after closing

`supabase/functions/stock-price/quoteWindow.ts` 的 `twQuoteTtlMs(now, tradeTime?)`
It is a pure function shared by **front-end and Edge Function** (front-end cross-directory import follows the existing pattern of `misParse.ts`):

| Taipei Time | Matching time `t` reported by the source | Taiwan Stock Quote TTL |
| ---- | ---- | ---- |
| 08:25–13:30 (Trial and Intraday) | any | 60 seconds |
| Outside that window | `t` ≥ `13:30:00` (confirmed close) | to 08:25 of the next day |
| Outside that window | `t` missing or earlier than 13:30 | 60 seconds (keep retrying) |

- **No status, no transaction calendar check**: only look at Taipei clock (fixed +8). On weekends and national holidays until 13:30
  It will naturally fall into the long TTL; if it is lifted at 08:25 the next day, if the market is closed that day, it will fall again at 13:30.
- **Only a confirmed close gets locked (0.6.37)**: the clock alone is not enough. "It is past 13:30, so no new price will
  arrive today" holds for the **price**, but not for "is this row the settled closing value". A row without `t` is an
  intraday snapshot — either written before the 0.6.36 upgrade, or from a fallback path that has no such field
  (Yahoo / TWSE OpenAPI). Locking it freezes that snapshot until 08:25 the next morning, and the quote card then shows
  "盤中" with open/high/low/volume all "—" all night. This happened in production on 2026-08-05.
  The cost of the fix is that a source which keeps returning non-final values keeps the 60-second retry going overnight —
  that is an abnormal state and should keep retrying. There is **no 14:00 grace deadline any more** (0.6.36 had one).
- **Both layers must be applied**: front-end `priceProxy.cacheTtlMs` and Edge's `price_cache` judgment.
  If you only change the front-end, Edge will still issue MIS when other devices or caches expire.
- **The coarse filter needs its own upper bound**: `freshAfter` on the Edge side does not know each row's `trade_time`,
  so it cannot call `twQuoteTtlMs(now)` — that returns the short TTL (no matching time given) and filters out yesterday's
  settled close, making the app fetch all night for nothing. `twMaxTtlMs(now)` assumes "already settled" to get the upper
  bound; the per-row decision still belongs to `twQuoteTtlMs`. The lower bound is still the larger of the two markets.
- The 60-second polling of `useStockPrices` does not need to be changed: whether the request is actually sent is determined by the TTL.
  Polling for all cache hits, zero requests during lockout period. Manual "refresh" (`force`) always bypasses TTL.
- **U.S. stocks are not compared** (10-minute TTL maintained): U.S. stocks happened to be trading during the Taiwan stock lockup period.
  Moreover, U.S. stocks have daylight saving time and pre-market and post-market hours, so the rules for determining closing prices are much more complicated.

### price_cache new field

`open` / `high` / `low` / `volume` / `trade_date` / `trade_time` / `trial`。
The reason is the same as 0.6.34 adding `prev_close`: once the cache hits, the source will not be asked again.
If you do not save them together, the quotation card will be missing. The front-end localStorage cache key is synchronously upgraded to `price-cache-v3`.

## Annual income: search box (0.6.38)

One box above both currency sections, matching on code / original name / Chinese display name (AAPL → 蘋果),
case-insensitive substring —— the same rule as the transactions page (`filterTransactions`).

**It filters what is aggregated, not what is visible.** Hiding detail rows while leaving the year totals alone
would print a year whose total adds up to nothing on screen. Recomputing makes the table read as "this stock,
by year", which is the question a search box is asked.

- The four KPI cards stay lifetime totals over every trade. They sit **above** the box, and a hint appears next
  to it while a query is active, so the asymmetry is stated rather than left to be discovered.
- An empty result says 找不到符合「x」的股票, which is a different sentence from（尚無交易紀錄）—— an empty
  ledger and a search miss are not the same thing.

## Macro page: one card per region (0.6.38)

The US chip row and the 近期走勢 table live in the same `.section.glass`. Split into two cards, the
資料更新於 stamp and the 重新整理 button appeared to govern only the upper one, though they cover both.

## Line Chart Style (0.6.8)

`LineSeriesChart` adopts Google Finance style; applied to **Exchange rate page 2 sheets and Chip page financing/securities 2 sheets**.
K-line, trading volume bar, and KD are **not applicable**.

- **Gradient area fill**: `<defs><linearGradient>`, fade from line color 0.28 opacity to 0.
  Use `geo.innerH` instead of `geo.y(0)` for the bottom edge - the value range of the line chart deliberately does not contain 0, and `y(0)` will fall far outside the plot area.
- **hover vertical dashed line** (`ChartFrame`'s `crosshair` prop, default off).
- **The prompt box is attached to the data point** (`tooltipAnchor` prop, default is off → continue to be pinned to the top).
  There is no single "y" for the bar chart and K-line. Picking one will only cause the prompt box to stop at a meaningless position.
- **Dots are automatically drawn according to the number of points**: ≤ 20 points are drawn one by one (7 days on the chip page), > 20 points are drawn only on the hover point
  (The exchange rate 260 dots a year will paste the line into a caterpillar).
- The center of the tooltip will be clamped within the container (`clampTipCenter`), and the width will be estimated in characters.

### Two implementation traps

1. **The id of the gradient cannot be used directly with `useId()`**: React generates `:r3:`,
   And `url(#:r3:)` is not a legal selector syntax, and the coloring will disappear entirely. The colon must be removed.
2. **There can only be one copy of segmentation logic**: `lineSegments` and `areaSegments` share the internal `segments()`.
   If each is divided into segments, as long as the breakpoints of the filling and the lines differ by one frame, a color block without lines will appear on the screen.

### html2canvas / PDF compatibility (tested, 2026-07-29)

The two line charts on the chip page will be imported into PDF, and SVG `<defs>` has never been used in this project before.
Measured conclusion: **html2canvas correctly renders `<linearGradient>` and `url(#id)` for coloring**,
The IDs of multiple instances in the same capture do not conflict, and the text does not turn into huge black characters.
(If any version breaks in the future: remove `<defs>`, change `fill` to line color and add `fillOpacity`, the effect will only be less fade out.)

## Foreign currency exchange rate page (0.6.7)

**Top-level page** "Foreign Currency Exchange Rate", based on Taiwan Dollar, data comes from `fx/twd.json`
(**Global single file, not per-ticker**, the same mode as `macro/us.json`).

| Currency | Yahoo currency pair (actually used) | Display decimal places |
| ---- | ---- | ---- |
| USD USD | `USDTWD=X` | 3 |
| Japanese Yen JPY | `JPYTWD=X` | 4 |
| Euro EUR | `EURTWD=X` | 3 |
| Renminbi CNY | `TWDCNY=X` (take the reciprocal) | 4 |
| Hong Kong Dollar HKD | `HKDTWD=X` | 4 |
| British Pound GBP | `GBPTWD=X` | 3 |
| Australian Dollar AUD | `AUDTWD=X` | 3 |
| 韓元 KRW | `KRWTWD=X` | 5 |

### Two data, two roads (0.6.7)

| Purpose | Source | Update |
| ---- | ---- | ---- |
| **Numbers and daily changes of currency cards** | `action: 'fx'` of `stock-price`, check only after opening the page | Instant, 10 minutes TTL |
| **History of trend charts** | `fx/twd.json`, daily scheduled production | once a day |

**Why it must be dismantled: The last stroke of `fx/twd.json` is "the most recent **complete** daily line",
Today's daily line will not be established until London Day is over (07:00 the next morning in Taipei) -
The card will remain at yesterday's close throughout the trading day. Actual measurement 2026-07-29 Taipei 11:00:
File 32.302, market actual 32.435, a difference of 0.42%.

The real-time quotation continues to use the three-layer cache of the current price (the `FX:<code>` key of L1 localStorage / L2 `price_cache` /
L3 Yahoo), TTL is 10 minutes, the two layers are consistent, `asOf` uses the actual acquisition time of the quotation to avoid the superposition of the two layers of TTL.
**The user will not crawl the page unless the page is opened (this is where it is better than "tune the schedule": the latter will crawl regardless of whether anyone is watching it).

- Real-time quotation uses **chart?range=1d`, not spark**. spark It seems like a good deal to get it all at once
  (1.4KB / 0.11 seconds vs 9.3KB / 0.73 seconds), but its `close` is rounded to **3 significant digits** -
  The Korean won will become `0.0225` (actual `0.022467`), the error is 0.25%, and the mantissa is moved one space to 0.44%.
  And the card shows 5 decimal places, which amounts to pretending precision.
- Real-time quotations always use the forward currency pair `XXXTWD=X`**; for historical quotes, choose one of the two currencies (see below). Both have their own strengths.
- When the quotation cannot be obtained, the card** will return the closing price of the daily period and clearly state it on the screen**——
  The difference between the two can be 0.4%, making users think that seeing the real-time price is misleading.

### Numeric caliber (must be marked on UI)

- The direction of storage and display is always "**How ​​many Taiwan dollars can be exchanged for 1 unit of foreign currency**"; in reverse calculation, the reciprocal is used and the second copy is not saved.
- **This is the mid-market price, not the exchange rate quoted by the bank**, there is no cash/spot buying and selling price. It must be marked on the screen
  "Please refer to the bank you visit for the actual settlement of foreign exchange." - There will definitely be a discrepancy when the user exchanges it at the bank. Failure to explain it clearly is misleading.
  (Originally, the exchange rate was quoted using Taiwan Bank’s card, but it couldn’t be caught. Please see the three hard restrictions below for the reason.)
- **Charts are daily close** (last full daily bar); **Cards are real-time mid-price** (delayed up to 10 minutes).
- Daily change is compared to the previous trading day. **Do not apply the red rise and green fall of profit and loss**, instead express it in words
  "Taiwan Dollar Appreciation/Depreciation" - The depreciation of the Taiwan dollar is a good thing for those who hold US stocks, but a bad thing for those who go abroad.
  There is no good or bad in itself (the same as the treatment of general economic indicators).
- When the data has not been updated for more than **3 days**, an expiration warning will be displayed on the top of the page. The reason is that the numbers on this page will be exchanged for money.
  The old files on Storage look exactly the same as the new files on the screen (accidental nature of 0.6.4-dev.5).

### Three hard limitations of data sources (all are actual measurements, don’t go down the wrong path again)

1. **Taiwan Bank reported that the exchange rate could not be obtained. ** `rate.bot.com.tw/xrt/flcsv/0/day` and
   `/xrt/flcsv/0/{YYYY-MM}/{Currency}` returns JS proof-of-work human-machine verification page
   (`Challenge Validation`), changing the browser UA is invalid, and the Edge Function cannot pass.
   This is the **only** reason to choose Yahoo, and it is also the source of the "only mid-price" limitation.
2. **No single currency pair direction holds true for all 8 currencies. ** If both sides have currencies, only 1 grid of data will be returned.
   (Back to 200, complete structure, but no history): `CNYTWD=X` dead and `TWDCNY=X` alive,
   `TWDEUR=X` dies and `EURTWD=X` lives. Therefore, there are two candidates for each currency, which are judged by points (`FX_MIN_POINTS`).
3. **The "real-time quote column" appended by Yahoo at the end of the sequence must be eliminated** (its timestamp is equal to
   `meta.regularMarketTime`). The real-time price on the opposite side of the currency pair is different from your own daily line——
   The measured CNY is therefore overweighted by a +4.47% daily change.

### No converter (removed in 0.6.7)

0.6.6 There used to be a converter with two-way input of "Taiwan Dollar ⇄ Foreign Currency", but it was completely removed in 0.6.7 according to the user's request.
Along with pure functions that just serve it (`twdToForeign` / `foreignToTwd` / `parseAmount` / `formatAmount`)
Delete them altogether - leaving functions without callers will only be mistaken for being used by others.
The exchange rates in both directions can still be seen: the card is "1 foreign currency = N Taiwan dollars", and the two trend charts are in two directions.

### Trend chart (side by side in both directions)

Draw **two** pictures during the same period: "New Taiwan Dollar/Foreign Currency" on the left (1 TWD can be exchanged for foreign currency),
Right "Foreign Currency / New Taiwan Dollar" (1 foreign currency can be exchanged for Taiwan dollars).

- **Why need two**: There are two ways to ask the user's question - "How many Japanese yen can this NT$1,000 be exchanged for?"
  What we are looking at is Taiwan dollar → Japanese yen. "How much is this 3,000 yen item in Taiwan dollars?" What we are looking at is Japanese yen → Taiwan dollar.
  They are reciprocal to each other, but it is troublesome to convert in the mind, especially the magnitude of yen 0.1972.
- ⚠️ **The two graphs are not mirror images of each other**: 1/x is non-linear, the curve shape is different,
  Moreover, the dates of the high and low points will be adjusted (highest in the forward direction = lowest in the reverse direction). This is a mathematical fact, not a bug,
  There is test pinning (the "high and low date swap" case of `invertPoints`).
- The number of decimal places for the reverse card is calculated by `autoDecimals()` according to the magnitude (about 5 significant figures, sandwiched between 2 and 6)——
  1 The foreign currencies that the Taiwan dollar can be exchanged for span four orders of magnitude: US dollar 0.030958, Japanese yen 5.0710, Korean won 45.366,
  The number of digits that comes with the currency will either change to 0.031 or to 5.0710000.
- The two columns on the desktop are side by side, ≤900px stacked into one column (the two pictures are squeezed into half the width of the mobile phone, and the trend cannot be seen).

3 There are three sections: month/6 months/1 year. Switching only recalculates the slices but not the network (one year is already on hand).
The interval is pushed back to the last day of the sequence instead of today. If the data stops a few days ago, the chart will not become inexplicably shorter.
The Y-axis is not forced to contain 0; days without data are disconnected and will not be interpolated.

- **Triggered by independent `fx-daily` cron job** (`0 3,9 * * *` UTC = Taipei 11:00/17:00,
  Run every day, non-Taiwan stock schedule), only catch once a day (Taipei calendar day).
- **This page is not displayed in local mode**: The same entry rule as "Individual Stock Analysis" and "General Economy".
- **The mobile version was not implemented in 0.6.7** (the user decided to wait for the desktop function to be verified before processing).
  The pagination is increased to six cells, and the bottom navigation bar of 0.6.6 is a vertical typesetting, which can accommodate it (320px each cell is still about 51px).

## AI analysis questioning dialogue (0.6.5)

After the initial analysis is generated, you can continue to ask questions on the same page.

- **Strictly framed in "data of this stock"**: technical aspect / chip aspect / fundamental aspect / profitability /
  General background/the analysis itself. Outside the scope, a fixed polite rejection sentence will be returned.
- **The frame limit rules are reissued in every round** and will not be diluted as the conversation becomes longer; it also contains provisions to prevent prompt word injection.
- **Maximum 10 rounds**. Complete data is re-sent in each round, and the cost is controlled by the number of rounds.
- Analysis and dialogue are stored in the browser `sessionStorage`: split the page and then cut it back to restore directly.
  No need to press again (= no repeated billing). To continue after restoration, you must first regenerate the analysis.
  ——Without payload, there is no data to base the frame on.
- **General manager can only be used as background in prompt**: system prompt explicitly prohibits using it to deduce the rise and fall of individual stocks.

## Main navigation layout (0.6.6-dev.1)

The same paging definition (`TABS` of `AppShell`) is rendered into two types according to the width of the window:

| width | type | label |
| ---- | ---- | ---- |
| ≥1021px | Table of pills at the top of the page | Complete four words (inventory overview...) |
| 721–1020px | Header column, only icon left | Name in `title` / `aria-label` |
| ≤720px | **Fixed bottom navigation bar** | Two-word short tags (overview, analysis, general manager, year, record) |

- The breakpoints are in CSS (`@media (max-width: 720px)`) and JS (`matchMedia`).
  **Changes in one place must be synchronized with the other**.
- The bottom column **must hang outside `.app-header`** (`PLAN.md §S4`: `backdrop-filter` at the top of the page
  will bind fixed positioning) and only render one tour at a time.
- Highly single source `--bottom-nav-h`; the position of the floating button and version badge is calculated by it,
  Add `env(safe-area-inset-bottom)` to the safe area.
- The mobile version badge is not fixedly positioned, but follows the footer of the page (the lower left corner is occupied by the navigation bar and floating button).
- When adding pagination, always use two words for `short`; the six columns at the bottom are still 59px at 375px, so there is no need to close the spacing.
