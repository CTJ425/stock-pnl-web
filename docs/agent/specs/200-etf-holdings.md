# Task 200 — ETF holdings page (0050 first)

Status: Phase 0 done (2026-10-13); Phase 1 + 2 implemented in this task. Follows Task 129
(`TASK_ARCHIVE.md`: TWSE OpenAPI has no ETF constituents endpoint) and Task 195 (Fugle
`etf-holdings` is paid and has no NAV / units / asset split / futures).

## Goal

Show what Yuanta's own 0050 「持股比重」 page shows
(<https://www.yuantaetfs.com/product/detail/0050/ratio>): fund summary (trade date, total NAV,
NAV per unit, units outstanding), asset amounts (stock / ETF / bond / futures), stock weights,
futures weights. **Scope: 0050 only.** Other ETFs, cross-ETF views, alerts, Discord and PROD
deploy are out of scope. Adding a second ETF should need one entry in the supported list and,
if its numbers differ, its own validation rules — nothing is abstracted ahead of that.

## Phase 0 — source (verified 2026-10-13)

**Source: Yuanta's JSON bridge, the same call the site's own Nuxt page makes**
(`$getAPI("ETFAPI","PCF/Daily",{ticker})` in its page bundle):

```
GET https://etfapi.yuantaetfs.com/ectranslation/api/bridge
    ?APIType=ETFAPI&CompanyName=YUANTAFUNDS&DeviceId=null&FuncId=PCF%2FDaily
    &AppName=ETF&Device=3&Platform=ETF&ticker=0050[&date=YYYYMMDD]
```

- No cookie, no special header. ~14 KB JSON, 0.6–0.85 s.
- Response (trimmed): `{ PCF: { trandate:'20261012', anndate:'20261013', totalav, nav, osunit,
  upddate:'2026-10-12 16:06:52', fundname, … }, FundWeights: { Summary: { stkvalues, etfvalues,
  bndvalues, futvalues, fundsize }, StockWeights: [{ code, name, ename, weights, qty, ym:null }],
  FutureWeights: [{ code, name, ename, weights, qty, ym:'202610' }], ETFWeights: [], BondWeights: [] },
  InKind, Cash, Memo }`.
- **Whole-fund holdings, not the creation basket**: 2330 `qty` 565,525,249 on 10/12 equals the
  page. The basket lives in `InKind` and is not used.
- **`date` is the announcement date (`anndate`), not the trade date**: `date=20261013` returns
  `trandate=20261012`; `date=20261012` returns `trandate=20261008` (10/9 was a holiday). A future
  `date` returns the latest day. The parser always takes the date from `PCF.trandate`.
- **Backfill**: works back to at least 2019-12-31. Not used by this task.
- **Published the same day, ~16:00 Taipei**, not T+1: `upddate` for 9/29–10/13 ranged
  15:54–16:33. The plan's "about one trading day late" wording is wrong and is not used.
- **Weights are relative to `Summary.fundsize`, not `PCF.totalav`**: on 10/12 the stock weight
  sum is 99.71 %; `stkvalues / fundsize` = 99.73 %, `stkvalues / totalav` = 99.48 %. The
  validation rule uses `fundsize`.
- **Supabase Edge can reach it**: a throwaway DEV-only function (`etf-probe`, deployed from
  scratch, deleted afterwards, `stock-report` untouched) got HTTP 200 JSON on 6 of 6 calls from
  DEV with the same figures as the local fetch.
- **Terms**: `robots.txt` is `User-agent: * / Allow: /`. No terms-of-use or copyright page is in
  the sitemap; the disclaimer API needs parameters the bundle does not expose. Not concluded —
  the user is to check the site footer. The data is shown with its source and a link.
- **Other Yuanta ETFs**: the same endpoint answers for 0056 (50 stocks, 1 future) and 00631L
  (1 stock, 3 futures). Not built.

Reference values, trade date 2026-10-12 (the fixture `etfHoldings.fixture.ts` is trimmed from
the real response): total NAV 2,553,551,300,844; NAV 114.47; units 22,307,000,000; stock
2,540,194,490,501; ETF 0; bond 0; futures 7,044,587,000; fundsize 2,547,140,807,580;
2330 台積電 565,525,249 shares 56.39 %; 2454 聯發科 34,056,356 shares 6.18 %;
TX 臺股期貨 628 contracts 0.24 % 202610; NYF 台灣50ETF股票期貨 738 contracts 0.03 % 202610.

## Schedule

`stock-report-nightly` does not exist as a cron job on DEV (checked 2026-10-13); `generate-chips`
is driven by the source probe and is skipped when nothing changed, so riding next to
`syncSectorFlow` (inside the non-skip branch) could miss the evening. The sync rides on
**`generate-market-data`** instead (`market-data-daily`, `0 10,14 * * 1-5` UTC = 18:00 / 22:00
Taipei), which runs unconditionally and comes after the ~16:00 publication. It is also its own
cron-gated action `sync-etf-holdings` and an admin-run job. No DDL, no new cron job.

## File contract (Web Interface Contract)

`reports` bucket, `market/etf_holdings/0050.json`:

```ts
interface EtfHoldingsFile {
  schema: 1
  etf: string            // '0050'
  fundName: string       // from PCF.fundname
  issuer: 'yuanta'
  sourceUrl: string      // the official ratio page
  updatedAt: string      // ISO, last write
  days: EtfHoldingsDay[] // newest first, at most 20
}
interface EtfHoldingsDay {
  tradeDate: string      // 'YYYY-MM-DD' from PCF.trandate
  publishedAt: string | null // PCF.upddate as given ('YYYY-MM-DD HH:mm:ss', Taipei)
  navTotal: number       // PCF.totalav
  navPerUnit: number     // PCF.nav
  unitsOutstanding: number // PCF.osunit
  fundSize: number       // Summary.fundsize — the denominator of the weights
  assets: { stock: number; etf: number; bond: number; futures: number }
  stocks: Array<{ code: string; name: string; shares: number; weight: number }>
  futures: Array<{ code: string; name: string | null; contracts: number; weight: number; month: string }>
}
```

`weight` is the percentage as published (56.39). Every figure is Yuanta's; nothing is recomputed
for display. Deviation from the plan: the asset block shows amounts only, no 占比 — the source
does not publish one and the denominator (`totalav` vs `fundsize`) would be our choice.

## Edge (`sources/supabase/functions/stock-report/`)

- `etfHoldings.ts` (pure): `yuantaHoldingsUrl`, `parseYuantaHoldings(raw) → day | null`,
  `validateHoldingsDay(day, rules, todayYmd)`, `ETF_0050_RULES`, `appendHoldingsDay` (same date
  replaced, newest first, cap 20), `holdingsFingerprint`, `expectedLatestTradeDate(now)`.
- Validation (0050): trade date parses and is not after today (Taipei); `navPerUnit ×
  unitsOutstanding` within 0.05 % of `navTotal`; stock weight sum within 0.5 pp of
  `assets.stock / fundSize × 100`; 45–55 stocks, unique codes, positive integer shares, weight > 0;
  contains 2330; futures amount > 0 ⇒ futures list non-empty. No futures amount/weight cross-check.
- `etfHoldingsSync.ts` (I/O injected, like `sectorFlowSync.ts`): read stored file → if its newest
  day ≥ `expectedLatestTradeDate(now)` return `unchanged` **without** a request → fetch → parse →
  validate → older than stored newest ⇒ `stale` → same date and fingerprint ⇒ `unchanged`, or
  `not-published` when that date is still before the expected one → upload.
  `expectedLatestTradeDate`: today (Taipei) on a weekday from 16:00, else the previous weekday.
  Holidays are not known here, so on a holiday the run makes one request and ends `not-published`.
- Reasons: `unchanged | not-published | fetch-failed | parse-failed | invalid | stale |
  upload-failed | error`; `invalid` carries `rule`. Never throws; never overwrites the file on
  failure.
- Wiring: called first in `runGeneratePhaseMarketData` (result in the phase's response body), action
  `sync-etf-holdings` (gate `cron`), admin-run job (both lists), `MechanismGuide` note, and a note
  at the `market-data-daily` retirement condition in `schema.sql`. Not run when the source probe
  runs that phase as a follow-up (it shares one 60 s invocation with the probe loop).
  Fetch: `fetchWithRetry`, 8 s per attempt, 10 s total, so the rest of the 60 s phase keeps its time.
- Failures (`fetch-failed | parse-failed | invalid | upload-failed | error`) go to `app_log`
  (`action = sync-etf-holdings`), because this phase writes no `batch_run_log` row; the manual action
  answers 502 on them so `admin_run_log.ok` is false. The read of the stored file throws on anything
  but not-found, so a failed read can never be taken as "no file" and shrink 20 days to one.
- The parser orders stocks by published weight (largest first); the top-10 cut relies on it.
- Accepted: a per-attempt timeout gets no retry inside the 10 s budget; the next try is the 22:00
  run. `appendHoldingsDay` adds only the latest day, so a day both runs miss is not backfilled.

## Web (`sources/src/`)

- `services/etfHoldingsProxy.ts`: contract types, `ETF_HOLDINGS_SUPPORTED = ['0050']`,
  `fetchEtfHoldings(etf)` → `ProxyResult`; unsupported code → `empty` with no request.
- `components/StockDetail/etfHoldingsView.ts`: 億元 formatting, top-10 / expand, futures hidden
  when empty.
- `components/StockDetail/EtfHoldingsTab.tsx`, new 「成分股」 tab in `StockDetailPage` only for a
  supported code (`?tab=analysis&sub=holdings`); a ticker switch to an unsupported code falls back
  to 籌碼. Blocks in Yuanta's order: data note (date, 元大投信公布, 每個交易日約 16:00 更新, link),
  fund summary (億元, full figure in `title`), asset amounts (zero rows dimmed), stock table
  (top 10, expand; **no row links** — 個股分析 opens only held or watched stocks, so a link to most
  constituents would show a different stock; review BLOCKER), futures table (hidden when none).
  A file that exists but cannot be read shows its own error, not the empty state. Weights are
  not coloured with `--up` / `--down`. Phone: name + weight, shares hidden. Empty state:
  「還沒有這檔 ETF 的成分股資料，排程每個交易日傍晚更新。」

## UI revision — charts first (0.10.39-dev.2, user-approved shape)

The user asked for 「圖表為主，表格為輔」. Order: data note → fund summary (three figures, unchanged)
→ **持股集中度**: one 100 % bar over fund size, segments = largest holding / ranks 2–10 / the rest /
「股票以外」 (100 − sum of stock weights); each stock segment is a plain sum of published weights →
**前 10 大持股**: horizontal bars on one shared scale (largest = full track) → `details.chart-more`
「看全部 N 檔明細」 holding the 50-row table (collapsed) → **資產配置**: one bar whose widths are each
amount's share of the four amounts together, labelled in 億元 only (no percent: the futures amount may
be notional, so a fund-size denominator could top 100 %) → futures table. Figures live in the legend,
not inside the bars (white text on the light-theme yellow failed contrast). Identity colours
`--chart-c1..3`; never `--up` / `--down`. The 「顯示全部」 button is gone (the disclosure replaces it).

## Tests

Edge: parser against the 10/12 fixture; each validation rule fails once, the fixture passes;
sync `unchanged` without fetch, `stale`, `invalid` not written, upload failure, 20-day cap,
`not-published`; route `sync-etf-holdings` is `cron`. Web: proxy skips unsupported codes; view
formatting / top-10 / futures; `StockDetailPage` shows 成分股 for 0050 and not for 2330.
