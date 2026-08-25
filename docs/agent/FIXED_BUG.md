# Fixed Bugs History (FIXED_BUG.md)

- Agent: Scribe
- Status: ACTIVE
- Timestamp: 2026-08-25 10:16:08 Asia/Taipei

---

## 🐛 Historical Bug Fixes

### BUG-037 — PROD `borrow` never lands; cached payload off by one trading day

- **Condition**: `borrow` source in stock-report probe. Root cause proven by reading code and PROD data.

- **Root Cause**: Two predicates answered the same question one day apart:
  - `readBorrowCacheFrom` (`index.ts`, formerly line 745) judged a cached borrow payload fresh with `.gte('ymd', minYmd)` — i.e. `ymd >= tradeYmd`.
  - `borrowHit` (`sourceProbePlan.ts:404-407`) requires `date > tradeYmd`, because the TWT96U endpoint serves TODAY's quota intraday and only flips to the next trading day after the close.

- **Consequence**: An earlier same-day `generate-chips` (fired by a t86 / margin / twt38u hit) cached the pre-flip payload under `ymd = today`. After the ~22:15-22:30 flip, the probe hit and fired `generate-chips` again, but `loadBorrow(todayYmd)` was served from the pre-flip cache and never re-called the endpoint. The report's `sources.borrow.date` stayed at today and `sourceLanded('borrow')` was false forever.

- **Evidence from PROD**:
  - `source_probe_tick`, source `borrow`, 2026-08-11 to 2026-08-24: 373 ticks / 126 hits / 0 landed. Never landed once.
  - 2026-08-24: 21:00–22:25 `借券日=2026-08-24＝當日額度，尚未翻日` (no hit); 22:30–23:30, 13 rounds of `借券日=2026-08-25（已翻次一交易日） · 已觸發 generate-chips：無變動 · 資料未到位，下輪重試`.
  - `chip_raw_cache` dataset `SBL_D`: the newest row is `ymd=20260824`, written 08-24 11:00 Taipei (earlier days likewise 09:17 / 11:00 / 16:30 / 16:05 / 14:30 — all pre-flip). No row at `ymd=20260825`, proving the post-flip payload was never fetched or cached.

- **Fix**:
  - `sourceProbePlan.ts`: new exported `borrowCacheUsable(cachedYmd, tradeYmd)` that delegates to `borrowHit` — one rule, deliberately not a second comparison.
  - `index.ts` `readBorrowCacheFrom` (now ~736–762): dropped the `.gte('ymd', minYmd)` filter, selects the newest `SBL_D` row, and returns null unless `borrowCacheUsable(String(data.ymd), minYmd)`.
  - Everything else unchanged: `loadBorrow`'s post-cache fetch, `writeCache` keying, the no-argument `loadBorrow()` call site.
  - Verified: `chip_raw_cache.ymd` is `text` and 8 characters wide, so descending order sorts chronologically. No other caller reads `SBL_D` with a range predicate (the only other uses are an exact-key `readCache` and `writeCache`).

- **Tests**: 1 new test in `sourceProbePlan.test.ts` covering the exact BUG-037 case plus an equivalence table proving `borrowCacheUsable` and `borrowHit` are the same rule. Full suite `npm test -- --run` from `sources/` = 81 files / 1244 tests passed, exit 0. `npm run typecheck:edge` exit 0.

- **Expected behaviour after deploy**: The first post-flip round fetches once and caches under the next trading day, the report's borrow stamp moves past today, `borrow` lands and then retires after its trailing run of 3 — replacing the current 13 post-flip rounds with 3.

- **Residual risk**: `index.ts` has no vitest coverage, so the deployed half is gated only by typecheck:edge and review.

- **Reviewer verdict**: PASS, no findings.

- **Status**: ✅ Code complete (not deployed). Files changed: `sourceProbePlan.ts`, `sourceProbePlan.test.ts`, `index.ts`. No version bump yet, no commit yet.

---

### BUG-036 — Backup cron transient 401 on one PostgREST request; no retry; error logged as [object Object]

- **Condition**: 2026-08-25 02:00 Asia/Taipei backup-daily cron run. `Promise.all` issued three PostgREST requests in the same millisecond: `GET /rest/v1/workspaces`, `GET /rest/v1/transactions`, `GET /rest/v1/user_settings`. Same service-role client, same API key. One request (`workspaces`) returned 401 while the other two returned 200. Transient gateway auth rejection, not a data/RLS/permission problem — same account succeeded the previous day.

- **Impact**: One failed request caused the entire account's backup to be skipped. No retry, so that account had no `2026-08-25.json` backup object. `backup_run_log` recorded `status='error'` with the literal message `[object Object]` because PostgREST errors are plain objects, not `Error` instances, and `String(err)` produces the placeholder string.

- **Four defects fixed (0.9.13, commit 84502c6)**:
  1. `sources/supabase/functions/backup-transactions/backupPlan.ts` — new `describeError()` function. Handles plain-object errors from PostgREST and serializes them for logging instead of producing `[object Object]`.
  2. `sources/supabase/functions/backup-transactions/index.ts` — added retry logic for failed accounts (up to 3 attempts, 500ms/1000ms backoff). Prune-only failure keeps `status='ok'` and is not retried.
  3. `sources/supabase/functions/backup-transactions/index.ts` — now checks and logs the `backup_run_log` insert result. Dropped row would have made an account look never-attempted.
  4. `src/components/Admin/BackupsSection.tsx` — `statusLabel` now shows error text on an `ok` row, so prune failures are no longer displayed as bare success.

- **Tests changed**:
  - `sources/supabase/functions/backup-transactions/backupPlan.test.ts` — added 4 test cases for `describeError()`.
  - `src/components/Admin/BackupsSection.test.tsx` — added 1 test case.

- **Verification**: `npm test` 81 files / 1239 tests exit 0; `npx tsc --noEmit` exit 0; `npx tsc --noEmit -p tsconfig.edge.json` exit 0; `npm run build` exit 0; `npx oxlint` 5 pre-existing warnings, no new ones.

- **Status**: ✅ FIXED in **0.9.13** (commit 84502c6, both dev and main, 2026-08-25). **PROD Edge Function `backup-transactions` not yet deployed** — awaiting explicit user authorization.

---

### RISK-001 — Probe round timeout: per-source loop has no deadline/budget check

- **Condition**: `sources/supabase/functions/stock-report/probeRound.ts:95–98` contained no per-source deadline or budget check; only the follow-up loop had one. Since 0.7.22-dev.1, three daily windows overlap at 17:00 (`t86` ends 16:00 inclusive, `bwibbu` and `twt38u` start at 17:00), and four sources scheduled together at 17:15/17:20. Each fetch carries 10s timeout.

- **Risk accepted at review**: Unlikely in normal operation (would require ≥3 sources timeout); acceptable trade-off against the alternative (omitting `twt38u` from probes, which is worse).

- **Fix (0.9.11, commit 8003b6a)**: `probeRound.ts` gained optional `probeDeadline` dependency (arrival time + budget in ms). Probe loop now defers a source before starting it once the budget is gone, never interrupts an in-flight probe. New result field `deferred` stays distinct from `skipped`. `index.ts` adds `PROBE_BUDGET_MS = 30_000` (30 seconds). Pattern: check budget before loop iteration, defer if exhausted, continue only if time remains.

- **Files changed**:
  - `sources/supabase/functions/stock-report/probeRound.ts` (optional `probeDeadline` param, `deferred` result field, budget check in main loop)
  - `sources/supabase/functions/stock-report/index.ts` (added `PROBE_BUDGET_MS = 30_000`, compute `probeDeadline`, pass to `probeRound()`)
  - `sources/supabase/functions/stock-report/probeRound.test.ts` (new test cases for budget exhaustion and defer behavior)

- **Alternative not taken**: Dropping `twt38u` from probes (rejected per original acceptance decision — reduction in coverage is worse than the bounded timeout risk).

- **Verification**: `npx vitest run supabase/functions/stock-report/` — probeRound tests exit 0. No probe round timeout observed in DEV under normal load (30s budget caps worst-case round at 30s total, well below Edge 60s limit).

- **Status**: ✅ FIXED in **0.9.11** (commit 8003b6a, 2026-08-24).

### Bug ID: BUG-035 — `twt38u` content fingerprint was raw table text, not a hash

- **Symptom**: `foreignTopFingerprint()` in `sources/supabase/functions/stock-report/twForeignTop.ts` joined every buyTop/sellTop cell with U+001F and returned that string directly. Measured on DEV `source_probe_tick`: roughly 10KB per row.

- **Root Cause**: The value is persisted in two places — `source_probe_tick.fingerprint` on every probe round, and `market/foreign_top50.json` in Storage as that file's idempotency key (`index.ts` `syncForeignTop` compares `existing?.fingerprint === fingerprint`). Every other probe source already stores the short `<length>:<djb2>` form produced by `fingerprint()` in `pollPlan.ts`. This was an inconsistency and a storage cost, not a correctness bug — equality comparison worked either way.

- **Fix**: `foreignTopFingerprint()` now returns `fingerprint(cells.join(UNIT_SEP))`. The U+001F separator still applies before hashing, so the AUDIT-04 concatenation-collision property is preserved. `twForeignTop.ts` gained one import from `./pollPlan.ts`.

- **Test change**: The old test asserted the fingerprint string contained U+001F, which is unobservable once hashed. It was replaced with a behavioural assertion that `['12','3']` and `['1','23']` produce different fingerprints, plus a new assertion that the fingerprint matches the short hash form.

- **Expected one-time side effect, already documented in the changelog**: After deploy, the first `syncForeignTop` comparison sees the old raw-format fingerprint in `market/foreign_top50.json` and re-uploads once. Self-healing. `source_probe_tick` only compares within a single day's window, so it is unaffected from the next day.

- **Files changed**:
  - `sources/supabase/functions/stock-report/twForeignTop.ts` (use `fingerprint()` on result)
  - `sources/supabase/functions/stock-report/twForeignTop.test.ts` (test changed from content assertion to collision detection + format assertion)

- **Verification**: `npx vitest run supabase/functions/stock-report/` — 366 tests passed, 0 failed. `npm test` — 75 files, 1136 tests passed. `npx tsc --noEmit` and `npm run typecheck:edge` — clean.

- **Status**: ✅ FIXED in **0.9.7** (2026-08-20 20:45:00 Asia/Taipei).

---

### Bug ID: BUG-033 — Margin probe fingerprint was always a constant (empty string hash)

- **Symptom**: `source_probe_tick.fingerprint` for source `margin` was always `0:45h` (the fingerprint of an empty string). Verified on DEV: every margin row on 2026-08-18 and 2026-08-19 carried `0:45h`.

- **Root Cause**: `probeSource` in `sources/supabase/functions/stock-report/index.ts`, the `id === 'margin'` branch read `(resp as { data?: unknown[] }).data`, but `MarginDatedResponse` has no top-level `data` field — its rows live under `tables[]`. `fingerprint(undefined)` therefore returned the empty-string fingerprint on every round.

- **Impact**: The probe's content-settled retire gate was dead code for `margin` — it compared `0:45h` to `0:45h` and always said "settled". `rows` was also always null for that source, hiding the actual per-stock row count.

- **Fix**: Added exported `marginDatedFingerprint()` function in `sources/supabase/functions/stock-report/twChips.ts`, built on the existing `marginTable()` helper (now exported) plus `rowsFingerprint` from `pollPlan.ts`, so row order does not count as a revision and the market-total table `tables[0]` does not affect the result. `index.ts` uses it, and `rows` now reports the real per-stock row count.

- **Files changed**:
  - `sources/supabase/functions/stock-report/twChips.ts` (new exported `marginDatedFingerprint` and `marginTable`)
  - `sources/supabase/functions/stock-report/index.ts` (use new `marginDatedFingerprint` in margin branch)
  - `sources/supabase/functions/stock-report/twChips.test.ts` (new tests for fingerprint)

- **Verification**: `npx vitest run supabase/functions/stock-report/` — 365 tests passed, 0 failed. `npx tsc --noEmit` clean. Reviewer: **PASS**, no findings.

- **Status**: ✅ FIXED in **0.9.6** (2026-08-20 17:55:00 Asia/Taipei).

---

### Bug ID: BUG-034 — Probe retire gate had two independent holes in its logic (open-ended revision history + transient run trap)

- **Symptom**: The old rule retired a source when total landed count ≥ `REQUIRED_LANDED_COUNTS[id]` AND (`REQUIRE_SETTLED_CONTENT[id] === false` OR the last two fingerprints were equal). Two failure modes: (1) `A → B → B` would retire immediately even though `A → B` proved the upstream was still revising; (2) `contentSettled` read only the last two entries, losing track of all intermediate revisions.

- **Root Cause**: The retire logic gate mixed two incompatible ideas: a count threshold (`REQUIRED_LANDED_COUNTS`) and a content-settlement gate (`contentSettled` reading only the last two fingerprints). A stale re-fetch (returning fingerprint B) would read as "settled" even though the session was B → C → B in full.

- **Impact**: Sources could be retired while their upstream was still revising. Later follow-up rounds would re-probe a source marked retired, breaking the retry loop's assumption of monotonic progress.

- **Fix**: Rewrite the rule to trailing-run counting. `counts[id]` now holds the length of the trailing run of identical fingerprints (new exported `trailingRun` function in `sourceProbePlan.ts`). `retiredSources(counts, required)` checks only `counts[id] >= required[id]`. Any content change resets the counter to 1. Deleted `REQUIRE_SETTLED_CONTENT` and `contentSettled` — MOPS needs a run of 1 (trivially satisfied), so its old "retire on first landing regardless of fingerprint" behaviour is preserved.

- **`REQUIRED_LANDED_COUNTS` values unchanged**: Measured reason recorded to dispute the code comment claiming "T86 revises every 15 minutes". DEV `batch_run_log` for 2026-08-12..08-19 shows T86 revises **at most once per day**, and the revision lands between roughly 17:00 and 20:45 — outside t86's 16:00–17:00 probe window. Raising the count would catch nothing. The revision is instead picked up by later follow-up rounds, which re-fetch T86 and reset `t86_frozen` via `nextT86State`.

- **Files changed**:
  - `sources/supabase/functions/stock-report/sourceProbePlan.ts` (new exported `trailingRun` function)
  - `sources/supabase/functions/stock-report/sourceProbePlan.test.ts` (new tests for trailing run)

- **Verification**: `npx vitest run supabase/functions/stock-report/` — 365 tests passed, 0 failed. `npx tsc --noEmit` clean. Reviewer: **PASS**, no findings.

- **Status**: ✅ FIXED in **0.9.6** (2026-08-20 17:55:00 Asia/Taipei).

---

### Bug ID: BUG-032 — Held stock buy fee counted twice in P&L simulator

- **Symptom**: When simulating what-if scenarios for held stocks, the 買進價 defaulted to `avgCost` (fee-inclusive average cost). The `whatIf()` function then added `buyFee` again, inflating 投入成本 by ~0.14% (measured NT$4,276 excess on a ~NT$3M position). The cost breakdown in 對帳單 showed the overstated number; the P&L was correct (both based on same `whatIf()` call) but the cost line was wrong.

- **Root Cause**: `WhatIfTab` defaulted held stock's 買進價 to `avgCost` (fee-inclusive, from 庫存總覽). The `whatIf()` function then added `buyFee` again during entry cost computation. Pre-existing behaviour; made visible in 0.9.1-dev.2 because 對帳單 now shows 投入成本 and 手續費 explicitly (0.9.1-dev.1 showed only headline P&L).

- **Fix (chosen option)**: Use the raw traded price (fee-exclusive) as the default 買進價. Specifically: replace `avgCost` prop with `rawAvgCost` throughout (source: `Holding.rawAvgCost`, computed as `pos.rawCost / pos.qty`, where `pos.rawCost` accumulates only `tx.price * tx.qty` without fees). The fee is now counted exactly once in `whatIf()`. Files changed:
  - `sources/src/components/StockDetail/WhatIfTab.tsx` — `avgCost` prop renamed to `rawAvgCost: number | null`; used for 買進價格 default, `isHeld` check, ladder anchor, avgCost mark, and marks strip. Hint text now reads `買進價預設為成交均價 <price>（未含手續費）`.
  - `sources/src/components/StockDetail/StockDetailPage.tsx` — `StockDetailPageProps` gains `rawAvgCost?: number | null` (defaults to `null`), forwarded to `WhatIfTab`.
  - `sources/src/components/StockDetail/AnalysisPage.tsx` — passes `selected.row.holding.rawAvgCost` through that dedicated prop.
  - `sources/src/components/StockDetail/WhatIfTab.test.tsx` — prop renamed throughout; two new test cases added: `買進價用未含費的成交均價，手續費只算一次` (asserts 投入成本 − 價金 ≤ 150 on 100k position, verifying only one 0.1425% fee) and `提示說明買進價來自未含費的成交均價`.

- **What was deliberately not changed**: `pnlEngine.ts`, `fees.ts`, `whatIf()` maths, 庫存總覽 / `DashboardPage`, `YearlyPage`, `estimateUnrealized`, and `ReportHolding` / `reportProxy.ts` (report Edge payload type not widened).

- **Verification**: `npx vitest run` → 73 files / **1113 tests**, all pass. `npx tsc --noEmit` → 0 errors. `npx oxlint src` → 0 errors (5 pre-existing only-export-components warnings). `npm run build` → ok. Review: `route:reviewer` **PASS**, zero findings — end-to-end fee-exclusive path verified, no other `Holding.avgCost` consumers changed, new prop optional, watched stocks behave as before.

- **Status**: ✅ FIXED in **0.9.4** (2026-08-20 13:42:49 Asia/Taipei).

---

### Bug ID: BUG-031 — Watched ticker had no quote because `useStockPrices` only covers holdings

- **Symptom**: User added a non-held stock (e.g., 1101) to watchlist. Analysis page showed 「行情尚未取得／目前抓不到這檔股票的報價」. The new P&L simulator tab (introduced in 0.8.0) could not function because it had no price data — exactly the use case the watchlist feature exists for (analyzing stocks not in the portfolio).

- **Root Cause**: `AnalysisPage` passed `quote={null}` for every watched entry because `useStockPrices` hook only fetches holdings. The hook enumerates holdings via the portfolio service and makes a single batch request for their prices, but has no mechanism to extend that fetch to stocks that are watched but not held.

- **Fix**: For the selected watched entry only, invoke `fetchPrices([{ market: 'TPE', ticker }])` from `services/priceProxy.ts`, keyed on the selected watched ticker ID. Set up an effect cleanup `cancelled` flag to prevent a stale response for a previously selected ticker from overwriting data for the current selection. Failure leaves the quote null and never blocks rendering. Holdings' price fetch path remains unchanged.

- **Regression test**: Browser E2E (Playwright): Select a watched non-held ticker → verify `quote` is populated → P&L simulator can compute and display meaningful values (e.g., "回本價 NTD 25.18" for a real 1101 position).

- **Status**: ✅ FIXED in **0.8.1** (2026-08-19 11:58:53 Asia/Taipei).

---

### Bug ID: BUG-030 — 管理觀察 button looked dead because panel rendered far below fold

- **Symptom**: User clicked the 管理觀察 button in the analysis page. Nothing appeared to happen. The component did render, but off-screen: it was appended as a flat `<section>` after the full-length `<StockDetailPage>` report, placing it hundreds of pixels below the viewport, so the click appeared to have no effect.

- **Root Cause**: `WatchlistPanel` was rendered as a plain inline `<section className="glass section">` placed after `<StockDetailPage>` in `AnalysisPage.tsx`. Because `StockDetailPage` is a full-length report page (headers, chip table, analysis content, AI section), adding content after it appends it far below the fold in a typical viewport. The panel had its own internal head and close button, so it did not signal its off-screen state.

- **Why unit tests passed**: jsdom has no layout engine, so bounding box checks are impossible. All 1058 component and integration tests passed while the feature was unusable in the browser. The failure was purely a layout/placement issue invisible to DOM testing.

- **Fix**: Wrap the panel in the existing shared `sources/src/components/Common/Modal.tsx` component, which portals to `document.body`, brings an overlay, Esc-to-close handler, and a single close button with `aria-label="關閉"`. Remove the panel's own head and duplicate close button to avoid redundancy.

- **Regression test**: Browser E2E: Panel must be a `role="dialog"` portaled outside the caller's subtree (`container.contains(dialog) === false && document.body.contains(dialog) === true`); verify dialog bounding box is inside viewport (e.g., y=49 with viewport 800px high).

- **Status**: ✅ FIXED in **0.8.1** (2026-08-19 11:58:53 Asia/Taipei).

---

### Bug ID: BUG-029 — TWT38U probing never ran since 0.7.19 — two independent gaps in dispatch path

- **Symptom**: TWT38U (外資買賣超) was added as the 8th probe source in 0.7.19 (Task 113b), but probing never executed a single time on PROD or DEV. Window 17:00–18:00 existed, 3-landing target was set, but every day passed with zero landed hits. Task 113b was recorded with `⚠️ Reviewer: NOT RUN`, so the dispatch wiring was never verified.

- **Root Cause — Gap 1**: `sourceProbePlan.ts` function `sourcesForTaipeiTime()` iterated a hardcoded tuple `['bfi82u','t86','bwibbu','margin','borrow']` that omitted `'twt38u'`. Despite `DAILY_WINDOWS.twt38u` being defined, `REQUIRED_LANDED_COUNTS['twt38u'] = 3`, `REQUIRE_SETTLED_CONTENT['twt38u'] = true`, `PROBE_FOLLOW_UP['twt38u']` being wired, and `sourceLanded('twt38u')` being implemented, the scheduler never emitted the source because it was filtered at derivation time.

- **Root Cause — Gap 2**: `probeSource()` in `index.ts` had no branch for `id === 'twt38u'`. Even once the scheduler emitted it, every 5-minute tick would fall through to `fail('unknown source')` and never hit, never retire, re-probing every 5 minutes for the whole window forever.

- **Why test suite stayed green**: `sourceProbePlan.test.ts` assertions locked in the five-source list as correct (assertions at 17:00 and 18:00 expected exactly those five). `index.ts` is Deno-only so no vitest test executes `probeSource()`, leaving Gap 2 undetected.

- **Fix**:
  1. `sourceProbePlan.ts` — `sourcesForTaipeiTime()` now derives the daily-source list from `Object.keys(DAILY_WINDOWS)` instead of a hardcoded tuple, so adding a source to the windows table can no longer silently skip it.
  2. `index.ts` — new `if (id === 'twt38u')` branch: `fetchRwdJson(twt38uUrl(todayYmd))` with a null guard, `parseForeignTop`, `hit = parsed !== null && parsed.rawDate === todayYmd`, `fingerprint` via `foreignTopFingerprint`, `rows = buyTop.length + sellTop.length`.
  3. `sourceProbePlan.test.ts` — window assertions updated to expect `twt38u`, plus new tests locking the 17:00–18:00 boundary and the weekend case.

- **Accepted Risk**: `probeRound.ts:95–98` has no per-source deadline/budget check (only the follow-up loop does). At 17:00 three windows now overlap (`t86` ends 17:00 inclusive, `bwibbu` and `twt38u` start at 17:00); at 17:15/17:20 four sources are scheduled. Each fetch carries a 10s timeout, so worst case moves closer to the 60s Edge Function limit. Accepted deliberately, not fixed.

- **NOT deployed**: Fix is code-only and uncommitted. PROD is still running the old bundle. TWT38U will not probe there until the Edge Function is redeployed. Deployment was not performed (project rule: no deploy without explicit user instruction).

- **Verification**: 
  - `npx vitest run supabase/functions/stock-report/` — 15 files, 352 tests passed, 0 failed. The 2 new assertions failed before the fix and pass after.
  - `npm run typecheck:edge` — no errors.
  - `npx oxlint supabase/functions/stock-report/` — clean.
  - Reviewer: FAIL on round 1 (found Gap 2 above), PASS on round 2 after fix.

- **Files changed**: 
  - `sources/supabase/functions/stock-report/sourceProbePlan.ts` (derive from `Object.keys`)
  - `sources/supabase/functions/stock-report/index.ts` (`twt38u` branch in `probeSource`)
  - `sources/supabase/functions/stock-report/sourceProbePlan.test.ts` (window assertion updates + new tests)

- **Status**: ✅ FIXED in **0.7.22-dev.1** (2026-08-18 21:20:00 Asia/Taipei).

---

### Bug ID: BUG-028 — 帶日期的 BWIBBU 端點在「尚未發布」時回 200，被快取一整天，導致當日所有基本面檔案被跳過

- **Symptom (measured on PROD `kxnxadaghidwumqsqneu`)**: 
  - `source_probe_tick` for `bwibbu`: 2026-08-14 had 42 ticks / 17 hits / **0 landed**; 2026-08-17 had 19 ticks / 15 hits / **0 landed**. The source hit repeatedly and never retired because it never landed.
  - Tick notes: `17:20 估值日=今日（1083 筆）· 已觸發 generate-market-data：日線 2／基本面 2 · 資料未到位，下輪重試`, then every later round `日線 0／基本面 0`.
  - Storage: of 47 `fundamental/*.json` objects, **40 were last written 2026-08-10** — valuation data (本益比／殖利率／股價淨值比) had been silently stale for 6 trading days. `fundamental/2609.json`, written 17:08 on 2026-08-17, carried `valuation: null`.

- **Root Cause**: TWSE's `BWIBBU_d` endpoint returns **HTTP 200** with `{"stat":"很抱歉，沒有符合條件的資料!"}` and no `data` before the table publishes (~17:15 Taipei) — verified live. `readLatest` (`index.ts`) cached any response that did not throw, and `fetchJson` only throws on non-2xx. So the first `generate-market-data` run before 17:15 wrote that empty payload into the day's `BWIBBU_D` cache key. Every later run then read it back, so `normaliseBwibbuDated` returned null, `freshValuationDay` was null, `valuationCurrent` was therefore always true, and **every** fundamental file hit the `skipped++; continue` branch for the rest of the day.

- **Two hypotheses investigated and disproved**:
  1. "PROD Edge is running pre-0.7.15 code." Disproved: `functions list` showed `stock-report` v49 deployed 2026-08-17 16:59.
  2. "`bwibbu?.[0]?.Date` reads a field the dated endpoint does not have." Disproved: `normaliseBwibbuDated` reshapes the response and fills `Date` from the requested ymd; running the real 1083-row payload through `normaliseBwibbuDated` + `extractValuation` produced correct valuations for 2609 / 3231 / 2330.

- **Fix**: `readLatest` gained an optional validity predicate; the cache write is skipped when it returns false, and the fetched value is still returned. The BWIBBU call site passes the new `bwibbuDatedUsable` from `twFundamental.ts`, which is defined in terms of `normaliseBwibbuDated` so the two cannot drift. This makes `readLatest` consistent with `loadT86`, which already guarded its cache write with `t86Ok`. The other three `readLatest` call sites (MI_MARGN, T187AP05_L, T187AP17_L) pass no predicate and are unchanged.

- **Accepted Risk**: on a weekday market holiday `BWIBBU_D` is never usable, so `readLatest` re-fetches every round instead of caching once — on the order of 30 extra requests to twse.com.tw that day, with no backoff. Accepted deliberately: the alternative is a full day of silently stale valuations, which is the bug itself.

- **No cache purge needed** — `chip_raw_cache` is keyed by day, so the next trading day starts clean. Today (2026-08-18) may still be poisoned and will recover tomorrow.

- **Files changed**:
  - `sources/supabase/functions/stock-report/twFundamental.ts` (new exported `bwibbuDatedUsable`)
  - `sources/supabase/functions/stock-report/index.ts` (`readLatest` optional predicate + BWIBBU call site)
  - `sources/supabase/functions/stock-report/twFundamental.test.ts` (3 new tests)

- **Verification**: `npx vitest run` — 68 files / **987 tests passed** (was 984). `npx tsc -p tsconfig.edge.json` clean, `npm run build` ok, `npx oxlint src supabase` 0 errors. Reviewer verdict **PASS**. Live check: `bwibbuDatedUsable` agreed with `normaliseBwibbuDated` on four real payloads (2 published days true, unpublished day and Sunday false).

- **Status**: ✅ FIXED in **0.7.20** (2026-08-18 15:46:30 Asia/Taipei).

### Bug ID: BUG-028 — `ProbeWarRoom` falsely marked source as retired on first hit due to substring match on tick note
- **Found by**: Unit testing & code inspection of `ProbeWarRoom.tsx`.
- **Description**: `ProbeWarRoom` component checked `sourceTicks.some((t) => t.note?.includes('到位'))` which caused daily sources (target: 3 hits) to prematurely show "✅ 已退休" after only 1 hit when the tick note stated "資料已到位".
- **Root Cause**: Prematurely treating single-tick note strings as source retirement state instead of requiring `hitCount >= s.target`.
- **Impact**: Admin status page displayed misleading "✅ 已退休" badge for sources on their 1st or 2nd hit instead of "🟢 探測中 (1/3)" or "🟢 探測中 (2/3)".
- **Fix**: Restricted `isRetired` strictly to `hitCount >= s.target`.
- **Regression test**: `ProbeWarRoom.test.tsx` asserting 1/3 and 2/3 hits show `🟢 探測中` and only 3/3 hits show `✅ 已退休`.
- **Status**: ✅ FIXED in **0.7.17** (2026-08-14 18:00:00 Asia/Taipei).

### Bug ID: BUG-026 — `decideSkip` had no borrow term, so a late 借券 flip could never trigger a real run
- **Found by**: reading 2026-08-11's probe ticks on both environments (not reported by a user).
- **Description**: `decideSkip` (`pollPlan.ts:154`, pre-fix) retired the chips phase on
  `t86Today && t86Frozen && marginToday`, with no borrow term at all. 借券 flips to the next trading
  day only after close-plus-settlement — measured **22:15 on both DEV and PROD** on 2026-08-11, later
  than every other term in that gate. So from ~21:00 the gate already answered `complete`, and every
  invocation after that short-circuited **before `loadBorrow` ever ran**.
- **Proven by execution** (2026-08-11, `source_probe_tick` + `batch_run_log`, identical on both
  environments):

  | time | `source_probe_tick` note | `batch_run_log` |
  | ---- | ---- | ---- |
  | 22:15 / 20 / 25 / 30 / 35 / 40 / 45 | `已觸發 generate-chips：產出 0 檔 · 資料未到位，下輪重試` (×7) | `skipped=t, skip_reason=complete, borrow_ok=f`, duration 144–221ms |

  Seven identical `產出 0 檔` notes gave no hint the gate had short-circuited — the skip was only
  findable by joining to `batch_run_log`. The two `stock-report-nightly` cron passes at 21:30/21:45
  went through the **same gate** and were skipped the same way, so there was no outer retry either;
  borrow ended the day unlanded.
- **Root cause**: the `complete` branch in `decideSkip` (`pollPlan.ts`) ANDed only
  `t86Today && t86Frozen && marginToday`. Borrow was never represented, so once the other three terms
  were true (~21:00) the gate stayed `complete` regardless of what borrow was doing.
- **Impact**: from ~21:00 onward every `generate-chips` invocation for the rest of the day was a no-op,
  including the 7 borrow-probe follow-ups at 22:15–22:45 and the two `stock-report-nightly` passes.
  借券賣出 never landed for 2026-08-11.
- **Fix** (`pollPlan.ts`, `index.ts`): added `borrowLanded: boolean` to `decideSkip`'s input and ANDed
  it into the `complete` branch (`run-cap` keeps precedence). Computed at the call site in
  `runGeneratePhaseChips` as `borrowHit(last?.borrowDataDate ?? null, todayYmd)`, reusing the existing
  `borrowHit` predicate from `sourceProbePlan.ts` — it already answers exactly this question
  (「借券的日期有沒有走過今天」, not 「有沒有抓過借券」). `borrow_data_date` added to the `readLastRun`
  select so the date carries across rounds the same way `t86_fingerprint` already does.

  A second fix travels with this one: `borrowDataDate` is now **seeded from the previous row instead
  of `null`**. A skipped round fetches nothing, so logging `null` would erase the very date that
  justified the skip — and since `decideSkip` reads that column back, the gate would then flip between
  skip and run every other round.
- **Regression test**: `pollPlan.test.ts` — `borrowLanded:false` with the other three terms true must
  be `{skip:false}`; the same with `borrowLanded:true` must be `{skip:true, reason:'complete'}`.
- **Status**: ✅ FIXED in **0.7.13** (`ce3c220` on `dev`, 2026-08-12 10:48). 992/992 vitest,
  `typecheck:edge` 0 errors, `tsc -b` clean, `oxlint` clean. DEV Edge deployed 10:50 and smoke-verified
  — two consecutive `generate-chips` calls advanced `runs_today` 1 → 2, which proves the new
  `borrow_data_date` select in `readLastRun` actually works (a bad select would have returned an
  error, made `readLastRun` answer `null`, and degraded silently).
  ⏳ **The live proof is still pending** and must not be claimed until it happens: borrow should show
  no ticks before 21:00 tonight, and its hit round (~22:15) should reach `data_landed=true` and then
  stop instead of repeating to window close.

### Bug ID: BUG-027 — `readFundamentalSnapshot` sampled only 20 holdings from an unordered query
- **Found by**: reading 2026-08-11's probe ticks on both environments; explains the open question
  recorded in commit `ac3177e` (`mops_profit` answered `landed=false` on PROD and `true` on DEV at
  21:00, same v45 bundle).
- **Description**: `readFundamentalSnapshot` (`index.ts`, pre-fix) took
  `(await batchTwTickers()).slice(0, MAX_FUNDAMENTAL_SAMPLE)` with the cap at 20, and its `max` across
  that sample decides `data_landed` for `bwibbu`, `mops_revenue` and `mops_profit`. `batchTwTickers` →
  `heldTwTickers` selects from `transactions` with **no `ORDER BY`**, so which 20 survived was
  whatever row order Postgres happened to return.
- **Strongly supported, not replayed**: PROD holds 26 distinct TW tickers (the cap bites); DEV holds 5
  (the cap can never bite). That is the shape of the `ac3177e` open question and makes the sampling
  order the supported explanation for it — but the 21:00 row order that day was not captured, so this
  is inferred from the cap's structural difference between environments, not reproduced. The fix
  removes the failure mode either way.
- **Root cause**: an unordered SQL query feeding a truncating `.slice()`, whose result silently
  decides a three-source landing verdict.
- **Impact**: on any environment whose holdings exceed the 20-ticker cap (PROD), the landing verdict
  for `bwibbu` / `mops_revenue` / `mops_profit` rode on arbitrary row order. The failure direction was
  safe (missing a Q2 holding reads as 「沒有證據」 → retries) but the retries could persist all day for
  no real reason.
- **Fix** (`index.ts`): dropped `.slice(0, MAX_FUNDAMENTAL_SAMPLE)`; reads all holdings now. Deleted
  the now-orphaned `MAX_FUNDAMENTAL_SAMPLE` constant. The `max` reduction and the `catch → null` fail
  path were left alone — `null` is correctly read as 「沒有證據」 by `sourceLanded`.
- **Status**: ✅ FIXED in **0.7.13-dev.1** (commit `ce3c220`, 2026-08-12 10:48). Same verification and
  deploy status as BUG-026 above — no unit test exists for this function (`readFundamentalSnapshot`
  lives in `index.ts`, which vitest cannot import; see BUG-026 note and Task 87).

### Bug ID: BUG-024 —— 估值 BWIBBU 每天存進去的都是「前一個交易日」
- **Description**: The valuation cached under trading day N has, on every day on record, carried day N−1's
  data. Nothing schedules a re-fetch, and the probe that was supposed to detect this asks an endpoint
  that cannot answer the question.
- **Proven by execution** (2026-08-11 19:3x, DEV `chip_raw_cache`):

  | cache key | written | payload's own `Date` |
  | ---- | ---- | ---- |
  | 20260811 | 08-11 16:57 | **1150810** |
  | 20260810 | 08-10 16:30 | **1150807** (08-10 was a Monday) |
  | 20260807 | 08-07 16:56 | **1150806** |

  Not once is the payload's self-reported date equal to its own cache key.
- **Root cause —— three things compounding**:
  1. **The endpoint has no date parameter.** `BWIBBU_ALL_URL` (`openapi.twse.com.tw/v1/exchangeReport/
     BWIBBU_ALL`) is a snapshot that trails the market by a trading day. Measured 2026-08-11 19:36:
     OpenAPI returned 1083 rows all dated `1150810`, while the **dated** RWD endpoint
     `www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?date=20260811&selectType=ALL` returned
     `stat: OK`, `date: 20260811`, **1084 rows**. Today's valuation was published; we were asking the
     wrong surface.
  2. **`readLatest` freezes the first answer of the day.** Its cache key is the trading day we are
     building for, so the first fetch wins and every later call that day eats the cache —— even after
     the mirror catches up. This is the same mechanism `SPEC.md` § Data source probe already documents
     as the reason the probe experiment exists; nobody had connected it to BWIBBU.
  3. **Nothing re-runs it.** `generate-market-data` has **no cron** (documented choice in `schema.sql`:
     phases split for free-tier wall clock, market-data/history left as 「admin manual in this
     experiment; may gain their own crons later」). Since 0.7.8 the probe follow-up was the de-facto
     automatic path —— and the bwibbu probe can never fire, see below.
- **Why the probe never caught it**: `bwibbu`'s hit rule compares the snapshot's self-reported ROC date
  to today. Because the snapshot always trails, that comparison is false for the whole 17:30–22:00
  window —— **0 hits in 27 probes on 2026-08-11**. Contrast the other daily sources, whose requests
  carry the date, which is exactly why they can answer 「今天的出了沒」.
- **Impact**: valuation (本益比 / 殖利率 / 股價淨值比) shown in the app is one trading day stale, every
  day. **Not mislabelled** —— `twFundamental.ts` writes `dataDate: rocDate(row.Date)`, so the record
  carries its true date; the cost is latency and a probe readout that measures the mirror's lag rather
  than the source's publication time.
- **Fix (not yet applied)**:
  1. Point the `bwibbu` probe at the dated RWD endpoint, so its hit rule matches the other four
     (「請求自帶日期 → 表回來了就是今天的」).
  2. Give `generate-market-data` and `generate-history` their own crons —— the probe follow-up should
     not be the only automatic path for 估值 / 月營收 / 季報.
  3. Optionally move the ingest to the dated endpoint too. Different shape: 8 columns
     (`證券代號/證券名稱/收盤價/殖利率(%)/股利年度/本益比/股價淨值比/財報年季`) vs the OpenAPI object,
     so position fields by header text as `twProfitHistory` already does —— do not index blindly.
- **Status**: ✅ FIXED in 0.7.11 (2026-08-11 20:40)

**Fixed in 0.7.11.** Three separate faults, all pushing the same way; fixing any two would not have
helped. (1) probe + ingest moved to the dated `BWIBBU_d` endpoint, normalised by header text.
(2) the per-ticker seal `existing.dataDate >= targetDate` sealed a file built earlier that day from
the stale snapshot —— it now also requires the valuation inside to match the day actually fetched.
(3) `generate-market-data` / `generate-history` gained crons in both environments.

Proven live on DEV, and the tick log is the demonstration:

| 20260811 | hit | data_landed | note |
| ---- | ---- | ---- | ---- |
| 20:35 | ✅ | **false** | 已觸發 generate-market-data · 資料未到位，下輪重試 |
| 20:40 | ✅ | **true** | 已觸發 generate-market-data · 資料已到位 |
| next round | —— | —— | `bwibbu` in `skipped`; no probe, no fetch |

The 20:35 row is the mechanism refusing to retire a source whose data had not reached the file the UI
reads —— at that moment it genuinely had not, because of fault (2). That is the behaviour being bought.


### Bug ID: BUG-025 — 收盤後十分鐘，行情卡仍寫「盤中」且價量是收盤前的值
- **Date**: 2026-08-11, fixed in **0.7.5**
- **Reported**: user, 13:31 Taipei — 「應該已經是盤後了，右上角還是盤中」.
- **Symptom**: 13:30–約 13:40 之間，個股分析「行情」右上角狀態停在 `盤中`（正確應為 `已收盤`），
  現價／開高低／量都是收盤前最後一次撮合的值。儀表板的現價與未實現損益吃同一份報價。
  **手動重新整理無效**。約 13:40 自行恢復。
- **Proven, not inferred**: MIS 在 13:31 已回 `t=13:30:00`、`ip=0`（實測 2330／2317），上游沒問題。
  `QuoteTab` 的狀態來自 `isClosed(quote)`＝`tradeTime >= '13:30:00'`，所以問題在快取沒換掉那筆
  13:29 的報價。
- **Root Cause**: `quoteWindow.twQuoteTtlMs` 在 08:25–13:30 之外，只要 `tradeTime` 未達 13:30:00
  就回 `UNSETTLED_RETRY_MS = 10 分`。收盤那一輪（13:30:30）拿到的正是 13:29 的盤中快照 →
  被判為「還新鮮十分鐘」→ 前端 60 秒輪詢空轉，一次請求都不發。
  `UNSETTLED_RETRY_MS` 是 0.6.42 為了 AUDIT-02（Yahoo 備援永遠不回撮合時間，整夜每分鐘輪詢）
  加的退避，但它被套用到 13:30 之後的**每一刻**，包含收盤撮合即將落地的那幾分鐘。
  手動重新整理無效是因為 `force` 只跳過前端 L1；Edge 的 `price_cache` 用同一支函式判 TTL。
- **Impact**: 每個交易日固定重現的十分鐘。顯示的是真實成交價，但不是收盤價，且標籤主動說謊。
- **Fix**: 新增 `SETTLE_END_MS = 14:00` 沉澱窗——13:30–14:00 之間未定案的報價回到 `POLL_MS`
  60 秒，過 14:00 才退回 10 分鐘。已定案的（`tradeTime >= 13:30:00`）仍立刻鎖到隔天 08:25。
  最壞情況（整個沉澱窗 MIS 都掛）每檔多 30 次請求，有界，與 AUDIT-02 的整夜輪詢不同量級。
  **前端與 `stock-price` Edge 兩邊都要部署**，只改一半不會生效。
- **Regression test**: `quoteWindow.test.ts`「13:30–14:00 沉澱窗…」與 `priceProxy.test.ts`
  「沉澱窗內每分鐘重問」——後者原本斷言的正是錯誤行為，已改寫。
- **Not fixed here（既有問題）**: Yahoo 備援永遠回 `tradeTime: null`，`isClosed` 因此恆為 false，
  MIS 斷線期間整天都會顯示「盤中」。那是 AUDIT-02 的第二半，需要另外標示資料來源才能解。

### Bug ID: BUG-024 — 融資／融券 both empty (chips phase 500 after 0.7.0)
- **Date**: 2026-08-11, fixed in **0.7.1**; PROD Edge **stock-report v39**
- **Symptom**: 個股籌碼「融資融券」整區空（融資＋融券同掛，因同一 `MarginChip`）；Admin 盤後批次在
  約 20:45 後每輪 500；`batch_run_log` 停在當日 17:00 左右，`margin_today` 永遠看不到 true。
- **Root Cause**: 0.7.0 holdings-only cleanup **deleted** `chipReportReady` and `fundamentalSoftReady`
  but left `evaluateTickerScope` calling both. After chips uploads, the phase threw
  `chipReportReady is not defined` / `fundamentalSoftReady is not defined` → no `logBatchRun`,
  subsequent crons 500. TWSE `MI_MARGN` itself was fine (DEV cache had 20260810 @ 21:00).
- **Fix**: restore both helpers in `stock-report/index.ts`. DEV: volume-copy + restart functions +
  manual `generate-all` → 5 holdings regenerated with margin/short. PROD: deploy v39
  (`--no-verify-jwt`, sha `fd12b418…`, commit `e751e3a`). Watchlist still out of night batch
  by 0.7.0 design (holdings-only).
- **Status**: ✅ FIXED (0.7.1; PROD stock-report v39).

### Bug ID: BUG-023 — Manual 「全部執行」 showed opaque non-2xx
- **Date**: 2026-08-10, fixed in **0.6.47**
- **Root Cause**: Frontend sent one `admin-run` with all jobs; Edge ran them
  sequentially in a single request. Wall-clock / idle ~150s → gateway **504**;
  body often not `{ error: string }`, so supabase-js only showed
  `Edge Function returned a non-2xx status code`. Confirmed path: 全部執行.
- **Fix**: `runAdminJobs` invokes **one job per request** and aggregates results;
  504/non-JSON errors surface status + hint. Frontend only (Pages deploy).
- **Status**: ✅ FIXED (0.6.47).

### Bug ID: BUG-019 — An unparsed cron looked like intended output (AUDIT-05)
- **Date**: 2026-08-06, fixed in 0.6.43
- **Root Cause**: `describeCron` returned the bare expression when no branch matched. Echoing it was the honest
  choice —— a cron string beats a mistranslated sentence —— but on screen it was indistinguishable from a
  deliberate rendering, so a missing branch could sit there unnoticed. BUG-012 and BUG-014 both hid exactly there.
- **Fix**: the fallback prefixes 「未解析的排程 」 and still shows the expression. The next unmatched shape announces
  itself the moment it renders.
- **Status**: ✅ FIXED (0.6.43), frontend only.

### Bug ID: BUG-020 — A failed local-mode write said nothing (AUDIT-06)
- **Date**: 2026-08-06, fixed in 0.6.43
- **Root Cause**: `dataProvider.writeStore` was the one unguarded localStorage write. Letting it throw is correct
  —— silently dropping a user's transaction would be worse than an error —— but it threw the raw
  `QuotaExceededError`, which surfaced as an unhandled rejection far from the save. The data was lost and the
  screen said nothing.
- **Fix**: catch and rethrow with a cause the user can act on (storage full → export and prune; private window →
  use a normal window). `TransactionForm` already renders `寫入失敗：{message}`, so the message now reaches the user.
- **Status**: ✅ FIXED (0.6.43), frontend only.

### Bug ID: BUG-021 — `shiftPeriod` could produce a negative month (AUDIT-07)
- **Date**: 2026-08-06, fixed in 0.6.43
- **Root Cause**: `total % 12` where JavaScript's `%` keeps the dividend's sign, so a negative ordinal yields a
  negative month. **Unreachable at today's years** —— a trap disarmed rather than an observed defect.
- **Fix**: floored modulo `((total % 12) + 12) % 12`.
- **Status**: ✅ FIXED (0.6.43). Edge code, deployed with the 0.6.43 functions.

### Bug ID: BUG-022 — 「顯示全部」 could not reach the whole file (AUDIT-08)
- **Date**: 2026-08-06 (introduced by me in 0.6.38), fixed in 0.6.43
- **Root Cause**: the turnover table read the same 60-day slice the charts use, while `market/daily.json` keeps up
  to 120 days. `SHOWN_DAYS` exists to keep an X axis readable —— a chart's problem, which a table does not have.
- **Fix**: the table reads `market.days` in full; the charts keep the slice. The header and button count the file.
- **Status**: ✅ FIXED (0.6.43), frontend only.

### Bug ID: BUG-015 — The dashboard priced holdings at the trial-matching estimate with no marker (AUDIT-01)
- **Date**: found 2026-08-06 by audit, fixed in 0.6.42
- **Root Cause**: `trial` was set from MIS's `ip` on every quote and read by exactly one consumer, the quote card.
  `buildHoldingRows` dropped it, so the dashboard's 現價 and 未實現淨損益 used the indicative auction price —— a
  price **nothing traded at** —— during 08:30–09:00 and 13:25–13:30, while the quote card labelled the same number
  「試撮中」 one page away.
- **Fix**: `HoldingRow.trial`, and a 「試撮」 badge beside the price with a tooltip saying the P&L beside it is
  computed from that estimate. Frontend only.
- **Tests**: `holdingRows.test.ts` (flag carried, and ordinary quotes stay unmarked —— a badge that shows always
  means nothing).
- **Status**: ✅ FIXED (0.6.42), live with the frontend.

### Bug ID: BUG-016 — The fallback path polled every minute all night, unbounded (AUDIT-02)
- **Date**: found 2026-08-06 by audit, fixed in 0.6.42
- **Root Cause**: the Yahoo fallback never reports a matching time, and since 0.6.37 a missing matching time means
  "not settled" → 60-second TTL **at any hour**. While MIS was unavailable, every TW quote refetched once a minute
  all night, for every user, with no backoff and no cap. 0.6.37 accepted the retry deliberately; it never bounded it.
- **Fix**: a separate `UNSETTLED_RETRY_MS` of 10 minutes outside trading hours. The row is still **not locked** ——
  that is BUG-011's fix and must stay —— it is just asked ten times less often, and is still replaced the moment a
  settled quote appears.
- **Tests**: `quoteWindow.test.ts` and `priceProxy.test.ts`, including the pair that pins "fresh at 2 minutes,
  refetched at 11" —— the contract is bounded retry, not locking.
- **Status**: ✅ FIXED in code (0.6.42); ⚠️ **`stock-price` must be redeployed** for the server half —— Task 75.

### Bug ID: BUG-017 — The FX range lost up to three days at month ends (AUDIT-03)
- **Date**: found 2026-08-06 by audit, fixed in 0.6.42
- **Root Cause**: `setUTCMonth(m - n)` keeps the day of month, so a series ending on the 29th–31st overflowed into
  the next month. Measured: `2026-05-31` minus 3 months → `2026-03-03`, and `2026-03-31` minus 1 month → the same
  date. The window came out short and nothing on screen said so.
- **Fix**: step the month arithmetically and clamp the day to the target month's last day.
- **Tests**: `fxConvert.test.ts` with a series ending on 05-31, asserting the cutoff lands on 02-28.
- **Status**: ✅ FIXED (0.6.42), live with the frontend.

### Bug ID: BUG-018 — Two different T86 rows could share a fingerprint (AUDIT-04)
- **Date**: found 2026-08-06 by audit, fixed in 0.6.42
- **Root Cause**: `sortedRows` joined cells with an empty string, so `['12','3']` and `['1','23']` both encoded as
  `'123'`. That fingerprint is the gate deciding whether today's T86 is **final** (`nextT86State` freezes after N
  identical polls), so a collision would read a genuine revision as "unchanged" and freeze the wrong version.
- **Probability was low** (fixed-arity numeric columns) and no occurrence is known —— this is a latent defect found
  by reading, fixed because the fix is one character.
- **Fix**: join with U+001F, which cannot occur in a TWSE JSON string field.
- ⚠️ **Expected one-off effect on deploy**: every fingerprint changes, so the first round after deployment counts
  one extra `revisions` against the stored value and restarts the stability count. It settles by itself.
- **Tests**: `pollPlan.test.ts` —— digits moved between adjacent cells must change the fingerprint.
- **Status**: ✅ FIXED in code (0.6.42); ⚠️ **`stock-report` must be redeployed** (with `--no-verify-jwt`) —— Task 75.

### Bug ID: BUG-014 — The macro schedule row printed the raw cron string too
- **Date**: 2026-08-05 (long-standing, fixed in 0.6.41)
- **Discovered by**: Claude, cross-checking every row of the 排程 table while confirming BUG-012 for the user.
- **Symptom**: `macro-daily` (`*/30 12-18 * * *`) rendered verbatim instead of as a sentence. Unlike BUG-012 this
  was **not** caused by a recent change —— that row had been unreadable since the schedule took its current shape.
- **Root Cause**: `describeCron`'s step-syntax branch requires a `1-5` (weekday) suffix, and this job runs every
  day, so it matched nothing and fell through. Same fall-through as BUG-012, different missing branch.
- **Impact**: Display only, admin console only.
- **Fix**: A branch for a daily step range. It must mark 次日: 12–18 UTC is 20:00 through **02:30 the next day**
  in Taipei, and without the marker the row reads 「每日 20:00–02:30」, i.e. as if it ran in the morning.
  While there, the end minute is now derived from the step instead of the literal `:45` —— correct for the
  15-minute job that had this shape, and 15 minutes short for anything else.
- **Tests**: `timeline.test.ts` two entries (the daily crossing-midnight case, and a 30-minute weekday range that
  pins the end minute at `:30`).
- **Status**: ✅ FIXED (0.6.41) and live —— pure frontend.
- **Timestamp**: 2026-08-05 23:55:00 Asia/Taipei

### Bug ID: BUG-013 — The timeline legend still said the earliest shift was 16:00
- **Date**: 2026-08-05 (exposed by 0.6.38, fixed in 0.6.40)
- **Discovered by**: The user, after BUG-012 was fixed: "排程上面的說明最早還是 16".
- **Symptom**: The legend above the after-hours timeline read 「盤後批次是週一至週五 16:00–23:45 每 15 分一輪」
  and mentioned no other schedule, so the page still read as if nothing ran before 16:00.
- **Root Cause**: Two separate faults in one sentence. It **hard-coded** a value that lives in pg_cron —— the same
  mistake BUG-012 punished, one file away —— and it described only `stock-report-nightly`, which was adequate while
  every row on the axis came from that batch. 0.6.38 gave the 全市場 row its own earlier schedule and the sentence
  silently became wrong-by-omission. Note the schedule **table** was already correct: this was the prose beside it.
- **Impact**: Display only, admin console only.
- **Fix**: The legend reads both schedules from `data.schedules` and renders them through `describeCron`, names the
  two groups of rows separately, and says a 15:00 arrival for 全市場 and a 16:30 one for 個股 T86 are both normal.
- **Tests**: One new (the legend names both schedules, both derived from cron). Three existing tests had to be
  adjusted: two matched 「三大法人・全市場」 unscoped and now also hit the legend, and one pinned the old wording.
- **Status**: ✅ FIXED (0.6.40) and live —— pure frontend.
- **Timestamp**: 2026-08-05 23:40:00 Asia/Taipei

### Bug ID: BUG-012 — The admin schedule printed the raw cron string, so 15:00 never appeared
- **Date**: 2026-08-05 (introduced in 0.6.38, fixed in 0.6.39)
- **Discovered by**: The user, reading the admin console: "後台的排程好像沒有提到 15:00 的排程".
- **Symptom**: After `market-daily` moved to `0,30 7-10 * * 1-5`, the 排程 table showed that expression verbatim
  instead of a sentence. One row of an otherwise readable table was unreadable, and since the raw string is in UTC
  the page never mentioned 15:00 anywhere.
- **Root Cause**: `describeCron` in `timeline.ts` has one branch per shift shape and falls back to `return expr`.
  It covered step syntax, a daily hour list, and a single-minute hour range —— but not **a minute list inside an
  hour range**, which is exactly the shape 0.6.38 introduced. Changing the cron and not teaching the formatter is
  the whole bug: the schedule display is derived from `cron.job`, so it was correct and unreadable at once.
- **Impact**: Display only, admin console only. The schedule itself ran correctly the whole time.
- **Fix**: A branch for `M[,M…] H1-H2 * * 1-5` rendering 「週一至週五 15:00–18:30 每 30 分」. It sits **below** the
  single-minute branch and requires at least one comma, so `0 8-10 * * 1-5` keeps listing its three shifts one by
  one —— three times reads better than "每 60 分".
- **Tests**: `timeline.test.ts` two entries (the new shape, and a control that the old shape is still listed).
- **Status**: ✅ FIXED (0.6.39) and live —— pure frontend, shipped with the merge to `main`.
- **Timestamp**: 2026-08-05 23:00:00 Asia/Taipei

### Bug ID: BUG-011 — The after-close lock froze an intraday snapshot until the next morning
- **Date**: 2026-08-05 (introduced in 0.6.36, fixed in 0.6.37)
- **Discovered by**: Production, on the same day 0.6.36 went live.
- **Symptom**: After 13:30 the quote card on the individual-stock analysis page kept reading "盤中",
  and open / high / low / volume / previous close were all "—", with no way to recover before 08:25 the next day.
- **Root Cause**: `twQuoteTtlMs` locked the quote on the clock alone — "it is past 13:30, so no new price will arrive
  today". That reasoning holds for the **price**, but not for **"is this row the settled closing value"**.
  Rows lacking `trade_time` are intraday snapshots: written before the 0.6.36 column upgrade, or coming from a fallback
  path that has no such field (Yahoo / TWSE OpenAPI). 0.6.36 explicitly chose not to let a missing `t` block the lock,
  and the production upgrade at 16:47 left exactly such pre-upgrade rows in `price_cache`.
  The 13:30–14:00 grace window did not help either: it only covered a `t` that existed but was too early, and it expired
  at 14:00, after which even a stuck intraday matching time was frozen for the whole night.
- **Impact**: Production only, after 13:30 on 2026-08-05. Display layer only — no wrong number was ever shown,
  the card simply stopped updating and showed placeholders.
- **Fix**: `quoteWindow.ts` — the lock now requires a confirmed close (`tradeTime >= '13:30:00'`); a missing or earlier
  `t` returns the 60-second TTL at any hour, and the 14:00 `CONFIRM_MS` deadline is gone.
  A new `twMaxTtlMs(now)` supplies the upper bound for the `freshAfter` coarse filter in `stock-price/index.ts`,
  which cannot know each row's `trade_time` — without it the coarse filter would drop yesterday's settled close
  and refetch all night.
- **Tests**: `quoteWindow.test.ts` (rewritten around the new rule, including the case that locks the old behaviour out)
  and `priceProxy.test.ts`; whole suite 877 passed across 57 files.
- **Status**: ✅ FIXED and **live in both environments** (0.6.37). The browser half shipped with the push to `main`;
  the Edge half was deployed at 20:57 (dev v10 → **v11**) and 20:58 (prod v14 → **v15**), `verify_jwt` staying `true`.
  Evidence that it is the new code: `ezbr_sha256` moved from `00ce1004…` (the 0.6.36 build both environments shared)
  to `733891b768b2…`, **identical in both** — see Task 71 for why the sha, not the version number, is the evidence.
- **Timestamp**: 2026-08-05 21:05:00 Asia/Taipei

### Bug ID: BUG-010 — All legal entities in the market were received on time, but were drawn off-axis and judged as "delayed"
- **Date**: 2026-08-05 (introduced in 0.6.33, fixed in 0.6.36-dev.2)
- **Discovered by**: The user looked at the screen and reported "After the train started at 16:00, the status is still the same. Is this a BUG?"
- **Symptom**: The background timeline title stops at "Taiwan stock market after-hours round 2026-08-04",
  The data date in the "Three Major Legal Persons·All Markets" column is already 2026-08-05 - contradictory on the same axis.
  This column is also labeled "Delay" and is pasted to the far right of the axis.
- **Evidence** (actual measurement in test area on 2026-08-05):
  `market/daily.json`’s `asOf = 2026-08-05T08:00:04Z` (Taipei 16:00:04), the last `date = 2026-08-05`;
  And `chip.dataDate` is still `2026-08-04` (T86 will not be available until the 16:30 round, `batch_run_log`
  16:00 / 16:15 The two columns `t86_today = false` can be verified, and the column will be converted to `true` at 16:30).
  With 8/4 15:00 as the origin, `hoursFromBase` gets **25 hours**, `tlPercent(25)` = 131% is clipped to 100%,
  `judgeSource` is judged as `late` because 25 > `dueBy 3 + 0.25`.
- **Root Cause**: The base date of the timeline is taken from a single source (`chip.ymd` / `chip.dataDate`, individual stock chip report),
  But the five columns on the axis are from different batches: individual stock T86 post-market batch (16:30),
  The whole market BFI82U is scheduled independently `market-daily` (16:00). The column running faster must cross the coordinates of the epicycle.
- **Impact**: Between 16:00 and 16:30 on each trading day, the market-wide column that has been acquired on time will always have a red light.
  An always-on warning is equivalent to no warning - which is exactly against the principles set by `timeline.ts` itself.
  The data itself is completely correct, it is purely a display layer issue.
- **Fix**: `timeline.ts` adds `roundBaseYmd()`, and the base date is changed to the **maximum value of each source data**;
  The title and axis coordinates share the same base. Whether it belongs to this round is determined by "whether the timestamp falls within the axis range [0, TL_SPAN_HOURS]".
  Rather than comparing the date - because **The self-reported date for borrowing securities is the announcement date (the next trading day)**, which is naturally one day longer than the current round.
  Comparing it with it will cause the only column that should have a red light to be regarded as not caught; similarly, it will not participate in the calculation of `roundBaseYmd`.
- **Tests**: `timeline.test.ts` 4 items (including the control that directly locks the old behavior of "25 hours → late"),
  `AdminStatusPage.test.tsx` 1 transaction (when the whole market comes first, the title will jump, the individual stocks will show waiting and the old date will not be displayed).
- **Status**: ✅ FIXED (0.6.36-dev.2) and live — pure front-end, shipped with the 0.6.36 merge to `main` at 16:55.
- **Timestamp**: 2026-08-05 16:35:00 Asia/Taipei

### Bug ID: BUG-009 — The three major legal entities arrived on time but were judged to be "delayed" by three seconds.
- **Date**: 2026-07-31 (introduced in 0.6.13, fixed in 0.6.16)
- **Discovered by**: The user looked at the screen and reported "What does the delay here mean?"
- **Symptom**: On the Taiwan stock after-hours timeline on the "Capture Status" page, the three major legal entities display "Delay" in red.
  However, the daily K-line captured at the same time (16:30) shows green "normal". Caught at the same moment, one red and one green.
- **Evidence** (2026-07-31 official area test):
  `20260731/0050.json` of `sources.institutional.fetchedAt = 2026-07-31T08:30:03.218Z`
  =Taipei **16:30:03**, **1.5009 hours** from base 15:00;
  And `TW_CHAIN.institutional.dueBy = 1.5` (= 16:30:00 sharp).
- **Root Cause**: `fetchedHour > spec.dueBy` judgment for `judgeSource()`,
  The semantics of `dueBy` is originally "**which round**" (the after-hours batch is every 15 minutes, the 16:30 round),
  But it is written as a moment accurate to the second. The 16:30 round actually finished writing Storage at 16:30:03.
  **Crossed the threshold in three seconds**. The `dueBy` of the daily K-line is 2 (17:00), so it’s okay——
  The two were caught at the same moment but had different colors, precisely because the thresholds were different.
- **Fix**: Added `ROUND_GRACE_HOURS = 0.25` (the length of one round), and changed the judgment to
  `fetchedHour > spec.dueBy + ROUND_GRACE_HOURS`. The semantics returns to "falling within that round is considered on time."
- **Changed Files**: `sources/src/components/Admin/timeline.ts`、`timeline.test.ts`、
  `AdminStatusPage.tsx` (Supplementary explanation of legend)
- **Lesson**: **The unit semantics of the constant must be consistent with the predicate. ** `dueBy` wants to express "which round",
  But use it to directly compare the size with a timestamp accurate to milliseconds - this kind of "discrete intention, continuous comparison"
  As long as the boundaries are aligned, something will happen, and off-by-seconds are easy to miss in testing.
  (The original tests used values ​​such as 1.25 and 18.167 that are far away from the boundary).
  The new test specifically uses a welt value of `dueBy + 0.0009` to pin it.
- **Confusion fixed by the way**: The legend only says "Source Release Window", so the user asked
  "Aren't the three major legal entities originally open from 16:00 to 23:45 every 15 minutes from Monday to Friday?"——
  That is **our batch schedule**, and the light-colored block is **the time when the stock exchange releases the information**, and they are different.
  The legend has made up for this difference.
- **Verification**: ✅ `npm test` 721/721 (2 new welt tests), build passed,
  lint has only three existing warning and Playwright four widths, dark and light, and are scanned in full.

### Bug ID: BUG-008 — The general economic data is always one day behind, and is always one day behind every month during the winter period.
- **Date**: 2026-07-31 (introduced in 0.6.5-dev.2, fixed in 0.6.11-dev.1)
- **Discovered by**: User reported "But there has been an update to PCE, but I didn't catch it?"
- **Symptom**: The core PCE on the general economy page is stuck at 2026-05, while it is already there on 2026-06 on FRED.
  Same for both zones (official/test). The "data updated on" on the screen shows 2026-07-30 21:00,
  It seems that the schedule has been run, but the data is old.
- **Evidence chain** (2026-07-31 12:03 Taipei actual measurement):
  1. **Online file**: `asOf = 2026-07-30T13:00:01Z` of `macro/us.json` in both areas (Taipei 7/30 21:00),
     `PCEPILFE.latest.period = '2026-05'`。
  2. **FRED Current Status**: `PCEPILFE` already has `2026-06-01,130.266`.
  3. **ALFRED vintage comparison** (key): `vintage_date=2026-07-29` only goes to 2026-05 (value 130.082);
     `vintage_date=2026-07-30` **Already has 2026-06**, and at the same time 2026-05 is corrected to 130.094.
     ⇒ 2026-06 That item was put on the shelves on **7/30**.
  4. **Cross-validation captures the current status**: PCE yoy of the online file = 3.41%, and the corresponding base period is
     **The corrected** 130.094 - proves that the 13:00 UTC class did capture the updated sequence that day,
     It’s just that the 2026-06 sum has not entered FRED at that point in time.
- **Root Cause**: The idempotent key of `syncMacro()` is **Taipei Calendar Day**
  （`taipeiDateOf(existing.asOf) === today` At once return）。
  The purpose of `macro-daily` arranging two shifts (13:00 / 15:00 UTC) is "if the first shift fails to receive the call, the second shift will make up for it".
  But when the first class "**successfully** captures a piece of data that has not been updated", it will write `asOf` = today,
  As soon as the second shift saw the same Taipei day, it skipped it without sending a single request - the retry shift designed specifically for this purpose was useless.
  BEA releases at 8:30 US Eastern = 12:30 UTC in summer, it will take longer for FRED to be imported from BEA, and it cannot be received at 13:00;
  The winter release time is 13:30 UTC, and the 13:00 class** even runs before the release**,
  Therefore, the data for each month during the winter period is fixed to be one day slower. `schema.sql` §9 Original annotation
  "The two shifts fall behind summer and winter respectively." But he didn't realize that the success of the first shift would cause the second shift to never be executed -
  Design intent and implementation cancel each other out.
- **Fix**:
  - `usMacro.ts` adds `macroFingerprint(indicators)` pure function (reuses `pollPlan.ts`
    `fingerprint`), `syncMacro` is changed to **catch first, compare later, write only when changed**, and remove the date short circuit.
  - The fingerprint** covers the entire period of points, not just the latest period**: FRED will go back and correct the historical values.
    (This vintage has been changed to 2026-04 and 2026-05 at the same time, and the latest issue has not changed),
    Just comparing it to latest will make this type of revision never catch up.
  - `MacroFile` adds `checkedAt` (the last time FRED was asked), and `asOf`
    (Last change time of data) separation. When the content has not changed, only `checkedAt` is updated and `asOf` is left unchanged.
  - The front end will supplementally display "(last check...)" when the two days are different, otherwise the user will see a
    The date didn't move for several days and I thought it was broken.
  - `syncFx` **Deliberately not following up**: The exchange rate is closed at a new price every trading day, and the one who gets it at 03:00 will definitely get it.
    It is already a complete daily line of the previous trading day, and the second shift cannot make up for anything. Changing the fingerprint will only determine "changed" every time.
- **Changed Files**: `sources/supabase/functions/stock-report/usMacro.ts`、
  `usMacro.test.ts`, `index.ts`, `sources/supabase/schema.sql` (**annotation only**),
  `sources/supabase/README.md`、`sources/src/services/macroProxy.ts`、
  `sources/src/components/Macro/MacroPage.tsx`、`MacroPage.test.tsx`、
  `sources/src/components/StockDetail/aiPayload.test.ts`
- **Lesson**: **"Executed today" does not mean "got new data today". ** Use dates as idempotent keys,
  It is equivalent to assuming that "as soon as the scheduling time comes, the source will be ready" - this is true for the data you control,
  This is not true for external publishing schedules (especially across time zones and daylight savings time).
  For any design that "schedules multiple shifts and retries", the idempotent key must be **content** rather than time.
  Otherwise, the success of the first shift will silence all subsequent shifts, and the extra shifts are just psychological comfort.
  The price is just five more HTTP requests per day.
- **Verification**: ✅ `npm run lint` (only 3 existing warnings) / `npm run build` passed;
  `npm test` 632/632 (original 622 + new 10).
  ✅ **Online review in the test area (2026-07-31 12:37)**: After deployment, use `functions download` to compare file by file
  10 All files are consistent with `dev`. Hit `sync-macro` twice:
  The 1st time `reason: 'updated'`, `asOf=04:37:19.466Z`, 3892ms;
  The second time `reason: 'unchanged'`, **`asOf` completely unchanged**, 1020ms (FRED is really caught, not a short circuit).
  ⇒ The fingerprint is stable and does not fall into the sorting trap of BUG-004.
  `PCEPILFE.latest` of `macro/us.json` has been added from 2026-05 **2026-06 = 3.29%**,
  `checkedAt` is 4 seconds later than `asOf` (the second call only updates the check time), and the semantic separation is as expected.

### Bug ID: BUG-007 — The day’s margin trading can never be entered into the report, and the area on the chip page is always empty.
- **Date**: 2026-07-31 (introduced in 0.6.1-dev.1 `7e27a58`, fixed in 0.6.10)
- **Discovered by**: User reported "No data seems to be captured in this field of margin trading"
- **Symptom**: The margin trading table on the chip page of individual stock analysis is always displayed
  "Today's margin trading has not been announced yet (approximately 21:00–22:00), and the later schedule will be automatically added."
  The same goes for looking at it late at night and the next morning; the 7-day balance chart is always the latest day.
- **Evidence chain** (three sections tested separately, actual test at 2026-07-31 08:50):
  1. **Fetching and parsing are normal**: `rwd/zh/marginTrading/MI_MARGN?date=20260730` returns 200,
     `tables[1]` has 16 columns and `fields[0]='codename'`, which is completely consistent with `MARGIN_IDX`.
  2. **Cache normal**: Official area `20260729/0050.json`
     `sources.margin.fetchedAt = 2026-07-29T13:00:03Z` (Taipei 21:00)——
     That night's round did catch it and write it into `chip_raw_cache`.
  3. **Report has not been rewritten**: The official area manifest points to `20260730`, the file
     `generatedAt=2026-07-30T08:15:04Z` (Taipei 16:15), `margin: null`.
     And the copy of `20260729` was written at 16:00** the next day (`batch_run_log` can be checked by `taipei_ymd`,
     The first round of the next day `last=null` → `runSig` must be different → forced to re-produce), then the numbers 07-29 are brought.
- **Root Cause**: `index.ts` regenerates the gate's `runSignature` passed in
  `margin: series.marginDatedFailed ? '' : series.dataYmd`。
  `marginDatedFailed` asks "Have **any** been caught on one day in the past 7 days", there must be some historical days,
  So it is `false` all day long, and this section is equal to the constant `dataYmd` all day long.
  So at 21:00, the day's margin trading was captured in the round and written into the cache, but the **fingerprint did not change → `regenerate=false`**;
  21Starting from :15, `decideSkip` determines that `complete` is all short-circuited, and the `margin` reported that day will always stop at null.
- **Fix**:
  - `SeriesResult` adds `marginYmds` (the actual trading days of margin trading in the window, from old to new),
    `marginDatedFailed` is derived from it instead (the semantics remain the same, but it is more precisely limited to the days in the window).
  - Reproduce the gate to use `marginSigPart(series.marginYmds)` instead (a pure function of `pollPlan.ts`).
    As soon as the day's data arrives, the fingerprint will change, triggering a re-production; historical day replenishment is also covered.
- **Changed Files**: `sources/supabase/functions/stock-report/index.ts`、
  `pollPlan.ts`、`pollPlan.test.ts`
- **Lessons**: `pollPlan.test.ts` originally had a line "margin and securities lending from scratch → different fingerprints", and what was tested was a pure function
  (`margin: ''` vs `'b'') And the ** caller cannot produce `''`** at all - the purpose of the test has not been met by the implementation.
  Pure functional tests must also pin "what will be fed by the caller", otherwise they will test an input that does not exist.
- **Verification**: ✅ `npm run lint` / `npm run build` passed; `npm test` 622/622 (original 618 + new 4).
  Online (2026-07-31 09:15): Both areas have `functions deploy stock-report --no-verify-jwt`
  And use `functions download` to compare file by file to be the same as `main`; after triggering `generate-all` once,
  The `margin` of the official area `20260730/0050.json` is added (33,974 financing, `source: rwd`), `notes` is cleared,
  History has data for 7/7 days, and `sources.margin.fetchedAt = 2026-07-30T13:00:03Z` proves
  **The information was captured at 21:00 last night, but it could not be written into the report**.
  ⏳ Tonight’s round at 21:00 is the real regression verification (T86 has been frozen, only margin trading has come from scratch →
  Must `regenerated=true`).

### Bug ID: BUG-006 — The stock switching menu on the mobile phone is squeezed into a small piece, and only "18..." is visible.
- **Date**: 2026-07-29 (introduced in 0.6.7, fixed in 0.6.9-dev.1)
- **Discovered by**: Reported when the user switches to the mobile version, with screenshots attached
- **Symptom**: The stock switching menu at the top of the individual stock analysis page is only a few dozen pixels wide on mobile phones.
  The code name was truncated by ellipsis to "18...", and it is not clear which gear is currently selected.
  According to actual measurement, when 390px is reached, only **48px** is left in the container, and when 360px, only **33px** is left.
- **Root Cause**: There is an entry in `@media (max-width: 720px)` in `index.css`
  `.ws-select { flex: 1; min-width: 0 }`, the comment reads "The workspace menu eats up the remaining horizontal space at the top of the page"——
  **It is written for the top of the page**.

  The revision of BUG-005 allows the menu of individual stock analysis to also use `.ws-select` (in order to share the same appearance with the top of the page),
  So I inherited this mobile phone rule. The situations of the two containers are completely different:

  | | What else is in the same column |
  | ---- | ---- |
  | `.app-header` | Brand, workspace, account - plenty of space, `flex: 1` just fills up the remaining width |
  | `.detail-head` | Title (`flex: 1 1 auto`) + two buttons - four children competing for 390px |

  The `flex-basis` of `flex: 1` is **0**, when competing with the title of `flex: 1 1 auto` (basis is the content width),
  The allocated space approaches zero. The desktop computer is not visible because it is wide enough, only the mobile phone will explode.
- **Fix**: Convergence that rule into `.app-header .ws-select` (return to its original object),
  And give individual stock selections their own mobile behavior: `.detail-head .ws-select { flex: 1 0 100% }` has an exclusive column.
  By the way, let the title occupy its own column (`.detail-head .detail-title { flex: 1 0 100% }`),
  Only two buttons will be in the same column - otherwise the title will eat up the middle width and only squeeze the next one, pushing the other to the fourth column.
- **Verification**: Playwright size 320/360/390/430/720/721/1280px Seven widths:
  The trigger buttons are all 105px, the code is zero truncation, the two buttons are in the same column, and there is no horizontal overflow;
  The long stock name "00929 Fuhua Taiwan Technology Premium" (200px) is still fully displayed under 390px.
  Also confirm that the top workspace menu is not affected (still `flex: 1/1/0%`, container 252~612px).
- **Lesson**: **Before sharing a class, check who its media query is written for. **
  BUG-005 It is right to let the two places share the appearance, but sharing the class is equivalent to inheriting all breakpoint rules together——
  And those rules often carry the implicit premise of "the original container."
  The specific method this time is to add the container-specific rules to the ancestor selector (`.app-header .ws-select`).
  Make its scope of application consistent with the annotation description.

### Bug ID: BUG-005 — The stock switching drop-down of individual stock analysis degenerates into a native select without style
- **Date**: 2026-07-29 (introduced in 0.6.6, fixed in 0.6.7-dev.1)
- **Discovered by**: User reported that "the drop-down box for individual stock analysis looks different from the box at the top of the page", screenshot attached
- **Symptom**: The individual stock switch in the upper left corner of the individual stock analysis page becomes the default white background box of the browser starting from 0.6.6
  (No dark bottom, no rounded corners, no borders, chevron is also missing), it is very abrupt on the dark interface with glass quasi-object style.
  The workspace menu at the top of the page is normal.
- **Root Cause**: 0.6.6 (commit `674fa75`, bottom navigation bar of mobile phone) deleted `index.css`
  `.ws-select select` and `.ws-select select option` are the entire paragraph, and the commit description is written
  "After dev.3, you can no longer select dead CSS of any element."

  **That judgment only holds true for the top of the page. ** The workspace selector at the top of the page was indeed replaced in 0.6.5-dev.3
  `HeaderMenu` (`<button>`), but `AnalysisPage.tsx` is still used from beginning to end
  `<div class="ws-select"><select>` - that piece of CSS has always been effective.

  The misjudgment is because "use grep to find `.ws-select select` this **selector string**" and cannot find anything:
  It is made up of `<div className="ws-select">` and `<select>` in it.
  No line of source code looks like that selector.
- **Fix**: It’s not about filling the CSS back, but converging the two places into the same component——
  `HeaderMenu` moved from `AppShell.tsx` to `components/Common/HeaderMenu.tsx`,
  `AnalysisPage` uses it instead (the trigger button continues to use `.hmenu-ws`, and according to the user's choice, the front icon is not placed and only chevron is left;
  List using `menuitemradio` + Check, consistent with the workspace menu).
  Keeping a copy of each style is the reason why the clock will run this time. Adding CSS will only make it run again next time.
- **By the way, fix two points that would have caused problems** (only new callers will step on them):
  - `.hmenu-pop` is `right: 0` (designed for the menu on the right side of the page header). The stock selection menu is on the **left** of the screen.
    If used, it will expand to the left and go out of the screen → Added `.hmenu-pop-left`.
  - There is no height limit for the pop-up layer. When holding dozens of stocks, the list will grow beyond the window → Add `.hmenu-pop-scroll`.
- **Verification**: `AnalysisPage.test.tsx` changed from `selectOptions(combobox)` to
  Click the button → click `menuitemradio`, and add three new cases (the trigger button displays the current file,
  `aria-checked` of the selected item is the only one and will be automatically closed after selection). 568 tests all green.
- **Lesson**: **Search for the class name before deleting CSS, do not search for the complete selector. **
  Compound selectors (`.a b`) never appear literally in JSX.
  This time the search is for `ws-select` (two .tsx hits), not `.ws-select select` (zero hits).

### Bug ID: BUG-004 — The column order of T86 is different every time, causing the polling to never wait until it is finalized and the work never ends.
- **Date**: 2026-07-27 (0.6.1 was discovered and fixed the night it went online, 0.6.2)
- **Discovered by**: Claude, look at the first batch of measured data in the official area `batch_run_log`
- **Symptom**: `t86_unchanged` jumps between 0/1, **cannot reach `T86_STABLE_POLLS = 2`**,
  So `t86_frozen` is always false and `decideSkip` is never short-circuited. Really catch all 32 rounds a day,
  0.6.1 The three gates are all useless, and `generatedAt` also jumps every round.

  ```
  20:30 u=0 regen=true   21:15 u=1 regen=false   21:45 u=0 regen=true
  20:45 u=0 regen=true   21:30 u=0 regen=true    22:00 u=1 regen=false
  21:00 u=0 regen=true
  ```

- **Root Cause**: Catch `rwd/zh/fund/T86` twice directly (with an interval of 3 seconds),
  The length is the same 194,959 bytes but the bytes are different. After comparing column by column:
  **1334 The contents of the columns are exactly the same as the set, except that the order of 7 columns has been changed**——
  Between the columns with the same last column, the sorting of the endpoints is unstable.
  `fingerprint()` is calculated on `JSON.stringify`, and the fingerprint will change as soon as the order changes.
  So each round is judged as "rewritten again" by `nextT86State`.
- **Fix**: Added `t86Fingerprint()` in `pollPlan.ts`: **sort** after joining each column of `data`,
  Only take the `date` / `total` / sorted columns to calculate. All four T86 fingerprint calls in `index.ts` use it instead.
  The remaining fields (title/fields/notes/hints) are intentionally excluded - that's a fixed template,
  And quickly remove Postgres jsonb, **jsonb will rearrange the keys of objects**, which is a second independent source of instability.
- **Verification**: ✅ **Passed** (2026-07-27 23:00, official area).
  Offline: Verify with two actually captured files - the bytes before correction are different, but the semantic fingerprints after correction are the same.
  Plus 6 tests, including two reverse cases of "the real rewrite can still be measured" and "one less column"
  (To avoid overdoing it and not being able to detect anything).
  Online: Four rounds after deployment completed the expected path, **in contrast to the 0/1 shock before repair**:

  ```
  22:15 u=0 frozen=false regen=true 8509ms ← Change algorithm and restart
  22:30 u=1 frozen=false regen=false 8467ms
  22:45 h=2 frozen=true rain=false 7749ms ← Finalize
  23:00 u=2 frozen=true skip=true/complete 753ms ← short circuit, zero external capture
  ```

  Summary of the day: 13 rounds / 1 short circuit / 6 heavy productions; short circuit average **753ms**, actual running average **10,025ms**.
  The final time for T86 is 22:45, and the earliest time for margin trading is 21:00.
  (753ms, not "tens of milliseconds": the short-circuit path is still 3 Postgres round-trips -
  Read the status of the previous round, check today's cache, and write the observation column. The key point is **zero external crawling**. )
  ⚠️ The number `t86_revisions=5` is **untrustworthy today**: it contains fake rewrites fed by byte noise before repair.
  The first clean numbers will be tomorrow.
- **Lessons**: **To use content fingerprints as a criterion for "whether something has changed", it must first be formalized to the semantic layer. **
  External endpoints have no obligation to ensure serialization stability - column order here, key order over jsonb,
  Two independent sources will invalidate the byte comparison.

### Bug ID: BUG-003 — The cron in the test area hits the endpoint of the official area and is blocked by 401
- **Date**: 2026-07-27 (discovered and fixed)
- **Discovered by**: Claude, when accepting BUG-002, he found that the test area `manifest.json` was not advanced.
- **Root Cause** (two mistakenly stacked together):
  1. **URL points to the official area**: The command in the test area `cron.job` is
     `https://kxnxadaghidwumqsqneu.supabase.co/…`. The schedule in the test area never calls its own function.
  2. **Key does not match**: It contains a set of 43 code strings, `net._http_response` is displayed
     09:30:00Z (Taipei 17:30) that time **401**.
- **This is a variant of BUG-002**: It is also "§6c placeholder that needs to be replaced manually",
  But it’s not that I forgot to change it, but it was changed to the value of another environment (it is speculated that the SQL of the official area was copied during the repair at 14:04).
  The detection SQL of BUG-002 only checks "whether the key length is 13" and cannot catch this.
- **Warning**: The same set of URL + key is returned at 08:04:43Z (Taipei 16:04) 200**,
  It became 401 after the official area reset `CRON_SECRET`.
  In other words, before that, the database in the test area has the ability to trigger batches in the official area.
- **Fix**: Rebuild the test area cron job (change the url back to your own ref, fill in the test area's own `CRON_SECRET`,
  Schedule changed to `*/15 8-15 * * 1-5`). `schema.sql` §6d review checklist added
  "The project ref of **url must be your own**" is the criterion.
- **Verification**: ✅ 2026-07-27 20:15 That round of running —— `manifest.json` by
  `06:03:54Z` / `ymd=20260724` advances to `12:15:05Z` / `ymd=20260727`,
  `batch_run_log` writes the first column (`t86_today=true`, `generated=5`, `duration_ms=15361`).

### Bug ID: BUG-002 - The `<CRON_SECRET>` placeholder in cron in the official area has never been replaced, and the after-hours batch has never been automatically run.
- **Date**: 2026-07-27 (discovered and fixed)
- **Discovered by**: Claude, two-zone deployment audit after 0.6.0 finalization
- **Root Cause**: There are two placeholders in the `cron.schedule` body of `schema.sql` §6c
  (`<PROJECT_REF>` and `<CRON_SECRET>`), need to be replaced manually. The official area was not replaced when it was first applied.
  The cron job therefore calls the function with the literal value `'<CRON_SECRET>'` (length 13).
- **Impact**: The official area `stock-report` is deployed with `--no-verify-jwt` and authorized entirely by `x-cron-secret`.
  Therefore, the total number of the three classes is 401. **After-hours batch reports in the official area have never been generated by cron**. In the past, all reports were triggered manually.
  What's even more troublesome is that it is **silent**: the failure is only left in `net._http_response` (retained for 6 hours), and no trace is found the next day.
  There are always reports (manually generated) in Storage, and no abnormalities can be seen from the front end.
- **Same origin precedent**: The same placeholder fault in the test area has been fixed at 2026-07-27 14:04. The same landmine was stepped on twice,
  Because the two areas apply schema independently, fixing one side will not also fix the other side.
- **Fix**: Rebuild `cron.unschedule` + `cron.schedule` and fill in the real project ref and CRON_SECRET plain text.
  Review after repair: `active=true`, URL is `https://kxnxadaghidwumqsqneu.supabase.co/functions/v1/stock-report`,
  The key length is no longer 13.
- **Detection method** (can be reused directly in the future, only the last 4 codes are returned, so it can be safely leaked):
  ```sql
  SELECT jobname, schedule, active,
         (regexp_match(command, 'url\s*:=\s*''([^'']*)'''))[1] AS url,
         left(s,4) || '...' || right(s,4) || ' length=' || length(s) AS key fragment
  FROM (SELECT jobname, schedule, active, command,
               (regexp_match(command, $$'x-cron-secret',\s*'([^']*)'$$))[1] AS s
        FROM cron.job WHERE jobname = 'stock-report-nightly') t;
  ```
  **Length 13 = `<CRON_SECRET>` not replaced. **
- **Verification**: ✅ **Passed** (verified at 2026-07-27 19:20, Claude).
  `generatedAt` of `manifest.json` is pushed from baseline `08:04:50Z` to `09:46:47Z`;
  `batch_run_log` writes two columns (`17:30` cron + `17:46`), both `t86_today=true`, `generated=5`;
  `cron.job` `active=true`. **cron is passed, and the after-hours batch in the official area really runs automatically for the first time. **
  By the way, overturn the old annotation: **17:30 will get the day's T86** (`data_ymd=20260727`).
  ⚠️ On the same day, the test area `manifest.json` still stopped at `06:03:54Z`, and its cron showed no movement - a separate BUG-003 was established.
- **Lessons**: You need to manually replace the schema paragraphs with placeholders, and **there must be an independent verification query after application**.
  "SQL execution is successful" does not mean "the value is filled in correctly" - `cron.schedule` accepts the placeholder string correctly.

### Bug ID: BUG-001 - The inventory overview is inconsistent with the average price and profit and loss ratio of the brokerage APP
- **Date**: 2026-07-17
- **Root Cause**:
  1. **Average Price Difference**: The registration fee is 80 yuan (the actual brokerage price is 40 yuan), causing the calculated average buying price to rise from 102.44 to 102.48.
  2. **Profit and loss rate gap**: The original system inventory overview is mixed with the profits and losses and costs of the historical settled periods (the denominator includes the cost of settled positions), resulting in a different caliber for calculating the total return rate and the unrealized return rate of the securities APP.
- **Fix**:
  1. Transaction record update fee login value.
  2. Modify the Dashboard components and profit and loss calculation logic: remove the "Realized Profit and Loss" and "Cumulative Total Profit and Loss" fields, and adjust the total return rate to only include the "Unrealized Return Rate" of the current position (unrealized profit and loss / total cost of the current position).
- **Changed Files**: `sources/src/components/Dashboard/`, `sources/src/utils/pnlEngine.ts`
- **Verification**: Compare securities APP caliber through unit testing and manual testing.

### Bug ID: BUG-028 — `scribe` dispatch returns partial text when hitting maxTurns ceiling
- **Symptom**: a `scribe` dispatch returns a plausible half-sentence ("Now let me verify…", "Now for Job B…") and looks like a successful result. The caller cannot distinguish it from a completed dispatch.
- **Root cause**: `maxTurns: 15` in `.claude/agents/scribe.md` was below what a record-plus-roll dispatch actually needs. Hitting the ceiling stops the agent mid-loop and returns its partial text as a normal result — no error is raised.
- **Evidence**: across 7 dispatches in session 7b928169, all 5 that reached 15–17 tool calls were truncated; both that finished in 5–8 tool calls completed cleanly.
- **Damage**: the `PROGRESS.md` log entries for **Task 91 and Task 92** were destroyed. Both were cut from the hot file and the dispatch died before writing them to `PROGRESS_ARCHIVE.md`. Task 91 was recoverable from `git show HEAD`; Task 92 had never been committed and had to be reconstructed from facts.
- **Fix** (all in `.claude/agents/scribe.md`): `maxTurns` raised 15 → 30; a "write the destination before you cut the source" ordering rule added, so an interrupted move leaves a visible duplicate instead of a silent deletion; and a mandatory closing report block (`RECORDED` / `MOVED` / `VERIFY` / `UNFINISHED`) added so a truncated dispatch is detectable by its missing report.
- **Status**: ✅ FIXED (n/a — agent configuration only, no app version applies).
