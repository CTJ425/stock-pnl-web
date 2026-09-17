# Spec — Task 165 Phase 1: Discord daily market summary

- Status: approved by the user 2026-09-17 (design dialogue, Asia/Taipei); lane 2
- Branch: `dev`
- Phase 2 (per-user holdings summary, opt-in, max disclosure = percent + ticker) is **out of scope** here.

## 1. Task

Post a market-wide after-hours summary to **one admin-configured Discord webhook**, twice per
TW trading day: a brief edition at **17:05** and a full edition at **21:30** Asia/Taipei.
No per-user data of any kind is read or sent in this phase.

Decisions fixed with the user (do not revisit):

| Decision | Value |
| --- | --- |
| Users | multi-user app; the channel is on a Discord server with other members |
| Webhook owner | admin, set from the admin console; exactly one site-wide webhook |
| Webhook storage | server-only table; the browser never receives the URL back |
| Schedule | weekdays 17:05 (`brief`) and 21:30 (`full`); both are normal (not silenced) pushes |
| No TAIEX row for today | send nothing, record `skipped` (this is also the holiday rule — there is no holiday calendar, `report.ts:113`) |
| Brief content | 台股大盤, 三大法人（初步）, 國際指數（最近收盤）, 匯率 |
| Full content | 台股大盤, 三大法人, 融資融券, 國際指數（最近收盤）, 美國總經, 匯率 |
| Missing block | that block reads `尚未公布` (TW data) or `暫無資料` (others); the rest still sends |
| Indices | `^N225 ^KS11 ^KQ11 ^DJI ^GSPC ^IXIC ^SOX ^RUT`, last **completed** session only, dated |

## 2. Contract

### 2.1 Data sources (all verified against real responses on 2026-09-17)

| Block | Source | When it exists |
| --- | --- | --- |
| 台股大盤 + 三大法人 | Storage `reports/market/daily.json` → `MarketFile.days[]` (`twMarket.ts:48`), written by `sync-market`, triggered by the `bfi82u` probe | 15:00–16:30 preliminary, 19:30–20:15 complete |
| 融資融券 market totals | **fetched at send time**, TWSE `rwd/zh/marginTrading/MI_MARGN?date=YYYYMMDD&selectType=MS&response=json`, table `信用交易統計`. Not persisted. | after ~21:00 (probe window 20:30–22:30); often absent at 21:30 |
| 國際指數 | **fetched at send time**, Yahoo `v8/finance/chart/{symbol}?interval=1d&range=5d`. Not persisted. | always |
| 美國總經 | Storage `reports/macro/us.json` (`indicators[]`, 6 series) | always |
| 匯率 | Storage `reports/fx/twd.json`, `currencies[code=USD]` | refreshed 11:00 / 17:00 — hence 17:05 |

Real TWSE `MS` response for 2026-09-16:
`{"stat":"OK","date":"20260916","tables":[{"title":"115年09月16日 信用交易統計","fields":["項目","買進","賣出","現金(券)償還","前日餘額","今日餘額"],"data":[["融資(交易單位)",…,"9,190,511","9,248,877"],["融券(交易單位)",…,"198,052","197,048"],["融資金額(仟元)",…,"582,240,465","586,166,660"]]},{}]}`.
Unpublished or non-trading date: `{"stat":"很抱歉，沒有符合條件的資料"}` (no `tables`).

### 2.2 New pure modules (`sources/supabase/functions/stock-report/`)

None of these may import `jsr:` / `npm:` specifiers or `index.ts` (Vitest loads them).
Signatures are fixed by the stub files already in the tree; keep them exactly.

**`discordUrl.ts`** — also imported by the browser, so it imports nothing.
- `isDiscordWebhookUrl(url)`: trims, then true only for
  `https://discord.com/api/webhooks/<17–20 digits>/<20–100 of [A-Za-z0-9_-]>` or the same on
  `discordapp.com`. No port, userinfo, query, fragment, trailing slash, other subdomain, or `http:`.
- `webhookLast4(url)`: last 4 chars of the token of a valid URL; `''` otherwise.

**`discordWebhook.ts`** — `postDiscordWebhook(url, payload, deps?)`, never throws.
- Invalid URL → `{ ok:false, httpStatus:null, reason:'invalid-url' }`, no fetch.
- `POST <trimmed url>?wait=true`, `Content-Type: application/json`, body `JSON.stringify(payload)`,
  `signal: AbortSignal.timeout(10_000)`.
- 2xx → `{ ok:true, httpStatus }`.
- 429 → wait `retry_after` seconds from the JSON body, else the `Retry-After` header (seconds),
  else 1 s; `ms = min(ceil(sec*1000), MAX_RETRY_AFTER_MS)`; `await sleep(ms)`; retry **once**.
  A second 429 → `reason:'rate-limited'`; any other second response is classified normally.
- 401 or 404 → `reason:'webhook-gone'`, no retry. Other non-2xx → `reason:'http-error'`.
- fetch rejects (incl. timeout) → `{ ok:false, httpStatus:null, reason:'network' }`, no retry.
- The result never carries the URL, the token, a response body, or an error message.

**`marketMargin.ts`** — `marginSummaryUrl(ymd)` (`YYYYMMDD` in) and
`extractMarketMarginTotals(resp)`:
- `null` unless `stat === 'OK'` and `date` is 8 digits.
- Finds the table whose `fields[0]` (whitespace-trimmed) is `項目` **and** `fields[4] === '前日餘額'`
  **and** `fields[5] === '今日餘額'`; otherwise `null` (format change guard).
- Rows by exact trimmed label in column 0: `融資(交易單位)`, `融券(交易單位)`, `融資金額(仟元)`.
  All three must exist, else `null`. Values by index 4 (prev) and 5 (today) via `normNum`
  (`twChips.ts:35`). `change = today − prev` when both are numbers, else `null`.
- `date` output is `YYYY-MM-DD`.

**`globalIndexClose.ts`** — `SUMMARY_INDICES` (order and labels fixed in the stub),
`indexChartUrl(symbol)`, `lastCompletedClose(resp, nowSec)`:
- Pair `timestamp[i]` with `indicators.quote[0].close[i]`; drop pairs whose timestamp or close is missing,
  null, or not finite; **sort the remaining pairs by timestamp ascending** before any other step.
- If `meta.currentTradingPeriod.regular` has `start` and `end`, and `nowSec < end`, and the last
  remaining bar's timestamp `>= start`, drop that bar (session still open).
- Result = last remaining bar. `date` = `MM/DD` of `(timestamp + meta.gmtoffset)` read as UTC.
  `changePct = (close − prevClose) / prevClose * 100` using the bar before it; `null` when there is
  no earlier bar or its close is 0. No bars → `null`. Malformed input → `null`, never throws.

**`discordSummary.ts`** — `findMarketDay`, `buildSummaryPayload`, `buildTestPayload`. Formatting
rules (tests pin the exact strings):
- Payload: `username: '盤後總結'`, `allowed_mentions: { parse: [] }`, no `content`, exactly one embed,
  `footer.text = '資料來源：證交所、Yahoo Finance、FRED｜僅供參考，非投資建議'`,
  `timestamp = generatedAt`.
- Title: brief `📊 台股盤後快報 MM/DD(X)`, full `📋 台股盤後完整版 MM/DD(X)`, where `X` is
  `日一二三四五六` of `ymd` (a calendar date; compute with `Date.UTC`, never the host timezone).
- Color: `changePoints > 0` → `0xE5484D` (TW convention: red = up); `< 0` → `0x30A46C`; else `0x8B8D98`.
- Field names and order — brief: `台股大盤`, `三大法人（初步）`, `國際指數（最近收盤）`, `匯率`;
  full: `台股大盤`, `三大法人`, `融資融券`, `國際指數（最近收盤）`, `美國總經`, `匯率`. All `inline:false`.
- Number helpers: thousands separators; minus is ASCII `-`; sign comes from the **rounded** value
  (`+` when > 0, `-` when < 0, none when it rounds to 0). 億 = TWD / 1e8, one decimal.
- 台股大盤 (`taiex` null → `尚未公布`):
  line 1 `加權 45,848.90 ▲337.41 (+0.74%)` — `▼` when negative, `平盤 (0.00%)` when 0;
  pct = `changePoints / (taiex − changePoints) * 100`, two decimals; `changePoints` null → `加權 45,848.90`.
  line 2 `成交 6,759.7 億` (`tradeValueTwd` null → `成交 —`).
- 三大法人 (`institutional` null → `尚未公布`): four lines
  `外資 -179.8億`, `投信 +95.7億`, `自營 -129.7億`, `合計 -213.8億`.
  外資 = `foreignTwd` (same as `TwMarketSection.tsx:81`); 自營 = `dealerSelfTwd + dealerHedgeTwd`
  (null only when both are null; a single null counts as 0); a null amount prints `—`.
- 融資融券 (full only; `margin` null → `尚未公布`): three lines
  `融資 9,248,877 張 (+58,366)`, `融資金額 5,861.7 億 (+39.3億)`, `融券 197,048 張 (-1,004)`.
  融資金額 is 仟元, so 億 = value × 1000 / 1e8. A null change prints `(—)`.
- 國際指數: one line per `SUMMARY_INDICES` entry in order: `日經225 63,923.00 +0.69% 09/16`;
  `quote` null → `日經225 暫無資料`; `changePct` null → no pct token.
- 美國總經 (full only; `macro` null or empty → `暫無資料`): one line per indicator in input order,
  `<label> <prev> → <latest>（<latest.period>）`, where a value prints with at most two decimals and
  no trailing zeros; unit `%` is appended directly (`2.47% → 2.45%`), any other unit after a space
  (`21 千人 → 162 千人`); kind `rate` with `valueLow` prints `3.5–3.75%`; a missing previous prints
  `— → …`; a missing latest prints `<label> 暫無資料`. A point whose `value` is null counts as missing
  (never formatted as 0), for both latest and previous, including kind `rate`.
- 匯率 (`usdTwd` null or `latest` null → `暫無資料`): `USD/TWD 31.773 (+0.056)` using `decimals`;
  `prevClose` null → no parenthesis.
- Every field value ≤ 1024 chars; whole embed ≤ 6000 chars.
- `buildTestPayload(generatedAt)`: same username / allowed_mentions / footer; title
  `🔔 Discord 連線測試`; one field `狀態` = `連線正常，每日總結會發送到這個頻道。`.

**`discordRun.ts`** — orchestration with injected dependencies (no Supabase client inside).

`runDiscordSummary(deps, edition)`:
1. `ymd` = Taipei calendar date of `deps.now()` as `YYYY-MM-DD` (use `taipeiYmd` + `dashDate`, `report.ts:92/122`).
2. `loadMarketFile()` (a rejection counts as `null`) → `findMarketDay` → none:
   `finishSend(ymd, edition, {kind:'skipped', reason:'no-market-day'})`, return it.
   **No** webhook read, claim, fetch, or post.
3. `loadWebhookUrl()` → `null`: `finishSend(… 'no-webhook')`, return it. No claim, no post.
4. `claimSend(ymd, edition)` → `false`: return `{kind:'skipped', reason:'already-sent'}` without
   calling `finishSend` or `post`.
5. In parallel: every `SUMMARY_INDICES` symbol via `loadIndex` → `lastCompletedClose(resp, nowSec)`
   (rejection → `quote: null`); `loadUsdTwd` (rejection → `null`). **Full only:** `loadMacro`
   (rejection → `null`) and `loadMargin(ymd without dashes)` → `extractMarketMarginTotals`, where a
   rejection **or a totals `date` other than `ymd`** → `null`. Brief never calls `loadMacro` / `loadMargin`.
6. `post(url, buildSummaryPayload(...))` with `generatedAt = now().toISOString()`.
7. Outcome `sent` / `failed` → `finishSend(ymd, edition, outcome)`. On `failed`, also
   `log({ level:'warn', message:'discord summary send failed', detail:{ status, code: reason, name: edition } })`.
8. Return the outcome. `claimSend` or `finishSend` throwing propagates (the handler turns it into a 500).

`runWebhookOp(deps, input)` — `input` is the untrusted request body minus `action`:
- Not an object, or `op` not one of `get|set|clear|test` → `{ ok:false, error:'bad-request' }`.
- `get` → status. `set` → `url` must be a string passing `isDiscordWebhookUrl`, else
  `invalid-url` with **no write**; writes the trimmed URL, returns status. `clear` → delete, status.
- `test` → no webhook → `not-configured`, no post. Otherwise `post(url, buildTestPayload(now))`,
  `finishSend(ymd, 'test', outcome)`, returns `{ ok:true, status, test: <DiscordSendResult> }`.
- Status = `{ configured, last4, updatedAt, recent }`, `recent = recentSends(10)`.
  **No result ever contains the URL or the token.**

### 2.3 `index.ts` wiring

- `discord-summary`: `assertCronSecret(req)` first; `body.edition` must be `brief` or `full`, else 400.
  Real deps: `downloadJson<MarketFile>('market/daily.json')`; `app_secrets` row
  `name='discord_webhook_url'`; `claimSend` = insert `discord_send_log {taipei_ymd, edition, status:'claimed'}`
  returning `false` on Postgres `23505` and throwing on any other error; `finishSend` = for `brief`/`full`
  with `sent`/`failed`, update the `claimed` row of that day+edition (`status`, `http_status`, `reason`,
  `updated_at`), otherwise insert a new row; `loadIndex` = `fetchJson(indexChartUrl(s))`;
  `loadUsdTwd` from `fx/twd.json`; `loadMacro` from `macro/us.json`;
  `loadMargin` = `fetchJson(marginSummaryUrl(ymd))`; `post = postDiscordWebhook`;
  `log` = `logEvent(db, { action:'discord-summary', ... })`. Respond 200 with the outcome JSON.
- `discord-webhook`: `await assertAdmin(req)` first; `runWebhookOp` with deps on `app_secrets`
  (upsert on `name`) and `discord_send_log` (latest 10 by `created_at desc`, mapped to `SendLogRow`).
  `bad-request`/`invalid-url` → 400, `not-configured` → 409, ok → 200.
- Neither action is added to `ADMIN_RUN_JOBS` (a "run all" must never post to Discord).
- Nothing logs, returns, or throws the webhook URL.

### 2.4 Schema (`sources/supabase/schema.sql`, the only DDL source)

```sql
CREATE TABLE IF NOT EXISTS app_secrets (
    name TEXT PRIMARY KEY CHECK (name IN ('discord_webhook_url')),
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role (which bypasses RLS) may read or write.
REVOKE ALL ON public.app_secrets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS discord_send_log (
    id BIGSERIAL PRIMARY KEY,
    taipei_ymd TEXT NOT NULL,
    edition TEXT NOT NULL CHECK (edition IN ('brief', 'full', 'test')),
    status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'skipped', 'failed')),
    http_status INT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE discord_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discord_send_log FROM anon, authenticated;
-- One real send per day and edition. `failed` / `skipped` rows do not block a retry.
CREATE UNIQUE INDEX IF NOT EXISTS discord_send_log_once
    ON discord_send_log (taipei_ymd, edition)
    WHERE edition <> 'test' AND status IN ('claimed', 'sent');
```

Two cron jobs, written in the **same shape as `market-data-daily` (`schema.sql:728`)**, placeholders
included, with an unschedule-if-exists guard like the existing jobs:
`discord-summary-brief` `'5 9 * * 1-5'` (Taipei 17:05) body `{"action":"discord-summary","edition":"brief"}`;
`discord-summary-full` `'30 13 * * 1-5'` (Taipei 21:30) body `{"action":"discord-summary","edition":"full"}`.

`sources/supabase/verify.sql`: add `('app_secrets'),('discord_send_log')` to the `want` list at
lines 39–43, and to any other per-table list in that file (e.g. an RLS check) if one exists.

### 2.5 Snapshots (`sources/scripts/lib/snapshotPlan.cjs`, `sources/scripts/snapshot.cjs`)

`snapshot.cjs` dumps **every** public table except `CACHE_TABLES`, so `app_secrets` would be
copied into every snapshot and offsite. Add `SECRET_TABLES = ['public.app_secrets']`, add
`'public.discord_send_log'` to `CACHE_TABLES`, and export
`dataExcludeTables(withCache: boolean): string[]` → `withCache ? SECRET_TABLES : [...CACHE_TABLES, ...SECRET_TABLES]`.
`snapshot.cjs` must use it for the public data dump in **both** modes, so `--with-cache` still
excludes secrets. Restoring a snapshot leaves the webhook unset; that is intended.
`backup-transactions` already uses an explicit table list (`backupPlan.ts:12`); no change.

### 2.6 Admin console

- `sources/src/services/discordWebhook.ts`: `getDiscordWebhookStatus`, `saveDiscordWebhook(url)`,
  `clearDiscordWebhook`, `testDiscordWebhook` → `supabase.functions.invoke('stock-report',
  { body: { action: 'discord-webhook', op, url? }, timeout: 45_000 })` (every invoke carries a timeout —
  `src/services/invokeTimeout.test.ts`; 45 s covers a test send's 10 s post + 10 s back-off + retry).
  `supabase` null (本機模式) → throw
  `本機模式無法設定 Discord`. An invoke error → throw `Discord 設定失敗` plus the HTTP status if
  known — never the URL. Types are declared here (do not import types from `supabase/functions/`
  except `discordUrl.ts`).
- `sources/src/components/Admin/DiscordSection.tsx`, registered in `AdminConsolePage.tsx` `PANELS`
  as `{ id: 'discord', label: 'Discord', icon: MessageSquare }`. Required behaviour (pinned by
  `DiscordSection.test.tsx`):
  - heading `Discord 每日總結`; note `平日 17:05 快報、21:30 完整版；當天沒有台股大盤資料時不送。`
  - status: `已設定（…abcd）` + update time, or `尚未設定`.
  - input `type="password"`, `aria-label="Discord Webhook 網址"`, `autoComplete="off"`, always
    empty after load and after a successful save; button `儲存` disabled while empty.
  - an invalid URL shows `網址格式不正確，需為 https://discord.com/api/webhooks/…` and does **not** call save.
  - `清除` and `測試發送` appear only when configured; `清除` asks `window.confirm('確定要清除 Discord Webhook？')`.
  - test result: `測試訊息已送出` or `發送失敗（<reason text>）`, reason text map:
    `webhook-gone` 網址已失效, `rate-limited` Discord 限流, `http-error` Discord 回應錯誤,
    `network` 連線失敗, `invalid-url` 網址格式不正確, otherwise 未知錯誤.
  - recent sends table, columns `日期 / 類型 / 狀態 / HTTP / 原因`; 類型 `brief` 快報,
    `full` 完整版, `test` 測試; 狀態 `sent` 已送出, `skipped` 略過, `failed` 失敗, `claimed` 處理中.
  - the full webhook URL never appears in the DOM text.
  - **Every rejected service call shows the thrown message verbatim** (e.g. `Discord 設定失敗（HTTP 409）`)
    and changes nothing else: a failed load must not render `尚未設定`; a failed clear keeps the
    current status; a rejected test send (the Edge answers `not-configured` with HTTP 409, which
    supabase-js surfaces as a rejection) shows the message instead of a `發送失敗（…）` line.
  - While any save / clear / test request is in flight, `儲存`, `清除` and `測試發送` are all disabled,
    so a double click sends one request; they re-enable when it settles.
  - Markup follows the class conventions of `AiConnectionSection.tsx` (same admin-console look).

## 3. Files

Exhaustive. Stubs marked (stub) already exist with the fixed signatures; replace their bodies.

- `sources/supabase/functions/stock-report/discordUrl.ts` — **done by the main session; do not edit**
- `sources/supabase/functions/stock-report/discordWebhook.ts` (stub)
- `sources/supabase/functions/stock-report/marketMargin.ts` (stub)
- `sources/supabase/functions/stock-report/globalIndexClose.ts` (stub)
- `sources/supabase/functions/stock-report/discordSummary.ts` (stub)
- `sources/supabase/functions/stock-report/discordRun.ts` (stub)
- `sources/supabase/functions/stock-report/index.ts`
- `sources/supabase/schema.sql`
- `sources/supabase/verify.sql`
- `sources/scripts/lib/snapshotPlan.cjs`
- `sources/scripts/snapshot.cjs`
- `sources/src/services/discordWebhook.ts` (stub)
- `sources/src/components/Admin/DiscordSection.tsx` (stub)
- `sources/src/components/Admin/AdminConsolePage.tsx`

## 4. Verify

From `sources/`, all must pass:

```bash
npm test
npm run build
npm run typecheck:edge
```

Nothing is deployed and no Supabase DDL is applied as part of this task (see §6).

## 5. Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| Valid discord.com / discordapp.com URL, surrounding spaces | true; last4 = token tail | unit `discordUrl.test.ts` |
| http, other host, subdomain, port, query, fragment, trailing slash, short id, bad token chars | false; last4 `''` | unit `discordUrl.test.ts` |
| 204 / 200 | ok with status; URL gets `?wait=true`; JSON body; POST | unit `discordWebhook.test.ts` |
| 429 (body `retry_after`) then 204 | sleep(ms) once, ok | unit `discordWebhook.test.ts` |
| 429 with header only; 429 over cap | header used; sleep capped at 10 000 | unit `discordWebhook.test.ts` |
| 429 twice | `rate-limited`, 2 fetches | unit `discordWebhook.test.ts` |
| 404 / 401 | `webhook-gone`, 1 fetch | unit `discordWebhook.test.ts` |
| 500 | `http-error` | unit `discordWebhook.test.ts` |
| fetch rejects | `network`, never throws | unit `discordWebhook.test.ts` |
| invalid URL | `invalid-url`, no fetch | unit `discordWebhook.test.ts` |
| any result | serialized result never contains the token | unit `discordWebhook.test.ts` |
| Real 2026-09-16 MS response | exact totals and changes | unit `marketMargin.test.ts` |
| "沒有符合條件的資料"; header changed; row missing; empty `{}` | null | unit `marketMargin.test.ts` |
| Real ^N225 mid-session | partial bar dropped → 63,923 on 09/16, +0.69% | unit `globalIndexClose.test.ts` |
| Same, after session end | today's bar kept → 09/17 | unit `globalIndexClose.test.ts` |
| Real ^GSPC before open | last bar kept → 09/16, -0.45% | unit `globalIndexClose.test.ts` |
| null closes, single bar, empty/malformed | skipped / pct null / null | unit `globalIndexClose.test.ts` |
| `SUMMARY_INDICES` | exactly the 8 symbols in order | unit `globalIndexClose.test.ts` |
| Brief with real 2026-09-16 data | title, color, 4 fields, exact lines | unit `discordSummary.test.ts` |
| Full with real data + margin + macro | 6 fields, exact lines | unit `discordSummary.test.ts` |
| Missing institutional / margin / index / fx / macro / taiex | `尚未公布` / `暫無資料` | unit `discordSummary.test.ts` |
| Brief given margin + macro | they are not rendered | unit `discordSummary.test.ts` |
| Any payload | `allowed_mentions.parse` empty, limits respected | unit `discordSummary.test.ts` |
| No market day | skipped, no url read / claim / post | unit `discordRun.test.ts` |
| No webhook | skipped, no claim / post | unit `discordRun.test.ts` |
| Claim refused | `already-sent`, no post, no finish | unit `discordRun.test.ts` |
| Brief success | sent; macro / margin loaders not called; finish recorded | unit `discordRun.test.ts` |
| Full, margin dated another day | 融資融券 = 尚未公布 | unit `discordRun.test.ts` |
| Index loader rejects for one symbol | that line 暫無資料, still sent | unit `discordRun.test.ts` |
| Post fails | failed + warn log without URL | unit `discordRun.test.ts` |
| Webhook op: bad input / invalid set / valid set / get / clear / test / test unconfigured | per §2.2; no result contains the URL | unit `discordRun.test.ts` |
| Snapshot exclusions | secrets excluded in both modes; send log is cache | unit `scripts/lib/snapshotPlan.test.mjs` |
| Service: invoke body; local mode; error text has no URL | per §2.6 | unit `src/services/discordWebhook.test.ts` |
| Admin section behaviour | per §2.6 | integration `DiscordSection.test.tsx` (jsdom) |

## 6. Non-goals

- No per-user data, no holdings, no watchlist (Phase 2).
- No Discord bot, DMs, or silenced messages.
- No holiday calendar; no persisting margin totals or index quotes.
- Not added to `ADMIN_RUN_JOBS`; no change to `generate-chips`, `sync-market`, or probes.
- No deploy, no DDL on DEV/PROD, no `CRON_SECRET` handling — applying §2.4 to DEV is a separate,
  user-approved step (`supabase-ops`: clone the command of an existing job with
  `replace(command, '"action":"probe"', …)` so the secret is never read).
- No change to `app_settings` or to RISK-013.
