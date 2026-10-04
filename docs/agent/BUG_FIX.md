# Active Bug Fixes & Accepted Risks (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-10-02 14:20:00 Asia/Taipei

---

## 🐛 Open Issues

> **Accepted risks and won't-fix decisions moved out on 2026-09-30** → `ACCEPTED_RISKS.md`.
> They were 13 KB of this file and nothing ever acted on them, so they cost tokens at every
> session start and returned nothing. `grep` that file before you "discover" one of them again.
> Fixed bugs are in `FIXED_BUG.md`. Only things that still need doing belong here.

### BUG-111 — 「頁面發生錯誤」 on a tab switch after a deploy (stale lazy chunk)
- **Where**: every `lazy(() => import(...))` — `sources/src/components/AppShell.tsx:41-53`, `WorkspaceControls.tsx`, `Dashboard/DashboardPage.tsx`; fallback UI `ErrorBoundary.tsx`
- **Root Cause**: a tab opened before a deploy still requests the previous build's hashed chunk (e.g. `FxPage-C27YOKQ4.js`). Cloudflare Pages answers an unknown path with `index.html`, `200 text/html` (checked live 2026-10-04), the module load fails, `React.lazy` rejects, and the root ErrorBoundary replaces the whole app. Releases land several times a day, so any long-lived tab hits it on its next first visit to a lazy page.
- **Evidence**: PROD `app_log` (source=web, action=render, 30 days): all 6 rows are `Failed to fetch dynamically imported module` / `error loading dynamically imported module` (Firefox), each from a client one release behind — e.g. 0.10.26 at 04:33Z, 12 min after 0.10.27 reached `main`. DEV rows are dev-server HMR noise (`useWorkspace 必須在 WorkspaceProvider 內使用`), not this.
- **Fix**: `sources/src/utils/chunkReload.ts` `loadChunk` wraps all 9 dynamic imports: on failure reload once (guard `sessionStorage['chunk-reload-at']`, 30 s) and keep the Suspense fallback; a second failure in the window, or no usable sessionStorage, rethrows to the ErrorBoundary.
- **Verified**: unit `chunkReload.test.ts` (5). Playwright on local-mode production builds behind a Pages-style SPA fallback, first 年度 chunk answered with index.html: before fix → 「頁面發生錯誤」; after fix → one reload, 年度收益 renders; chunk broken on every request → one reload then the ErrorBoundary, no loop.
- **Status**: FIXED on `dev` (0.10.28-dev.1), not released.

### BUG-084 — Stale per-workspace 最低手續費 in localStorage still drives estimates, with no UI to see or change it
- **Where**: `sources/src/utils/settings.ts` (`getMinFee`), `sources/src/utils/holdingRows.ts:80-81,119-121`
- **Root Cause Analysis**:
  1. From `046abd9` (2026-07-18) until `9bacc14` (0.9.24-dev.1, 2026-08-31) the transaction form persisted the typed 最低手續費 into `localStorage` (`stock-pnl-web/min-fee-whole|odd/<workspaceId>`) on every change.
  2. `9bacc14` removed that write-back, but nothing clears the new keys and `getMinFee` still reads them first. No UI shows or edits a workspace minimum fee (the AppShell fee dialog only handles the rate).
  3. A browser that typed a minimum fee in that window keeps using it for unrealized P&L and break-even on small positions and odd lots; another device, and the server-side Discord holdings card (Task 165 Phase 2), use the defaults 20 / 1.
- **Impact**: at most the gap between the stale and the default minimum fee per row, only where the estimated sell fee equals the minimum.
- **Status**: OPEN — found 2026-09-17 while checking docs/agent/specs/discord-holdings.md; accepted for Task 165 Phase 2 pending a user decision (clear the legacy keys, or persist minimum fees to `workspaces`).

### BUG-098 — Backup restore ignores `transactions.seq` (found in the 0.10.15 review)
- **Where**: `sources/supabase/functions/stock-report/adminHandlers.ts:575` (`handleAdminBackupRestore` upserts `select('*')` rows), `sources/scripts/restore.cjs` (no seq handling)
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

### BUG-103 — Two 0.10.15 paths fail badly if code runs ahead of the DDL
- **Where**: `stock-report/discordHandlers.ts:332` (`HOLDINGS_TX_COLUMNS` selects and orders by `seq`, no degrade step); `schema.sql` `apply_transaction_updates` (an older RPC ignores `tx_nature` but returns the full count)
- **Impact**: the nightly holdings card dies for every user, or 標記當沖 reports success while storing nothing. Both DBs have the DDL today (`verify_setup()` 10/10), so this only bites if the deploy order is ever reversed.
- **Status**: OPEN (low urgency)

### BUG-107 — 年度收益 trade-count breakdown omits stock dividends (2026-10-02 DEV E2E)
- **Where**: `YearlyPage.tsx:433-434`
- **Root Cause**: 「11」 broken down as 買入 6・賣出 3・股利 1 = 10; the stock dividend is counted in the total but not in any part.
- **Status**: OPEN (low)
