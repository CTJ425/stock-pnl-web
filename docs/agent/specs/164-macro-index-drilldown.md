# Task 164 — Macro index drill-down, quote timestamps, and trend ranges

- Spec owner: main session
- Written: 2026-09-15 15:40:00 Asia/Taipei
- Base version: 0.9.55
- Lane: 2 (elevated risk — external API, Edge contract, new UI surface)

## 1. Goal

Make every card in the 國際指數 subtab a drill-down entry point, add a quote
timestamp to each card, and give each index detail view the same trend-range
vocabulary the stock 行情 tab already offers.

Deliver in three phases. Phase A and Phase B are independent of Phase C.

| Phase | Scope | Blocked by |
| --- | --- | --- |
| A | Card list: timestamps, session-hours note, TW group, clickable cards | none |
| B | Index detail view: 當日 band + 7-range trend chart | Phase A types |
| C | 台指期夜盤 card and detail view (TAIFEX) | data-source decision, see §7 |

## 2. What already exists — do not rebuild it

Measured on 2026-09-15 against the live Yahoo API and the current code.

1. **The `prices` action already returns `open`, `high`, `low`, `volume`, `asOf`.**
   `fetchYahooPrice` (`supabase/functions/stock-price/index.ts:150-200`) fills them
   from `meta.regularMarketDayHigh` / `meta.regularMarketDayLow` /
   `indicators.quote[0].open[0]`. `handlePrices` returns `Quote & { asOf }`.
   **No Edge Function change is needed for Phase A or Phase B.**
2. **`indexQuotes.ts:47-56` drops those fields.** It keeps `price` and `prevClose`
   only. This front-end file is the whole narrowing.
3. **`IntradayChart` is a line chart, not a candlestick chart.** It draws with
   `lineSegments` (`IntradayChart.tsx:11`). There is no candle code in that file.
   The user requirement "走勢圖，不要 K 線圖" is already satisfied by reusing it.
4. **`intradayParse.ts` already exposes `dayOpen` / `dayHigh` / `dayLow` /
   `prevClose`**, and the `IDX` path uses the same `parseYahooChart` as the TW path.
5. **`seriesFromDailyRows` and `TREND_LABELS`** (`StockDetail/trendRange.ts`) already
   convert `DailyRow[]` into a chart series for the 6 non-intraday ranges.

## 3. Measured facts that constrain the design

| Fact | Evidence | Consequence |
| --- | --- | --- |
| `meta.regularMarketOpen` does not exist | probed `^N225`, `^DJI`, `^KS11`, `^TWII` | day open comes from the first bar's `open`; the code already does this |
| `regularMarketVolume` is 0 for `^N225`, `^SOX`, `^RUT`, `^TWII` | live probe | never show a volume field on a foreign index |
| `validRanges` = `1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max` | `^N225` meta | all 7 required ranges are reachable |
| `range=max` answers with **3-month** bars for `^N225` (168 bars) | live probe | 全部 is a quarterly series for indices, not monthly; `handleDailyRange` still labels `granularity: '1mo'` |
| `5y` + `1d` returns ~1220 daily bars | derived from 1y = 244 bars | one `5y` fetch covers 近 6 月 / 本年迄今 / 近 1 年 / 近 5 年 |
| 成交金額 and 三大法人 come from TWSE FMTQIK and BFI82U into `market/daily.json` | `stock-report/twMarket.ts:86,98` | TW-only; no foreign equivalent exists |
| `reports` bucket `daily/{ticker}.json` covers TW holdings only | `dailyProxy.ts:1-8` | a foreign index must always use `fetchRemoteDaily`, never `fetchDailySeries` |

## 4. Contract

### 4.1 `src/services/dailyProxy.ts` — add a market parameter

```ts
export async function fetchRemoteDaily(
  ticker: string,
  range: RemoteDailyRange,
  market: 'TPE' | 'US' | 'IDX' = 'TPE',
): Promise<RemoteDaily | null>
```

- The invoke body must send `symbol: { market, ticker }`. Line 117 hardcodes `'TPE'`
  today; that is what blocks every foreign-index range.
- **The module cache key must include the market**: `${market}:${ticker}:${range}`.
  Leaving it at `${ticker}:${range}` lets a `TPE` row answer an `IDX` request.
- The default keeps `QuoteTab.tsx:197` and `TechnicalTab.tsx:126` unchanged.

### 4.2 `src/components/Macro/indexTrend.ts` — new file

```ts
import type { TrendRange } from '../StockDetail/trendRange'

/** The 7 ranges an index offers. '1m' (近 1 月) is deliberately absent — user decision 2026-09-15. */
export const INDEX_TREND_RANGES: readonly TrendRange[]

export type IndexTrendSource =
  | { kind: 'intraday'; range: '1d' | '5d' }
  | { kind: 'daily'; remoteRange: '5y' | 'max' }

/** Which upstream call a range needs. Throws for a range not in INDEX_TREND_RANGES. */
export function indexTrendSource(range: TrendRange): IndexTrendSource
```

Mapping, exhaustively:

| range | source |
| --- | --- |
| `1d`, `5d` | `{ kind: 'intraday', range }` |
| `6m`, `ytd`, `1y`, `5y` | `{ kind: 'daily', remoteRange: '5y' }` |
| `all` | `{ kind: 'daily', remoteRange: 'max' }` |

### 4.3 `src/components/Macro/sessionHours.ts` — add TW and the hours text

```ts
export type MarketRegion = 'TW' | 'JP' | 'KR' | 'US'

export interface SessionHours {
  /** Local trading hours, e.g. '09:00–15:30'. */
  local: string
  /** Same window in Taipei time, e.g. '08:00–14:30'. */
  taipei: string
  /** Lunch break in local time, or null. */
  breakLocal: string | null
}

export const SESSION_HOURS: Record<MarketRegion, SessionHours>
```

- `RULES.TW`: `timeZone: 'Asia/Taipei'`, `openMin: 540`, `closeMin: 810`, no break.
- `openRegions` display order becomes `['TW', 'JP', 'KR', 'US']`.
- The US `taipei` string must name both offsets: `21:30–04:00（夏令）/ 22:30–05:00（冬令）`.
  Do not compute it — `America/New_York` changes offset twice a year and a single
  string cannot be right all year. It is explanatory copy, not a computed value.

### 4.4 `src/services/indexQuotes.ts` — widen the kept fields

```ts
export interface IndexQuote {
  ticker: string
  price: number
  prevClose: number | null
  /** ISO string the Edge reports as the fetch time of this quote. Null when absent. */
  asOf: string | null
}
```

- Read `asOf` from the same `prices` entry. Keep the existing `isPositiveFinite`
  guard on `price`; an unparsable `asOf` becomes `null`, never a thrown error.
- Do **not** add `open` / `high` / `low` / `volume` here. The detail view gets those
  from the intraday call, which is the only source that is correct for every range.

### 4.5 `src/components/Macro/IndexDetail.tsx` — new component

```ts
export function IndexDetail({
  def,
  onBack,
}: {
  def: { region: MarketRegion; label: string; ticker: string }
  onBack: () => void
}): JSX.Element
```

Renders, in order:

1. Header: back button, `def.label`, trading-date badge, session-state badge.
2. Big price and the change / change-percent pair, coloured by `pnlClass`.
3. A session-hours strip: local hours, lunch break when present, Taipei equivalent.
4. One `當日` band with exactly six cells: 開盤, 最高, 最低, 昨收, 漲跌點數, 漲跌幅.
5. `IntradayChart` with `showVolume={false}` and the 7 `INDEX_TREND_RANGES` buttons.

**Negative requirements.** The component must not render:

- any 收盤統計 band — no foreign index has one (§3);
- any 三大法人 aside;
- any volume figure or volume sub-chart;
- a 近 1 月 range button.

### 4.6 `src/components/Macro/GlobalIndices.tsx` — card changes

- Add a `TW` group, first in order, holding one card: 加權指數 / `^TWII`.
- Each card becomes a button or link that calls `onSelect(def)`.
- Each card gains a timestamp line rendered from `quote.asOf` in `Asia/Taipei`,
  formatted `MM/DD HH:mm`, plus the session state word for that region.
- Each group head gains the `SESSION_HOURS` text for its region.
- A card with no quote yet shows `—` and no timestamp line. It stays clickable.

### 4.7 `TwIndexToday.tsx` — range upgrade

Replace `useState<IntradayRange>('1d')` with `useState<TrendRange>('1d')` and route
the fetch through the same `indexTrendSource` switch. The 收盤統計 band and the
三大法人 aside stay exactly as they are.

## 5. Files

Phase A and B may touch only these:

```
sources/src/services/dailyProxy.ts
sources/src/services/indexQuotes.ts
sources/src/components/Macro/sessionHours.ts
sources/src/components/Macro/indexTrend.ts          (new)
sources/src/components/Macro/IndexDetail.tsx        (new)
sources/src/components/Macro/GlobalIndices.tsx
sources/src/components/Macro/TwIndexToday.tsx
sources/src/components/Macro/MacroPage.tsx
sources/src/index.css
```

Anything outside this list is an escalation, not a judgement call.

## 6. Verify

```
cd sources && npm run build && npm test
```

`npm run build` is the type gate. `npx tsc --noEmit` does not type-check test files
in this project and has reported exit 0 against a red build three times.

## 7. Phase C — 台指期夜盤 (specify only, do not build yet)

Two TAIFEX sources are confirmed to work (probed 2026-09-15):

- `https://openapi.taifex.com.tw/v1/DailyMarketReportFut` — one row per contract per
  session. `TradingSession` is `一般` or `盤後`. The `盤後` row carries Open, High,
  Low, Last, Change, Volume. `OpenInterest` is `-` on that row. Response is ~880 KB,
  so it must be filtered server-side, never shipped to the browser.
- `https://mis.taifex.com.tw/futures/api/getQuoteDetail` (POST, `{"SymbolID":["TXF…-F"]}`)
  — live `COpenPrice`, `CHighPrice`, `CLowPrice`, `CLastPrice`, `CTotalVolume`,
  `OpenInterest`, `CRefPrice`, `CDate`, `CTime`.

**Open problem: there is no intraday bar endpoint for the night session.** Three
candidate paths (`getChartData1`, `getChartData`, `getQuoteList` with a K type) were
probed; the first two answer 404 and the third is a full quote list, not bars. A
一日 trend line for the night session therefore requires this project to poll
`getQuoteDetail` and store its own ticks. That is a new table, a new cron job, and a
retention policy — larger than all of Phase A and Phase B together.

Decide before building Phase C: self-recorded ticks, or a night-session card that
shows only the figures the daily report already gives and no trend chart.

## 8. Test charter

| # | Case | Expected outcome | Layer / file |
| --- | --- | --- | --- |
| 1 | `INDEX_TREND_RANGES` contents | exactly `['1d','5d','6m','ytd','1y','5y','all']`, and `'1m'` absent | unit / `indexTrend.test.ts` |
| 2 | `indexTrendSource('1d')` and `('5d')` | `{ kind: 'intraday', range }` | unit / `indexTrend.test.ts` |
| 3 | `indexTrendSource` for `6m`,`ytd`,`1y`,`5y` | all four give `{ kind: 'daily', remoteRange: '5y' }` | unit / `indexTrend.test.ts` |
| 4 | `indexTrendSource('all')` | `{ kind: 'daily', remoteRange: 'max' }` | unit / `indexTrend.test.ts` |
| 5 | every `INDEX_TREND_RANGES` entry has a `TREND_LABELS` label | no undefined label | unit / `indexTrend.test.ts` |
| 6 | `fetchRemoteDaily(t,'5y','IDX')` | invoke body carries `market: 'IDX'` | unit / `dailyProxy.market.test.ts` |
| 7 | `fetchRemoteDaily(t,'5y')` with no market | invoke body carries `market: 'TPE'` | unit / `dailyProxy.market.test.ts` |
| 8 | same ticker and range, markets `TPE` then `IDX` | two separate invokes; the cache must not answer the second from the first | unit / `dailyProxy.market.test.ts` |
| 9 | `fetchIndexQuotes` with an `asOf` in the payload | `IndexQuote.asOf` holds it | unit / `indexQuotes.asOf.test.ts` |
| 10 | `fetchIndexQuotes` with `asOf` missing or non-string | `asOf` is `null`, the quote is still returned | unit / `indexQuotes.asOf.test.ts` |
| 11 | `SESSION_HOURS` covers all four regions | every region has non-empty `local` and `taipei` | unit / `sessionHours.hours.test.ts` |
| 12 | `marketSession('TW', …)` at 10:00 Taipei on a weekday | `'open'` | unit / `sessionHours.hours.test.ts` |
| 13 | `marketSession('TW', …)` at 14:00 Taipei on a weekday | `'closed'` | unit / `sessionHours.hours.test.ts` |
| 14 | `IndexDetail` renders the 當日 band | all six labels present | component / `IndexDetail.test.tsx` |
| 15 | `IndexDetail` renders 7 range buttons | 7 buttons, and no 近 1 月 | component / `IndexDetail.test.tsx` |
| 16 | `IndexDetail` negative case | no 三大法人, no 收盤統計, no 成交量 text | component / `IndexDetail.test.tsx` |
| 17 | `GlobalIndices` card with `asOf` | a timestamp string renders on the card | component / `GlobalIndices.drill.test.tsx` |
| 18 | `GlobalIndices` card click | `onSelect` fires with that ticker | component / `GlobalIndices.drill.test.tsx` |
| 19 | `GlobalIndices` TW group | a 加權指數 card exists and its ticker is `^TWII` | component / `GlobalIndices.drill.test.tsx` |
| 20 | `GlobalIndices` group heads | each of the four groups shows its hours text | component / `GlobalIndices.drill.test.tsx` |

## 9. Non-goals

- No Edge Function change in Phase A or Phase B. The `prices` and `intraday` actions
  already return everything these phases need.
- No `price_cache` schema change. Adding `meta.regularMarketTime` as a true market
  timestamp would need a new column, and `asOf` already answers the stated
  requirement ("抓取資料的日期與時間").
- No 收盤統計 for foreign indices. The user ruled this out on 2026-09-15.
- No K-line / candlestick rendering anywhere in this task.
- No change to the 技術面 tab or to `TREND_RANGES`, which the stock pages still use
  with all eight entries.

## 10. Test-id contract

The tests in §8 query these ids. They are part of the contract, not decoration.

| Test id | Element |
| --- | --- |
| `index-detail` | `IndexDetail` root |
| `index-back` | back button in `IndexDetail` |
| `index-session-hours` | session-hours strip in `IndexDetail` |
| `index-open` / `index-high` / `index-low` | 當日 band value cells |
| `index-prev-close` / `index-change` / `index-change-pct` | 當日 band value cells |
| `index-range-buttons` | container holding exactly 7 `<button>` elements |
| `gix-card-<ticker>` | one index card, e.g. `gix-card-^N225`; must be clickable |
| `gix-stamp-<ticker>` | the card's timestamp line; **absent** when `asOf` is null |
| `gix-hours-<region>` | group-head hours text, region is `TW` / `JP` / `KR` / `US` |

Range buttons keep their `TREND_LABELS` text as the accessible name, because the
tests select them by name (`近 6 月`, `全部`).

## 11. Failing tests written on 2026-09-15

Run from `sources/`:

```
npx vitest run src/components/Macro/indexTrend.test.ts \
  src/services/dailyProxy.market.test.ts \
  src/services/indexQuotes.asOf.test.ts \
  src/components/Macro/sessionHours.hours.test.ts \
  src/components/Macro/IndexDetail.test.tsx \
  src/components/Macro/GlobalIndices.drill.test.tsx \
  src/services/indexQuotes.test.ts \
  src/components/Macro/sessionHours.test.ts
```

Measured before any implementation: **8 files failed, 21 tests failed, 27 passed,
exit 1**. `indexTrend.test.ts` and `IndexDetail.test.tsx` fail at import because
their modules do not exist yet, so their 14 cases are not in the 21 count.

Two existing test files were edited to match the new contract, and the
implementing agent must not revert them:

- `src/services/indexQuotes.test.ts` — two `toEqual` assertions now expect `asOf: null`.
- `src/components/Macro/sessionHours.test.ts` — `openRegions` at 01:00Z now expects
  `['TW', 'JP', 'KR']`, because 01:00Z is 09:00 in Taipei.
