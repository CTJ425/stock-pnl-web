# Task 162 — Global indices on the Macro page (JP / KR / US), with intraday polling

Status: spec (2026-09-15)
Lane: 2 (Edge Function change + deploy) for §4; Lane 1 for §3 and §5.

## Goal

Add a third subtab to the Macro page. The subtab shows 8 foreign indices in 3 region
groups, and refreshes every 60 s while a region is in session.

## Contract

### Symbols (verified 2026-09-15 against Yahoo chart v8, all HTTP 200 with a price)

| Region | Label | `market` | `ticker` |
| --- | --- | --- | --- |
| JP | 日經 225 | `IDX` | `^N225` |
| KR | KOSPI | `IDX` | `^KS11` |
| KR | KOSDAQ | `IDX` | `^KQ11` |
| US | 道瓊 | `IDX` | `^DJI` |
| US | S&P 500 | `IDX` | `^GSPC` |
| US | 那斯達克 | `IDX` | `^IXIC` |
| US | 費城半導體 | `IDX` | `^SOX` |
| US | 羅素 2000 | `IDX` | `^RUT` |

`^TOPX` (TOPIX) is excluded on purpose: Yahoo returns HTTP 200 but
`meta.regularMarketPrice` is `null`.

### Trading sessions (local time of each market)

| Region | Timezone | Session | Break |
| --- | --- | --- | --- |
| JP | Asia/Tokyo | Mon–Fri 09:00–15:30 | 11:30–12:30 |
| KR | Asia/Seoul | Mon–Fri 09:00–15:30 | none |
| US | America/New_York | Mon–Fri 09:30–16:00 | none |

Rules:
- The open bound is inclusive, the close bound is exclusive. 15:30 JST is `closed`.
- The break start is inclusive, the break end is exclusive. 11:30 JST is `break`,
  12:30 JST is `open`.
- Read the weekday in the market timezone, not in UTC or in Asia/Taipei.
- Public holidays are out of scope. A holiday reports `open` and returns the last close.

### Error cases

- A symbol that Yahoo does not answer: show `—` in every number cell. Do not block the
  other 7 cards.
- The whole request fails: keep the last good values on screen, show the previous
  `lastUpdated` time, and retry at the next tick. Do not clear the cards.

### What must not change

- The existing 台股 and 美國經濟 subtabs, their data path, and their tests.
- `price_cache` behaviour for `TPE:` and `US:` keys. Only `IDX:` keys get the new TTL.
- Holdings pricing, P&L, and any money calculation. This task is display only.

## Data path

The Edge Function `stock-price` already accepts `market: 'IDX'`. `yahooSymbols()`
(`sources/supabase/functions/stock-price/index.ts:123`) returns the ticker verbatim for any
market other than `TPE`, and `index.ts:681` applies no market allow-list. 8 indices cost
**one** POST.

Request:

```
{ action: 'prices', symbols: [{ market: 'IDX', ticker: '^N225' }, ...] }
```

Response (`index.ts:322`):

```
{ prices: { 'IDX:^N225': { price, prevClose, open, high, low, volume, tradeDate, tradeTime, trial, asOf } } }
```

### Why a new service and not `priceProxy.fetchPrices`

`PriceRequestItem.market` is typed `Market = 'TPE' | 'US'`
(`sources/src/types/models.ts:3`). `Market` is the holdings and P&L type. Do not widen it.
`fetchPrices` also holds an L1 localStorage cache whose non-`TPE:` TTL is 10 minutes
(`priceProxy.ts:93`), which would stall a 60 s poll.

Add `sources/src/services/indexQuotes.ts` instead. It is display-only, holds no cache, and
does not import `Market`.

```ts
export interface IndexQuote { ticker: string; price: number; prevClose: number | null }
export async function fetchIndexQuotes(tickers: string[]): Promise<Record<string, IndexQuote>>
```

- Key the result by the bare ticker. Strip the `IDX:` prefix.
- Return `{}` for an empty input, for an Edge error, and for a thrown exception. Never throw.
- Drop an entry whose `price` is not a finite number greater than 0.
- Set `prevClose` to `null` unless it is a finite number greater than 0.

### The one server-side change

`cacheTtlMsFor()` (`sources/supabase/functions/stock-price/index.ts:97`) gives every
non-`TPE:` key a 10-minute DB cache. A 60 s poll would read a value up to 10 minutes old.
Add an `IDX:` branch that returns 60 000 ms. Do not change the `TPE:` or `US:` result.

## Polling

`sources/src/components/Macro/GlobalIndices.tsx` owns the timer. Copy the shape of
`sources/src/hooks/useStockPrices.ts:63-73`.

1. Fetch all 8 tickers once on mount.
2. Every 60 s, fetch only the tickers of the regions that `openRegions(new Date())` returns.
3. Skip the network call when `openRegions()` returns an empty array. Keep the timer.
4. On `visibilitychange` to `visible`, fetch the open regions immediately.
5. Clear the interval and remove the listener on unmount.
6. MacroPage renders the panel only when the subtab is active, so unmount stops the timer.

## UI

- `MacroSubTab` becomes `'tw' | 'us' | 'world'`. The new tab label is `國際指數`.
- Three groups in this order: 日本, 韓國, 美國. Each group header carries a session badge:
  `盤中` / `午休` / `已收盤`.
- One card per index. Show the name, the price, the change, and the change percent.
- Match `TwIndexToday.tsx`: container class `rpt-card`, value class `v`.
- Colour the change with `pnlClass` from `sources/src/utils/formatters.ts:80`.
- Show `—` in every number cell of an index that has no quote.
- Show the last update time as `HH:mm:ss` on the Asia/Taipei clock.

## Files

The builder may touch these files and nothing else:

| File | Action |
| --- | --- |
| `sources/src/components/Macro/sessionHours.ts` | create — pure session logic |
| `sources/src/services/indexQuotes.ts` | create — Edge call, display only |
| `sources/src/components/Macro/GlobalIndices.tsx` | create — 3 groups, cards, polling |
| `sources/src/components/Macro/MacroPage.tsx` | edit — add the `world` subtab |
| `sources/supabase/functions/stock-price/index.ts` | edit — `IDX:` branch in `cacheTtlMsFor` |
| `sources/src/index.css` or the Macro style file | edit — only if a new class is needed |

Both test files already exist and are red. The builder must not edit them.

## Verify

```
cd sources
npm test -- src/components/Macro/sessionHours.test.ts
npm test -- src/services/indexQuotes.test.ts
npm run build
npm run typecheck:edge
```

`npm run build` is the type gate. `npx tsc --noEmit` does not check test files here.

The Edge TTL change has no unit test. Verify it on DEV after deploy: call the `prices`
action twice, 90 s apart, and compare `asOf`. The second value must differ.

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| 09:00 JST | `marketSession('JP') === 'open'` | `sessionHours.test.ts` |
| 11:30 JST | `'break'` | `sessionHours.test.ts` |
| 12:30 JST | `'open'` | `sessionHours.test.ts` |
| 15:30 JST | `'closed'` | `sessionHours.test.ts` |
| 11:30 KST | `'open'` (KR has no break) | `sessionHours.test.ts` |
| 09:30 ET in EDT (13:30 UTC) | `'open'` | `sessionHours.test.ts` |
| 09:30 ET in EST (14:30 UTC) | `'open'` — proves no hardcoded offset | `sessionHours.test.ts` |
| 13:30 UTC in January | `'closed'` (08:30 ET) | `sessionHours.test.ts` |
| Monday 00:30 UTC | US `'closed'` (Sunday in New York) | `sessionHours.test.ts` |
| Saturday | every region `'closed'`, `openRegions() === []` | `sessionHours.test.ts` |
| 01:00 UTC | `openRegions() === ['JP','KR']` | `sessionHours.test.ts` |
| 13:30 UTC | `openRegions() === ['US']` | `sessionHours.test.ts` |
| `IDX:` cache key | TTL is 60 s, not 600 s | `stock-price` Edge unit or manual |
| `TPE:` and `US:` cache keys | TTL unchanged | same |

## Non-goals

- No new cron job, no new database table, no new Edge Function.
- No intraday chart for the foreign indices. Numbers only in this task.
- No holiday calendar.
- No version bump by the builder. The ship step owns the version.
