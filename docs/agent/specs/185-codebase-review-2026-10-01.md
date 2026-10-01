# Task 185 — Codebase review 2026-10-01: defects, hardening and optimizations

Reviewed at `4d787a7` (0.10.12) on `dev`. Line numbers are as of that commit.

## Status (2026-10-01 16:40 Asia/Taipei)

Implemented in the working tree, **uncommitted and not deployed**; gates green (lint, build, `typecheck:edge`, engine sync, vitest 2,762 pass / 7 skipped).

| Item | State |
| ---- | ----- |
| A1 split wizard | ✅ fixed — sells and stock dividends convert too |
| A2 stale transactions on switch | ✅ fixed — `txWorkspaceId` in `WorkspaceContext` |
| A3 partial batch commit | ✅ code + DDL applied to DEV and PROD, behaviour proven on DEV Postgres |
| A4 0-row update | ✅ fixed — every Supabase update asks for the ids back |
| B1 `stock-price` | ✅ validation (`symbols.ts`), deployed DEV v25 + PROD · ⏳ **endpoint is still callable by anyone** (measured) |
| B2 CSP | ✅ wildcards removed · ⏳ confirm on the deployed site with the console open |
| B3 `scratchpad/` | ✅ measured and cleaned — leaked secret is live nowhere; self-hosted artefacts deleted · ⏳ the retired lab host is the user's call |
| C1, C4, C5, C6 | ✅ fixed |
| C3 split-log FK | ✅ applied to DEV and PROD; cascade and orphan-reject proven on DEV |
| C2 bond-ETF exemption | ⏳ open — needs the statute's end date |

Verified on 2026-10-01: the A3 RPC and the C3 FK were run against DEV Postgres (see each entry); the frontend changes were driven in a real browser in local mode. **Not** verified: a logged-in browser journey against DEV cloud — signup needs email confirmation and no DEV credentials were available.
Re-verified 2026-10-01 16:10 Asia/Taipei: B1 was rewritten (its premise was wrong, see there); A2, A3, B3, C1, C2, C5, C6 and the dropped item were made more precise.

## Gates at review time

`npm run lint` exit 0 · `npm run build` exit 0 · `npm run typecheck:edge` exit 0 · vitest 2,697 passed / 7 skipped.
`sources/supabase/functions/_shared/engine/pnlEngine.ts` is in sync with `src/utils/pnlEngine.ts` (diff is the generated header and the two import lines only).

## Not covered

`stock-report/index.ts` (3.8k lines) was read for routing and auth only. The StockDetail, Macro, Admin and Discord UIs were not reviewed. Nothing was checked in a browser. `BUG-079`, `BUG-084` and `ACCEPTED_RISKS.md` entries are not repeated here.

---

## A. Wrong numbers or wrong data (fix first)

### A1. Stock split wizard converts BUY rows only
- **Where**: `sources/src/components/Transactions/StockSplitModal.tsx:134` (`matchingTxs` filters `tx_type === 'BUY'`); the file never mentions sells (`grep -ci 'sell\|賣出'` → 0).
- **Failure**: BUY 1,000 @100, SELL 400 @110 (before the split), then 1 拆 2. The wizard rewrites the BUY to 2,000 @50 and leaves the SELL at 400. Measured with `computeLedger`: holding **1,600** shares (correct 1,200), realized **+24,000** (correct +4,000) — a phantom +20,000.
- **Also**: a `STOCK_DIVIDEND` row before the cutoff keeps its pre-split share count for the same reason.
- **Fix**: convert SELL and STOCK_DIVIDEND rows on or before the cutoff in the same batch; or, if that is out of scope, detect them for the selected ticker and block with a message. Add a `computeLedger`-level test (buy, partial sell, split) that compares against the hand-computed post-split ledger.
- **Done**: first option. `fee_tax` and the recorded `fee_rate` of those rows are written back untouched; cash `DIVIDEND` rows stay as they are (the cash amount does not change with a split); the summary cards stay buy-only. The new `StockSplitModal` tests had encoded the buy-only behaviour (their fixture contains an NVDA sell and asserted 2 rows) and now assert 3; Task 145 §3 had already suggested converting both sides. The new ledger-level test checks that, after the wizard's output, realized profit and cost are unchanged and shares double.

### A2. Switching or deleting a workspace keeps the new workspace's transactions in state
- **Where**: `sources/src/context/WorkspaceContext.tsx:125-132` (load effect), `:170` (`deleteWorkspace`).
- **Failure**: `currentId` changes at once; `transactions` (and so `ledger`) changes only when `listTransactions` resolves, and nothing sets a loading state on a switch. Until then — and until the next successful load if this one fails — the new workspace's name is shown over the previous workspace's holdings. A transaction added in that window is written to the right workspace, but `addTransactions` appends it to the new workspace's list in state, and the form's holdings hints come from the new ledger.
- **Fix**: `setTransactions([])` at the top of the effect (or gate the views on a per-workspace loading flag).
- **Done**: a per-workspace flag (`txWorkspaceId`, set together with the rows); `transactions`, `ledger` and `loading` are derived from it, so `AppShell`'s existing placeholder covers the gap. A failed load keeps the placeholder plus the error banner rather than an empty portfolio, which would look like data loss. Consequence: the header 新增交易 button appears once the rows have loaded, a tick after the shell.

### A3. `apply_transaction_updates` commits the rows it could match, then the UI says nothing changed
- **Where**: `sources/supabase/schema.sql:1594` (RPC), `sources/src/services/dataProvider.ts:512` (count check), `sources/src/components/Transactions/batchUpdate.ts:33` (message).
- **Failure**: one id in the batch no longer exists (deleted from another tab or device after this one loaded). The RPC updates every other row and commits; the client then throws, and `runBatchApply` shows 「批次更新失敗，共 N 筆均未變更」, which is false. Local state is not patched and, for the split wizard, `recordSplit` is skipped. After a reload every remaining row is already converted but there is no split-log row, so the duplicate-split warning cannot fire and re-running the wizard converts those rows a second time.
- **Fix**: make the RPC raise (rolling the statement back) when the number of updated rows differs from the number of ids passed in, and keep the client check as a second line.
- **Done**: the RPC compares against `jsonb_array_length` of the input (a duplicate id is a shortfall too) and raises `P0002`; the client check stays, worded as a possible partial update, and `batchUpdate.ts` no longer says "均未變更".
- **Proven on DEV Postgres** against the real 181-row table, then restored: a batch where every id exists returns `updated=1` and applies; a batch carrying one unknown id raises `P0002` and leaves the good row at its earlier value; a batch repeating the same id does the same. The test row was set back to its original price/qty/fee and re-read to confirm.

### A4. Supabase `updateTransaction` treats 0 affected rows as success
- **Where**: `sources/src/services/dataProvider.ts:482` (`LocalProvider.updateTransaction` at `:173` throws 「找不到要更新的交易」).
- **Failure**: an update that RLS or a deletion turns into a no-op returns no error; `WorkspaceContext.updateTransaction` then patches local state, so the screen shows a save that never happened.
- **Fix**: `.select('id')` on the update and throw when it returns no row. Same pattern in `renameWorkspace` and `setWorkspaceFee*`.
- **Done**: `assertRowsAffected` in `dataProvider.ts`, used by `updateTransaction`, `renameWorkspace` and the four `setWorkspaceFee*` writes.

---

## B. Security and hardening

### B1. `stock-price` can be called by anyone who takes the key out of the bundle

**Measured against deployed DEV on 2026-10-01, after two wrong readings. This is the settled version.**

```
no Authorization header            -> 401
Bearer <sb_publishable_… from .env/bundle>  -> 200 + real quote data
Bearer not-a-jwt                   -> 401
```

- **Where**: `sources/supabase/functions/stock-price/index.ts:749`, `supabase/config.toml:427-428`.
- **History of this entry, so nobody re-derives it a fourth time**:
  1. First reading: "anyone with the bundle's anon key can call it." **Right, for the wrong reason** (it assumed the key was a JWT).
  2. Second reading: "the key is `sb_publishable_`, not a JWT, so `verify_jwt = true` rejects it." **Wrong** — inferred from the key's format without testing it. Supabase's platform gate accepts a publishable key as the anon role.
  3. Measured: the publishable key returns 200. The key ships in the deployed bundle (`stock-pnl-web.pages.dev`), so the endpoint is effectively public.
- **Impact**: anybody can drive Yahoo / MIS requests and service-role writes to `price_cache` and `stock_names` through this function, with no per-user limit. The in-function check only tests that *some* bearer token is present.
- **Done (0.10.13)**: `symbols.ts` — `sanitizeSymbols` for `prices`, `isValidSymbol` → 400 for `intraday` / `daily`; market `TPE | US | IDX`, ticker `^[A-Za-z0-9.^=-]{1,16}$`, Taiwan codes `^[0-9A-Za-z]{1,8}$` because `buildMisChannels` puts them into the MIS URL unencoded. Verified live on DEV: an injection ticker and junk elements are dropped while a valid symbol in the same batch still answers; a bad `intraday` / `daily` symbol gets 400. The header comment was corrected.
- **Still open, and this is the actual exposure**: the function does not identify the caller (no `getUser`) and has no per-user quota, so validation only narrows *what* an anonymous caller can ask for, not *that* they can ask. Closing it means `assertUser` plus a quota like `stock-report`'s — which changes who can use the app's quote path, so it is a product decision, not a cleanup.

### B2. CSP `connect-src` contains `https:`
- **Where**: `sources/public/_headers`.
- **Why**: the stated reason is a user-supplied AI base URL, but the front end now only fetches TWSE / TPEx (`twMarketData.ts`) and Supabase (`reportsBucket.ts`, `BackupsSection.tsx`, `functions.invoke`); no WebSocket, EventSource or realtime channel is used. The wildcard lets injected script send data to any HTTPS origin.
- **Fix**: shrink to the explicit origin list. The file's own header says a change must be checked on a deployed preview with the console open; the build and tests cannot catch it.
- **Done 2026-10-01**: `connect-src` is now `'self' https://*.supabase.co https://openapi.twse.com.tw https://www.tpex.org.tw`. The stated reason for `https:` — a user-supplied AI provider base URL — **no longer exists**: `schema.sql` drops `ai_provider`, `ai_base_url` and `ai_api_key`, and `src/` has no AI code left. The origin list was derived from every absolute URL in the production bundle; the four that remain (`localhost:9999`, `react.dev`, `discord.com`, `github.com`) are a supabase-js default and error strings, not connection targets. TWSE and TPEx stay because `twMarketData.ts:171-173` falls back to a **direct browser fetch** when the Edge proxy fails, so they are reached client-side in production. `wss:` was deliberately left out — supabase-js ships a realtime client but nothing subscribes to a channel; a future realtime feature will need `wss://*.supabase.co` added back.
- ⏳ **Still to confirm**: load the deployed site with the DevTools console open and check for CSP violations. Neither the build nor the test suite can catch a mistake in this file.

### B3. `scratchpad/` in a public repo — closed on 2026-10-01

**Measured, then cleaned.**

- **The leak**: `scratchpad/bootstrap-dev.sh` carried a `CRON_SECRET` as a parameter-expansion default from `04a2833` (2026-08-11 20:46) to `0b2bea9` (2026-08-12 11:04) — a **14.5-hour** window in a public repo.
- **Whose secret**: the retired self-hosted deployment `korq9tvdz0jd7yblr72p.ivan.lab`, which resolves to **10.8.22.99** (RFC1918, not internet-routable). Never the cloud projects.
- **Is it still live anywhere?** No. sha256 of the leaked value is `951e1bbd…`; `supabase secrets list` reports `de418211…` on DEV and `21d0257c…` on PROD, both `updated_at` 2026-09-01 — the day the cloud projects were recreated. (Comparing the hash is the method `supabase-ops` prescribes; the value itself is never printed.)
- **Cleanup, at the user's instruction** ("把所有關於 docker 或是 self host 相關的內容都刪掉"): deleted `scratchpad/bootstrap-dev.sh`, `bootstrap-dev-full.sql`, `bootstrap-dev-phase1.sql`, `trust-ivanlab-ca-db.sh`, `certs/rootCA.crt` and `sources/scripts/verify-watchlist-e2e.cjs` (it drove `docker exec` into a DB container). Four dead self-hosted/new-ref URLs in `comprehensive-audit.cjs` and `reconcile-market-daily.cjs` were repointed at the current cloud projects and their `rejectUnauthorized: false` (only ever needed for the lab CA) removed; two Playwright scripts stopped writing a `sb-korq9tvdz0jd7yblr72p-auth-token` key. The stale "a local docker stack runs on this host" claim was removed from `CLAUDE.md`, `supabase-ops` and `probe-ops` — **`docker` is not installed on this host at all**.
- **Still open, and only the user can close it**: whether the retired `*.ivan.lab` host still accepts that secret. It still resolves on the LAN; probing a live host with a leaked credential was refused here. **The value remains in git history** — deleting a file does not remove it, and rewriting a public repo's history is a separate decision.
- The CA certificate that was tracked carried **no private key** (`CA:TRUE`, certificate only), so it was an internal-topology disclosure, not a key leak.

---

## C. Smaller defects and optimizations

| # | Where | Item |
| - | ----- | ---- |
| C1 | `sources/src/hooks/useStockPrices.ts:64` | The 60 s poll ignores `document.visibilityState`. TW quotes expire after 60 s during the session (locked from 13:30 to 08:25) and US after 10 min, so a background tab keeps calling the Edge function through the TW session and every 10 min for US holdings. Skip the tick unless the tab is visible. |
| C2 | `sources/src/utils/pnlEngine.ts:217` | The bond-ETF tax exemption in `sellTaxRate` has no date dimension, while the day-trade halving has `DAY_TRADE_TAX_SUNSET`. **Verify the exemption's end date** (recollection, not confirmed here: 2026-12-31). If it ends, a bond-ETF sell from then on would get 0 tax in the unrealized and break-even estimates, in the form's default tax rate (`TransactionForm.tsx:94,214`) and in `calculateFee`, and `splitFeeTax` would book the tax actually paid as brokerage fee. |
| C3 | `sources/supabase/schema.sql:1567` | `tx_split_log.workspace_id` has no foreign key, so deleting a workspace leaves orphan rows (harmless to reads, which filter by workspace). ✅ Added (orphans deleted first; DEV and PROD both had 0). Proven on DEV with a throwaway workspace: the log row cascaded away on delete, and an insert naming a non-existent workspace is now rejected with 23503. |
| C4 | `sources/src/services/dataProvider.ts:92` | Local mode only: `LocalProvider.readStore` returns an empty store on a parse or shape failure, and the next write overwrites the damaged data. Copy the raw string to a backup key first. |
| C5 | `sources/src/utils/csv.ts` | Export has no `fee_rate` column, so an export/import round trip drops every row's recorded rate. `parseCsv` also enters quote mode on a `"` in the middle of an unquoted field and can swallow the rows after it; the app's own export quotes such fields, so only files from elsewhere are affected. |
| C6 | `sources/src/context/WorkspaceContext.tsx:170` | Code hygiene, harmless today: `setCurrentId` is called inside the `setWorkspaces` updater, which StrictMode double-invokes in development. Move it outside. |

## Checked and dropped

- `inferFeeRate` / `inferTxFeeRate` use `Math.floor` where `calculateFee` uses `floorSafe`. Compared over the twelve common rates × integer prices 1–2000 × 6 quantities (144,000 cases) and × every TWSE tick price from 0.01 to 5,000 × 16 quantities (844,800 cases): **0 differences**. Not a bug; do not re-open without a counter-example.
