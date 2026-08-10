# Spec: Top-30 (+ ETF) preheat with dual-scope completion gate

- Status: IN PROGRESS (wired into generate-all 0.6.46-dev.7)
- Version target: 0.6.46-dev.7
- Agent: Grok
- Timestamp: 2026-08-10 21:30:00 Asia/Taipei

## Goal

Pre-warm shared Storage for the **day's top 30 TWSE symbols by trade value**, **including ETFs**,
so most analysis opens hit Storage without on-demand MOPS. User-specific holdings remain the
other mandatory scope. A batch **must not report full success** until **both** scopes are done
for that run's definition of "done".

## Non-goals

- Caching live quotes for the top 30 (quotes stay on `stock-price` / MIS).
- Replacing holdings ∪ watchlist — top 30 is an **additional** set.
- OTC-only ranking in v1 (STOCK_DAY_ALL is TWSE-listed; TPEX merge is a later option).

## Ranking source

| Item | Choice |
|------|--------|
| API | `GET https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` |
| Rank key | `TradeValue` (TWD), descending |
| N | 30 |
| ETF | **Included** — no filter on `00xx` / letter suffix |
| Invalid codes | Drop if not `^[0-9A-Za-z]{2,8}$` |
| Cadence | Once per session day, job window from **Taipei 15:00** |
| Failure | Keep previous `meta/top_tickers.json`; do not empty the set |

Pure rank logic: `topTickers.ts` (`rankTopByTradeValue`).

Snapshot path: `reports` bucket `meta/top_tickers.json` (schema 1).

## Schedule (Taipei)

| Job | When | Role |
|-----|------|------|
| **top30-sync** (new or folded) | From **15:00**, can align with early after-close data | Fetch STOCK_DAY_ALL → write `meta/top_tickers.json` |
| **generate-all** (existing 16:00–23:45 /15m) | Uses union list | Chips + daily + fundamental for **holdings ∪ watchlist ∪ top30** |
| Optional early generate | 15:00–16:00 | Only if STOCK_DAY_ALL is already published; otherwise first useful round stays 16:00 |

User requirement: **start work from 15:00**. Implementation may use:

- `cron` e.g. `0,30 7-15 * * 1-5` UTC (= 15:00–23:30 Taipei) **or**
- first `generate-all` extended earlier **plus** a dedicated `action: 'sync-top-tickers'`.

Prefer a **dedicated sync-top-tickers** at 15:00 / 15:30 so ranking does not depend on `decideSkip`
short-circuit of generate-all.

## Batch ticker union

```text
batchTwTickers =
  mergeTwTickerLists(
    heldTwTickers(),      // all users' TPE holdings (platform-wide)
    watchedTwTickers(),   // tw_watchlist
    top30FromStorage(),   // meta/top_tickers.json → {ticker,name}[]
  )
```

Holdings first in merge so names win.

## Dual-scope completion gate ("才可以回報")

### Scopes

| Scope | Members | "Done" for a ticker (v1) |
|-------|---------|---------------------------|
| **holdings** | Distinct tickers in any user's TPE holdings (+ watchlist if product wants) | Chip report for `dataYmd` exists **and** fundamental soft-ready (see below) |
| **top30** | Current `meta/top_tickers.json` list | Same file checks for each ranked ticker |

**Soft-ready fundamental (aligned with on-demand soft mins, not full 12/12):**

- `revenueMonths.length >= 6` **and**
- `profitQuarters.length >= 6`  
  OR ETF/unknown path already sealed complete with empty series (no MOPS data forever).

Full 12/12 remains night multi-round; the **gate for "可回報"** uses soft-ready so a single
evening can finish without waiting six profit rounds. UI "歷史補齊中" can still show until 12/12.

### Report contract

JSON response + `batch_run_log` (or sibling columns) must expose:

```json
{
  "ok": true,
  "scopes": {
    "holdings": { "total": 12, "ready": 12, "complete": true },
    "top30": { "total": 30, "ready": 28, "complete": false, "missing": ["xxxx", "..."] }
  },
  "reportComplete": false
}
```

Rules:

- `reportComplete === holdings.complete && top30.complete`
- Admin / probe "綠燈" for this job uses **`reportComplete`**, not mere HTTP 200
- A run may still **write partial progress** and return HTTP 200 with `reportComplete: false`
  (progress is not failure); **do not** claim full success in admin copy when false
- `decideSkip` short-circuit: if chips skip but scopes incomplete, **must still run**
  fundamental/daily backfill for incomplete tickers (or a dedicated follow-up action).  
  **Do not** skip the whole handler solely because T86/margin are frozen.

### Ordering inside a run (recommended)

1. Ensure top30 snapshot exists (fetch if missing/stale for `taipeiYmd`).
2. Build union list.
3. Existing chip path (with regenerate rules) for union / holdings as today.
4. `syncDaily` + `syncFundamental` + revenue/profit backfill for union (budgeted per run).
5. Evaluate both scopes → set `reportComplete`.

Wall-clock: keep per-run budgets; multi-round nights accumulate toward `reportComplete`.

## Live quotes (no regression)

| Concern | Rule |
|---------|------|
| `stock-price` / MIS | Unchanged; **never** subscribe top30 for quotes in preheat |
| Quote TTL / auction lock | Unchanged |
| Storage fundamental preheat | Must not write `price_cache` |
| UI | Quote card vs fundamental dates may differ (existing semantics) |

## Security / quota

- Ranking + preheat: **cron secret** only (or admin-run), not user JWT warm quota
- User `warm` remains for long-tail outside union / thin files
- `WARM_DAILY_LIMIT` unchanged

## Files (planned)

| Path | Change |
|------|--------|
| `stock-report/topTickers.ts` | Pure rank + file shape (**done draft**) |
| `stock-report/topTickers.test.ts` | Unit tests (**done draft**) |
| `stock-report/index.ts` | fetch STOCK_DAY_ALL, write meta, extend batchTwTickers, scope report |
| `stock-report/batchTickers.ts` | no change required if merge lists at call site |
| `schema.sql` | optional cron `sync-top-tickers`; optional log columns |
| Admin timeline / status | show dual-scope + `reportComplete` |

## Acceptance

1. ETF with high TradeValue appears in top 30 (no strip).
2. Job window starts **≥ 15:00 Taipei** on trading days.
3. `reportComplete` is true only when holdings scope **and** top30 scope both ready.
4. Opening a top-30 symbol with thick Storage does not need on-demand history for soft mins.
5. Live price path unchanged (tests for stock-price / quoteWindow still green).
6. Failure of OpenAPI ranking does not wipe previous top30 file.

## Open points (non-blocking)

- Whether watchlist is inside "holdings scope" for the gate (recommend **yes**, same as batch union personal set).
- TPEX merge for OTC names that dominate volume.
- Soft-ready thresholds (6/6) vs hard 12/12 for `reportComplete` — v1 = soft; may raise later.
