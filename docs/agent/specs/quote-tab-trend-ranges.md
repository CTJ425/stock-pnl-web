# Spec: eight ranges on the 行情 trend chart

Target version: 0.9.42
Owner tab: `StockDetail > 行情` (`QuoteTab.tsx` + `IntradayChart.tsx`)
Status: approved by user 2026-09-10

## Goal

The 行情 tab's 走勢圖 must offer the same eight ranges as the rest of the feature:
`一日`, `五日`, `近 1 月`, `近 6 月`, `本年迄今`, `近 1 年`, `近 5 年`, `全部`.

It stays a **line chart** for all eight. K bars and indicators remain the 技術面 tab's job.
`技術面` is not changed by this spec — it keeps the six ranges shipped in 0.9.41.

## Decision that this spec reverses

0.9.41 asked the same question and the answer was "只擴充 K 線圖的選擇器" — the intraday
chart was explicitly left alone. The user reversed that on 2026-09-10 after seeing the
result. `docs/agent/specs/chart-range-eight.md` §7 lists `IntradayChart.tsx` under "Files
that need no change"; that line is now obsolete and a revision note points here.

## Facts established by reading the code

These are the reason the change stays small. Verify them before deviating.

- `IntradayChart` reads only three fields off `series`: `points`, `prevClose`, and `symbol`
  (`IntradayChart.tsx:139-140,182`). It never reads `interval`, `range`, `dayOpen`,
  `dayHigh` or `dayLow`. So the prop can be narrowed to a smaller structural type, and a
  daily-derived series does not have to invent an `interval`.
- `TwIndexToday.tsx:253` renders the same component with `range={range}` /
  `onRangeChange={setRange}` where its state is `IntradayRange`. Widening the prop to a
  plain `TrendRange` would break that call site on function-parameter contravariance.
  Making the props generic keeps it compiling untouched.
- `TwIndexToday` reads `dayOpen`/`dayHigh`/`dayLow` from its **own** `series` variable
  (`TwIndexToday.tsx:178-180`), not through `IntradayChart`. Narrowing the chart's prop
  does not affect it.
- `pickLabelIndices` is already exported and unit-tested in `technicalView.ts`. Reuse it
  for the daily x-axis instead of writing a second spacing rule.
- `rangeBars` (`technicalView.ts`) already implements every daily slice rule including
  `ytd`. Reuse it. Do not re-derive slicing.

## Changes

### 1. `sources/src/components/StockDetail/trendRange.ts` (new)

```ts
export type TrendRange = '1d' | '5d' | '1m' | '6m' | 'ytd' | '1y' | '5y' | 'all'

export const TREND_RANGES: readonly TrendRange[] =
  ['1d', '5d', '1m', '6m', 'ytd', '1y', '5y', 'all']

export const TREND_LABELS: Record<TrendRange, string> = {
  '1d': '一日',
  '5d': '五日',
  '1m': '近 1 月',
  '6m': '近 6 月',
  ytd: '本年迄今',
  '1y': '近 1 年',
  '5y': '近 5 年',
  all: '全部',
}

export function isIntradayRange(range: TrendRange): range is IntradayRange
export function dailyKeyOf(range: TrendRange): RangeKey | null
export function epochOfTradingDate(date: string): number
export function seriesFromDailyRows(
  symbol: string,
  rows: DailyRow[],
  range: TrendRange,
): TrendSeries | null
```

- `isIntradayRange` is true for `'1d'` and `'5d'` only.
- `dailyKeyOf` returns `null` for `'1d'`/`'5d'`; for every other value it returns the same
  string, which is already a valid `RangeKey` from `technicalView.ts`. Do not duplicate the
  `RangeKey` union — import it.
- `epochOfTradingDate('2026-09-10')` returns `Date.parse('2026-09-10T00:00:00Z') / 1000`.
  The chart formats the label back with **UTC** getters, so the round trip is exact and no
  time zone can shift a bar by one day.
- `seriesFromDailyRows`:
  1. Return `null` when `dailyKeyOf(range)` is `null` or `rows` is empty.
  2. `take = Math.min(rangeBars(rows, key), rows.length)`; `from = rows.length - take`.
  3. `prevClose = from > 0 ? rows[from - 1][4] : null`. Taking the row **before** the slice
     is what makes the first visible bar's colour and change figure correct.
  4. `points = rows.slice(from).map(r => ({ t: epochOfTradingDate(r[0]), c: r[4], v: r[5] }))`.
  5. Return `{ symbol, prevClose, points }`.

### 2. `sources/src/components/StockDetail/IntradayChart.tsx`

- Export a narrower series type and use it as the prop type:

```ts
export interface TrendSeries {
  symbol: string
  prevClose: number | null
  points: IntradayPoint[]
}
```

  `IntradaySeries` stays structurally assignable to it, so both existing call sites keep
  working. Change the `series` prop from `IntradaySeries | null` to `TrendSeries | null`.

- Make the props generic so `TwIndexToday` needs no edit:

```ts
export interface IntradayChartProps<R extends TrendRange = TrendRange> {
  series: TrendSeries | null
  loading: boolean
  error?: boolean
  range: R
  onRangeChange: (range: R) => void
  /** Which buttons to draw. Defaults to the two intraday ranges. */
  ranges?: readonly R[]
  tradeDate?: string | null
  showVolume?: boolean
}

export function IntradayChart<R extends TrendRange>(props: IntradayChartProps<R>)
```

- Render the range buttons from `ranges ?? (['1d', '5d'] as readonly R[])`, labelling each
  with `TREND_LABELS[r]` and keeping the existing `aria-pressed={r === range}` and the
  `m-range` / `走勢區間` markup. Do not hand-write the two buttons any more.

- Add `const intraday = isIntradayRange(range)` and branch these five places on it:

  1. **`labels`** — `intraday` keeps `hourMinute(p.t).label`. Otherwise format from the
     epoch with UTC getters: `MM/DD`, except `range === 'all'` which uses `YYYY/MM`.
  2. **`labelIndices`** — `intraday` keeps the existing hour/day grouping. Otherwise use
     `pickLabelIndices(points.length, 6)` imported from `./technicalView`.
  3. **`vwap`** — `intraday` keeps `vwapSeries(points)`. Otherwise every entry is `null`.
     A cumulative VWAP across a year is not a meaningful number, and an all-`null` series
     makes `lineSegments` emit nothing, so the 均價 line disappears with no other change.
  4. **`dateRemark`** — `intraday` keeps the existing `當日走勢` / `近 5 日走勢` text.
     Otherwise use `` `${TREND_LABELS[range]}走勢` ``.
  5. **`tooltipFor`** — `intraday` keeps `時間 HH:MM` and `單量`. Otherwise the first field
     is `日期 YYYY-MM-DD` (UTC getters again) and the volume field reads
     `成交量 N 張`. The 均價 line drops out on its own because `vwap[i]` is `null`.

- `rangeLabel` becomes `TREND_LABELS[range]`. The `ariaLabel` template is otherwise unchanged.
- Do not change `changeLabel`, `vwapSeries`, `finalVwap`, `priceDomain`, `niceDomain`, the
  SVG geometry, the hover handling, or the volume pane.

### 3. `sources/src/components/StockDetail/QuoteTab.tsx`

- Two new props, appended to the existing interface, both **optional**:
  `dailySeries?: DailySeries | null` (default `null`) and `dailyStatus?: DailyStatus`
  (default `'ready'`). Optional keeps the 404-line `QuoteTab.test.tsx` and its single
  `renderTab` helper compiling without a sweep through every call site.
- `const [range, setRange] = useState<TrendRange>('1d')` — the default stays 一日.
- Replace the single intraday effect with one effect keyed on
  `[ticker, range, dailySeries]` that covers three cases. It must set `series` to `null`
  **at the top of every run**, before any branch:

  1. `isIntradayRange(range)` → the existing `fetchIntraday({ market: 'TPE', ticker }, range)`
     path, unchanged.
  2. `dailyKeyOf(range)` is `'1m' | '6m' | 'ytd' | '1y'` → no network. Build with
     `seriesFromDailyRows(ticker, dailySeries?.rows ?? [], range)`. Loading follows
     `dailyStatus === 'loading'`; error follows `dailyStatus === 'error'`.
  3. `dailyKeyOf(range)` is `'5y' | 'all'` → `await fetchRemoteDaily(ticker, remoteRangeOf(range)!)`,
     then `seriesFromDailyRows(ticker, remote.rows, range)`. Set the error flag when it
     returns `null`.

  **Guard the async paths with an `alive` flag and honour it before every `set*` call.**
  0.9.41 shipped exactly this bug on the other tab: clearing state only in one branch left
  the previous range's rows on screen under the new range's label, with no loading
  indicator. That is the specific failure this effect must not repeat.

- `const vwap = isIntradayRange(range) ? finalVwap(series?.points ?? []) : null`.
  The `均價` cell then renders `—` on the daily ranges through the existing `fmtPrice`.
- Pass `ranges={TREND_RANGES}` to `<IntradayChart>`. Every other prop is unchanged.

### 4. `sources/src/components/StockDetail/StockDetailPage.tsx`

Pass the already-loaded daily series down — `useDailySeries` is called at lines 190-195 and
its result is currently only used for `technicalLatest`:

```tsx
<QuoteTab
  …existing props…
  dailySeries={dailySeries}
  dailyStatus={dailyStatus}
/>
```

### 5. Files that must not change

`TwIndexToday.tsx`, `technicalView.ts`, `TechnicalTab.tsx`, `dailyProxy.ts`,
`intradayProxy.ts`, `intradayParse.ts`, anything under `sources/supabase/`, any migration.
The Edge `daily` action shipped in 0.9.41 and is already deployed to DEV; this is a
front-end-only change.

## Accepted deviations from the text above

Recorded after implementation. Both were adjudicated by the main session, not chosen by the builder.

1. **`ranges ?? (['1d', '5d'] as unknown as readonly R[])`.** The spec wrote a single cast.
   TypeScript rejects it because `R` is unconstrained inside the generic body, so the double
   cast through `unknown` stands.
2. **A wrapper `<div>` around the chart region, carrying `role="group"` and the rich
   `aria-label`, on daily ranges only** (`IntradayChart.tsx:285`). `ChartFrame` labels its own
   `<svg role="group">` through `aria-labelledby`, and the volume frame's name is
   `${ariaLabel}，成交量` — so both frames match the same range-label substring and a role query
   cannot tell them apart. The wrapper takes the price-bearing name and the two frames take
   static names (`走勢圖` / `走勢圖，成交量`). Intraday ranges keep exactly their previous
   accessible names; the extra `<div>` carries no role or label for them.

   This is a production change driven by test ergonomics, which is why it is written down here.
   It was kept rather than reverted because a chart with two panes reads better as one named
   group than as two frames whose names differ only by a suffix. Revisit it if `ChartFrame` ever
   grows a real `aria-label` prop — at that point the wrapper can go.

## Verify

Run from `sources/`:

```
npm run build
npm run typecheck:edge
npx vitest run
```

`npm run build` is the type gate — `npx tsc --noEmit` does not type-check test files here.

## Deploy note

No Edge deploy is needed for this version. `近 5 年` and `全部` still depend on the
`stock-price` `daily` action, which is live on DEV (v7) and **not yet on PROD**.
