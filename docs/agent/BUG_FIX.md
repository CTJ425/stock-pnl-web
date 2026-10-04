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
  - `app_log` insert policy still lets a signed-in browser write many small rows (the size CHECK caps each row, not the count).
- **Status**: OPEN — found 2026-10-04 (Task 193).

### BUG-107 — 年度收益 trade-count breakdown omits stock dividends (2026-10-02 DEV E2E)
- **Where**: `YearlyPage.tsx:433-434`
- **Root Cause**: 「11」 broken down as 買入 6・賣出 3・股利 1 = 10; the stock dividend is counted in the total but not in any part.
- **Status**: OPEN (low)
