# Task 195 — replace MIS / Yahoo (Taiwan stocks only) with Fugle MarketData

Requested 2026-10-06 (Asia/Taipei). Branch **`feat/fugle-marketdata`**, cut from `dev` at `e0e25bf`.
The branch has no upstream; push it with `git push -u origin feat/fugle-marketdata`. Never push it to `dev`.

Decisions taken with the user:

- Scope = **all five call sites** in §2, including `max` (monthly) and the nightly `syncDaily`.
- DEV Supabase work is authorised: deploy, set and read secrets by name, and read-only queries. **PROD is not.**
- Push the branch to GitHub. **The API key must never reach git, chat, logs or GitHub.** See §6.
- Fugle runs **first**, and MIS / Yahoo stay as fallbacks. If the key is missing, Fugle answers 401/403/429,
  or a call fails or times out, the code falls through to today's path for that symbol. The app must never
  get worse than today because of Fugle.

Out of scope, staying on Yahoo because Fugle has no such data: US stocks, foreign indices
(`globalIndexClose.ts`, `IDX:` symbols including `^TWII`), FX (`fxRates.ts`, `stock-price` `fx`), and the
`search` action. Chips (T86, BFI82U, MI_MARGN, TWT96U, TWT38U, sector flow) are also out of scope.
Fugle's `ownership/institutional-trades/{symbol}` is per-symbol only, gives shares and no NT$, and is paid
only, so it cannot replace a whole-market file.

## 1. Background from the research (2026-10-06)

- **Fugle MarketData** is a REST API at `https://api.fugle.tw/marketdata/v1.0/stock/...`, authenticated with
  the `X-API-KEY` header. Deno can call it with plain `fetch`, so no SDK is needed.
- Fubon's 新一代 API serves the same data (時報資訊 + Fugle). It was rejected because it needs the native
  SDK, which does not run on Deno Edge, plus a 富邦 account, a `.pfx` cert or API key on a server, and a
  fixed IP for its allowlist. Supabase Edge egress IPs are not fixed.
- **Plans** come from the pricing page as seen in search snippets. The page itself was not opened, because
  egress was blocked in the cloud session. **Confirm on https://developer.fugle.tw/docs/pricing/ before
  relying on these numbers.**

  | Plan | Price | Intraday (`intraday/*`) | Historical | 盤後籌碼 |
  |---|---|---|---|---|
  | 基本用戶 | free | 60/min | 60/min | not available |
  | 開發者 | NT$1,499/mo | 600/min | — | 60/min |
  | 進階用戶 | NT$2,999/mo | 2,000/min | — | 60/min |

  - A 429 means "wait one minute".
  - Not verified: whether `snapshot/*` is included in the free plan, and whether the minute limit is per key
    or per account.
- **Terms ("聲明" on the intro page):** users must follow the TWSE / TPEx / TAIFEX 交易資訊使用管理辦法.
  This site shows quotes to several accounts, so whether a personal plan allows that is **open, and the
  user's call**. Read the statement before going to PROD.
- **Overseas IP:** no geo restriction is documented, but none was tested either. The first DEV call in §8
  settles it.

## 2. Call sites to replace

| # | File:line (at `e0e25bf`) | Today | Fugle | Front-end consumer |
|---|---|---|---|---|
| 1 | `sources/supabase/functions/stock-price/index.ts:236` `fetchMisPrices` | MIS `getStockInfo.jsp` | `GET /intraday/quote/{symbol}` (see §4.1 for the snapshot option) | `useStockPrices`, `WatchSection`, `useWatchQuote` (60 s poll) |
| 2 | same file `:204` `fetchYahooPrice`, **TPE only** | Yahoo `.TW` / `.TWO` | merged into #1; Yahoo stays as the last fallback | same |
| 3 | same file `:703` `handleIntraday`, **TPE only** (`IDX` stays Yahoo) | Yahoo 1m (`1d`) / 5m (`5d`) | `1d`: `GET /intraday/candles/{symbol}?timeframe=1`. `5d`: `GET /historical/candles/{symbol}?timeframe=5&from&to`, plus today's `intraday/candles?timeframe=5` when the session is open | `QuoteTab` → `IntradayChart` |
| 4 | same file `:722` `handleDailyRange` | Yahoo `5y` 1d / `max` 1mo | `GET /historical/candles/{symbol}?timeframe=D` (5y) or `timeframe=M` (max) | `TechnicalTab` 近 5 年 / 全部 |
| 5 | `sources/supabase/functions/stock-report/index.ts:1090` `syncDaily` (URL builder `twDaily.ts:65` `dailyUrl`) | Yahoo 1y 1d per ticker, nightly and on demand (`warm`) | `GET /historical/candles/{symbol}?timeframe=D&from=<today-1y>&to=<today>` | `daily/{ticker}.json` in Storage → technical tab, holdings card |

Every response shape the front end sees **stays the same** (`Quote`, `IntradaySeries`, `DailyRow`,
`{ rows, granularity }`), so `sources/src` should not need any change. If a change looks necessary,
stop and re-read this section: it means a mapping in §3 is wrong.

## 3. Field mapping and units (evidence included — do not guess)

Response shapes come from Fugle's own SDK, `github.com/fugle-dev/fugle-marketdata-sdk` (cloned
2026-10-06, HEAD `3f459fad`): `core/src/models/{quote,candle,snapshot,ticker}.rs`, plus the real captured
bodies in `js/tests/fixtures/official_sdk_quote.json` and `py/tests/test_passthrough.py` (`QUOTE_2330`,
captured 2026-09-16).

### 3.1 `intraday/quote/{symbol}` → `Quote` (stock-price)

| Our field | Fugle | Notes |
|---|---|---|
| `price` | `lastPrice`, else `closePrice` | When `isTrial` is true, use `lastTrial.price` and set `trial: true`, the way MIS `z` + `ip` works today. |
| `prevClose` | **`referencePrice`**, else `previousClose` | The real body of 2026-09-16 has `referencePrice 2380`, `previousClose 2385`, `change 5`, `closePrice 2385`, so `change = close − referencePrice`. 漲跌 colouring must use the reference price (平盤價), which differs from the previous close on ex-rights days. |
| `open` / `high` / `low` | `openPrice` / `highPrice` / `lowPrice` | — |
| `volume` (張) | `total.tradeVolume` | **Already in 張.** Proof from `official_sdk_quote.json`: `tradeValue 72,462,105,000 / tradeVolume 40,610 = 1,784,341 ≈ avgPrice 1784.34 × 1000`. Do not divide by 1000. |
| `tradeDate` (YYYYMMDD) | `date` (`YYYY-MM-DD`) | Strip the dashes. |
| `tradeTime` (HH:mm:ss, Taipei) | `lastTrade.time`, else `lastUpdated` | **Microseconds** in real bodies (`1769751000000000` = 2026-01-30 13:30:00 +08:00). The SDK doc comment says "ms", but the fixtures disagree. Normalise by magnitude: > 1e14 → µs, > 1e11 → ms, else s. Unit-test all three. |
| `trial` | `isTrial` | — |
| `industry` | not in the quote | See §4.2. |

**BUG-045 analogue (must keep):** if the session has reached close (`isClose` true, or time ≥ 13:30:00) and
there is no trade price, return `null` so the chain falls through. Never fall back to a bid after close.

**BUG-110 (must keep):** `handlePrices` already skips live fetches on a closed day (`twIsClosedDay`), and
the cache read rejects closed-day `trade_date`. The Fugle path sits **inside** that same guard. Do not
call Fugle on a closed day.

### 3.2 `intraday/candles/{symbol}` → `IntradaySeries`

- `data[].date` is ISO with `+08:00`; `t = Date.parse(date) / 1000`. `c = close`.
- `v` must be **shares** (`IntradayChart.tsx:243-246` divides by 1000 to show 張). Fugle intraday
  quantities are in 張 (§3.1 proof), so `v = volume × 1000`.
  **Not verified for candles specifically.** On DEV, check that `Σ candles.volume` equals the same
  moment's `quote.total.tradeVolume`, and record the result.
- `prevClose`: the candles carry none. Read the `price_cache` row `TPE:{ticker}.prev_close` first, at no API
  cost. Otherwise make one `intraday/quote` call (that one also refreshes `price_cache`). For `5d`, use the
  close of the day before the first bar in the window, taken from the historical daily call or `daily/{ticker}.json`.
- `dayOpen` / `dayHigh` / `dayLow`: first `open`, max `high`, min `low`, the same as `parseYahooChart`.
- `symbol`: keep the shape Yahoo gave (`'2330.TW'` / `'2330.TWO'`), derived from the quote's or candle
  response's `market` (`TSE` → `.TW`, `OTC` → `.TWO`). `IntradayChart` uses it in the aria label (`:226`).
- `interval` / `range`: same values as today (`intradayInterval(range)`).

### 3.3 `historical/candles/{symbol}` → `DailyRow[]` (`[date, o, h, l, c, volumeShares]`)

- Request `fields=open,high,low,close,volume,turnover` explicitly.
- **Volume unit: decide it from the data, do not hard-code it.** Compute the median over rows of
  `turnover / (volume × close)`. A value ≈ 1 means shares; ≈ 1000 means 張, so multiply by 1000. If
  `turnover` is absent, fail the Fugle path and fall back to Yahoo. `TechnicalTab.tsx:91` and the test at
  `TechnicalTab.test.tsx:26` expect **shares**.
- `adjusted`: leave it unset (raw prices). Yahoo's v8 `indicators.quote` is split-adjusted but not
  dividend-adjusted. Taiwan splits and capital reductions are rare, but this is a known difference: note
  it in the code comment.
- Keep `extractDaily`'s rule of dropping today's still-open bar (`isTwMarketClosed`). The 0.9.26-dev.2
  self-heal in `syncDaily` (premature-file check) must keep working unchanged.
- Rows go **old → new**: pass `sort=asc`, and sort anyway.
- One call covers at most **one year** (doc snippet: "retrieve stock prices within 1 year"). So `5y` is 5
  calls (D), and `max` is monthly bars (M) from 2010-01-01, chunked by year if the API rejects a longer
  range. **Try one long M call first.** Only chunk if it is refused, and record which one worked.
- `max` (monthly): the Yahoo-only "live row" quirk (`dailyRange.ts`) does not apply. Fugle's current-month
  bar is the month to date, which is what `extractMonthly` already ends with after dropping the live row.
  Check this on DEV.

## 4. Design

### 4.1 New shared module `sources/supabase/functions/_shared/fugle.ts` (+ `fugle.test.ts`)

Keep the split the repo already uses: **pure parsers**, unit-tested by vitest like `misParse.ts`, and a
thin I/O layer.

- `FUGLE_BASE = 'https://api.fugle.tw/marketdata/v1.0/stock'`
- `fugleKey(): string | null`
  - Returns `Deno.env.get('FUGLE_API_KEY')`, trimmed. An empty value counts as null.
  - Never log it, never put it into an error message, and never echo it into `app_log` / `logEvent`
    detail.
- `fugleGet(path, query)`
  - Returns `{ ok: true, json } | { ok: false, status }`.
  - 8 s `AbortSignal.timeout`; header `X-API-KEY`. Never put the key in the URL.
  - **Circuit breaker:** a 429 sets a module-level `blockedUntil = now + 60 s`, and a 401/403 sets it to
    `now + 10 min`. While blocked, return `{ ok: false, status: 0 }` without a network call. This keeps one
    exhausted minute from turning into a retry storm, and the caller falls back to MIS / Yahoo.
  - `logEvent` once per transition into the blocked state, with the status and path only.
- Pure parsers: `parseFugleQuote`, `parseFugleIntradayCandles`, `parseFugleHistoricalCandles` (with the
  unit detection from §3.3), `fugleTimeToMs` (µs / ms / s), `fugleSymbolSuffix(market)`.
- Fixtures: copy the two real bodies named in §3 into
  `sources/supabase/functions/_shared/__fixtures__/fugle/`. They are public market data from an
  MIT / Apache-2.0 repo; name the source in a header comment.
- Prices for many symbols: use per-symbol `intraday/quote` while the uncached TPE count is **≤ 20**. Above
  that, try `snapshot/quotes/TSE` + `snapshot/quotes/OTC` (2 calls cover the whole market).
  - Snapshot has no `isTrial` and no reference price, so `prevClose = closePrice − change`.
  - If snapshot answers 401/403 (plan), remember that per isolate and use MIS for the overflow.

### 4.2 Industry

Fugle's quote has no industry, but `price_cache.industry` drives watchlist grouping
(`WatchSection.tsx:169`) and the category on the quote tab.

- Before upserting a Fugle quote, read the existing `price_cache.industry` for those keys (no freshness
  filter) and carry it forward.
- If a key has never had one, make **one** `GET /intraday/ticker/{symbol}` call and map `industry` (code,
  e.g. `"24"`) through `toIndustry()` from `misParse.ts`.
- This is at most one ticker call per symbol, ever.

### 4.3 Order in `handlePrices` (unchanged otherwise)

1. DB cache (unchanged).
2. **Fugle** for missing TPE symbols, only on a trading day.
3. MIS for whatever Fugle did not resolve.
4. Yahoo for whatever is still missing, plus US symbols, under the same `PRICES_YAHOO_DEADLINE_MS`.
5. Upsert (unchanged).

Count which source answered and log one line per call. The DEV check uses it.

### 4.4 `syncDaily` pacing

It runs sequentially. Use Fugle per ticker, falling back to `yahooDailySymbols()` on any failure. If a run
has more than 50 tickers, space Fugle calls ≥ 1.1 s apart. Check the phase's wall-time budget first: the
chips phase worst case is 66 s of 150 s (RISK-023). If the pacing would not fit, cap Fugle at 50 tickers
per run and let the rest use Yahoo.

### 4.5 Docs inside the code

Update the header comment of `stock-price/index.ts`, which describes MIS → Yahoo today, and the "Why
Yahoo" note in `twDaily.ts`.

## 5. Usage estimate — will the free plan be exhausted?

Measured facts in the code:

- The TW quote TTL during the session is **60 s, site-wide** (`quoteWindow.ts` `POLL_MS`). Every front-end
  poll is 60 s. So Fugle quote calls per minute ≤ **the number of distinct uncached TPE symbols across all
  open tabs of all users**, not the number of users.
- After 13:30 the cache locks until 08:25 the next day, so there are almost no calls outside the session.
- Intraday chart: 1 call per open per 60 s (`intradayProxy.ts` client cache). `5d` is 2 calls.
  `5y` is 5 historical calls and `max` is 1 to 16. These come only from a user clicking.
- `syncDaily`: one historical call per held / watched ticker per run.

What this means for the free plan (60/min intraday, 60/min historical):

- With fewer than ~50 distinct TW symbols across everyone's holdings and watchlists, the quote path stays
  under 60/min even when every symbol misses at once. Above that, the snapshot branch in §4.1 holds it to
  2 calls/min.
- Historical: one user opening 近 5 年 + 全部 costs ~6 to 21 calls. Several users doing it in the same
  minute, together with a large `syncDaily`, can hit 60.
- **When it is exhausted, nothing breaks.** The circuit breaker sends that minute to MIS / Yahoo, which is
  today's behaviour.
- **Shared key:** if DEV and PROD use the same key, they share the limit. Use **two keys**, one per
  project, or accept the sharing knowingly.
- To do: before PROD, run read-only on PROD to count distinct TW tickers in holdings plus watchlists, and
  record the number here. It could not be run from the cloud session, which has no CLI or token.

## 6. API key handling (hard rules)

1. The user creates the key on developer.fugle.tw and **never pastes it into chat**.
2. The user sets it themselves:
   - Supabase Dashboard → project **Stock-Pnl-Web-Dev** (`zyebvayngwrqzoaicbwd`) → Edge Functions →
     Secrets → `FUGLE_API_KEY`.
   - Or from a local shell: `supabase secrets set --project-ref zyebvayngwrqzoaicbwd FUGLE_API_KEY=...`.
     Type it there; never in a file that is tracked.
3. Code reads only `Deno.env.get('FUGLE_API_KEY')`. **No default value, no fallback literal, no key in tests**:
   tests use `'test-key'` and a mocked `fetch`.
4. For local runs, keep the key in `sources/supabase/functions/.env` or `sources/.env`.
   - Both are git-ignored, verified with `git check-ignore -v`.
   - Re-run `git check-ignore -v <file>` before every commit that touches env handling.
5. Before every push:
   - `git diff origin/dev...HEAD | grep -nEi 'x-api-key|fugle_api_key\s*=|apikey'` must show only the env
     name and header name, never a value.
   - GitHub push protection may not know Fugle's key format, so this check is the real gate.
6. Logging: never log request headers. `logEvent` detail for Fugle has `path` (symbol included), `status`
   and `source` only.
7. `supabase secrets list` shows only a hash, which is fine to show. Never print the value. If a key ever
   lands in a commit, **rotate it on Fugle first**, then rewrite: the repo is public.
8. PROD gets its own secret only at release time, set by the user.

## 7. Tests (vitest, from `sources/`)

- `fugle.test.ts`:
  - The real 2330 quote → expected `Quote`: price 1775, prevClose 1805, volume 40610, tradeDate 20260130,
    tradeTime 13:30:00, trial false.
  - The 2026-09-16 body → prevClose **2380**, not 2385.
  - Trial body → `trial: true` with the trial price.
  - After close with no trade → null.
  - µs / ms / s timestamps.
  - Historical unit detection for both shares and 張, and missing turnover → null.
  - Intraday candles → points with `v` in shares.
- `stock-price` order test: with `fetch` mocked, Fugle OK → MIS and Yahoo are not called. Fugle 429 → MIS
  is called and the breaker skips Fugle on the next call. No key → zero Fugle calls.
- `syncDaily`: Fugle failure → Yahoo is used and a good existing file is never clobbered (the existing
  protection test must still pass).
- Gates: `npm test`, `npm run build` (**not** `npx tsc --noEmit`), `npm run typecheck:edge`, `npm run lint`.

## 8. DEV verification (after the user has set `FUGLE_API_KEY` on DEV)

From `sources/`, on a clean tree at a known commit:

1. Deploy:
   - `supabase functions deploy stock-price --project-ref zyebvayngwrqzoaicbwd`. Keep the default
     `verify_jwt=true`.
   - `supabase functions deploy stock-report --project-ref zyebvayngwrqzoaicbwd --no-verify-jwt`. This
     flag is required.
   - Record the `ezbr_sha256` values from `functions list`.
2. Overseas IP and key: call `prices` for `2330` and one OTC symbol (e.g. `6488`) during the session with a
   signed-in JWT. The log line must show `source=fugle`. A 401/403/451 or timeout here means overseas
   access or the key is the problem: record it and stop.
3. Compare with MIS at the same minute: price, prevClose, volume (張), tradeTime.
4. `intraday` 1d / 5d: check the bar count, `v` units (§3.2), and the prevClose line.
5. `daily` 5y / max: check the row count and volume unit against `daily/{ticker}.json`, and record whether
   the long M call worked.
6. Trigger `warm` or wait for the nightly run, then confirm `daily/{ticker}.json` is rewritten with Fugle
   data.
7. Remove the secret, or set it to garbage, and confirm everything still works through MIS / Yahoo.

## 9. Versioning and release

- The current release is `0.10.32`, so this cycle's number is **`0.10.33-dev.N`**, starting at `dev.1`.
  Follow `CLAUDE.md` § Versioning:
  - bump all of `version.syncFiles`;
  - add the zh-TW changelog entry;
  - commit the code, version files and changelog together.
- Merge to `dev` only after §8 passes and the user agrees. PROD needs a separate secret (§6.8), the terms
  question answered (§1), and a separate OK.
- Update `TASK.md` and `PROGRESS.md` (bookkeeping skill) when work lands.

## 10. Open questions for the user

1. Is the free plan enough, or will you buy 開發者? This changes nothing in code, only the limits in §5.
2. Use one key for DEV and PROD, or two?
3. The terms question in §1 (several accounts viewing the quotes).

## 11. Implementation notes — where the code departs from this spec (2026-10-06, local session)

Measured with the free key on this host; full numbers in `docs/architecture/1006.md` §2–§3.

| Spec | Code | Why |
|---|---|---|
| §3.3 decide historical volume unit from `turnover` | hard-coded shares | Daily `volume` equals TWSE STOCK_DAY 成交股數 exactly (2330, 2026-10-01..06). |
| §3.3 `adjusted` unset, note the split difference | raw + `splitAdjust` (reference / prev close outside 0.8–1.25) | 0050's 1:4 split would show a 75% cliff; with the adjustment 5y closes match Yahoo within 0.26%. |
| §3.3 `max` via `M`, chunk if refused | `max` stays on Yahoo | `M` is refused over 1 year too (400); Fugle monthly starts 2004 vs Yahoo 2000; 23 calls; monthly bars cannot be split-adjusted. |
| §4.3 Fugle before MIS for quotes | **MIS → Fugle → Yahoo** (user, 2026-10-06) | MIS is already the exchange's live data and takes a whole batch in one call; Fugle first cost one call per symbol of the shared 60/min and lost `industry`. Fugle now only replaces Yahoo's TW leg. |
| §4.1 snapshot above 20 symbols | Yahoo above 20 | Free plan: `snapshot/quotes/TSE` → 403 (measured). Only reached when MIS fails. |
| §4.2 one `intraday/ticker` call for an unknown industry | cached `industry` carried forward, else null | MIS normally fills it; Fugle only answers when MIS failed, and Yahoo has no industry either. |
| §3.2 1d prevClose from `price_cache` first | always one `intraday/quote` call | Simpler; costs one intraday call per chart load. |
| §3.2 5d with today's `intraday/candles` merged | Yahoo when today's session is missing from history | Not yet known whether minute history includes the live session; one call instead of two. |
| §4.3 one log line per call naming the source | only failures are logged (`app_log`, action `prices` / `intraday`, `fugle <reason>`) | Avoids an `app_log` row per poll. Verify the source by comparing values instead (§8.3). |
| §4.4 pacing above 50 tickers | none; a 429 parks `historical` and the rest use Yahoo | Same outcome, no added wall time. |
| §7 order test with mocked `fetch` | not written | Only the pure parsers are tested (`fugleParse.test.ts`, `fugleDaily.test.ts`). |
| §6.2 user sets the secret | set by the agent from `sources/.env` via `secrets set --env-file` (temp file deleted, value never printed) | DEV secrets were authorised. One key is shared by local and DEV. |
