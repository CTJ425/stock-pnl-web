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

## Expansion to other ETFs — decisions (2026-10-14 09:42:18 Asia/Taipei, user interview)

PROD on 2026-10-14 had 10 ETF codes in transactions/watchlist across 7 issuers: held 0050 (元大),
009828 中信台日韓PCB (中信, also watched); sold out 0056 (元大), 00919 + 00685L (群益), 00403A +
00981A (統一, active), 00878 (國泰), 00936 (台新), 009816 (凱基).

1. **Which ETFs**: every ETF code that any user has *ever traded* or watches, computed by the schedule
   each run (not a fixed list); only codes whose issuer has a parser are fetched.
2. **Issuers**: one at a time, each with its own Phase 0 (endpoint, whole-fund vs basket, Edge
   reachability, publish time, terms). Order: 中信 (009828, held) → 群益 → 統一 → 國泰 → 台新 → 凱基.
   元大 0056 needs no new parser.
3. **Phase 0 failure** (Edge blocked, no machine-readable data, PDF only): stop and ask the user —
   do not pick a workaround (Actions, PDF parsing, paid source) alone.
4. **Terms**: record robots.txt and terms per issuer in Phase 0; stop only on an explicit ban of
   republishing / automated retrieval. Source and official link always shown.
5. **New code**: no on-demand fetch; it appears after the next scheduled run.
6. **Unsupported issuer**: the 成分股 tab *is* shown, with 「這檔的投信（…）成分股資料尚未串接」 and the
   official link. This replaces the 0050-only rule "unsupported codes get no tab" — the tab now
   appears for any ETF code (starts with `00`), data or not.
7. **One shared screen that adapts**: a 市場分布 bar (sum of published weights by market) when
   holdings span two or more markets (009828); for leveraged / futures-led funds (00685L) the main
   chart becomes an 曝險 bar list over fund size that may exceed 100 %, with a plain-language note,
   instead of the 100 % concentration bar.
8. **Delivery**: one issuer per release. Release 1 = automatic list + 尚未串接 state + 元大 0056 +
   中信 009828; then one release per further issuer, each with tests and `route:reviewer`.

Open (decide during build, not asked): contract fields for market / currency of foreign holdings
(schema bump if needed); per-type validation rules replacing the 0050-only `ETF_0050_RULES`; the
request budget inside the 60 s `market-data-daily` phase once 10+ ETFs are fetched.

## Release 1 — CTBC Phase 0 and build (2026-10-14 10:11:38 Asia/Taipei)

**Source: CTBC's own SPA API** (`https://www.ctbcinvestments.com.tw/API/<path>`, found in the site's
Vite bundle). Every call is POST with `token` in both the query string and the JSON body:
`home/AuthToken {token:'www.ctbcinvestments.com'}` → session token (91–115 chars, contains `+ / =`;
**must be URL-encoded** — sent raw, `+` reads as a space and every call answers 「Token 無效或過期」) →
`etf/ETFList {IsWithETF:'Y'}` maps `ETF_ID` 009828 → `FID` E0039 (36 funds) →
`etf/ETFHoldingWeight {FID, StartDate:'YYYY/MM/DD'}`.

- **Whole fund**: 3037 欣興 999,600 sh × 1,180 = 1,179,528,000 ≈ 11.44 % of NAV 10,304,880,295.
  Weights are over net assets (`fundSize = navTotal`). NAV × units vs NAV: −0.03 %.
- **Shape**: `FundAssets[0]` (資料日期 'YYYY/MM/DD', 基金淨資產, 基金在外流通單位數, 基金每單位淨值);
  `FundAssetsDetail[]` groups (`STOCK`: 30 rows; `CASH`: cash and 應收(付)證券款 lines). Numbers are
  strings with thousands separators; `amount_` is in the row's own currency (JPY/KRW), so there are no
  NT$ asset-class totals → `assets: null`. Codes carry an exchange suffix: none = TW, `JP`, `KP`/`KQ` =
  Korea. 2026-10-13: TW 17 / JP 9 / KR 4; stock weights 98.97 %.
- **Dates**: `StartDate` returns the latest day on or before it; back to 2026-09-15 (listed late
  August). `StartDate 10/12` → 10/08: 10/09 a TW holiday, 10/12 skipped (probably Japan's 體育の日 —
  not verified). T was available by T+1 09:40 Taipei; same-day time unknown → `publishHourTaipei: null`
  (only the previous weekday is expected).
- **Edge**: a throwaway DEV function (deleted, 404 after) got rc 0, 30 holdings, ~1.1 s on 3/3 calls.
- **Terms**: `robots.txt` on both domains `Allow: /`; no terms page checked beyond that.

**Built** (release 1 per § Expansion): `_shared/etfIssuer.ts` (issuer by short-name prefix, shared
with the browser); `etfHoldingsCtbc.ts` (session: 1 auth + 1 list per run, then 1 call per fund);
`HoldingsSource` per issuer in `etfHoldingsSync.ts`; `syncEtfUniverse` over every ETF code in all
users' transactions (open or closed) ∪ watchlists, 0050 first, 20 s start budget, unsupported issuers
listed not fetched; contract adds `stocks[].market` (missing = TW), `assets` nullable, `issuer`
'yuanta' | 'ctbc' (schema stays 1: additive). Rules: 0050 keeps its own; others `DEFAULT_HOLDINGS_RULES`
(≥ 1 stock, ≤ 500); without `assets` the stock weight sum must not top 100.5 %. UI: tab for every ETF
code; 尚未串接 message (no request) for an issuer without a source — no official link (their URLs
were not verified); 市場分布 bar when holdings span ≥ 2 markets; 資產配置 only when `assets` exist;
data note and link text name the issuer.

DEV live (branch deploy, `stock-report` v19 `06fcb71f10c2…`): first run 0050 unchanged, 0056 and
009828 written, 7 codes unsupported, 4.5 s; second run 705 ms, nothing written.

### Release 1 review (session 2 via herdr, 2026-10-14 10:26:17 Asia/Taipei)

Review-only agent (`pr-reviewer`, Claude, `--disallowedTools Edit Write NotebookEdit`, told not to
commit / push / comment) on PR #1: 0 BLOCKER, 6 RISK, 6 NIT; all checked against the code, none
false. Fixed: (1) issuer read from user-typed `transactions.name` → Edge prefers the TWSE short name
from `reports/twlist/latest.json`, 0050 always in; the tab always reads the file and uses the name only
to word a missing-file message; (2) 「主動」 prefix stripped before brand matching; (3) uniqueness by
`market:code` (and React keys); (4) a fund with no stocks → `no-stocks`, not a failure; (5) budget
counted from before the universe query, a fund starts only if `elapsed + source.worstCaseMs()` fits
(Yuanta 7 s; CTBC 21 s before its session, 7 s after), per-call 6 s / 7 s, round 25 s; (6) universe
query error logged. NITs fixed: `TT` → TW; unknown CTBC row types refuse the day; supported-issuer copy
generated from the brand list. Not changed: market bar > 100 % (the bar clips, `overflow: hidden`);
one extra same-day rewrite of pre-release files (adds `market`, harmless).

## Release 2 — 群益 (Capital) Phase 0 and build (2026-10-14 11:18:46 Asia/Taipei)

**Source: Capital's Angular app API** `https://www.capitalfund.com.tw/CFWeb/api/<path>` (found in its
lazy chunks; the `/api/...` paths in `main.js` are relative to `/CFWeb`), POST JSON, no token:
`etf/list` with body **`null`** (an empty body answers 411) → `data.funds[]` (`data` is an object
`{etfFilters, funds}`, 28 funds) maps `stockNo` 00919 → `fundNo` 195, 00685L → 094 →
`etf/buyback {fundId, date}` (what its 投資組合 and 申購買回清單 pages call).

- **Whole fund**: 2881 富邦金 611,370,000 shares at 15.5016 % of NAV 631,025,345,971. Weights are over
  NAV (stocks 99.58 % + futures 0.42 % = 100 %). NAV identity −0.008 %. `assets` null (only margin /
  cash / payable lines). `fundhold/list` is only the monthly top 10 — not used.
- **Dates**: `pcf.date2` = trade date, `pcf.date1` = announcement date; `date` asks by announcement
  date (`null` = latest); back to at least 2026-09-15. T was there by T+1 11:00; same-day time not
  observed → `publishHourTaipei: null`.
- **00685L**: 0 stocks, one future 台指期 202610, 15,866 contracts, **200.9432 %**.
- **Edge**: throwaway DEV probes (deleted) got HTTP 200 JSON on every call, 0.1–1 s; User-Agent and
  `charset` variants make no difference.
- **Terms**: `robots.txt` `Allow: /`.

**Built**: `etfHoldingsCapital.ts` (session: 1 list + 1 call per fund; fund page link
`/etf/product/detail/<fundNo>/portfolio`); `capitalSource`; `HoldingsSource.sourceUrl` may be async;
issuer union adds `capital`, 群益 `supported: true`. **Futures-led funds** (decision 7): validation
accepts a day with no stocks when futures exist (rows whole, weight ≠ 0); the sync writes it (only a
day with neither stocks nor futures is `no-stocks`); the tab draws 期貨曝險 bars on a scale of at least
100 % with a 100 % mark instead of the stock charts. Bond rows refuse the day (not parsed yet).

**Caught on DEV, not by tests** (both fixed with regression tests on real shapes): (1) the list parser
read `data` as an array — the unit-test fake was a hand-built array, so every Capital fund ended
`fetch-failed` on DEV; the fake is now the real `etf/list` response. (2) The web normalizer dropped a
day with no stocks, so 00685L showed 「格式對不上」 in the preview; a producer→consumer test on the real
00685L data now covers it. Also: one Capital call stalled once → per-call 3 s an attempt inside 7 s
(room for one retry, was 6 s / 7 s); `app_log` `detail` was `{}` because `_shared/log.ts` keeps an
allowlist — now `ticker` / `code` / `hint` / `ymd`.

DEV (branch deploy `stock-report` v23 `36539ca3b4bd…`): 00919 file deleted then recreated by the sync
(40 holdings), 00685L written, 0050 / 0056 / 009828 unchanged, 3.4 s.

### Release 2 review (session 2 via herdr, 2026-10-14 11:29:36 Asia/Taipei)

Review-only agent `pr-reviewer` on PR #2: 1 BLOCKER, 6 RISK, 4 NIT; all checked, none false.
- **BLOCKER fixed**: "no stocks + some futures" was taken as futures-led, so a truncated stock-fund
  response (00919 with only its 0.42 % futures line) would be written and could replace a complete
  day. Now `_shared/etfShape.ts` `isFuturesLed`: |futures| ≥ 90 % and > stocks, shared by the Edge
  validation and the tab; anything else with no stocks fails `stock-count` and is not written.
- RISK fixed: NAV tolerance `max(0.05 %, 0.006 / navPerUnit)` (2-decimal rounding of low-priced funds);
  00631L-style 1 stock + futures uses the exposure view (same predicate) with a stock-position
  disclosure; inverse lines get `--chart-c3` and a 「反向」 tag; copy no longer calls the excess "倍數",
  a sum is shown only for several lines and labelled 本站相加; Capital non-TWD / foreign codes / bond
  rows → `unsupported-holdings` (quiet skip, not a failure); null / missing lists read as empty.
- NIT fixed: futures React keys carry the index. Not changed: the 3 s attempt timeout also covers
  reading the body (responses are a few KB); month format other than `YYYYMM` only affects the code
  label; Storage read/write time is still outside the 25 s budget (as in release 1).

## Tests

Edge: parser against the 10/12 fixture; each validation rule fails once, the fixture passes;
sync `unchanged` without fetch, `stale`, `invalid` not written, upload failure, 20-day cap,
`not-published`; route `sync-etf-holdings` is `cron`. Web: proxy skips unsupported codes; view
formatting / top-10 / futures; `StockDetailPage` shows 成分股 for 0050 and not for 2330.
