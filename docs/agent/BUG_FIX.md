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

### RISK-002 — Night batch cost scaling with watched stock count

- **Condition**: 0.8.0 expands `batchTwTickers()` from held-only to held ∪ watched; each stock ~6 external requests; cost per day ≈ (users × avg watched stocks) × 6.
- **Limit**: `tw_watchlist` max 30 stocks/user is the only brake.
- **Status**: OPEN — accepted at review (0.8.0), deployed to PROD 2026-08-19 11:29:34 Asia/Taipei.
- **Action after deploy**: Monitor one week of batch runtime (starting 2026-08-19). If runtime grows linearly with user base × watched count, switch to "only watched-to-user pairs that have been opened in analysis UI" for batch scope. Alternative would reduce per-day noise.

---

## 📝 Operational Notes

### Project-identity heuristic in `supabase-ops` skill is stale

- **Finding**: The `supabase-ops` skill's project-identity distinguishing heuristic states "batch_run_log: official area 2 / test area 0", used to infer which environment is live. As of 2026-08-24, DEV self-hosted has 211 rows in batch_run_log, so the count no longer reliably distinguishes DEV (test) from PROD (official).
- **Impact**: Agents relying on this heuristic would give false confidence about the target environment. Not a bug in the skill itself, but the distinguishing criterion has eroded.
- **Mitigation**: When operating on Supabase environments, use explicit paths for disambiguation. DEV operations on self-hosted should reference the compose file path directly; PROD operations on cloud should reference the explicit project ID (kxnxadaghidwumqsqneu). Do not rely on count-based heuristics that can drift over time.
- **Discovered**: During backup-transactions phase 1 DEV deployment, 2026-08-24.

---

**Historical notes**: BUG-026 (borrow flip dead on arrival) and BUG-027 (unordered 20-ticker sample
decided landing) fixed in **0.7.13** — see `FIXED_BUG.md`. BUG-024 fixed in **0.7.11** — see `FIXED_BUG.md`.

BUG-023 (manual 「全部執行」 opaque non-2xx) fixed in **0.6.47** — see `FIXED_BUG.md`.

BUG-011 (the after-close lock froze an intraday snapshot) was fixed as 0.6.37, deployed to both environments at
20:57 / 20:58, and moved to `FIXED_BUG.md`.

The 2026-07-28 look-back on BUG-004 (32-round day, 16:00–17:00 rounds, short-circuit ratio) is obsolete:
the scheduler has been reworked several times since, most recently in 0.6.32, and the timeline now reads from
`batch_run_log` directly. Nothing is pending from it.


If you find a new bug, please record it here:

```markdown
### Bug ID: BUG-XXX
- Description: 
- Root Cause:
- Impact:
- Status: OPEN
```
