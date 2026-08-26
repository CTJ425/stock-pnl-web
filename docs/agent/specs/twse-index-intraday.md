# Spec — TAIEX intraday panel in 總體經濟 > 台股

- Status: DRAFT — awaiting go-ahead to implement
- Lane: 2 (Edge Function change + external API + two deploy targets)
- Author: main session, 2026-08-26

## Task

Add a "當日大盤" panel at the top of the 台股 tab: an intraday TAIEX chart plus a stats
row of 開盤 / 最高 / 最低 / 昨收 / 漲跌點數 / 漲跌幅. The existing KPI grid, candle chart,
turnover chart and tables stay where they are and keep their current meaning.

## Established facts (measured, not assumed)

1. `^TWII` is served by Yahoo chart v8 and needs no special encoding beyond the
   `encodeURIComponent` the Edge already applies (`%5ETWII`).
2. **The deployed Edge already routes an index symbol with no code change.** POSTing
   `{action:'intraday', symbol:{market:'IDX', ticker:'^TWII'}, range:'1d'}` to the DEV
   Edge returned `symbol='^TWII'`, `prevClose=45169.46`, 271 points. `SymbolItem.market`
   is validated only as `typeof === 'object'` (`index.ts:628`), and `yahooSymbols()`
   returns `[item.ticker]` verbatim for any non-`TPE` market (`index.ts:105-108`).
3. **Day high/low must NOT be derived from the close series.** Measured on 2026-08-26:
   close-derived low `44979.04` vs true `meta.regularMarketDayLow` `44925.84` — off by
   53.2 points. `max(quote.high)` and `min(quote.low)` match the meta values exactly.
4. `meta.regularMarketOpen` does not exist for `^TWII`. The true session open is
   `quote.open[0]` (first non-null), `45157.64` on the measured day — not `close[0]`
   (`45044.20`).
5. **Yahoo reports no volume for the index**: `meta.regularMarketVolume` is 0 and every
   bar's volume is 0, for both `1d/1m` and `5d/5m`.
6. `IntradayChart` is a pure presentation component and is otherwise index-safe: the
   volume label is `單量` with no unit string, `prevClose` is used as the dashed baseline
   and the red/green area split, and the symbol only reaches an aria-label.
7. `QuoteTab`'s stats grid cannot be reused: it hardcodes `張` on the volume cell
   (`QuoteTab.tsx:222`).
8. `MarketDay` (`marketProxy.ts:35-52`) already carries `taiexOpen/High/Low`, `taiex`,
   `changePoints`, `tradeValueTwd` — for the **latest complete trading day**. The candle
   chart already plots that OHLC. These stay as-is; the new panel is a different day.

## Contract

### `parseYahooChart` (`supabase/functions/stock-price/intradayParse.ts`)

`IntradaySeries` gains three optional day-level fields:

```ts
/** First non-null `quote.open`; null when the array is absent or all null. */
dayOpen: number | null
/** Max of non-null `quote.high`; null when absent. */
dayHigh: number | null
/** Min of non-null `quote.low`; null when absent. */
dayLow: number | null
```

- Read from `result.indicators.quote[0].open|high|low`. Do **not** derive them from
  `close`, and do **not** read them from `meta`.
- They describe the range the caller asked for. For `range='5d'` they span all five days;
  the UI only shows them for `1d`.
- `points`, `symbol`, `range`, `interval`, `prevClose` keep their current meaning and
  their current null behaviour. Existing callers must not change.
- A response with no `open`/`high`/`low` arrays still returns a valid series with the
  three fields null — the stock path must not regress.

### `IntradayChart` (`src/components/StockDetail/IntradayChart.tsx`)

Gains one optional prop:

```ts
/** Render the volume sub-chart. Default true. */
showVolume?: boolean
```

When false the volume panel and its label are not rendered and the price panel takes the
full height. No other prop or behaviour changes.

### `TwIndexToday` (new, `src/components/Macro/TwIndexToday.tsx`)

- Fetches via `fetchIntraday({ market: 'IDX', ticker: '^TWII' }, range)`.
- Renders: index value + 漲跌點數 + 漲跌幅 header; `<IntradayChart showVolume={false} />`
  with the 1日/5日 toggle; then six cells — 開盤 `dayOpen`, 最高 `dayHigh`, 最低 `dayLow`,
  昨收 `prevClose`, 漲跌點數 `last - prevClose`, 漲跌幅 `(last - prevClose)/prevClose`.
- Taiwan convention: up is red, down is green — use the existing `pnlClass()`.
- 成交金額 is deliberately absent. Yahoo gives none for the index; the existing KPI grid
  below keeps showing it for the latest complete trading day.
- `series === null` renders the section with an empty-state message, never a crash and
  never a zero. `prevClose === null` renders the change cells as `—` in neutral colour,
  matching how the stock quote card already refuses to guess a baseline.

## Files

Builder may touch only these:

- `sources/supabase/functions/stock-price/intradayParse.ts`
- `sources/supabase/functions/stock-price/index.ts` (type + doc comment only)
- `sources/src/services/intradayProxy.ts` (type only)
- `sources/src/components/StockDetail/IntradayChart.tsx`
- `sources/src/components/Macro/TwIndexToday.tsx` (new)
- `sources/src/components/Macro/TwMarketSection.tsx` (insertion only, around line 435)
- `sources/src/index.css` (styles for the new section)

## Verify

From `sources/`:

```
npm test -- src/services/intradayParse.test.ts src/components/StockDetail/IntradayChart.test.tsx src/components/Macro/TwIndexToday.test.tsx src/components/Macro/TwMarketSection.test.tsx
npm run lint && npm run typecheck:edge && npm run build
```

Not done until all pass with exit 0. Check the exit code, not the summary line.

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| Yahoo payload with open/high/low arrays | `dayOpen` = first non-null open, `dayHigh` = max high, `dayLow` = min low | `intradayParse.test.ts` |
| Day high/low differ from close extremes | The three fields follow the OHLC arrays, not the close series | `intradayParse.test.ts` |
| Payload with no open/high/low arrays | series still valid; three fields null; points unchanged | `intradayParse.test.ts` |
| All-null open array | `dayOpen` null, `dayHigh`/`dayLow` still computed | `intradayParse.test.ts` |
| Existing stock fixtures | unchanged output for symbol/range/interval/prevClose/points | `intradayParse.test.ts` |
| `showVolume={false}` | volume panel absent; price path still rendered | `IntradayChart.test.tsx` |
| `showVolume` omitted | volume panel rendered (default true, no regression) | `IntradayChart.test.tsx` |
| TwIndexToday with a series | six cells show dayOpen/dayHigh/dayLow/prevClose and the derived change; up is red | `TwIndexToday.test.tsx` |
| Negative change | change cells green | `TwIndexToday.test.tsx` |
| `series === null` | empty state, no crash, no zeros printed | `TwIndexToday.test.tsx` |
| `prevClose === null` | change cells render `—` neutral, not `NaN`/`Infinity` | `TwIndexToday.test.tsx` |
| Range toggle | switching to 5日 refetches with `range='5d'` | `TwIndexToday.test.tsx` |
| 台股 tab renders | new panel appears above the existing KPI grid; existing KPI/candle/tables still render | `TwMarketSection.test.tsx` |

## Non-goals

- No intraday 成交金額, and no new TWSE endpoint. Decided 2026-08-26.
- No change to `market/daily.json`, `twMarket.ts`, or any cron job.
- No change to the existing KPI grid, candle chart, turnover chart or the two tables.
- No change to the stock quote tab or `QuoteTab.tsx`.
- No price_cache write for the index series; the client's 60s in-memory cache in
  `intradayProxy.ts` is the only cache, as it already is for stocks.
- 漲跌家數, 期現價差 and futures open interest are out of scope.

## Deploy note — one file change, two targets

`intradayParse.ts` lives in the Edge directory but is imported by the browser through
`intradayProxy.ts`. A `git push` ships only the frontend half. After merge:

1. DEV: copy into `volumes/functions/stock-price/` with `/bin/cp -f` (plain `cp` is
   aliased to `cp -i` and silently skips existing files), then
   `docker compose up -d --force-recreate functions`.
2. PROD: `supabase functions deploy stock-price --project-ref kxnxadaghidwumqsqneu`
   (default `verify_jwt=true` — do **not** pass `--no-verify-jwt`, that flag belongs to
   `stock-report`). Confirm the `ezbr_sha256` changed in `functions list`.

Version: next is 0.9.19 on `dev` (`0.9.19-dev.N` while unfinished) — confirm with the
`versioning` skill before bumping.
