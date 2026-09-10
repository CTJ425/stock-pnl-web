# Spec: eight ranges on the daily K chart

Target version: 0.9.41
Owner tab: `StockDetail > 技術` (`TechnicalTab.tsx`)
Status: approved by user 2026-09-10

## Goal

The daily K chart range selector must offer six ranges:
`近 1 月`, `近 6 月`, `本年迄今`, `近 1 年`, `近 5 年`, `全部`.

The intraday chart keeps `一日` / `五日` and does not change. The two selectors
together give the eight ranges the user asked for.

Remove the current `近 3 月` button.

## Decisions already made

1. **Route A.** `5y` and `全部` do not go into Storage. The client asks the
   `stock-price` Edge Function for them on demand. The nightly `daily/{ticker}.json`
   batch does not change. Supabase storage use does not change.
2. **`全部` is a monthly chart.** Measured 2026-09-10 with `2330.TW`:
   - `range=max&interval=1d` → Yahoo ignores `interval` and returns `dataGranularity=1mo`,
     321 rows, 28 KB.
   - `period1=0&interval=1d` → 6643 daily rows, 566 KB. Too heavy for one browser
     request and for an SVG chart. Do not use it.
3. **`1m`, `6m`, `ytd`, `1y` read the existing file.** `daily/{ticker}.json` holds
   about 244 rows (1 year). YTD is always a subset of it (measured: 168 rows).

## Measured facts the code must handle

- `range=5y&interval=1d` returns 1215 daily rows for `2330.TW`. One row
  (2025-08-01) has `null` in all five OHLCV fields. Drop such rows.
- `range=max` returns monthly bars stamped at **month start**, but only after you
  add `meta.gmtoffset`. Without the offset the dates read as month end and are wrong.
- `range=max` appends one extra live row for today (`2026-09-10`) after the
  current month bar (`2026-09-01`). Its timestamp equals `meta.regularMarketTime`.
  Drop that row, or the chart shows two bars for the current month.

## Changes

### 1. `sources/supabase/functions/stock-price/dailyRange.ts` (new)

```ts
export type DailyRangeKey = '5y' | 'max'
export function dailyRangeInterval(range: DailyRangeKey): '1d' | '1mo'
export function extractMonthly(resp: ChartResponse): DailyRow[]
```

- `dailyRangeInterval`: `'5y' → '1d'`, `'max' → '1mo'`.
- Import `DailyRow`, `ChartResponse`, `tradingDateOf` from `../stock-report/twDaily.ts`.
  The `../_shared/log.ts` import in `index.ts:42` proves a relative import outside the
  function directory bundles correctly.
- `extractMonthly` rules, in order:
  1. Read `chart.result[0]`. Return `[]` when `timestamp` is not an array or
     `indicators.quote[0]` is missing.
  2. `offset = meta.gmtoffset ?? 28800`.
  3. Skip index `i` when `close`, `open`, `high` or `low` is not a finite number.
  4. Skip index `i` when `timestamp[i] === meta.regularMarketTime` (the live bar).
  5. `date = tradingDateOf(timestamp[i], offset)`; `volume` falls back to `0`.
  6. Sort ascending by date.
- Do **not** apply the `isTwMarketClosed` filter here. That filter belongs to daily
  bars only. `extractDaily` keeps it, and the `5y` branch reuses `extractDaily`
  unchanged so that the last bar of `近 5 年` matches the last bar of `近 1 年`.

### 2. `sources/supabase/functions/stock-price/index.ts`

Add one action. Keep the existing five untouched.

```
POST { action: 'daily', symbol: { market, ticker }, range: '5y'|'max' }
  → { rows: DailyRow[], granularity: '1d'|'1mo' }
```

- Reject any other `range` value with `json({ error: 'range 需為 5y 或 max' }, 400)`,
  mirroring the `intraday` branch at `index.ts:626-630`.
- Handler `handleDailyRange(symbol, range)`: build the URL exactly as
  `handleIntraday` does at `index.ts:565-567`, with
  `interval=${dailyRangeInterval(range)}&range=${range}`. Walk `yahooSymbols(symbol)`
  and return the first candidate that yields a non-empty row array.
- Parse with `extractDaily(data)` when `range === '5y'`, `extractMonthly(data)` when
  `range === 'max'`.
- Every candidate failing is a normal answer, not an error: return
  `json({ rows: [], granularity: dailyRangeInterval(range) })`.
- Add the action to the interface comment block at the top of the file, in the same
  style as the `intraday` entry.
- Keep `verify_jwt` default. Do not add `--no-verify-jwt`.

### 3. `sources/src/services/dailyProxy.ts`

Add, next to `fetchDailySeries`:

```ts
export type RemoteDailyRange = '5y' | 'max'
export interface RemoteDaily { rows: DailyRow[]; granularity: '1d' | '1mo' }
export async function fetchRemoteDaily(
  ticker: string,
  range: RemoteDailyRange,
): Promise<RemoteDaily | null>
```

- Copy the shape of `fetchIntraday` in `services/intradayProxy.ts`: module-level
  `Map` cache, return `null` when `!isSupabaseConfigured || !supabase`, `try/catch`
  returning `null`, `supabase.functions.invoke('stock-price', { body, timeout: 15_000 })`.
- Cache TTL is `300_000` ms, not 60 s: this data changes once per trading day.
- Cache key is `` `${ticker}:${range}` ``.
- Body is `{ action: 'daily', symbol: { market: 'TPE', ticker }, range }`.
  Assumption stated: the daily K chart serves Taiwan stocks only, because
  `daily/{ticker}.json` is written by the Taiwan nightly batch.
- Filter the returned rows with the existing `isValidRow` guard. Return `null` when
  no valid row survives.

### 4. `sources/src/components/StockDetail/technicalView.ts`

```ts
export type RangeKey = '1m' | '6m' | 'ytd' | '1y' | '5y' | 'all'

export const RANGE_LABELS: Record<RangeKey, string> = {
  '1m': '近 1 月',
  '6m': '近 6 月',
  ytd: '本年迄今',
  '1y': '近 1 年',
  '5y': '近 5 年',
  all: '全部',
}

/** Ranges whose rows come from the Edge Function, not from daily/{ticker}.json. */
export function isRemoteRange(range: RangeKey): boolean
export function remoteRangeOf(range: RangeKey): '5y' | 'max' | null
export function rangeBars(rows: DailyRow[], range: RangeKey): number
```

- Delete `RANGE_BARS`. Replace its use at `technicalView.ts:127` with
  `const take = Math.min(rangeBars(rows, range), rows.length)`.
- `rangeBars` returns how many trailing bars to show:
  - `'1m'` → `20`
  - `'6m'` → `120`
  - `'1y'`, `'5y'`, `'all'` → `rows.length`
  - `'ytd'` → the number of trailing rows whose date is `>= ${year}-01-01`, where
    `year` is the year of the **last row's date**, not the wall clock. Reading the
    year from the data keeps the function pure and removes every time zone question.
    Return at least `1`.
- `isRemoteRange` is true for `'5y'` and `'all'`. `remoteRangeOf` maps
  `'5y' → '5y'`, `'all' → 'max'`, everything else `→ null`.
- **Do not change the calculate-then-slice order.** The file header explains why.
  Indicators stay computed over the full `rows` argument.

### 5. `sources/src/components/StockDetail/TechnicalTab.tsx`

- `const RANGES: RangeKey[] = ['1m', '6m', 'ytd', '1y', '5y', 'all']` (line 47).
- Default state becomes `useState<RangeKey>('1m')` (line 103).
- Add remote loading. Keep it inside this component; do not change the props.

```ts
const [remote, setRemote] = useState<RemoteDaily | null>(null)
const [remoteBusy, setRemoteBusy] = useState(false)
```

  In a `useEffect` keyed on `[ticker, range]`: when `remoteRangeOf(range)` is null,
  set `remote` to null and stop. Otherwise set `remoteBusy` true, call
  `fetchRemoteDaily`, and guard the result with an `alive` flag so a fast range
  switch cannot write a stale answer. Clear `remoteBusy` in both paths.

- The view source becomes:

```ts
const sourceRows = isRemoteRange(range) ? (remote?.rows ?? null) : (series?.rows ?? null)
const view = useMemo(
  () => (sourceRows ? buildTechnicalView(sourceRows, range) : null),
  [sourceRows, range],
)
```

- While `remoteBusy` is true and `remote` is null, show the existing loading block
  (`RefreshCw` + `正在讀取歷史股價…`) in place of the charts. Reuse the markup that
  the `status === 'loading'` branch already renders; do not invent a new style.
- When the remote fetch returns null, show the existing
  `notice notice-warn` warning block with the text `讀取長區間股價失敗，請稍後再試。`
- The volume table heading at line 303 counts trading days. `全部` counts months.
  Change the unit word only:
  `每日成交量・{RANGE_LABELS[range]}（{view.volumeRows.length} 筆）`.
  Change the expand button text at line 308-309 the same way: `只顯示近 20 筆` and
  `顯示全部 N 筆`.
- Do not change the `status === 'loading'` and `status === 'error'` early returns.
  They guard the file fetch, which the remote ranges do not use.

### 6. `sources/src/components/StockDetail/StockDetailPage.tsx:198`

`buildTechnicalView(dailySeries.rows, '3m')` → `buildTechnicalView(dailySeries.rows, '1m')`.
The call only reads `.latest`, which is range independent, so the value does not change.

### 7. Files that need no change

> **Revision 2026-09-10 (0.9.42).** The `IntradayChart.tsx` line below is **obsolete**.
> The user reversed the "只擴充 K 線圖的選擇器" decision after seeing 0.9.41 and asked for the
> same eight ranges on the 行情 trend chart. That work is specified in
> `docs/agent/specs/quote-tab-trend-ranges.md`. Everything else in this spec still holds:
> the 技術面 tab keeps the six ranges described here, and the Edge `daily` action is unchanged.

- `AiTab.tsx:115` already uses `'1y'`, which survives.
- `aiPayload.ts` reads `RANGE_LABELS[range]` generically.
- `components/Fx/fxConvert.ts` has its own unrelated `FxRange = '3m'|'6m'|'1y'`.
  Do not touch it.
- `IntradayChart.tsx`, `intradayParse.ts`, `intradayProxy.ts`.
- `stock-report/` — the nightly batch and `daily/{ticker}.json` do not change.

## Verify

Run from `sources/`:

```
npm run build
npm run typecheck:edge
npx vitest run
```

`npm run build` is the type gate. `npx tsc --noEmit` does not check test files here.
`npm run typecheck:edge` is a separate gate and covers `supabase/functions`.

## Deploy note

The `daily` action needs a `stock-price` deploy to DEV before `近 5 年` and `全部`
can answer in the browser. Ask the user before any deploy.
