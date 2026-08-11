# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-11 19:45:00 Asia/Taipei

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
- **Status**: OPEN

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
