# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-12 11:00:00 Asia/Taipei

---

> **All eight are done.** AUDIT-01 … 04 in 0.6.42 (`FIXED_BUG.md` BUG-015 … BUG-018, Edge halves deployed to both
> environments 2026-08-06 01:2x), AUDIT-05 … 08 in 0.6.43 (BUG-019 … BUG-022). The list below is kept as the record
> of what the audit found and why each mattered.

## 🔍 Codebase audit 2026-08-06 —— findings only, nothing changed

A read-through of the core logic (`pnlEngine`, `fees`, `csv`, `priceProxy`, `pollPlan`, `twChips`, `macroCalendar`,
`fxConvert`, the two Edge Functions and the admin page) looking for defects and for values that are written to drift.
**No code was touched.** Ranked by what it costs if it bites; each entry states what is proven and what is inferred.

### AUDIT-01 — The trial-matching price is shown as 現價 with no marker outside the quote card
- **Proven by reading**: `priceProxy.ts` carries `trial` on every quote (set from MIS `ip`), `QuoteTab` is its **only**
  consumer, and `buildHoldingRows` never reads it —— the dashboard's 現價 column and 未實現淨損益 take `quote.price`.
- **Why it matters**: during 08:30–09:00 and 13:25–13:30, MIS's `z` is the **indicative auction price**. Nothing was
  traded at it. For that hour the dashboard prints a P&L computed from a price that does not exist yet, and says
  nothing about it —— while the quote card one page away labels the very same number 「試撮中」.
- **Not yet observed in the wild**: this is a reading of the code, not a report. Task 69 item 2 (watch a trial window)
  would confirm it on screen.
- **Cheapest fix if wanted**: carry `trial` into `HoldingRow` and mark the cell, the same way `stale` already is.

### AUDIT-02 — The Yahoo fallback silently defeats the after-close lock, and nothing caps it
- **Proven by reading**: the Yahoo path in `stock-price/index.ts` always returns `tradeTime: null`, and since 0.6.37
  `twQuoteTtlMs` treats a missing matching time as "not settled" → 60-second TTL **at any hour**.
- **Consequence**: while MIS is unavailable, every TW quote refetches once a minute all night, for every user, with
  no backoff and no daily cap. 0.6.37 accepted this deliberately ("an abnormal state should keep retrying") but the
  retry is unbounded, and the state is invisible on screen.
- **Second-order**: the two sources disagree on volume by about 10% (measured 2026-08-05 on 2330: MIS 31,851 張 vs
  35,214 張 from the daily batch, which is the Yahoo-calibre figure). A fallback therefore shifts a displayed number
  by ~10% with no source marker.

### AUDIT-03 — `sliceByRange` loses 1–3 days whenever the series ends on a 29th–31st
- **Proven by execution**: `fxConvert.ts` does `d.setUTCMonth(d.getUTCMonth() - months)`, which overflows on
  month-end dates. Verified with node: `2026-05-31` minus 3 months gives **2026-03-03** (not 02-28), and
  `2026-03-31` minus 1 month also gives **2026-03-03**.
- **Impact**: the FX range picker quietly returns a window short by up to three days. Invisible —— the chart just
  starts a little later than the label claims.

### AUDIT-04 — The T86 fingerprint joins cells with an empty string
- **Proven by execution**: `pollPlan.ts` `sortedRows` uses `row.join('')`, and `['12','3'].join('')` equals
  `['1','23'].join('')`. Two different rows can produce the same string.
- **Why it matters more than it looks**: this fingerprint is the gate that decides whether today's T86 is **finalised**
  (`nextT86State` freezes after N identical polls). A collision means a real revision reads as "unchanged".
- **Probability is low** (fixed-arity numeric columns) but the fix is one character —— a separator that cannot occur
  in the data.

### AUDIT-05 — `describeCron`'s silent fall-through is a defect generator
- Two bugs in one evening (BUG-012, BUG-014) had the same shape: a cron shape with no branch falls through to
  `return expr`, and a raw cron string on screen looks like a deliberate rendering rather than a failure.
- **Suggestion, not a bug**: make the fallback self-announcing (e.g. prefix 「未解析」) so the next unmatched shape is
  obvious the moment it appears, instead of waiting for a user to notice that a time looks wrong.

### AUDIT-06 — `writeStore` is the one unguarded localStorage write
- `dataProvider.ts` writes the local-mode ledger with no `try`, while `priceProxy` / `twMarketData` / `aiChatStore`
  all guard theirs. A quota or private-mode failure throws out of the save path with no message.
- **Arguably correct to fail loudly** for user data —— silently dropping a transaction would be worse. What is wrong
  is that it fails *unhandled*: the user sees nothing.

### AUDIT-07 — `shiftPeriod` breaks for negative period arithmetic
- `macroCalendar.ts` computes `total % 12` on `y * 12 + m - 1 + n`. JavaScript's `%` keeps the sign, so a negative
  total yields a negative month. Unreachable at today's years; a trap for whoever first calls it with a large
  negative `n`.

### AUDIT-08 — 「顯示全部」 on the new market volume table cannot reach the whole file
- `SHOWN_DAYS = 60` slices the days before the table sees them, while `market/daily.json` keeps up to
  `MARKET_DAYS_CAP = 120`. The button names the number it will show, so nothing lies —— but 「全部」 means "all 60 of
  the 60 I was given", not "everything on file". Introduced by me in 0.6.38.

---

## 🐛 Currently Active / Open Bugs

### RISK-004 — `addTransactions` silently drops `tx_nature` on pre-migration database

- **Where**: `sources/src/services/dataProvider.ts:174-188` (retry path in `SupabaseProvider.addTransactions`)
- **What**: When `tx_nature` column is missing (PROD before BUG-041 SQL runs), `addTransactions` retries with schema that omits the field. Retry succeeds and returns success, so caller believes the label was persisted. User sees "save" succeed, then finds the label gone on reopen.
- **Confirmed by Review**: Task 139 code review before landing.
- **Impact Today**: None. PROD schema change blocked by BUG-041; DEV has the column.
- **User Experience**: User picks 當沖, sees save succeed, reopens and finds label lost. But ledger inference (fee/tax split via `splitFeeTax`) still produces correct tax numbers because `DAY_TRADE` → halved tax is both the explicit inference and the fallback when label absent.
- **Mitigation**: Same property that `workspaces.fee_rate` shipped with in Task 135: explicit label lost until PROD migration runs, but numbers stay correct.
- **Decision**: Accepted, not fixed. No code change.
- **Status**: OPEN (low severity, accepted)
- **Introduced**: Task 139 (2026-09-01)

---

### RISK-003 — Historical chip report files keep permanent "回補中" note

- **Where**: `sources/supabase/functions/stock-report/index.ts:2135` (note text from `assembleOne` at `index.ts:698-701`)
- **What**: For the 6 non-latest days the chips backfill writes (Task 130 new `phase: 'chips'`), `daySeries.incomplete` is true by construction. Each past-date `reports/{ymd}/{ticker}.json` embeds the note "歷史資料回補中…走勢圖會逐日補齊". The nightly `generate-chips` only ever rewrites `{series.dataYmd}/{ticker}.json`, so the note never clears.
- **Confirmed by Observation**: DEV manual test on 2026-08-31, Task 130 manual DEV verification item 7. The generated `20260828/2454.json` carries the note; only the newest file (manifest.ymd) has the full 7-day history and no note.
- **Impact Today**: None. `reportProxy.ts:178-180` only ever fetches `manifest.ymd`, so no consumer reads a past-date report.
- **Future Risk**: Becomes a real defect if any future feature reads a report by a specific past `ymd`.
- **Decision**: Accepted, not fixed. The note is semantically defensible — a report for 7 days ago genuinely has a thin history window.
- **Status**: OPEN (low severity, confirmed)
- **Introduced**: Task 130 (2026-08-30)

---

### RISK-002 — Night batch cost scaling with watched stock count

- **Condition**: 0.8.0 expands `batchTwTickers()` from held-only to held ∪ watched; each stock ~6 external requests; cost per day ≈ (users × avg watched stocks) × 6.
- **Limit**: `tw_watchlist` max 30 stocks/user is the only brake.
- **Status**: OPEN — observation week completed, scaling hypothesis not exercise; revised trigger applied.
- **Observation week (2026-08-18..2026-08-26)**:
  - Daily batch total runtime peaked at 283.7 s on 2026-08-20, fell to 162.1 s on 2026-08-25 after the 0.9.15 borrow fix cut redundant rounds.
  - Mean per-run duration rose from ~4.3 s (2026-08-12) to 10.1 s (2026-08-25), roughly double.
  - Scaling hypothesis NOT exercised: PROD user base unchanged (2 users, 1 with a watchlist), 8 watched rows, 58 stock_names.
  - Per-run growth (4.3s → 10.1s) is therefore NOT attributable to users × watched count.
- **Revised trigger**: Revisit RISK-002 if user growth or watchlist growth occurs, not on calendar. Current per-run baseline (10.1 s post-borrow-fix) is the new reference point.
- **Action on growth**: If user count or avg watched per user rises, monitor subsequent week of batch runtime and compare against 10.1 s baseline.

---

## 📝 Operational Notes

### DEV CRON_SECRET rotation (exposed in earlier session)

- **Status**: OPEN — deferred, user decided to record instead of rotate immediately.
- **Exposure**: DEV `CRON_SECRET` exposed in plaintext in session transcript on 2026-08-25. `/root/container/supabase/stock-pnl-web-dev/.env` still has mtime 2026-08-07 15:37 (unchanged since before exposure).
- **Rotation requirements** (when user authorizes):
  1. Generate new `CRON_SECRET` value.
  2. Update DEV `.env` at `/root/container/supabase/stock-pnl-web-dev/.env`.
  3. Recreate the functions container: `docker compose up -d --force-recreate functions` (from compose directory).
  4. Update the `x-cron-secret` header in all 6 DEV cron jobs using `alter_job(jobid, ...)` — update the `command` text to embed the new secret.
  5. Verify by re-hashing the updated commands, not by "no error" message.
- **Discovered**: Task 134, carried to BUG_FIX.md 2026-08-26.

### Supabase personal access token exposed in transcript (2026-08-26)

- **Status**: OPEN — requires revocation in Supabase console.
- **Exposure**: A Supabase personal access token was pasted into a session transcript on 2026-08-26 and was used again on 2026-08-26 to deploy the 0.9.19 PROD Edge Function (`stock-price`). Revocation is required.
- **Risk**: Supabase personal access tokens grant full management access to every project in the account (Management API, CLI for functions, database, secrets, project settings). Token has been actively used for privileged operations (function deployment). Revocation is the required action.
- **Action required**: Revoke the token in the Supabase console (Settings → Access Tokens). This action is the user's responsibility.
- **Discovered**: 2026-08-26.
- **Used for deployment**: 2026-08-26 (`supabase functions deploy stock-price --project-ref kxnxadaghidwumqsqneu`).

---

### Project-identity heuristic in `supabase-ops` skill is stale

- **Finding**: The `supabase-ops` skill's project-identity distinguishing heuristic states "batch_run_log: official area 2 / test area 0", used to infer which environment is live. As of 2026-08-26, DEV self-hosted has 242 rows in batch_run_log, and PROD has 565 rows. The count no longer reliably distinguishes DEV (test) from PROD (official) — both are growing with daily probe activity.
- **Cron.job row counts**: Both DEV and PROD have 6 jobs as of 2026-08-26 (after PROD cron cleanup), so this count also no longer distinguishes them.
- **Impact**: Agents relying on count-based heuristics would give false confidence about the target environment. Not a bug in the skill itself, but the distinguishing criteria have eroded.
- **Mitigation**: When operating on Supabase environments, use explicit paths for disambiguation. DEV operations on self-hosted should reference the compose file path directly (`/root/container/supabase/stock-pnl-web-dev/`); PROD operations on cloud should reference the explicit project ID (`kxnxadaghidwumqsqneu`). Do not rely on count-based heuristics that can drift over time.
- **Updated**: 2026-08-26; original finding 2026-08-24.

### Supabase Redirect URLs allow-list does not contain app origin

- **Status**: OPEN — requires Supabase console configuration.
- **Finding**: Signup confirmation link flow calls `signUp` with `emailRedirectTo`, so Supabase verifies the account and redirects back with `#access_token=...&type=signup`. The Supabase project's Redirect URLs configuration does not include the app's origin, so GoTrue rejects the `redirect_to` and falls back to `SITE_URL`. Evidence: DEV self-hosted compose `.env` has empty `ADDITIONAL_REDIRECT_URLS` and `SITE_URL` pointing at the Supabase API (`http://kong:8000`) rather than at the app; Supabase CLI has no access token available in this environment; PROD front-end deploy target currently unconfigured.
- **Consequence**: The signup confirmation flow works (account is verified), but the redirect lands at Supabase instead of the app, breaking the user's perception that anything happened. App catches the hash with `authRedirect.ts` on render, but only if the browser is at the correct origin.
- **Action required**: Add the app's origin to the Supabase project's Redirect URLs allow-list (Supabase dashboard → Project Settings → Auth → Authorized redirect URLs). Separate the URLs configured by app environment (DEV, PROD).
- **Discovered**: 2026-08-31, during signup confirmation link fix (Item 5).

---

**Historical notes**: BUG-026 (borrow flip dead on arrival) and BUG-027 (unordered 20-ticker sample
decided landing) fixed in **0.7.13** — see `FIXED_BUG.md`. BUG-024 fixed in **0.7.11** — see `FIXED_BUG.md`.

BUG-023 (manual 「全部執行」 opaque non-2xx) fixed in **0.6.47** — see `FIXED_BUG.md`.

BUG-011 (the after-close lock froze an intraday snapshot) was fixed as 0.6.37, deployed to both environments at
20:57 / 20:58, and moved to `FIXED_BUG.md`.

The 2026-07-28 look-back on BUG-004 (32-round day, 16:00–17:00 rounds, short-circuit ratio) is obsolete:
the scheduler has been reworked several times since, most recently in 0.6.32, and the timeline now reads from
`batch_run_log` directly. Nothing is pending from it.

---

## 🐛 BUG-040 — WITHDRAWN (2026-09-01)

- **Finding**: "Admin self-revocation without confirmation" — premise is false.
- **Investigation**: `handleAdminSetRole` in `sources/supabase/functions/stock-report/index.ts:3700-3702` refuses self-revocation server-side (`if (userId === targetUserId && !targetIsAdmin) throw`). `setUserAdmin` in `AuthContext.tsx` unwraps that error message. `AccountsSection.test.tsx` already pins the UI behaviour (button stays enabled and unchanged on error).
- **Conclusion**: No code change needed. Existing test already covers the guard. Entry withdrawn from open bug list.

---

## ⚠️ RISK — `breakEvenPrice` returns 0 for zero-cost holdings when `minFee` is undefined

- **Where**: `sources/src/utils/fees.ts:89-92` (after BUG-038 fix)
- **Condition**: `cost === 0` AND `minFee === undefined`
- **Consequence**: Return value is 0, which is also the documented "no answer" sentinel for the function. Cannot distinguish a real zero break-even from a failure.
- **Reachability**: Possible for non-TWD holdings through `sources/src/utils/holdingRows.ts` (minFee is undefined for non-TWD); rendered by `DashboardPage.tsx`.
- **Severity**: Low. No marker error. Row still renders; formula is just 0.
- **Status**: Pre-existing, not introduced by this session. BUG-038 fix did not change this case.
- **Discovered**: 2026-09-01, after BUG-038 fix

---

### BUG-041 — PROD Supabase schema pending: `workspaces.fee_rate` and `transactions.tx_nature`
- **Where**: `sources/supabase/schema.sql` sections 1 and 5
- **What**: Two pending PROD schema changes:
  1. **Fee rate persistence (Task 135)**: `workspaces.fee_rate` column. App falls back to legacy column list and keeps working without it, but fee rate does not persist across browsers until migration runs.
  2. **Transaction nature (Task 139)**: `transactions.tx_nature` column. App retries with schema omitting the field and keeps working, but user's explicit nature label is lost until migration runs (though tax/fee numbers stay correct via inference).
- **Action required**: Execute on the PROD Supabase project:
  ```sql
  ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS fee_rate NUMERIC;
  ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_fee_rate_range;
  ALTER TABLE workspaces ADD CONSTRAINT workspaces_fee_rate_range CHECK (fee_rate IS NULL OR (fee_rate >= 0 AND fee_rate < 1));
  
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_nature TEXT;
  ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_tx_nature_check;
  ALTER TABLE transactions ADD CONSTRAINT transactions_tx_nature_check
      CHECK (tx_nature IS NULL OR tx_nature IN ('SPOT', 'DAY_TRADE', 'MARGIN'));
  
  NOTIFY pgrst, 'reload schema';
  ```
- **Reason it is open**: This session has no PROD access token (`supabase projects list` returns `LegacyPlatformAuthRequiredError`). Blocking action must be performed by user.
- **Status**: OPEN
- **Discovered**: 2026-08-31 (fee_rate); 2026-09-01 (tx_nature)

### BUG-042 — `listWorkspaces` 的退回重試會吞掉第一次的錯誤訊息
- **Where**: `sources/src/services/dataProvider.ts:183-191`
- **What**: When the retry succeeds (or a second error occurs), the first query's error is discarded. A real cause like missing column-level grant on `fee_rate` leaves no trace; `fee_rate` reads fail silently every time without diagnostic output.
- **Status**: ACCEPTED RISK — the project's production source contains no `console.warn` / `console.error` at all, so adding one would break existing style. Reviewer verdict: PASS.
- **Discovered**: 2026-08-31

### BUG-043 — `LocalProvider.setWorkspaceFeeRate` 對未知 id 靜默成功
- **Where**: `sources/src/services/dataProvider.ts:148-155`
- **What**: `setWorkspaceFeeRate(id, rate)` resolves without writing when `id` matches no workspace, so caller believes the rate was persisted.
- **Status**: ACCEPTED RISK — identical to existing `LocalProvider.renameWorkspace` pattern at the same file, so it is project style and not a regression. Reviewer verdict: PASS.
- **Discovered**: 2026-08-31


