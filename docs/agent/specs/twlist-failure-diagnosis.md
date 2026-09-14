# BUG-081 — `twlist` fails with no usable diagnosis

## Problem

The Taiwan stock list does not load. Two layers hide the cause.

Measured on 2026-09-14 (PROD `hrilemueiqyaoiwnkeuu`, DEV `zyebvayngwrqzoaicbwd`, both `ap-south-1`):

- `POST /functions/v1/stock-price {"action":"twlist"}` returns **HTTP 502** three times out of
  three, body `{"error":"台股清單來源不完整（上市或上櫃來源無回應）"}`, in 0.8–1.2 s.
- Both upstream endpoints answer HTTP 200 from a host outside Supabase.
- The Edge network is up: the same function's `prices` action returned live MIS quotes at
  09:57:33 Asia/Taipei.
- The deployed function is version 7 from 2026-09-10; no code changed.
- The only client log row is `error / web / fetchDirect / TypeError: Failed to fetch`, which is
  the expected CORS block of the fallback path, not the real failure.

The real failure is that one of TWSE / TPEx does not answer from `ap-south-1`. **The code cannot
say which one, or why.** This spec makes the failure name itself. It does not add a fallback
source; that comes after the next `twlist` call reports the failing host.

## Contract

### A. `sources/supabase/functions/stock-price/twList.ts`

Add the failure detail to the result type:

```ts
export interface TwListFailure {
  source: 'TWSE' | 'TPEx'
  reason: string
}

export type TwListResult =
  | { ok: true; rows: TwListRow[] }
  | { ok: false; error: string; failures: TwListFailure[] }
```

`buildTwList` must:

1. Examine **both** sources before it returns. The current early return on a rejected source
   hides the state of the other source; remove it.
2. Record one `TwListFailure` per failed source, in the order TWSE then TPEx:
   - a rejected source: `reason` is the rejection's `message` when it is an `Error`, else
     `String(reason)`, cut to 200 characters;
   - a fulfilled source with zero usable rows: `reason` is
     `` `0 usable rows of ${raw.length} returned` ``.
3. Return `ok: false` when `failures` is not empty, with
   `` error = `台股清單來源不完整：${failures.map((f) => `${f.source} ${f.reason}`).join('；')}` ``.
4. Keep every behaviour the current tests fix: TWSE rows first, TPEx second, first code wins on
   a duplicate, a row without a code or a name is dropped, `close` parses thousands separators
   and records a non-positive or unparsable price as `null`.

### B. `sources/supabase/functions/stock-price/index.ts` — `handleTwList`

On `!result.ok`, write the reason to `app_log` before the response:

```ts
await logEvent(db, {
  level: 'error',
  action: 'twlist',
  message: result.error,
  detail: { failures: result.failures },
})
return json({ error: result.error, failures: result.failures }, 502)
```

`logEvent` and `db` are already in scope. Change nothing else in this file.

### C. `sources/src/services/twMarketData.ts` — `fetchViaEdge`

The function returns `[]` on `error` and writes no log. Make it log first.

1. Destructure `response` as well: `const { data, error, response } = await supabase.functions.invoke(...)`.
   `FunctionsResponse` carries `response?: Response` on both branches.
2. When `error` is set **or** `data.rows` is not an array, call
   `logClient('error', 'fetchViaEdge', <description>, {})` and then return `[]`.
3. `<description>` joins with `' · '`, dropping empty parts, in this order:
   - the error message — `error.message` for an `Error`, else `String(error)`, and
     `'rows 非陣列'` when `error` is null;
   - `` `HTTP ${response.status}` `` when `response` exists;
   - the response body text, cut to 300 characters, read only when `response.bodyUsed` is
     false. Add **no** inner `try`/`catch`: `catchLogging.test.ts` holds this file to exactly
     three catch blocks, each of which must call `logClient`. A rejected read falls to the
     existing outer catch, which logs and returns `[]`.
4. Keep the existing `catch` block, and keep returning `[]` in every failure case. A throw here
   would skip the direct fallback.

## Files

- `sources/supabase/functions/stock-price/twList.ts`
- `sources/supabase/functions/stock-price/index.ts`
- `sources/src/services/twMarketData.ts`

## Verify

From `sources/`:

```
npm test -- src/services/twMarketData.test.ts supabase/functions/stock-price/twList.test.ts
npm run build
npm run typecheck:edge
```

All three must exit 0.

## Test charter

| Case | Expected outcome | Layer / file |
| ---- | ---- | ---- |
| E9 | A rejected TWSE source names `TWSE` and carries the rejection message | `supabase/functions/stock-price/twList.test.ts` |
| E10 | Both sources rejected gives two failures, TWSE first | same |
| E11 | A fulfilled source with no usable rows reports the raw count, not "no answer" | same |
| E12 | `error` text contains every failed source name | same |
| L7 | An Edge 502 logs `fetchViaEdge` with the status and the Edge error body | `src/services/twMarketData.test.ts` |
| L8 | An Edge 200 whose `rows` is not an array logs `fetchViaEdge` too | same |

## Non-goals

- No fallback or mirror source for either exchange. Decide that after the next 502 names the host.
- No change to the completeness rule: a half list still fails. See RISK-010 and BUG-075/076.
- No change to `AddWatchModal`; the user still reads the fixed string 「台股清單載入失敗」.
- No deploy. The user approves each deploy.
