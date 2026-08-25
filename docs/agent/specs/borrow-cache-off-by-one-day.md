# BUG-037 — `borrow` never lands: the cache predicate and the landing predicate differ by one day

## Root cause (proven, not inferred)

Two predicates answer "is this borrow payload the one today's report needs", and they disagree:

| Question | Predicate | Location |
| --- | --- | --- |
| Is the cached payload still fresh? | `ymd >= tradeYmd` | `index.ts:745` — `readBorrowCacheFrom` uses `.gte('ymd', minYmd)` |
| Did borrow land? | `date > tradeYmd` | `sourceProbePlan.ts:404-407` — `borrowHit()` |

The borrow endpoint (TWT96U / `SBL_D`) has no date parameter and always returns "the latest".
Intraday it declares **today** (today's quota); only after the close does it flip to the **next**
trading day. `loadBorrow(todayYmd)` (`index.ts:2925`) therefore behaves like this:

1. An earlier `generate-chips` of the same day (fired by a `t86` / `margin` / `twt38u` hit) fetches
   the pre-flip payload, whose declared date is today, and caches it under `ymd = todayYmd`
   (`index.ts:789-792`).
2. The flip happens around 22:15-22:30. The probe fetches the endpoint directly, sees the next
   trading day, and records `hit = true`.
3. The hit fires `generate-chips`. `loadBorrow(todayYmd)` asks for a cached row with
   `ymd >= todayYmd` — the pre-flip row from step 1 satisfies it — so **the endpoint is never
   called again that day** and the report keeps `sources.borrow.date = today`.
4. `sourceLanded('borrow')` = `borrowHit(today, today)` = `today > today` = **false**, forever.

Measured on PROD: `source_probe_tick` for `borrow` from 2026-08-11 to 2026-08-24 is
**373 ticks / 126 hits / 0 landed** — it has never landed. The 2026-08-24 notes show the shape
exactly: 21:00-22:25 `借券日=2026-08-24＝當日額度，尚未翻日` (no hit), then 22:30-23:30
`借券日=2026-08-25（已翻次一交易日） · 已觸發 generate-chips：無變動 · 資料未到位，下輪重試`
repeated 13 times.

## Decision

One rule, not two. The cache is usable only when the cached payload is the one the landing
criterion asks for, and both questions are answered by the **same** exported predicate.

## Contract

### `sourceProbePlan.ts`

Add next to `borrowHit()`:

```ts
export function borrowCacheUsable(cachedYmd: string | null, tradeYmd: string): boolean
```

- Returns `borrowHit(cachedYmd, tradeYmd)` — do **not** write a second comparison. The whole point
  is that the cache question and the landing question can never drift apart again.
- `null` / an unparseable `cachedYmd` returns `false` (that is already `borrowHit`'s behaviour).
- Accepts `YYYYMMDD` (the shape of `chip_raw_cache.ymd`) and `YYYY-MM-DD` — `borrowHit` strips the
  dashes already.
- Doc comment (Traditional Chinese, matching the file) must state the measured failure: the old
  `>=` accepted the intraday payload, so after the flip the endpoint was never re-fetched.

### `index.ts` — `readBorrowCacheFrom` (currently line 736-755)

- Remove the `.gte('ymd', minYmd)` filter from the query. Select the newest `SBL_D` row
  (`.eq('dataset','SBL_D').order('ymd', { ascending: false }).limit(1).maybeSingle()`).
- After the row is read, return `null` unless `borrowCacheUsable(String(data.ymd), minYmd)`.
- Everything else in the function is unchanged: the `borrowDatedOk` guard, the
  `borrowDatedDate(resp) ?? dashDate(String(data.ymd))` fallback, and the `try/catch` returning
  `null`.
- Import `borrowCacheUsable` from `./sourceProbePlan.ts` alongside the existing imports.
- `loadBorrow()` itself is unchanged — the post-cache fetch, the `writeCache` keyed by the payload's
  own declared date, and the no-argument call at `index.ts:834` all stay as they are.

### Expected behaviour after the fix

- Pre-flip rounds: no cached row is newer than the trade date, so `generate-chips` fetches the
  endpoint. The report still shows the intraday borrow figures; nothing regresses.
- The first post-flip round fetches once, caches under `ymd = next trading day`, and the report's
  borrow stamp finally moves past today, so `sourceLanded('borrow')` is true.
- The following two rounds are served from that cache, so `borrow` reaches its trailing run of 3
  and retires — replacing today's 13 post-flip rounds with 3.

## Files

- `sources/supabase/functions/stock-report/sourceProbePlan.ts`
- `sources/supabase/functions/stock-report/index.ts`

Nothing else. Do not touch any `*.test.*` file, `probeRound.ts`, `twChips.ts`, or `docs/`.

## Verify

From `sources/`:

```
npm test -- sourceProbePlan.test.ts
npm run typecheck:edge
```

Both must pass and exit 0. `npm test`'s vitest summary can read "passed" on a red gate — check the
exit code.

`index.ts` is Deno-only and has **no vitest coverage**, so `typecheck:edge` plus review are the only
gates on that half. State in the report which lines of `readBorrowCacheFrom` you changed.

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| `borrowCacheUsable('20260824','20260824')` — the exact BUG-037 case | `false` | `sourceProbePlan.test.ts` |
| `borrowCacheUsable('20260825','20260824')` — post-flip payload | `true` | `sourceProbePlan.test.ts` |
| `borrowCacheUsable('20260823','20260824')` — stale | `false` | `sourceProbePlan.test.ts` |
| `borrowCacheUsable('2026-08-25','20260824')` — dashed input | `true` | `sourceProbePlan.test.ts` |
| `borrowCacheUsable(null,'20260824')` | `false` | `sourceProbePlan.test.ts` |
| the predicate is the same rule as `borrowHit` | identical results across a table of inputs | `sourceProbePlan.test.ts` |

## Non-goals

- No change to `borrowHit()`, to the borrow probe window (21:00-23:30), or to
  `REQUIRED_LANDED_COUNTS.borrow` (stays 3).
- No plumbing of a "force refetch" flag from the probe into `generate-chips`.
- No change to how `writeCache` keys the payload.
- No deploy in this change.
