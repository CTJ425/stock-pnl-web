# Task 130 — Auto chip warm for a newly added symbol

- Status: SPEC
- Lane: 2 (Edge Function + external API + background-job overlap)
- Timestamp: 2026-08-30 Asia/Taipei

## Problem

A symbol that the user adds for the first time has no chip data (三大法人 / 融資券 / 借券)
until the next nightly `generate-all` run. Two paths add a symbol:

- `WorkspaceContext.tsx:157` -> `prefetchStockData()` -> `warmStock()`. This path syncs
  daily prices and fundamentals only. It does not produce chip data.
- `watchlistService.ts:53` `addWatch()`. This path inserts one row and triggers nothing.

## Key facts that shape the design

1. `chip_raw_cache` stores the FULL whole-market TWSE payload per `(ymd, dataset)`
   (`index.ts:445`, `index.ts:461`). No filtering happens before the write.
2. Ticker filtering happens after the cache read: `sliceDay(raw, tickers)` (`index.ts:555`).
3. `loadSeries(tickers, now, opts)` (`index.ts:516`) already accepts a ticker ARRAY.
   A cached date does not decrement `fetchBudget` (`index.ts:539-548`).
4. `buildReport(p)` (`report.ts:178`) builds one ticker's report object.
5. `manifest.json` records the date only, with no ticker list (`index.ts:2966`).
   A new per-ticker report file needs NO manifest update.
6. `chip_raw_cache` retention is 14 calendar days (`CACHE_RETAIN_DAYS`, `index.ts:863`).

Result: for a warm cache, a single-ticker chip backfill makes ZERO upstream calls.
It reads the cache, slices one ticker, and writes report files.

## Contract

### Edge Function `stock-report`, action `warm`

Add one new `phase` value: `'chips'`. Do NOT change `'core'`, `'history'`, or `'full'`.

Input: `{ action: 'warm', ticker: string, name?: string, phase: 'chips' }`

Behavior, in order:

1. Validate `ticker` with the same validation the existing `warm` action uses.
2. Idempotence gate. Read `manifest.json` to get the latest `ymd`. If
   `reports/{ymd}/{ticker}.json` already exists, return immediately with
   `skipped: 'already-present'` and `daysWritten: 0`. Make no further calls.
3. Call `loadSeries([ticker], now, { maxUpstreamDays: 2 })`.
4. For each trading day in the result, up to 7 days, call `buildReport()` and upload
   `reports/{ymd}/{ticker}.json`.
5. Do NOT write `manifest.json`.

Output: `{ ok, ticker, phase: 'chips', daysWritten, daysFetchedUpstream, skipped?, durationMs }`

Error cases:
- Invalid ticker -> the existing `warm` error shape, HTTP 400.
- Cold cache, budget exhausted -> `ok: true` with a partial `daysWritten`. Do not throw.
  The nightly cron completes the remaining days.

### `loadSeries` new option

Add `maxUpstreamDays?: number` to the `opts` parameter. The value caps how many dates
may trigger an upstream fetch in one call. When the caller omits the option, keep the
current `MAX_BACKFILL_DAYS` behavior exactly. The nightly `generate-chips` phase must
not change behavior.

### Client `warmStock.ts`

Add `warmStockChips(ticker: string, name?: string): Promise<WarmChipsResult>`.

- Invoke `stock-report` with body `{ action: 'warm', ticker, name, phase: 'chips' }`.
- Keep a module-level dedupe set, in the same style as the existing warm state, so one
  session invokes at most once per ticker.
- `resetWarmState()` must clear the new dedupe set too.
- Return `{ ok: boolean, daysWritten: number, skipped?: boolean }`.
- On invoke error, return `{ ok: false, daysWritten: 0 }`. Do not throw.

### Client `prefetchStockData.ts`

After the existing fundamental logic, call `warmStockChips(ticker, name)`.
A chip failure must not change the existing return value or throw.

### Client `watchlistService.ts`

In `addWatch()`, after a SUCCESSFUL insert only, call `prefetchStockData(ticker, name)`.
Attach `.catch(() => {})`. A prefetch failure must never fail `addWatch()`.
Do not call it when the cap check rejects, or when the insert returns an error.

## What must NOT change

- `warm` phases `core` / `history` / `full`.
- The `generate-chips` nightly phase and its `batchTwTickers()` scope.
- `manifest.json` shape or write timing.
- `chip_raw_cache` schema, retention, or cleanup.
- The `tw_watchlist` insert payload and the watchlist cap rule.

## Non-goals

- No backfill deeper than `chip_raw_cache` retention allows.
- No per-symbol manual backfill button in the UI.
- No cron schedule change.
- No new DB table.

## Test charter

| Case | Expected outcome | Layer / file |
| ---- | ---- | ---- |
| `warmStockChips` invokes with the chips body | invoke called with `{action:'warm',ticker,name,phase:'chips'}` | `src/services/warmStock.test.ts` |
| `warmStockChips` dedupes a repeat call in one session | invoke called once for two calls | `src/services/warmStock.test.ts` |
| `resetWarmState` clears the chips dedupe | invoke called again after reset | `src/services/warmStock.test.ts` |
| `warmStockChips` returns ok:false on invoke error | no throw, `{ok:false,daysWritten:0}` | `src/services/warmStock.test.ts` |
| `prefetchStockData` fires the chips warm | `warmStockChips` called with ticker and name | `src/services/prefetchStockData.test.ts` |
| A chips failure does not break prefetch | prefetch resolves, no throw | `src/services/prefetchStockData.test.ts` |
| `addWatch` prefetches after a successful insert | `prefetchStockData` called with ticker and name | `src/services/watchlistService.test.ts` |
| `addWatch` does not prefetch when the insert errors | not called | `src/services/watchlistService.test.ts` |
| `addWatch` does not prefetch when the cap rejects | not called | `src/services/watchlistService.test.ts` |

## Coverage gap, stated explicitly

This repo has NO unit-test harness for `stock-report/index.ts` action dispatch. The
existing Edge tests cover pure functions only (`report.test.ts`, `twChips.test.ts`,
`chipStreak.test.ts`). The `phase: 'chips'` handler and the `maxUpstreamDays` cap
therefore carry NO automated test. Verify both by hand on DEV:

1. Add a symbol not present in any holding or watchlist.
2. Confirm `reports/{ymd}/{ticker}.json` appears for the recent trading days.
3. Confirm a second add returns `skipped: 'already-present'`.
4. Confirm the nightly `generate-chips` output stays unchanged.

## Verify

From `sources/`:

    npm test -- src/services/warmStock.test.ts src/services/prefetchStockData.test.ts src/services/watchlistService.test.ts
    npm run typecheck:edge

Check the EXIT CODE, not the summary line.
