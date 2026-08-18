# Spec: TWSE TWT38U Foreign Investors Top 50 Net Buy/Sell

- Task: 113
- Status: REVISED / READY TO BUILD (supersedes the 2026-08-17 PROPOSED draft)
- Lane: 2 (Edge Function + external API + background job)
- Version target: `0.7.19-dev.N` on `dev`
- Timestamp: 2026-08-18 Asia/Taipei

## 0. What changed against the PROPOSED draft, and why

Measured evidence, 16 trading days (`20251114` … `20260817`), comparing the live `T86` and
`TWT38U` endpoints:

| Finding | Measurement |
| --- | --- |
| `T86` and `TWT38U` report the same numbers | 0 value mismatches across all shared tickers on all 16 days, on all three legs (`不含自營商`, `外資自營商`, `合計`) |
| Deriving the ranking from the cached `T86` is **not** equivalent | 4 of 16 days differ, always because `selectType=ALLBUT0999` excludes warrants that TWT38U ranks (e.g. `063787`, `052786`, `074675`) |
| `selectType=ALL` would match exactly but costs 10x | 1.98 MB / 15,389 rows vs 194 KB |
| TWT38U is the cheapest exact source | **146 KB**, smaller than the T86 the pipeline already fetches |

Decisions taken:

1. **Fetch TWT38U.** Exact, and cheaper than either alternative.
2. **Run it inside `generate-chips`. No new action, no new probe source, no cron change.**
   This is the decisive point for correctness, not just for cost — see §4.
3. **Do not trust the upstream sort order.** The PROPOSED draft's §2.3 ("take the first 50
   rows") holds structurally today, but relying on it turns an upstream change into silent
   wrong data instead of an error. The parser sorts locally.
4. **No dated archive.** The draft's `market/foreign_top50_{YYYYMMDD}.json` had no retention
   policy and no reader. House convention is a single latest object (`market/daily.json`).
5. The draft's `sync-foreign-top` action, `twt38u` probe source, `ProbeWarRoom` 8th card and
   `MechanismGuide` entry are all **dropped**. `sourceProbePlan.ts` and every Admin file are
   untouched; the probe suite stays at 7 sources and the `7 大來源` copy and its three
   assertions in `MechanismGuide.test.tsx` stay valid.

## 1. Goal

Publish the TWSE **外資及陸資買賣超 TOP 50**（買超 / 賣超）as a snapshot object refreshed by the
existing chips pipeline, and render it under **總體經濟 > 台股**.

## 2. Upstream contract

- **URL**: `https://www.twse.com.tw/rwd/zh/fund/TWT38U?date={YYYYMMDD}&response=json`
- **Publication**: trading days, from ~16:00 Taipei.
- **Payload**: ~146 KB, ~1,300–1,430 rows.
- **Shape**: top-level `{ stat, date, title, fields, data, notes, groups, hints, total }`.
  There is **no `tables` wrapper** — unlike the T86 variant handling in `twChips.ts`.

### 2.1 Column mapping (12 columns, verified against `20260817`)

| Index | Meaning | Notes |
| :--- | :--- | :--- |
| `0` | 鉅額交易註記 | `'*'` when present, otherwise a **single space** `' '` — not an empty string |
| `1` | 證券代號 | **space-padded**, e.g. `"6770  "`, `"00403A"` |
| `2` | 證券名稱 | **space-padded**, e.g. `"力積電          "` |
| `3,4,5` | 外資及陸資(不含自營商) 買進 / 賣出 / 買賣超 | shares, comma-formatted |
| `6,7,8` | 外資自營商 買進 / 賣出 / 買賣超 | shares, comma-formatted |
| `9,10,11` | **外資及陸資合計** 買進 / 賣出 / 買賣超 | shares, comma-formatted |

**Ranking metric is column `11` (合計)** — the quantity the table is named after. Columns
`3..5` are not stored; add them only if a later task needs them.

### 2.2 Traps that must be handled

- `.trim()` every ticker and name. Unfiltered, `"6770  "` matches nothing.
- Numbers carry thousands separators; strip `,` before `Number()`.
- Rows with `net === 0` belong to **neither** list (36 such rows on `20260817`).
- Do **not** assume the file is pre-sorted. Sort locally.

## 3. Contract

### 3.1 New module `twForeignTop.ts` (pure, no network, no Deno APIs)

```ts
export const FOREIGN_TOP_SCHEMA = 1
export const FOREIGN_TOP_LIMIT = 50

export function twt38uUrl(ymd: string): string

export interface Twt38uResponse {
  stat?: string
  date?: string
  fields?: string[]
  data?: string[][]
}

export interface ForeignTopItem {
  ticker: string   // trimmed
  name: string     // trimmed
  buy: number      // shares, column 9
  sell: number     // shares, column 10
  net: number      // shares, column 11
  block: boolean   // column 0 === '*'
}

export interface ForeignTopParsed {
  rawDate: string           // YYYYMMDD, from resp.date
  date: string              // YYYY-MM-DD, derived
  buyTop: ForeignTopItem[]  // net > 0, descending, at most FOREIGN_TOP_LIMIT
  sellTop: ForeignTopItem[] // net < 0, ascending (most negative first), at most FOREIGN_TOP_LIMIT
}

/** null when stat !== 'OK', when data is missing/empty, or when resp.date is not 8 digits. */
export function parseForeignTop(resp: Twt38uResponse, limit?: number): ForeignTopParsed | null

/** Content fingerprint over the ranked rows. Cells joined with U+001F (see AUDIT-04). */
export function foreignTopFingerprint(p: ForeignTopParsed): string
```

Sorting contract:
- `buyTop`: `net` descending; ties broken by `ticker` ascending (string compare).
- `sellTop`: `net` ascending; ties broken by `ticker` ascending.
- Determinism is required — the upload-skip in §4.2 depends on it.

### 3.2 Stored object `market/foreign_top50.json`

```ts
export interface ForeignTopFile {
  schema: number   // FOREIGN_TOP_SCHEMA
  asOf: string     // ISO, when this snapshot was written
  date: string     // YYYY-MM-DD
  rawDate: string  // YYYYMMDD
  fingerprint: string
  buyTop: ForeignTopItem[]
  sellTop: ForeignTopItem[]
}
```

### 3.3 What must NOT change

- `sourceProbePlan.ts` in any way — no new source, no new follow-up, no window change.
- Any file under `sources/src/components/Admin/`.
- `t86` behaviour, `T86_STABLE_POLLS`, `nextT86State`, `refreshT86Ymd`, `runSignature`,
  `regenerate`, or anything that decides whether per-ticker reports are rebuilt.
- The `reports` bucket name and the `uploadJson` / `downloadJson` helpers.
- `schema.sql`, `batch_run_log` columns, and every cron job.

## 4. Why `generate-chips` is the right host

The user's question during review was: the probe retires a source after 3 landed hits — can it
retire before the upstream data is final? For a **standalone** action the answer is yes.
Landing is judged per round and retirement counts landed rounds, so a source retires three
rounds after the data first *appears*, not after it stops *changing*; once retired, nothing
re-reads that endpoint for the rest of the day.

`generate-chips` does not have that hole, because three separate probe sources trigger it:

| Source | Window | Follow-up |
| --- | --- | --- |
| `t86` | 16:00–17:00 | `generate-chips` |
| `margin` | 20:30–22:30 | `generate-chips` |
| `borrow` | 21:00–23:30 | `generate-chips` |

So the phase runs repeatedly from 16:00 until late evening, and each run re-fetches TWT38U and
overwrites the snapshot — last write wins. An upstream revision at any point in the afternoon
or evening is picked up without any new stability machinery. This is strictly stronger than the
PROPOSED draft's 17:00 standalone action, and it is why no fingerprint-stability counter is
needed here.

Accepted limitation: once `pollPlan.shouldSkip` short-circuits the phase for the day
(`t86Frozen` **and** `borrowLanded` **and** margin present), TWT38U stops refreshing too. That
point is reached late evening, hours after publication.

## 5. `index.ts` changes

| Anchor | Change |
| --- | --- |
| import block beside `./twMarket.ts` (l.120) | import `FOREIGN_TOP_SCHEMA`, `parseForeignTop`, `foreignTopFingerprint`, `twt38uUrl`, `type ForeignTopFile` from `./twForeignTop.ts` |
| beside `syncMarket` (l.1521) | add `async function syncForeignTop(ymd: string): Promise<{ synced: boolean; rawDate: string \| null; reason: string \| null }>` |
| `runGeneratePhaseChips` (l.2744) | call it inside the **non-skipped `else` branch**, after the `if (regenerate) {…}` block closes and before that branch ends; put the result in the phase's returned summary |

`syncForeignTop(ymd)` behaviour:

1. Fetch `twt38uUrl(ymd)` with **`fetchRwdJson`** (10 s timeout, returns `null` instead of
   throwing) — not `fetchJson`, which throws and has no timeout.
2. `parseForeignTop(...)`. On `null`, return `{ synced: false, rawDate: null, reason: 'empty' }`
   and **write nothing** — never overwrite a good snapshot with an empty one. A non-trading day
   and a not-yet-published table both land here, and both must be no-ops.
3. `downloadJson<ForeignTopFile>('market/foreign_top50.json')` for the previous snapshot.
4. Compute the fingerprint. If the previous snapshot has the same `rawDate` **and** the same
   `fingerprint`, skip the upload and return `{ synced: false, rawDate, reason: 'unchanged' }`.
   (Same reasoning as the existing T86 cache write-skip at `loadT86`: do not spend an UPSERT and
   a dead tuple to rewrite identical bytes.)
5. Otherwise `uploadJson('market/foreign_top50.json', file)` and return `{ synced: true, rawDate,
   reason: null }`.

`syncForeignTop` must not throw. Any failure degrades to `synced: false`; the chips phase must
never fail because a market-wide ranking could not be fetched.

## 6. Frontend

### 6.1 `sources/src/services/foreignTopProxy.ts`

Mirror `marketProxy.ts`: `fetchForeignTop(): Promise<ForeignTopData | null>` via
`downloadReportsJson<ForeignTopFile>('market/foreign_top50.json')`, reject a payload whose
`schema` is below `MIN_FOREIGN_TOP_SCHEMA = 1`, and drop malformed items.

Exported type, pinned by `ForeignTopSection.test.tsx`:

```ts
export interface ForeignTopItem {
  ticker: string
  name: string
  buy: number
  sell: number
  net: number
  block: boolean
}

export interface ForeignTopData {
  date: string   // YYYY-MM-DD
  asOf: string   // ISO
  buyTop: ForeignTopItem[]
  sellTop: ForeignTopItem[]
}
```

### 6.2 `sources/src/components/Macro/ForeignTopSection.tsx`

`export function ForeignTopSection(): JSX.Element` — **takes no props and fetches its own data**
in a `useEffect` via `fetchForeignTop()`. This keeps the edit to `TwMarketSection.tsx` down to one
import plus one `<ForeignTopSection />` line in a file that is already ~800 lines.

Contract pinned by `ForeignTopSection.test.tsx` — these strings are exact:

| Element | Requirement |
| --- | --- |
| Section title | `外資買賣超 TOP 50`, rendered **always**, including the empty state |
| Tabs | `role="tab"`, names `買超 TOP 50` and `賣超 TOP 50`; buy tab selected on first render |
| Unit toggle | `role="button"`, names `張` and `股`; `張` active on first render |
| Lots formatting | `shares / 1000`, exactly one decimal, thousands separators — `1_234_000` renders `1,234.0` |
| Shares formatting | thousands separators — `1_234_000` renders `1,234,000` |
| Block badge | the text `鉅額`, present only on rows with `block: true` |
| Empty state | the text `尚無外資買賣超資料`, and **no** `role="table"` in the document |

Only the active tab's rows may be in the DOM — the test asserts the inactive list's names are
absent, so a CSS-hidden second table will fail.

- Mounted in `TwMarketSection.tsx` **after** the institutional-matrix footer (after l.779),
  reusing the `rpt-section-head` + `table-scroll` conventions already in that file.
- Columns: `#`, 代號, 名稱, 買賣超, 買進, 賣出, and the 鉅額 badge.
- Odd-lot trading makes non-integer lots normal, which is why lots keep one decimal.

## 7. Test charter

| # | Case | Expected outcome | Layer / file |
| --- | --- | --- | --- |
| 1 | Real `20260817` rows parse | ticker/name trimmed, `net` from col 11, commas stripped | `twForeignTop.test.ts` |
| 2 | `block` flag | `'*'` → `true`; `' '` → `false` | `twForeignTop.test.ts` |
| 3 | Upstream rows shuffled | `buyTop`/`sellTop` still correctly ordered | `twForeignTop.test.ts` |
| 4 | `net === 0` rows | excluded from both lists | `twForeignTop.test.ts` |
| 5 | Fewer than 50 positives | returns what exists, no padding, no throw | `twForeignTop.test.ts` |
| 6 | More than 50 | truncated to `FOREIGN_TOP_LIMIT` | `twForeignTop.test.ts` |
| 7 | Equal `net` values | tie-broken by ticker ascending, stable across calls | `twForeignTop.test.ts` |
| 8 | `stat !== 'OK'` / empty `data` / bad `date` | returns `null` | `twForeignTop.test.ts` |
| 9 | `date` conversion | `'20260817'` → `rawDate '20260817'`, `date '2026-08-17'` | `twForeignTop.test.ts` |
| 10 | Fingerprint | changes when one cell changes; cells joined with U+001F so `['12','3']` ≠ `['1','23']` | `twForeignTop.test.ts` |
| 11 | `twt38uUrl` | contains the ymd and `response=json` | `twForeignTop.test.ts` |
| 12 | Section renders both tabs, switches list | buy list then sell list | `ForeignTopSection.test.tsx` |
| 13 | Unit toggle 張/股 | 1,234,000 shares → `1,234.0` 張 | `ForeignTopSection.test.tsx` |
| 14 | Block badge shown only when `block` | badge count matches | `ForeignTopSection.test.tsx` |
| 15 | Null snapshot | empty state, no throw | `ForeignTopSection.test.tsx` |

## 8. Files

Edge (`sources/supabase/functions/stock-report/`):
- `twForeignTop.ts` (new)
- `twForeignTop.test.ts` (new — written by the main session, builder must not touch it)
- `index.ts`

Client (`sources/src/`):
- `services/foreignTopProxy.ts` (new)
- `components/Macro/ForeignTopSection.tsx` (new)
- `components/Macro/ForeignTopSection.test.tsx` (new — main session)
- `components/Macro/TwMarketSection.tsx`

Version sync at ship time (`versioning` skill): `version.ts`, `package.json`,
`package-lock.json`, `README.md`, `docs/agent/CHANGELOG.md`.

## 9. Verify

From `sources/`:

```
npx vitest run supabase/functions/stock-report/twForeignTop.test.ts \
               src/components/Macro/ForeignTopSection.test.tsx
npx tsc -p tsconfig.edge.json
npm run build
npx vitest run
```

Not done until all four pass.

## 10. Non-goals

- No new Edge action, no new probe source, no cron change, no Supabase deploy, no PROD action.
- No change to `sourceProbePlan.ts` or to any Admin component.
- No dated historical archive of the ranking.
- No 上櫃 (TPEX) equivalent.
- Columns `3..5` (不含外資自營商) are not stored.
