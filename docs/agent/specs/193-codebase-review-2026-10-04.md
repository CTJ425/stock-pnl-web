# Task 193 — Codebase review 2026-10-04: findings and fix plan

## Context

User asked for a full review for hidden defects and optimisation opportunities across correctness,
security, performance and maintainability, and chose "report first, then pick what to fix". The
previous review (2026-10-01, `docs/agent/specs/185-codebase-review-2026-10-01.md`) skipped
`stock-report/index.ts` internals and the StockDetail / Macro / Admin / Discord UIs; 55 commits have
landed since. Excluded: open BUG_FIX.md items, ACCEPTED_RISKS.md, spec 185 A1–C6.

Gates at review time (dev @ `e61d732`, 0.10.28): `oxlint` 0 · `typecheck:edge` 0 ·
`sync:edge-engine --check` 0 · `npm audit --omit=dev` 0 vulns. The 226 KB `createLucideIcon-*.js`
chunk is React + supabase-js, not icons.

Severity: **High** = wrong ledger/report data a user can hit, or an exploitable hole · **Med** = wrong
display, edge case, small amount, DR/CI path · **Low** = latent or hygiene. "✔" = I re-read the code
path myself (or queried DEV read-only) after the slice reported it.

---

## 1. High

| # | Finding | Where | Evidence |
|---|---------|-------|----------|
| H1 ✔ | 取代 CSV import doubles every dividend in the file's range (cash counted twice; stock dividend adds shares again, lowers avg cost; repeats on every 取代) | `CsvImportModal.tsx:75` writes `parsed.rows`; `csv.ts:295-303` `replaceScope` deletes BUY/SELL only; `csv.ts:116-122` parses 現金股利/股票股利 from the app's own export | Contradicts UI text 「同一個檔案重複匯入結果都一樣」 |
| H2 ✔ | `take_warm_quota` (SECURITY DEFINER, no `auth.uid()` check) is executable by **anon** | `schema.sql:387-388` revokes from `PUBLIC` only; Supabase default privileges grant anon/authenticated explicitly | DEV query: `has_function_privilege('anon', …take_warm_quota…)` = **true**. Anyone with the bundle key can exhaust a user's warm quota or grow `warm_quota` without bound (random `p_ymd` never pruned, `index.ts:2072`) |
| H3 ✔ | Nightly whitelist counts DIVIDEND (and STOCK_DIVIDEND) as sells and nets across all users | `stock-report/batchTickers.ts:70` `delta = BUY ? qty : -qty`; `dataAccess.ts:22-35` no `user_id` | BUY 1000 + 現金股利 ×1000 → net 0 → ticker leaves `allowedTwTickers` (`index.ts:956`): no nightly 籌碼/日K/基本面 files, `generate`/`warm` 403, unless someone watchlists it. One user's SELL can cancel another's holding |

## 2. Medium

**Correctness — transaction form**
- **M1 ✔ Edit re-prices a whole-lot trade with the odd-lot minimum fee.** `TransactionForm.tsx:70` edit forces
  `unit='零股'` → `:85` `minFeeUnit='odd'` → `:387`. BUY 1,000 @ 30 fee 20, edit price → fee 13. 重算手續費
  (`fees.ts:198`, `qty >= 1000`) disagrees.
- **M2 ✔ A one-off fee rate carries over to the next trade.** `TransactionForm.tsx:675` resets
  `feeRateManual` but not the field; restore effect `:89-92` only re-runs on workspace/date change; header form
  stays open (`AppShell.tsx:353`).
- **M3 ETN (02xxxx) sells taxed at 0.3%.** `pnlEngine.ts:223-228`; `stockCategory.ts:801` already calls `02`
  ETN. **Needs a cited source before any change** (repo rule) — believed 千分之1 under 證交稅條例 §2.

**Correctness — quotes and charts**
- **M4 ✔ 損益試算 seeds the previous stock's price** when switching watched A → B: `AnalysisPage.tsx:157-175`
  clears `watchQuote` in an effect (after B mounts with A's quote); `WhatIfTab.tsx:94-122` seeds once and its
  re-seed effect omits `currentPrice`. Held → watched gives empty inputs that never fill.
- **M5 ✔ Watched stock quote never refreshes on 個股分析** (`AnalysisPage.tsx:157-175`, one fetch, no
  interval) while `QuoteTab.tsx:335` says 「盤中價格每分鐘更新一次」.
- **M6 ✔ 「近 1 年」 shows 5 years for any non-held stock.** `technicalView.ts:56-59` returns `rows.length`
  for `1y`; `useDailySeries.ts:77-87` falls back to a `5y` remote series. 1y and 5y look identical.
- **M7 ✔ Edge-outage fallback close locked as today's close until 08:25.** `priceProxy.ts:265-283` stamps the
  `STOCK_DAY_AVG_ALL` close (still yesterday's for hours after close) `asOf: now, stale:false, tradeTime:null`;
  `quoteWindow.ts:212` locks an unsettled after-close fetch until 08:25.
- **M8 「全部」 draws monthly bars labelled daily** (`dailyProxy.ts:152` `granularity:'1mo'` unread;
  `TechnicalTab.tsx:249-356` says 日K, MA 週/月/季線, 每日成交量; x-axis `MM/DD` across decades).
- **M9 ✔ Intraday error states unreachable** — `intradayProxy.ts:65-77` returns `null`, never throws, so
  `.catch` in `QuoteTab.tsx:182`, `IndexDetail.tsx:103,135`, `TwIndexToday.tsx` never runs; shows 「無走勢資料」
  instead of 「讀取走勢圖失敗」.
- **M10 國際指數 can stay 「—」** — `GlobalIndices.tsx:155-191` initial full load and open-regions-only tick
  share one `reqId`; a quick tab return discards the full load.

**Security / abuse (Edge, DB)**
- **M11 `generate` is unmetered and expensive** — every call scans all users' transactions + watchlists
  (`index.ts:851,956`) and `loadBorrow()` with no `minYmd` always fetches ~244 KB from TWSE (`index.ts:800-813,861`).
  A loop from any signed-up account can get the shared egress throttled by TWSE.
- **M12 ✔ `app_log` accepts unbounded rows from any signed-in user** — insert policy checks only `user_id` and
  `source='web'` (`schema.sql:1193-1196`); `detail jsonb`, `app_version`, `request_id` have no size limit.

**Ops scripts / CI (verified by hand)**
- **M13 ✔ Release titles go through a shell.** `scripts/sync-github-releases.cjs:275,284` `execSync` with only
  `"` escaped; runs in CI on every `main` push with a token (`release.yml:31`). Already damaged:
  `gh release view 0.9.35` → 「全域錯誤記錄 ：捕捉層…」, 0.9.33 → 「補讀  未覆蓋範圍的六項修正」. A `$(…)` heading
  would execute in CI.
- **M14 ✔ `restore.cjs` passes whole SQL files as one argv string** (`:189,193,198`). Linux caps one argv
  string at 128 KiB (`E2BIG` reproduced at 131,072 B). `schema.sql` is already 100,705 B; `data-public.sql`
  grows with users. The non-dry-run path has never run. Also puts password hashes and `CRON_SECRET` in
  `/proc/<pid>/cmdline`. CLI has `-f <file>`.

**Performance**
- **M15 Hidden-tab polling** in `WatchSection.tsx:113-123`, `AdminStatusPage.tsx:224-242`,
  `GlobalIndices.tsx` tick — the C1 fix (skip when hidden) was applied to `useStockPrices` only. AdminStatusPage
  also blanks the whole console on one failed poll (`:255`).
- **M16 Every tab return re-downloads report + fundamentals** (`StockDetailPage.tsx:220-237`, `forceRefresh`,
  3 Storage downloads, no throttle, no `alive` guard → a late response can overwrite the next stock's report).
- **M17 Hover re-renders the whole TAIEX section** (`TwMarketSection.tsx:223,349`; `IntradayChart.tsx:146,305-316,445-462`
  rebuilds up to ~1,250 volume rects per mouse move on 5Y).
- **M18 外幣匯率 重新整理 blanks the page and resets the chart to 3m** (`FxPage.tsx:287-288,328`).
- **M19 Admin war room 收工/探測中 uses a different rule than the server** (`ProbeWarRoom.tsx:211` total hits vs
  `sourceProbePlan.ts:170-200` three consecutive same-fingerprint hits in window); windows hard-coded 3× (`ProbeWarRoom`,
  `MechanismGuide`, `AdminStatusPage:373`).

## 3. Low

- **Correctness (latent/edge)**: `fees.ts:237` day-trade signature applies min fee at 0% rate (calculateFee
  does not); `WorkspaceContext.tsx:191-199` rows added during a workspace switch land in the new workspace's state;
  `StockSplitModal.tsx:196-203` stores an inferred rate as recorded (no effect today); `FundamentalTab.tsx:330`
  TTM EPS needs all four newest quarters (often 「資料不足 3/4」); `DiscordMySettings.tsx:201-235` two quick time
  saves overwrite each other; `MacroPage.tsx:31` / `BackupsSection.tsx:113` use browser/UTC dates.
- **Edge**: user-supplied `name` written into shared report/fundamental files shown to all users
  (`index.ts:843,2219`; spoofing, not XSS); `discordHandlers.ts:431` finishing a holdings send also flips
  claimed market rows (no `kind` filter); `discordRun.ts:111` 17:30 summary never retries if today's market row
  is late; `stock-price/index.ts:732` applies Taipei 13:30 cutoff to US daily bars; `index.ts:2786` uncapped
  `Promise.all` + repeated full scans; `verify.sql` says "19 tables" but checks 18 (missing `tx_split_log`),
  RLS check covers 8/19; `stock-price/index.ts:810` logs raw `err.stack`; `adminHandlers.ts:224` storage list
  `limit: 1000`.
- **Dated**: `TW_HOLIDAYS` covers 2026 only (`quoteWindow.ts:83-103`) — BUG-110 guard degrades to weekends on
  2027-01-01. CI `e2e-dev.yml` runs `npx wait-on` unpinned (not in devDependencies).
- **Privacy, by design**: public `reports` bucket answers 200/404 for `daily/<code>.json`, revealing the set of
  held/watched TW tickers (`schema.sql:407-409`). Needs a decision: accept as RISK or move to signed URLs.
- **Maintainability**:
  - Dead code (grep-proven, only definition + tests): `Macro/macroPeriod.ts`, `Common/HelpTh.tsx`, all
    `discordAccounts.ts` mutators, `fmtTradeStreak`, `anyMarketOpen`, `judgeCron`, `describeScope`;
    `StockDetailPage` props `onSelectTicker`/`onWatchlistChanged` never used → `AnalysisPage` `pickedWatch`
    bridge unreachable; Edge `discord-holdings` action + `listEnabledHoldingsUsers` (cron retired);
    `backfill-revenue/profit` have no cron.
  - Duplicates that can drift: `COMMON_FEE_RATES` (`pnlEngine.ts:386`, `fees.ts:23`); `inferTxFeeRate` vs
    `inferFeeRate`; `sellTaxRate` vs `getStockCategory`; `backup-transactions` copies `secretsMatch`/`pagedSelect`
    on the false premise that Edge can't import `_shared/` (it already imports `_shared/log.ts`); 4 Taipei-date
    helpers; `latestMarketDay` ×2; `FAIL_REASON_LABELS` ×2; spark helpers ×4; `fmtNum` ×2.
  - Stale comments: `FundamentalTab.tsx:4` (AI analysis), `ManualRunSection.tsx:2` ("five" jobs, there are 7),
    `TwIndexToday.tsx:3`, `MacroPage.tsx:454`, `rangeRows.ts` "figure for figure"; `useDailySeries.ts:82`
    `asOf = new Date()` so 「更新於」 always shows now.
  - Unbounded localStorage caches: price cache (`priceProxy.ts:294`), `reportCache` (`reportProxy.ts:165`).

Checked and clean (slices' summary): ledger engine (FIFO/avg, 當沖 pairing, short, rounding, rebate uplift),
`holdingRows`/`pnlBasis`, CSV parsing, `dividendReport`; Edge auth (26 actions single dispatch, constant-time
cron secret, admin role checked server-side, no IDOR), RLS on all 19 tables, every DEFINER function sets
`search_path`, webhook regex + `allowed_mentions` + Markdown escaping, all upstream fetches have timeouts,
paging on all user-table scans; CI actions pinned by SHA with minimal permissions.

---

## 4. Execution plan (user chose B1 + B2 + B3 + B4; ETN = cite first, then fix)

**Step 0 — records first.** Read `PRODUCT.md` (frontend rule) and load `bookkeeping`. Write this report to
`docs/agent/specs/193-codebase-review-2026-10-04.md`, open **Task 193** in `TASK.md` with items B1–B4.
Deferred items (below) go to `BUG_FIX.md` as BUG-112+ so nothing lives only in chat.

**Versioning.** The first behaviour commit picks **0.10.29** once; every behaviour commit after it is the next
`-dev.N` across all `version.syncFiles`, with a zh-TW `CHANGELOG.md` entry, committed together (CLAUDE.md
checklist; `versioning` skill). One commit per batch (B4 may split UI perf vs cleanup). Order: B1 → B3 → B2 → B4.

**B1 — High three**
- H1 `CsvImportModal.tsx` `importRows`: in 取代 mode drop `DIVIDEND`/`STOCK_DIVIDEND` rows; preview shows
  「股利列 N 筆不會寫入（取代只處理買賣）」. Keep `replaceScope` narrow (hand-entered dividends survive).
- H2 `schema.sql:387`: `REVOKE ALL ON FUNCTION take_warm_quota(uuid,text,int) FROM PUBLIC, anon, authenticated;`
  (Edge calls it via the service-role `db`, `index.ts:914`, so `warm` is unaffected). Add the check to `verify.sql`.
- H3 `batchTickers.ts` `netOpenTickers`: BUY +, STOCK_DIVIDEND +, SELL −, DIVIDEND ignored; accumulate per
  `user_id|workspace_id|ticker`, keep a ticker when any group ≠ 0. `dataAccess.ts` select adds `user_id, workspace_id`
  (still no `tx_nature`, per the BUG-044-P comment). Before editing, `grep` for other copies of the "non-BUY = sell"
  rule (`tx_type === 'BUY' ? qty : -qty`) and fix them in the same commit (repo rule 2).

**B3 — Ops/CI + Edge hardening**
- M13 `sync-github-releases.cjs`: `execFileSync('gh', [...args])` for create/edit and `git log`; no shell.
  Repairing the two damaged public titles (0.9.35, 0.9.33) = outward-facing → ask before running.
- M14 `restore.cjs` (and `wipe-dev.cjs` for consistency): write SQL to a `fs.mkdtempSync` file with mode 0600, call
  `supabase db query --linked -f <file>`, delete in the existing `finally`.
- M11 `index.ts` `generate`: pass today's `minYmd` to `loadBorrow` so the cache is read first; charge a per-user daily
  meter by reusing `take_warm_quota` (atomic, service-role) under a distinct limit — confirm first how often
  `reportProxy.ts:184` calls `generate` so the limit never blocks normal browsing.
- M12 `app_log`: `CHECK` limits on `pg_column_size(detail)`, `app_version`, `request_id`, added `NOT VALID` then
  validated after checking current max sizes on DEV (read-only); confirm Edge `log.ts` payloads fit.
- Low Edge: `finishHoldingsSend` adds the `kind` filter; `generate`/`warm` take the stock name from the server's
  `twNames` list, not the request body; `stock-price` logs `safeStack`; `adminHandlers.ts:224` pages the storage list;
  `verify.sql` adds `tx_split_log` + RLS check on all 19 tables.
- DDL (H2, M12) → DEV via `supabase-ops`, `verify_setup()`; Edge `stock-report` (`--no-verify-jwt`) and `stock-price`
  → DEV from a clean commit. **PROD DDL and Edge only on explicit OK.**

**B2 — Form + quote/chart display (+ ETN)**
- M1 `TransactionForm.tsx`: minimum-fee bucket from `getActualShares() >= 1000` in edit mode (same rule as
  `proposeFeeCorrections`); M2: after a successful add `setFeeRate(String(getFeeRateOn(date, workspaceId)))`.
- M3 ETN: find 證交稅條例 §2 text or TWSE's ETN page via WebSearch/WebFetch, quote it in the `sellTaxRate` comment,
  `grep` every tax-rule expression, change once, `npm run sync:edge-engine`. If no source is found, stop and report.
- M4 `AnalysisPage.tsx`: key the watch quote by ticker (`{ticker, quote}`) so a stale quote is never passed;
  `WhatIfTab.tsx` seeds empty price inputs once when the first quote arrives (user edits still win).
- M5 watched stock quote joins the existing polling path (`useStockPrices` or its interval + visibility guard).
- M6 `technicalView.ts` `rangeBars('1y')` = bars within one year of the last row's date (pure, date-based like `ytd`).
- M7 `priceProxy.ts`: TWSE fallback quotes are cached with a short TTL (not the 08:25 lock) — e.g. mark them so
  `cacheTtlMs` returns the unsettled retry interval.
- M8 `TechnicalTab.tsx`: read `granularity`; for `1mo` relabel (月K, MA labels, 成交量 title, x-axis with year).
- M9 `intradayProxy.ts`: distinguish failure from "no data" (throw or return `{error}`) so the callers' error states work.
- M10 `GlobalIndices.tsx`: separate request ids for full load vs tick (or tick also fetches rows still empty).

**B4 — Performance + maintainability**
- M15 visibility guard on `WatchSection`, `AdminStatusPage`, `GlobalIndices` polls (same pattern as
  `useStockPrices` C1); AdminStatusPage keeps the last good data on a failed poll.
- M16 `StockDetailPage.tsx`: throttle the focus refresh (e.g. ≥ 5 min) and add an `alive`/ticker guard.
- M17 hover state moved into the chart component (or memoised layers) in `TwMarketSection` / `IntradayChart`.
- M18 `FxPage.tsx`: refresh keeps the page mounted (separate `refreshing` flag).
- M19 `ProbeWarRoom.tsx`: use the server's retire rule/windows (import from `sourceProbePlan.ts` like `quoteWindow`).
- Delete grep-proven dead code (list in §3) with its tests; merge `COMMON_FEE_RATES`, `FAIL_REASON_LABELS`,
  `latestMarketDay`, `backup-transactions` copies of `secretsMatch`/`pagedSelect` into `_shared/`; fix the stale
  comments listed in §3; cap the two localStorage caches. `useDailySeries` remote `asOf` = last bar date.

**Deferred to BUG_FIX.md (not fixed this round, need a decision or data):** public `reports` bucket ticker
enumeration (accept as RISK vs signed URLs); `TW_HOLIDAYS` 2027 (needs the official calendar); `discordRun` 17:30
no-retry; US daily cutoff in `stock-price` (`index.ts:732`); uncapped `Promise.all` in `readFundamentalSnapshot`
(with RISK-002); latent A5/A6/A7 and TTM EPS rule; `e2e-dev.yml` unpinned `npx wait-on`.

## 5. Verification

- Every batch, from `sources/`: `npm run lint`, `npm run build` (the Verify line — never `tsc --noEmit`),
  `npm run typecheck:edge`, `npx vitest run`, `node scripts/sync-edge-engine.cjs --check`.
- New tests written to fail before the fix: `csv`/`CsvImportModal` (取代 with dividend rows), `batchTickers.test.ts`
  (dividend; cross-user cancel; stock dividend), `TransactionForm` (edit 1,000-share min fee; rate reset after add),
  `technicalView` (1y on a 5y series), `WhatIfTab`/`AnalysisPage` (watched A→B seed), `priceProxy` (fallback TTL),
  `intradayProxy` (error vs empty), `sellTaxRate` (ETN, with the citation next to the assertion).
- H2: re-run the DEV `has_function_privilege('anon'|'authenticated', 'public.take_warm_quota(uuid,text,int)')` → false;
  `warm` from the app still succeeds.
- H3: read-only DEV query comparing old vs new whitelist (ticker list only) to show which tickers come back.
- M13: `node scripts/sync-github-releases.cjs --dry-run` prints the backtick titles intact.
- M14: `restore.cjs --dry-run` on a DEV package, plus a synthetic > 128 KiB SQL through the `-f` path on DEV only.
- UI: `verify` skill (Playwright) — 損益試算 watched A→B, 近 1 年 on a non-held stock, Fx 重新整理, edit a whole-lot trade.
- Close-out: `bookkeeping` updates (`TASK.md`, `PROGRESS.md`, `FIXED_BUG.md`/`BUG_FIX.md`), then `ship` when the user
  asks to release.
