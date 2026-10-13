# Active Bug Fixes & Accepted Risks (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-10-13 11:09:47 Asia/Taipei

---

## 🐛 Open Issues

> **Accepted risks and won't-fix decisions moved out on 2026-09-30** → `ACCEPTED_RISKS.md`.
> They were 13 KB of this file and nothing ever acted on them, so they cost tokens at every
> session start and returned nothing. `grep` that file before you "discover" one of them again.
> BUG-103 and BUG-107 were accepted as low severity on 2026-10-12 → `ACCEPTED_RISKS.md`.
> Fixed bugs are in `FIXED_BUG.md`. Only things that still need doing belong here.

### BUG-120 — 「加入觀察」 often shows 「台股清單載入失敗」: TWSE OpenAPI outlasts the Edge timeout
- **Date**: 2026-10-13 (reported by the user: 「這功能為什麼很常失敗」)
- **Symptom**: the add-to-watch modal, stock search and name lookups fail with 「台股清單載入失敗」, mostly in trading hours.
- **Evidence**: PROD `app_log`, 30 days to 2026-10-13: ~13 user-visible failures (09-23, 10-05 … 10-13 10:25), every Edge entry `台股清單來源不完整：TWSE Signal timed out.`; each followed by web `fetchDirect: TypeError: Failed to fetch`. DEV identical. Separate: 10-08 13:44–13:49 `Failed to send a request to the Edge Function` (Edge unreachable). 09-24 `writeCache: The quota has been exceeded.`
- **Root Cause**:
  1. TWSE OpenAPI `STOCK_DAY_AVG_ALL` is 29,739 rows, 28,360 of them warrants. Measured 2026-10-13 10:30 Asia/Taipei: 528 KB gzipped in 10.19 s; uncompressed 3 MB+ unfinished at 40 s. `handleTwList` aborted at 10 s, `buildTwList` correctly refused the half list (BUG-075/076) → HTTP 502.
  2. The client's second leg in production, `fetchDirect`, always fails on CORS.
  3. `readCache` ignored an expired localStorage list, so nothing caught the failure; the ~3 MB list also overflowed localStorage quota.
  4. Every `twlist` call hit both exchanges live — no server-side copy.
- **Assumption hits (grep `STOCK_DAY_AVG_ALL`)**: `stock-price/index.ts` `handleTwList`; `stock-report/twNames.ts` `TWSE_LIST_URL` (Discord holdings card names, 15 s timeout, same exposure); `src/services/twMarketData.ts` `TWSE_URL`. All three changed.
- **Fix** (uncommitted working tree, 2026-10-13):
  1. New `supabase/functions/_shared/twseList.ts`: `STOCK_DAY_ALL?response=open_data` CSV (1,381 stocks/ETFs, 137 KB, 0.1 s) first; OpenAPI fallback with warrants removed by `isTwseWarrantCode`; `loadTwseRows` shared by both Edge functions and reports a failed primary via `onFallback`. Coverage given up: TWSE warrants (TPEx warrants were never covered; search already hid warrants).
  2. `handleTwList` keeps the last good list at `reports/twlist/latest.json` (read capped at 3 s, write never throws). Served while < 1 h old; on a failed refresh the copy of any age is served with `stale: true`. `resolveTwList`: a live list under 50 % of the stored one counts as truncated (served copy, not stored); with TPEx on the snapshot the copy wins only while < 24 h old; snapshot lists are never stored. Budget: 3 s Storage + 8 s CSV + 12 s OpenAPI < 30 s client timeout.
  3. Client: production uses Edge only; an outdated list (Edge `stale` or expired localStorage) is returned for search/names, held 5 min in memory, never re-stamped into localStorage. `getTwStockList({ allowStale: false })` rejects it; `priceProxy.fetchTwFallback` uses that, so an old close never passes as a fresh price.
  4. `AddWatchModal`: 「重試」 button next to the error.
  5. `twNames.ts` / `discordHandlers.ts`: same loader; CSV leg 8 s via `twChips.fetchText(url, timeoutMs)`.
  6. Vite proxy `/api/twse-www` (declared before `/api/twse`); E2E mocks in `scripts/run-all-e2e.cjs` and `scripts/verify-monthly-rebate-cost-e2e.cjs` now serve the CSV.
- **Review** (`route:reviewer`, sonnet, 2026-10-13): FAIL with 1 BLOCKER + 9 RISK; all verified against the code and fixed except the Deno-bound `handleTwList` wiring, which still has no test (the logic it calls — `loadTwseRows`, `resolveTwList`, cache parse/TTL — is unit-tested). See PROGRESS.md 2026-10-13 for the per-finding verdicts.
- **Verification**: real-data check — the CSV parses to 1,381 rows; OpenAPI minus warrant codes = 1,379 rows, all contained in the CSV. Tests that failed before / pass after: `twMarketData.test.ts` S1–S3, `priceProxy.staleList.test.ts`, modal retry. Also `twseList.test.ts` (8), `twList.test.ts` C1–C6, `twNames.test.ts`, S4–S6. `npm test` 3,117 pass / 7 skipped; `npm run build`, `typecheck:edge`, `oxlint` exit 0; `node --check` on both E2E scripts. E2E scripts not run.
- **DEV deploy** (2026-10-13 13:33 Asia/Taipei, user ran the deploy; uncommitted working tree): `stock-price` and `stock-report` (`--no-verify-jwt`). Smoke: `{"action":"twlist"}` call 1 HTTP 200 in 5.0 s (live, incl. cold start), 2,393 rows, 2330 close 2540, 6488 present, 0 warrant codes; call 2 HTTP 200 in 0.75 s with `cachedAt 2026-10-13T05:33:50.375Z` (stored copy written and read). `app_log` `twlist` in the window: none (no CSV fallback, no TPEx snapshot, no write failure). Discord `twNames` path not exercised live (runs on its schedule).
- **Status**: OPEN — DEV deployed and verified; not committed, no version bump; PROD not deployed (needs `main` + explicit OK).

### BUG-084 — Stale per-workspace 最低手續費 in localStorage still drives estimates, with no UI to see or change it
- **Where**: `sources/src/utils/settings.ts` (`getMinFee`), `sources/src/utils/holdingRows.ts:80-81,119-121`
- **Root Cause Analysis**:
  1. From `046abd9` (2026-07-18) until `9bacc14` (0.9.24-dev.1, 2026-08-31) the transaction form persisted the typed 最低手續費 into `localStorage` (`stock-pnl-web/min-fee-whole|odd/<workspaceId>`) on every change.
  2. `9bacc14` removed that write-back, but nothing clears the new keys and `getMinFee` still reads them first. No UI shows or edits a workspace minimum fee (the AppShell fee dialog only handles the rate).
  3. A browser that typed a minimum fee in that window keeps using it for unrealized P&L and break-even on small positions and odd lots; another device, and the server-side Discord holdings card (Task 165 Phase 2), use the defaults 20 / 1.
- **Impact**: at most the gap between the stale and the default minimum fee per row, only where the estimated sell fee equals the minimum.
- **Status**: OPEN — found 2026-09-17 while checking docs/agent/specs/discord-holdings.md; accepted for Task 165 Phase 2 pending a user decision (clear the legacy keys, or persist minimum fees to `workspaces`).

### BUG-098 — Backup restore ignores `transactions.seq` (found in the 0.10.15 review)
- **Where**: `sources/supabase/functions/stock-report/adminHandlers.ts:575` (`handleAdminBackupRestore` upserts `select('*')` rows). (`sources/scripts/restore.cjs` was deleted 2026-10-07; `scripts/db-migrate.sh` restores `pg_dump` data, which carries `setval` for every sequence.)
- **Root Cause**: a 0.10.15+ backup carries `seq`, and the upsert writes it back without advancing `transactions_seq_seq`; into a recreated DB the next trade gets a *smaller* seq than restored same-day rows. A pre-0.10.15 backup has no seq, so `nextval` is assigned in upsert order = file order = random uuid order. `compareTxOrder` checks seq before `created_at`, so either way same-day order can scramble — BUG-089 returns after a disaster recovery.
- **Fix direction**: after restoring transactions, `setval` past `MAX(seq)`; for rows without seq, assign it in `compareTxOrder` order (the schema.sql backfill already does exactly that).
- **Status**: OPEN

### BUG-099 — CSV import trusts file row order as `seq` (PLAUSIBLE, needs a real export)
- **Where**: `sources/src/services/dataProvider.ts:531` (`addTransactions`), `src/utils/csv.ts` (no sort / order check)
- **Root Cause**: `seq` follows the order rows are sent; a newest-first export reverses a same-day 買→賣→買, and seq now outranks BUG-049's opening-leg-first fallback, so a false 超賣 and wrong cost are possible.
- **To settle**: check the row order of a real 玉山 / RON / 元大 export before choosing a fix (detect descending dates and reverse, or warn).
- **Status**: OPEN — unverified

### BUG-100 — Sell-form 當沖 detection counts 融資 lots
- **Where**: `sources/src/components/Transactions/TransactionForm.tsx` `dayTradeContext` (`openLots` carry no `tx_nature`)
- **Root Cause**: a same-day 融資 buy with no older stock makes `certain` true, so the sell is auto-labelled 現股當沖 with the reduced rate, although 資券當沖 gets no relief; the buy stays MARGIN. BUG-092 fixed the same thing in the wizard only. Read from code, not run.
- **Status**: OPEN

### BUG-101 — Sell-form labels a partly-matched buy row as 當沖
- **Where**: `TransactionForm.tsx` `buyLegs` (labels every buy behind an open same-day lot)
- **Root Cause**: buy 2,000 in one row, day-trade 1,000 → the whole row reads 當沖. Figures are right (the engine pairs by quantity) but the record overclaims, and 標記當沖 skips that date for good. `proposeDayTradeLabels` labels a buy only when fully matched; the form should follow it.
- **Status**: OPEN

### BUG-102 — Two lists sort same-day trades without `seq`
- **Where**: `src/components/Dashboard/HoldingsLedger.tsx:481`, `src/components/Transactions/StockSplitModal.tsx:145`
- **Root Cause**: both sort by `tx_date, created_at` instead of `compareTxOrder`, so after a bulk import they show a same-day sequence in uuid order while the engine uses seq. Display only.
- **Status**: OPEN

### BUG-112 — Task 193 review items deferred (need a decision or data, not fixed this round)
- **Where / what** (details in `specs/193-codebase-review-2026-10-04.md` §3):
  - public `reports` bucket answers 200/404 per `daily/<code>.json`, so anyone can enumerate the held/watched TW tickers (`schema.sql:407-409`) — accept as a RISK or move to signed URLs;
  - `TW_HOLIDAYS` covers 2026 only (`quoteWindow.ts:83-103`); from 2027-01-01 the BUG-110 guard falls back to weekends;
  - `discordRun.ts:111` the 17:30 summary records `skipped/no-market-day` and never retries that day;
  - `stock-price/index.ts:732` applies the Taipei 13:30 cutoff to US daily bars;
  - `index.ts:2786` uncapped `Promise.all` in `readFundamentalSnapshot` (with RISK-002);
  - latent: `fees.ts:237` day-trade signature at 0% rate, `WorkspaceContext.tsx:191-199` add during a workspace switch, `StockSplitModal.tsx:196-203` inferred rate stored as recorded, `FundamentalTab.tsx:330` TTM EPS needs four newest quarters, `DiscordMySettings.tsx:201-235` two quick time saves overwrite each other;
  - CI `e2e-dev.yml` runs `npx wait-on` unpinned (not a devDependency);
  - the request-body `name` of `generate`/`warm` lands in the shared report/fundamental files shown to every user (spoofing, not XSS), and the nightly batch takes names from the same user-supplied rows — the real fix is the official TWSE/TPEx names (`twNames.ts`) in all three places;
  - `app_log` insert policy still lets a signed-in browser write many small rows (the size CHECK caps each row, not the count);
  - `IntradayChart` re-runs `lineSegments` twice and rebuilds up to ~1,250 volume rects on every hover (the card-level re-render is fixed, this inner cost is not; it needs a stable `geo` before it can be memoised);
  - `MacroPage.tsx:31` `isSameDay` uses the browser's local date and `BackupsSection.tsx:113` names the export file from the UTC date (before 08:00 Taipei it is yesterday's);
  - Edge: the `discord-holdings` action and `listEnabledHoldingsUsers` (its cron is retired) and the seven `discord-accounts` ops no client calls any more; `MechanismGuide.tsx` and `AdminStatusPage.tsx:373` still write the probe windows as prose;
  - a signed-in `warm`/`generate` caller still supplies the `name` stored in shared files (see above);
  - quote pollers refresh every 1–2 min, not every minute (measured in the browser run, 2026-10-04): the poll interval (60 s) equals the quote TTL (60 s in session) and `asOf` is stamped when the response lands, so the first tick finds a 59.5 s-old quote still fresh and the next tick, 60 s later, refetches. Same in `useStockPrices` (holdings) and `WatchSection`; QuoteTab's text 「每分鐘更新一次」 is therefore optimistic. A fix would shorten the tick or let `fetchPrices` accept a tolerance — shared code, so not done with Task 193;
  - local mode: the dashboard's 觀察股票 block shows 「載入失敗」 and 「還沒有觀察標的」 together (`listWatchlist` throws without Supabase); toasts stack over the footer version on a 390 px screen. Both existed before Task 193.
  - the CI step `gh release create 0.7.25 --target 5550979… --title "0.7.25 — 修正 \`computeLedger()\` …"` fails on every `main` push (the workflow still reports success); before Task 193 it died on the backticks in the shell string, now it fails for a reason not yet read from the log — no `0.7.25` tag or Release exists.
- **Status**: OPEN — found 2026-10-04 (Task 193).

