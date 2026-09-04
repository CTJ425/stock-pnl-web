# Task Backlog & Tracking (TASK.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-08-14 13:28:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory) ——
> This file must be loaded in every session. Before archiving, it had 38.6K tokens, of which 90% were completion history.
> For detailed implementation history, always refer to `PROGRESS.md`, which is the proper place for narratives.

## 📍 Where the project stands (2026-09-04 14:50)

- **Version 0.9.30 — released and live on PROD.** `main` and `dev` are synchronized at `0.9.30`.
  - Implemented: 個股分析股票產業標籤清晰度與字級優化（解耦 `.watchlist-card-badge` 樣式覆蓋，升至 12.5px 高對比）、庫存總覽持股表格黃金比例字級與完全消除橫向滾動條（13px/12px/11px 甜蜜點，全解析度 0px 水平溢出）、分組列通欄純章節化（移除市值損益重複小計）、未實現損益與報酬率雙行直顯券商 APP 牌告口徑（月退制法定牌告對齊）、觀察股票迷你緊湊小卡（高度降 20%，網格 136px）、DEV 全功能 E2E 自動化整合測試 suite 與高質感自包含 HTML 報告。
  - Verification: 97 test files / **1,603** vitest tests, exit 0; `npm run typecheck:edge` exit 0; `npm run build` exit 0; `npx oxlint src` 0 errors.
  - Edge Functions: `stock-price` is **v3** on both projects and both carry the same `ezbr_sha256` `3ef2700b97ccad33d712c6359d1056a2c0a9fbc08a5ceb6a1b25a402b64c1621` with `verify_jwt: true`. `stock-report` is **v4** on both (`1d2ba453…266a794f23`, `verify_jwt: false`).
- **Version 0.9.29 — prior release.**
- **The PROD schema gap is closed.** `transactions.tx_nature` (CHECK includes `SHORT`), `transactions.fee_rate` and `workspaces.fee_rate` now exist on **both** cloud projects. Applied to PROD 2026-09-03; 110 existing transactions were not rewritten. Full DDL kept in `docs/agent/prod-0.9.28-migration.sql`. This closed Task 141, BUG-041 and BUG-044-P.
  - **It closed the gap, not the risk.** Both projects were recreated on 2026-08-31 from un-migrated schema and silently lost these columns; nothing surfaced it for three days, because `dataProvider.ts` retries without the missing column and reports success. Re-check the columns after any project recreation — see `RISK-004` in `BUG_FIX.md`.
- **DEV is the cloud project `zyebvayngwrqzoaicbwd`, not the local docker stack.** `sources/.env` points there and DEV Edge runs there (3 ACTIVE functions). The local `stock-pnl-web-dev-db-1` container answers plausibly but the app never talks to it.
- **`supabase link` was left pointing at neither project** after this release: both showed `linked: false`. DDL went through the Management API (`POST /v1/projects/{ref}/database/query`), which names the project in the URL and so does not depend on cwd the way `db query --linked` does. Prefer it for any single-project write.
- **DEV cron count: 6**: `source-probe`, `macro-daily`, `fx-daily`, `market-data-daily`, `history-daily`, `backup-daily`. The count is **6 on PROD too**, so it cannot identify a project — use `EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%<ref>%')`.
- **Known and not done**: the end-to-end Playwright run for the 融券 flow; `transactions.user_id` is `NOT NULL` but undeclared in the TypeScript `Transaction` type; `.inst-matrix tfoot td` hardcodes a white overlay that is inverted under the light theme.

## 📋 Active Tasks

### Task 129: ETF constituents in 個股分析 (deferred after investigation)
- **Status**: ⏳ **OPEN — Investigated, deferred; research documented**
- **Agent**: Scribe
- **Timestamp**: 2026-08-24 13:33:13 Asia/Taipei
- **What is this**: Explore adding ETF constituent holdings display to 個股分析 page, showing what a selected ETF owns.
- **Investigation outcome**:
  - **Taiwan Stock Exchange has NO official ETF constituent API.** `openapi.twse.com.tw/v1` has two ETF-related endpoints: `/opendata/t187ap47_L` (fund master data — fund code, tracking index, whether it holds foreign constituents, establishment/listing dates) and `/ETFReport/ETFRank` (monthly regular-savings account counts). Neither provides holdings detail.
  - **Daily PCF (實物申購買回清單) published by each issuer, not TWSE.** TWSE ETF section only links out to issuer sites.
  - **Three candidate data sources if this is built later**:
    1. **MoneyDJ** — uniform URL pattern `https://www.moneydj.com/etf/x/basic/basic0007.xdjhtm?etfid=<ticker>.tw`, server-rendered HTML; verified working for 0050. Gives ticker / weight % / shares held / as-of date. One parser covers all TW ETFs, but it is a third-party site and breaks on redesign.
    2. **Per-issuer PCF pages** (元大 / 國泰 / 富邦 / 群益 / 統一 …) — most authoritative, but needs 10+ parsers plus a ticker→issuer mapping table.
    3. **Paid APIs** — TEJ "ETF 持股(日)" — authoritative but requires subscription.
  - **ETF detection** — no new data needed: `sources/src/utils/fees.ts:59` already infers ETF from ticker starting with `00`; authoritative list available at `t187ap47_L`.
  - **Data layer constraint** — No per-ticker metadata table exists in schema; building this feature requires: new table (holdings index) + new Edge Function proxy (browser CORS blocked) + caching strategy. Pattern exists (`supabase/functions/stock-price/` and `supabase/functions/stock-report/`). Lane classification: **Lane 2 (backend, schema, Edge)**.
- **Next step**: If user decides to build this, start with data source validation (which MoneyDJ parser is robust enough, or evaluate issuer pages), then design schema, then Edge Function.
- **Unfinished**: Everything (architecture through implementation).

### Task 125: Deferred watchlist card design variants (Sparkline / Chips & PE / Range Bar)
- **Status**: ⏳ **OPEN — Design documented, implementation deferred by scope**
- **Agent**: —
- **Timestamp**: 2026-08-24 11:37:39 Asia/Taipei
- **What is this**: During 0.9.9 implementation, three advanced card variants were designed but deferred due to scope constraints (basic card 股代 / 股名 / 價格 / % 變化 shipped; richer variants held for later).
- **Three variants documented in** `docs/architecture/watchlist_6_design_variants.md` **+ .html**:
  1. **Sparkline card** — 7-day price trend miniature line chart, visual at-a-glance trend without numbers.
  2. **Chips & PE card** — Institutional flow badges (籌碼) with buying/selling icons, P/E badge, 機構法人 buy/sell flow indicator.
  3. **Range Bar card** — Intraday high/low range bar (open/close markers), today's trading envelope without historical context.
- **Scope decision**: All three variants add complexity (data fetch, rendering, state management, testing) without changing core watchlist UX. Ship basic card first, validate user interaction, then evaluate demand for variants.
- **Next step**: When scheduling variants, start with design finalization (existing docs are draft), then estimate implementation effort, decide priority relative to other features.
- **Unfinished**: Everything (design validation to implementation).

### quote-yahoo-a data source: stats grid omits 均價 / 成交金額 / 昨量
- **Status**: ⏳ **OPEN — Code shipped, data source decision pending**
- **Agent**: —
- **Timestamp**: 2026-08-25 15:41:49 CST
- **What is this**: 0.9.17 shipped the 個股分析 quote tab with a redesigned stats grid. The design mockup (`docs/design/quote-redesign-mockups.html`) shows three additional cells (均價, 成交金額, 昨量) beyond the current seven (成交量/開盤/最高/最低/昨收/漲跌幅/振幅). The shipped grid omits these three because `PriceQuote` has no data source for them today.
- **Open work**: Data source decision (schema table, batch service, or external API integration) for the three omitted columns. Implementation is straightforward once the source is decided; the scope gate is architecture, not code.
- **Unfinished**: Data source definition.

### Task 85: 0.7.8 / 0.7.9 探針命中直接觸發抓取，且要確認資料到位
- **Status**: 🔄 **shipped everywhere and proven live; landing windows measured, retune needed**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 19:00:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14 — full text in `TASK_ARCHIVE.md`.

**0.7.9**: retiring a source now needs `data_landed`, judged by `sourceLanded` reading the artifact's
own date —— not by whether the fetch threw. Validated against today's real DEV artifacts (the chips
report for 20260811 has a null `margin` stamp and an unflipped `borrow` while returning ok, which is
precisely what 0.7.8 would have mis-retired).

9. **Watch one live round with a hit** —— ✅ **Confirmed**. Green cells show `… · 已觸發 … · 資料已到位` and `data_landed = true`.
15. **Retune the remaining windows** —— 🔄 **Measured windows (2026-08-18..2026-08-26)**:
    - mops_profit 12:00
    - bfi82u 15:05-19:40
    - t86 16:05-16:45
    - twt38u 17:00-17:10
    - bwibbu 17:05-17:35
    - margin 20:45-21:00
    - borrow 22:15-23:30 (~~0.7.13, measured flip 22:15~~✅)
    
    **Remaining work**: retune the configured windows in sourceProbePlan.ts to match these measurements.

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Items 1, 2, 3 answered; item 4 remains open**
- **Agent**: Claude (last update) / Grok (carried forward)
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei (status text refreshed 2026-08-26)

1. **Did an early `market-daily` round actually land the day?** —— ✅ **ANSWERED**. Recent `batch_run_log` rows show `data_ymd` equal to `taipei_ymd`, confirming the session day is recorded.
2. ~~**The 成交量 discrepancy between the two sources**~~ —— ✅ **DONE 2026-08-06 10:00**. See SPEC 技術面.
3. **First post-BUG-018 T86 round `t86_revisions`** —— ✅ **ANSWERED**. Query shows `t86_revisions` is 0 with `t86_frozen` true on 20260820/21/24/25, confirming one-off +1 behavior and then stabilization.
4. **Trial-matching UI** —— ⏳ confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window
   (08:30–09:00 or 13:25–13:30). Needs a browser; data half is MIS `ip=1`.

### Task 128: CI workflow must gate deployments on test/lint/typecheck (discovered in audit 2026-08-23)
- **Status**: ⏳ **OPEN — User deferred; CI gate not added this round**
- **Agent**: Scribe
- **Timestamp**: 2026-08-23 18:52:37 Asia/Taipei
- **Finding**: `.github/workflows/deploy.yml` ran only `npm ci` → `npm run build` without running `npm test`, `npm run lint`, or `npm run typecheck:edge`. A push to `main` would deploy to production while CI type-checked via the build but ran no tests and no lint. The P0 finding from this audit (test summary said "all passed", but exit code was 1) is exactly the failure mode a test gate misses.
- **User decision**: Explicitly chose NOT to add CI gate in this round. Recording as open task, not as a deferred decision to revisit unprompted.

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

### Task 132: Supabase Redirect URLs allow-list
- **Status**: ⏳ **OPEN — configuration required**
- **Agent**: User
- **Timestamp**: 2026-08-31 16:45:40 CST
- **See**: `docs/agent/BUG_FIX.md` → "Supabase Redirect URLs allow-list does not contain app origin" (recorded 2026-08-31).

### Task 133: DEV self-hosted auth URLs are wrong
- **Status**: ⏳ **OPEN — awaiting front-end deploy target decision**
- **Agent**: —
- **Timestamp**: 2026-08-31 16:45:40 CST
- **What is this**: In DEV compose `.env`, `ADDITIONAL_REDIRECT_URLS` is empty and `SITE_URL` points at the Supabase API (`http://kong:8000`) rather than the app. Auth email links redirect to the API root instead of the app.
- **Blocker**: Front-end deploy target not yet decided; see `PROGRESS.md` for current status.
- **What to update**: Two `.env` variables: `ADDITIONAL_REDIRECT_URLS` and `SITE_URL`. Do not record any `.env` value; variable names only.

### Task 140: Review two anomalous transactions found in real broker exports
- **Status**: ⏳ **OPEN — awaiting user verification**
- **What is this**: Batch recalculation on committed exports proposed corrections for exactly two rows; both look like genuine broker record anomalies rather than tool errors. Needs user verification against broker statements.
  1. `2026-06-05 2891`: recorded 3,932 TWD, computed 722 TWD (excess 3,210, fits no known tax rate)
  2. `2026-06-23 00685L`: recorded 459 TWD (full 0.001425 fee rate), while every other row in that file uses 3折 0.0004275 rate
- **Evidence**: Both rows present in `docs/` broker export files; anomalies consistent across multiple parse/compute runs.
- **Next step**: User to cross-check against broker confirmation statements and transaction history.
- **Timestamp**: 2026-09-01 09:39:42 Asia/Taipei

