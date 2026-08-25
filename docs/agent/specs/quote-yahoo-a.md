# Spec — quote-yahoo-a: intraday chart + Yahoo-style quote header

Branch: `feat/quote-yahoo-a` (from `dev`).
Design reference: `docs/design/quote-redesign-mockups.html`, panel **方案 A**.

Lane 2 for T1 (external API + Edge Function). Lane 1 for T2 (UI only).

---

## Task

Add a **當日走勢圖** to the 個股分析 quote section, and rebuild the top of that
section to the Yahoo-style header + statistics grid shown in 方案 A.

Two independent units:

| Id | Scope |
| -- | ----- |
| **T1** | Intraday data path: pure parser, Edge Function action, client proxy |
| **T2** | UI: `IntradayChart` component + `QuoteTab` rebuild |

---

## Decisions already made — do not revisit

1. **No 五檔 (best-five order book).** MIS fields `a/f/b/g` stay unparsed. The
   mockup shows a 五檔 card; it is **out of scope**. Leave no placeholder markup
   for it.
2. **The four stacked sections stay stacked.** `StockDetailPage.tsx:351–390`
   renders 行情 → 籌碼 → 基本面 → 技術面 as hard-coded sections. They are **not**
   converted to tabs. Only the 行情 section's own content changes.
3. **Range tabs are 一日 and 五日 only.** 一月/三月/半年/一年 are deliberately
   omitted: the 技術面 section directly below already renders the daily K series
   from `daily/{ticker}.json`, and duplicating it here would show the same data
   twice on one screen.
4. **No charting library.** Reuse `ChartFrame`. See `chartScale.ts:2` for the
   standing reason (inline SVG must survive html2canvas → PDF).

---

## T1 — intraday data path

### Contract

**New pure module** `supabase/functions/stock-price/intradayParse.ts`, following
the `misParse.ts` pattern: no Deno APIs, unit-tested from the front-end Vitest.

```ts
export type IntradayRange = '1d' | '5d'
export type IntradayInterval = '1m' | '5m'

export interface IntradayPoint {
  /** Yahoo bar timestamp, epoch **seconds** */
  t: number
  /** Bar close. A null close is carried forward from the previous bar. */
  c: number
  /** Bar volume in **shares** as Yahoo reports it; 0 when the bar had no trade. */
  v: number
}

export interface IntradaySeries {
  /** `meta.symbol`, e.g. '2330.TW'; '' when absent */
  symbol: string
  range: IntradayRange
  interval: IntradayInterval
  /** `meta.chartPreviousClose`, else `meta.previousClose`, else null */
  prevClose: number | null
  points: IntradayPoint[]
}

export function intradayInterval(range: IntradayRange): IntradayInterval
export function parseYahooChart(json: unknown, range: IntradayRange): IntradaySeries | null
```

`intradayInterval`: `'1d' → '1m'`, `'5d' → '5m'`.

`parseYahooChart` rules, in order:

1. Non-object input, or `chart.error` not null/undefined → `null`.
2. `chart.result[0]` missing → `null`.
3. `result.timestamp` not an array, or `result.indicators.quote[0]` missing → `null`.
4. Walk bars by index. For each bar `i`:
   - `t` must be a finite number, else the bar is dropped.
   - `c` = `quote.close[i]` when finite; otherwise **carry forward** the last
     emitted close. If no close has been emitted yet, the bar is **dropped**
     (Yahoo pads the session's leading bars with nulls).
   - `v` = `quote.volume[i]` when a finite number ≥ 0, else `0`.
5. `prevClose`: first finite value of `meta.chartPreviousClose`, then
   `meta.previousClose`; else `null`.
6. `symbol`: `meta.symbol` when a non-empty string, else `''`.
7. Zero surviving points → `null`.

Bar order is preserved. The function never throws on malformed input.

### Edge Function action

In `supabase/functions/stock-price/index.ts`, add a fourth action beside the
existing three (dispatch at lines 578–589):

```
POST { action: 'intraday', symbol: { market: 'TPE'|'US', ticker: string }, range?: '1d'|'5d' }
  → { series: IntradaySeries | null }
```

- `range` defaults to `'1d'`. A value other than `'1d'`/`'5d'` → the same 400
  path the other actions use for a bad body.
- Resolve the Yahoo symbol with the **existing** `yahooSymbols(item)` helper
  (index.ts:99) — it already tries `.TW` then `.TWO` for TPE. Take the first
  symbol whose response parses to a non-null series.
- URL: `https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?interval={interval}&range={range}`
  — same host and shape as `fetchYahooPrice` (index.ts:124).
- A non-200 response, a throw, or a null parse falls through to the next symbol;
  when every symbol fails, return `{ series: null }` with a 200. **Never 500 on
  a missing ticker** — an unknown ticker returns Yahoo 404 and that is a normal
  "no data" answer, not an error.
- **No `price_cache` write.** The series is large and per-range; caching is the
  client's job. Do not add a table or migration.
- Update the interface comment block at the top of the file (lines 17–33) to
  document the new action, matching the existing style.

### Client proxy

**New** `src/services/intradayProxy.ts`:

```ts
export interface IntradayRequestItem { market: 'TPE' | 'US'; ticker: string }

export async function fetchIntraday(
  item: IntradayRequestItem,
  range: IntradayRange,
  options?: { force?: boolean },
): Promise<IntradaySeries | null>
```

- Calls `supabase.functions.invoke<{ series: IntradaySeries | null }>('stock-price', { body: { action: 'intraday', symbol: item, range }, timeout: 15_000 })`
  — mirror the guard style of `fetchFromEdge` (priceProxy.ts:141–175): bail to
  `null` when `!isSupabaseConfigured || !supabase`, and swallow errors.
- In-memory module-level cache keyed `` `${item.market}:${item.ticker}:${range}` ``,
  TTL **60_000 ms**, bypassed when `options.force` is true. Do not use
  localStorage — a day of 1-minute bars is too big for the quota priceProxy
  already shares.
- Re-import the types from the Edge module the way `misParse.test.ts` does
  (`../../supabase/functions/stock-price/intradayParse.ts`), so there is one
  definition of `IntradaySeries`.

### Files — T1

```
sources/supabase/functions/stock-price/intradayParse.ts    (new)
sources/supabase/functions/stock-price/index.ts            (add action + doc comment)
sources/src/services/intradayProxy.ts                      (new)
```

Nothing else. `misParse.ts`, `quoteWindow.ts`, `priceProxy.ts` must not change.

### Verify — T1

From `sources/`: `npm test -- intradayParse` must pass, and
`npx tsc --noEmit -p tsconfig.app.json` must be clean.
Not done until both pass. **Check the exit code, not the summary line.**

---

## T2 — UI

### `IntradayChart.tsx` (new, `src/components/StockDetail/`)

Props:

```ts
interface IntradayChartProps {
  series: IntradaySeries | null
  loading: boolean
  range: IntradayRange
  onRangeChange: (range: IntradayRange) => void
}
```

Structure: **two stacked `ChartFrame` instances** sharing one hover index.
`ChartFrame` fixes one plot area per instance (chartFrame.tsx:53, 114), so the
volume sub-chart is a second frame, not a second region of the first.

- `hoverIndex` state lives in `IntradayChart`; both frames get
  `hoverIndex={hover}` and `onHover={setHover}` so the crosshair tracks across
  both.
- **Price frame**, `height={220}`:
  - `domain` — **symmetric around `prevClose`**: with
    `dev = max(|c - prevClose|)` over the points, use
    `{ min: prevClose - dev * 1.18, max: prevClose + dev * 1.18 }`. This is what
    makes the dashed 昨收 line sit visually mid-chart, as in the mockup. When
    `prevClose` is null, fall back to `niceDomain` over the closes.
  - Children, drawn back to front: horizontal dashed 昨收 line at
    `geo.y(prevClose)` (ChartFrame draws only the vertical hover line —
    chartFrame.tsx:200–211 — so this one is the caller's); area fill split at
    that baseline, red (`--up`) above and green (`--down`) below; the close
    polyline coloured by last close vs `prevClose`; the cumulative-VWAP 均價 line
    in `--accent-2`; a dot on the last point.
  - Build the paths with `lineSegments` / `areaSegments` (`chartPath.ts:38,49`)
    where they fit. `areaSegments` closes to `geo.innerH`, **not** to the 昨收
    baseline — for the split fill, draw that path yourself.
- **Volume frame**, `height={70}`: bars from `geo.bandWidth`, height scaled to
  the max bar volume, coloured red when `c[i] >= c[i-1]` else green, opacity ~.5.
- `labels`: `HH:mm` in **Asia/Taipei** derived from `point.t`. `labelIndices`:
  the hour boundaries for `'1d'`; the first bar of each trading day for `'5d'`.
- `tooltipFor(i)`: 時間 / 成交 / 漲跌(+%) / 均價 / 單量, matching the mockup's
  readout row.
- `ariaLabel`: describes ticker, range, last price and change.
- Range switch: two buttons 一日 / 五日 with `aria-pressed`, calling
  `onRangeChange`.
- States: `loading` → the project's existing skeleton treatment; `series === null`
  → a quiet "無走勢資料" cell, not an error banner.

Volume unit: Yahoo gives **shares**. Divide by 1000 for display in 張 so it
matches the MIS caliber the rest of the card already uses (index.ts:143 does the
same division for the quote card).

### `QuoteTab.tsx` rebuild

Current: empty state (111–120) → quote cell grid (131–146) → hint (147–151) →
`IndicatorSummary` (153).

New order:

1. **Quote header** — 名稱 + 代號 + market tag; the price large and coloured by
   `price vs prevClose`; 漲跌 and 漲跌幅 beside it; the `tradeDate`/`tradeTime`
   stamp (use the existing `tradeDateLabel` from priceProxy).
2. **Statistics grid** — the Yahoo-style bordered grid from the mockup
   (`.m-stats`, 4 columns on desktop, 2 on narrow). Fill **only from fields that
   already exist** on `PriceQuote`: 成交量, 開盤, 最高, 最低, 昨收, plus 漲跌幅
   and 振幅 computed from `high`/`low`/`prevClose`. **Do not invent 均價,
   成交金額, 昨量, 本益比, 殖利率, 淨值比 in this card** — the mockup shows them,
   but this page has no source for them in `PriceQuote`; 本益比/殖利率/淨值比
   already live in the 基本面 section below. A cell with no data renders `—`,
   which is the existing convention.
3. **`IntradayChart`**.
4. **`IndicatorSummary`** — unchanged, kept where it is.

Keep the existing empty state and the hint text. Reuse `Cell` (43–50) where it
still fits; do not delete `IndicatorSummary`.

Styling: new classes go in `src/index.css` next to the existing `.glass` /
`.rpt-card` / `.kpi` rules, using the existing tokens only. **Do not add new
colour literals** — `--up`/`--down`/`--ink*`/`--surface*`/`--border*` cover
everything the mockup uses.

Wire the data with a small hook or `useEffect` inside `QuoteTab` calling
`fetchIntraday`, keyed on ticker + range, cancelled on unmount.

### Files — T2

```
sources/src/components/StockDetail/IntradayChart.tsx   (new)
sources/src/components/StockDetail/QuoteTab.tsx
sources/src/index.css
sources/src/components/StockDetail/StockDetailPage.tsx  (revision 2 — one line, see below)
```

Nothing else. `ChartFrame`, `chartPath.ts`, `chartScale.ts` and every other chart
component must not change.

---

## Revision 2 — corrections to this spec (main session, after T2 round 1)

Round 1 of T2 was implemented correctly against the spec and then correctly
**blocked**: the spec was wrong in three ways. These override anything above.

**R2-a — `StockDetailPage.tsx` is now in scope, for one line.**
Revision 1 forbade touching it, which left `QuoteTab` with no ticker and the
chart permanently inert. `StockDetailPage` already has `ticker` and `name` as
props (`StockDetailTarget`, StockDetailPage.tsx:45–52). Change **only** the
call site at line 354:

```tsx
<QuoteTab quote={quote} latest={technicalLatest} ticker={ticker} name={name} />
```

`ticker: string` and `name: string` become **required** props of `QuoteTab`.
Delete the optional-with-blank-fallback handling and the file-header paragraph
that describes it — the caller always has both.

**R2-b — drop the `market` prop and the 台股/美股 badge.**
This page formats every price as TWD (`fmtPrice(…, 'TWD')`, and it did so before
this task). A 美股 badge above NT$-formatted prices states something the page
cannot honour. Remove the prop and the badge; `fetchIntraday` takes a literal
`{ market: 'TPE', ticker }`. A US-stock quote card is a separate task.

**R2-c — restore the 試撮 estimate marker.** *(the real defect)*
The old card carried a `預估` cell that was populated **only** when
`quote.trial`, because during 試撮 (08:30–09:00, 13:25–13:30) MIS's `z` is a
**simulated matching price, not a trade**. Revision 1 folded the price into the
header and lost that distinction, so a trial price now renders identically to a
real close. The card's own hint text still promises 「預估」.

Required: when `quote.trial` is true, the price header renders a `預估` marker
next to the big price. When it is false, no marker. The big price stays where it
is either way. This is behaviour, not decoration — it is covered by the test
charter below.

**Tests are the main session's job, not the builder's.**
`QuoteTab.test.tsx` and one assertion in `StockDetailPage.test.tsx` pinned the
old seven-cell markup verbatim. Both have been rewritten by the main session to
match this revision. The builder must **not** edit either file; if a rewritten
test disagrees with the implementation, the implementation is what changes.

### Verify — T2, revision 2

From `sources/`, each command run on its own with `echo $?` read directly (never
piped into `head`/`tail`/`grep`, which replaces the exit code):

```
npx tsc --noEmit -p tsconfig.app.json     # exit 0
npx vitest run                            # exit 0
```

Baseline to beat: **82 files / 1263 tests passing** (1247 pre-existing + 16 from
T1). A "passed" summary above a non-zero exit is still a red gate.

### Test charter — revision 2 (superseded in part by revision 3)

| Case | Expected outcome | Layer / file |
| ---- | ---------------- | ------------ |
| Closed quote | stats grid is exactly 成交量/開盤/最高/最低/昨收/漲跌幅/振幅 | `QuoteTab.test.tsx` |
| Price above 昨收 | big price and delta both carry `pnl-up` | same |
| `prevClose` null | delta renders `—`, 漲跌幅 `—`, neither coloured up/down | same |
| Missing open/high/low/volume | each cell `—`, never `0` | same |
| `volume === 0` | `0 張`, distinct from `—` | same |
| `trial: true` | 預估 marker present | same |
| `trial: false` | no 預估 marker | same |
| No quote | empty state, no stats grid, indicator summary still renders | same |
| `quoteMeta` | unchanged from before this task | same |
| Page renders 行情 section | 成交量 present, stamp says 收盤 | `StockDetailPage.test.tsx` |

### Verify — T2

From `sources/`: `npx tsc --noEmit -p tsconfig.app.json` clean, and
`npm test` green (**exit code 0**, and no `Errors` line — a passing count above a
non-zero exit is still a red gate).

---

## Non-goals

- 五檔 / 內外盤 / MIS `a,f,b,g` parsing.
- Converting the stacked sections to tabs.
- Ranges beyond 一日 / 五日.
- Any `price_cache`, schema, or migration change.
- Deploying to DEV or PROD. No Supabase deploy in this task.
- Touching `sources/src/components/Charts/**`.
- Any new npm dependency.

---

## Test charter

| Case | Expected outcome | Layer / file |
| ---- | ---------------- | ------------ |
| Real 1d response, 271 bars | 271 points, `prevClose` 2375, `interval` `'1m'` | `src/services/intradayParse.test.ts` |
| Leading bars with null close | dropped, not carried from nothing | same |
| Mid-session null close | carried forward from the previous bar | same |
| Null volume | becomes `0`, bar kept | same |
| `chart.error` populated | `null` | same |
| `result: []` / missing timestamp | `null` | same |
| `meta.chartPreviousClose` absent, `previousClose` present | `prevClose` from the fallback | same |
| Both prev-close keys absent | `prevClose === null`, points still returned | same |
| Every bar dropped | `null` | same |
| `intradayInterval` | `'1d'→'1m'`, `'5d'→'5m'` | same |

`QuoteTab` and `IntradayChart` have no unit tests today and get none here;
their gate is `tsc --noEmit` plus a manual pass with the `verify` skill.

---

## Revision 3 — fill the dead space right of the chart, add the valuation cells

User decisions this revision implements:
- **估值整合走選項 1**: 本益比 / 殖利率 / 股價淨值比 move into the 行情 section and
  **carry their own data date**, following the precedent the card already sets for
  指標摘要 ("the two halves can be different days and that is not a bug").
  They are **not** recomputed live from EPS — that was offered and not chosen.
- **The blank right of the chart gets data**, rather than the chart being stretched
  across the whole card.

### The measured problem

Screenshotted at 1440px with real DEV data. The 行情 card's content box is 1350px wide:

| Symptom | Cause | Whose bug |
| ------- | ----- | --------- |
| ~590px of blank right of the chart | `.chart-wrap { max-width: 760px }` (index.css:2321) caps every chart in the app; the SVG measured 760px at both a 1440px and a 900px viewport | **pre-existing, app-wide** — not introduced by this task |
| Empty cell bottom-right of the stats grid | 7 cells in `repeat(4, 1fr)` → row 2 is 3 wide | revision 1 |
| 一日/五日 sits hard against the card's right edge, visually detached from the chart | the range switch is in `.m-card-h` which spans the full card while the chart stops at 760px | revision 1 |

**Do not raise `.chart-wrap`'s global `max-width`.** That cap governs every chart in
the app and the file already records a considered stance about chart width nearby
(index.css:2324–2326, on why two charts were un-stacked). Scope any override to the
intraday block.

### R3-a — two-column intraday layout

Wrap the chart and a new right rail in a grid, inside `QuoteTab`:

```
.intraday-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 14px;
  align-items: start;
}
@media (max-width: 900px) { .intraday-layout { grid-template-columns: 1fr; } }
```

Scoped width release, so other charts keep the 760px cap:

```
.intraday-layout .chart-wrap { max-width: none; }
```

The range switch moves inside the left column so it sits over the chart it controls,
not at the card's edge.

### R3-b — the right rail

Two groups in one `.m-card`-style column, in this order:

1. **成交金額** — `均價 × 成交量(張) × 1000`, displayed in 億 to 2 dp
   (2,373 × 12,815 × 1000 ≈ 304.15 億, which matches what Yahoo prints for the same
   session — use that as the arithmetic check). `—` when either input is missing.
2. **估值**, as a labelled sub-group: 本益比, 殖利率, 股價淨值比, followed by a
   footnote line `估值資料日 {valuation.dataDate}`. When `valuation` is null the whole
   sub-group renders one `尚無估值資料` line rather than three `—` rows.

The footnote is **required, not decorative**: these three numbers are computed from a
past close by the BWIBBU batch, and they sit beside a live price. Without the date the
card implies they are current. Do not "tidy" it away.

### R3-c — statistics grid becomes 8 cells

Add **均價** so the grid is exactly `4 × 2` with no orphan cell:

```
成交量  開盤   最高   最低
昨收    均價   漲跌幅  振幅
```

均價 is the **final cumulative VWAP** of the intraday series — the same number the
chart's 均價 line ends at. Export a helper from `IntradayChart.tsx` (e.g.
`finalVwap(points): number | null`) and use it in both places; do not compute VWAP
twice. `—` when the series is null or has no volume.

### R3-d — new props

`QuoteTab` gains `valuation?: Valuation | null` (from `services/fundamentalProxy`).
`StockDetailPage.tsx` passes `valuation={fundamental?.valuation ?? null}` — it already
holds `fundamental` at line 99 and already distributes it to three places.

### Files — revision 3

```
sources/src/components/StockDetail/QuoteTab.tsx
sources/src/components/StockDetail/IntradayChart.tsx     (export finalVwap; move the range switch)
sources/src/index.css
sources/src/components/StockDetail/StockDetailPage.tsx   (one prop on the call site)
```

Nothing else. **`sources/src/components/Charts/**` still must not change** — in
particular do not edit `.chart-wrap`'s own rule, only override it under
`.intraday-layout`.

### Verify — revision 3

From `sources/`, each command on its own line, `echo $?` read directly:

```
npx tsc --noEmit -p tsconfig.app.json     # exit 0
npx vitest run                            # exit 0
```

Baseline to beat: **83 files / 1276 tests**.

### Test charter — revision 3

| Case | Expected outcome | Layer / file |
| ---- | ---------------- | ------------ |
| Stats grid | exactly 8 cells, in the order 成交量/開盤/最高/最低/昨收/均價/漲跌幅/振幅 | `QuoteTab.test.tsx` |
| Series present | 均價 equals the final cumulative VWAP | same |
| Series null | 均價 `—`, 成交金額 `—`, grid still 8 cells | same |
| 成交金額 | 均價 × 成交量 × 1000, shown in 億 | same |
| 成交量 null | 成交金額 `—`, not 0 | same |
| `valuation` populated | 本益比 / 殖利率 / 股價淨值比 render, and the 估值資料日 footnote shows `dataDate` | same |
| `valuation` null | one 尚無估值資料 line, no `—` rows, no footnote | same |
| `valuation.dataDate` null | the three numbers render, footnote omitted | same |
| `finalVwap` | cumulative VWAP, ignores zero-volume bars, null on empty input | `IntradayChart.test.tsx` |

---

## Revision 4 — the card-level sidebar 方案 A actually had

User request: bring the layout closer to the 方案 A mockup
(`docs/design/quote-redesign-mockups.html`) — **指標摘要 on the right, and 持有 / 成本 /
市值 / 損益 at the top right**.

Revision 3 put a 260px rail beside the chart only. 方案 A's sidebar runs down the
**whole card**. This revision promotes it.

### R4-a — privacy: the holdings block must not reach the PDF

This is the one constraint that is not a style choice. The 行情 card sits inside
`surfaceRef` and is therefore captured by the PDF export, and the codebase records —
twice — that holdings are deliberately **outside** that range because they are
personal data (`StockDetailPage.tsx:317-318` and `:344-348`, and the `QuoteTab.tsx`
file header). Putting 持股 into this card without care reverses that decision and
silently ships the user's position into every exported PDF.

**Mechanism, already present, no JS change:** `reportPdf.ts:44` adds the class
`report-surface` to the capture root for the duration of the capture, and
`index.css:2808` already uses it to swap in the print palette. So:

```css
.report-surface .quote-aside-private { display: none; }
```

The holdings block **must** carry `quote-aside-private`. Existing export behaviour is
then unchanged: holdings still never appear in a PDF.

### R4-b — layout

Replace revision 3's `.intraday-layout` / `.intraday-rail` with a card-level grid in
`QuoteTab`:

```
.quote-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 900px) { .quote-layout { grid-template-columns: 1fr; } }
```

- **Left column**: quote header → statistics grid → hint → `IntradayChart`.
  Keep the scoped `max-width: none` release for `.chart-wrap` (revision 3) — re-point
  it at whatever class now wraps the chart.
- **Right column** (`.quote-aside`), top to bottom:
  1. **我的持股** (`.quote-aside-private`) — 損益 as the large figure with 報酬率
     beside it, then 持有 / 成本 / 市值 / 今日.
  2. **指標摘要** — moved here from its full-width position below. It keeps its own
     date heading; see the `QuoteTab` file header for why that date must stay.
  3. **成交金額** and **估值** (本益比 / 殖利率 / 股價淨值比 + 估值資料日) — the
     revision 3 rail content, unchanged in substance.

On narrow viewports the aside stacks under the chart, holdings first.

### R4-c — do not recompute the P&L

`QuoteTab` gains `holding?: ReportHolding | null`
(`services/reportProxy.ts:26-32`: `qty`, `avgCost`, `price`, `unrealized`, `roi`).

- **損益 renders `holding.unrealized` and 報酬率 renders `holding.roi` verbatim.**
  Do not derive them. The page carries three different cost bases
  (`holding.avgCost`, and `StockDetailPage`'s `rawAvgCost` / `avgCost` props, which are
  fee-exclusive and fee-inclusive respectively); recomputing here picks one arbitrarily
  and produces a number that disagrees with 庫存總覽 for the same position. A test pins
  this by passing an `unrealized` that does **not** match `qty × (price − avgCost)`.
- Only two figures are derived, both from the quote already on screen so they cannot
  disagree with it:
  - 市值 = `holding.qty × quote.price`
  - 今日 = `holding.qty × (quote.price − quote.prevClose)`, `—` when `prevClose` is null.
- `holding` null (a watched, unheld stock) → the whole 我的持股 block is absent, not an
  empty card.

### R4-d — caller

`StockDetailPage.tsx` passes `holding={holding}` on the `QuoteTab` call site. It
already has it as a prop (`StockDetailTarget`, line 45-52).

### Files — revision 4

```
sources/src/components/StockDetail/QuoteTab.tsx
sources/src/components/StockDetail/IntradayChart.tsx    (only if the range switch needs re-placing)
sources/src/index.css
sources/src/components/StockDetail/StockDetailPage.tsx  (one prop on the call site)
```

`sources/src/components/Charts/**` still must not change, and `.chart-wrap`'s own
global rule still must not change.

### Verify — revision 4

From `sources/`, each on its own line, `echo $?` read directly:

```
npx tsc --noEmit -p tsconfig.app.json     # exit 0
npx vitest run                            # exit 0
```

Baseline to beat: **83 files / 1287 tests**.

### Test charter — revision 4

| Case | Expected outcome | Layer / file |
| ---- | ---------------- | ------------ |
| Aside renders | `.quote-aside` exists and contains 指標摘要 when `latest` is given | `QuoteTab.test.tsx` |
| Holdings present | 持有 / 成本 / 市值 / 今日 render; 市值 = qty × price | same |
| **損益 not recomputed** | with `unrealized` deliberately inconsistent with `qty × (price − avgCost)`, the **passed** value is displayed | same |
| 報酬率 | `holding.roi` verbatim | same |
| `prevClose` null | 今日 shows `—`, the rest still renders | same |
| `holding` null | no 我的持股 block at all | same |
| **PDF privacy** | the holdings block carries `quote-aside-private`, the class the print rule hides | same |
| 指標摘要 moved | it is inside `.quote-aside`, not a sibling below it | same |
