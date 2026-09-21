# Spec — Per-account 經濟快報 preview send (Task 165, step 2h)

- Agent: Claude
- Status: APPROVED (user, 2026-09-21)
- Timestamp: 2026-09-21 Asia/Taipei
- Follows: `discord-user-self-service.md`, `discord-admin-slim.md`

## 1. Goal

個人持股報告 has two buttons: 「測試持股報告連線」 sends a fixed test message, 「完整推送測試」
sends the real card. 經濟快報 has only the first. An account therefore cannot verify that the
real 經濟快報 arrives in its own channel, or see what it will look like.

Give 經濟快報 the same second step, one button per edition, because an account now sets a
separate time for 快報 and for 完整版 and may want to check each.

## 2. A defect this feature would otherwise make worse

`finishDiscordMyMarket` (`index.ts:4608`) logs `kind: 'market'`. The daily manual-send quota
counts `kind IN ('test','preview')` only (`countHoldingsManualToday`, `index.ts:4485-4493`).
**So `test-market`'s quota check reads a counter its own writes never increment — the
`MANUAL_SENDS_PER_DAY = 10` limit has never applied to 經濟快報.** Adding an unbounded
*real-content* send on top of that is not acceptable, so the quota is fixed here.

`schema.sql`'s comment on the `kind` CHECK already claims nothing writes `'market'` any more.
After this change that is true.

## 3. Decisions

| # | Decision |
| - | -------- |
| D1 | **New op `preview-market`**, taking `{ edition: 'brief' \| 'full' }`. Builds the real edition and posts it to **the account's own** webhook. |
| D2 | **One implementation of "gather + build a preview".** The admin path (`runWebhookOp`'s `preview` branch) already does this inline. Extract it to an exported `buildMarketPreview` in `discordRun.ts` and make both callers use it. This removes a duplicate rather than adding one. |
| D3 | **`finishMarket` takes a `kind`.** `finishDiscordMyMarket(userId, ymd, kind, outcome)` with `kind: 'test' \| 'preview'`; `test-market` passes `'test'`, `preview-market` passes `'preview'`. Nothing writes `'market'` any more. The 10-per-day quota is then shared by all four manual buttons on the page, which is what the holdings side already assumes. |
| D4 | **Not gated on `market_enabled`.** A paused account must still be able to test, exactly as `test-market` already allows. Gating a test button on the switch it is used to verify is how step 2e's R8 went wrong. |
| D5 | **No confirmation dialog.** The message goes to the account's own channel, not the shared one. `preview-holdings` has no dialog for the same reason; the admin console's global preview keeps its dialog because that one is seen by every channel member. |
| D6 | **The `【預覽】` marker stays.** `buildMarketPreview` keeps the existing `content.replace(/^## /, '## 【預覽】')`, so a preview is never mistaken for the real scheduled post. |
| D7 | **Non-market-day fallback stays.** `findMarketDay(file, today) ?? latestMarketDay(file)` — a manual test must work on a weekend. Only an entirely empty file yields `no-market-data`. |

## 4. `discordRun.ts`

Extract from `runWebhookOp`'s `op === 'preview'` branch, unchanged in behaviour:

```ts
export interface MarketPreview {
  payload: DiscordPayload
  /** The market day the payload describes (may be older than today — D7). */
  ymd: string
  /** Today in Taipei, which is what the send log is keyed by. */
  todayYmd: string
}

/** `null` when the market file holds no usable day at all. */
export async function buildMarketPreview(
  deps: GatherDeps & Pick<SummaryDeps, 'now' | 'loadMarketFile'>,
  edition: SummaryEdition,
): Promise<MarketPreview | null>
```

`runWebhookOp`'s preview branch then becomes: call `buildMarketPreview`, map `null` to
`no-market-data`, post to `stored.url`, and keep its existing `finishSend(todayYmd, 'test', outcome)`
and `recentSends(10)` calls exactly as they are. **The admin path's observable behaviour does not
change**; its tests must keep passing untouched.

`latestMarketDay` stays module-private — only `buildMarketPreview` uses it.

## 5. `discordMySettings.ts`

`MySettingsDeps` gains the four gather loaders, so the module can build an edition:

```ts
export interface MySettingsDeps extends HoldingsSettingsDeps, GatherDeps {
  // …existing members, with one signature change:
  finishMarket: (userId: string, ymd: string, kind: 'test' | 'preview', outcome: HoldingsOutcome) => Promise<void>
}
```

`loadMarketFile` is already supplied by `HoldingsSettingsDeps`; `now` and `post` likewise.

New op, in this exact order — every failure must return **before** anything is posted:

```
op === 'preview-market'
  1. edition not 'brief'|'full'                    -> { ok: false, error: 'bad-request' }
  2. readMarket(userId).webhookUrl == null          -> { ok: false, error: 'not-configured' }
  3. countManualToday(userId, todayYmd) >= MANUAL_SENDS_PER_DAY
                                                    -> { ok: false, error: 'quota' }
  4. buildMarketPreview(deps, edition) == null      -> { ok: false, error: 'no-market-data' }
  5. post(row.webhookUrl, preview.payload)
  6. finishMarket(userId, preview.todayYmd, 'preview', outcome)
  7. { ok: true, status: await fullStatus(...), send: result, previewYmd: preview.ymd }
```

`test-market` changes in one place only: its `finishMarket` call gains `'test'`.

`MySettingsResult`'s error union already lists `'no-market-data'`; no new error code.

## 6. `index.ts`

- `finishDiscordMyMarket` takes `kind: 'test' | 'preview'` and inserts it instead of the literal
  `'market'`.
- `handleDiscordMySettings`'s deps object gains `loadIndex`, `loadUsdTwd`, `loadMacro`,
  `loadMargin` — copy the four expressions verbatim from `handleDiscordAccountTick`
  (`index.ts:4281-4284`), which already wires the same four.
- The HTTP status mapping for `result.error` must treat `'no-market-data'` the same way the
  admin path does; check what `handleDiscordWebhook` returns for it and match.

## 7. Frontend

`src/services/discordMySettings.ts` — one new export, modelled on `previewMyHoldingsReport`
(90 s timeout, its own literal, because `invokeTimeout.test.ts` scans for a literal):

```ts
export async function previewMyMarketSummary(edition: 'brief' | 'full'): Promise<DiscordMySettingsResult>
```

`src/components/Settings/DiscordMySettings.tsx` — inside the 經濟快報 block's `.ai-actions`, after
the existing 「測試經濟快報連線」 button and under the same `marketUrlStored` guard, two buttons:

- `預覽快報` → `previewMyMarketSummary('brief')`
- `預覽完整版` → `previewMyMarketSummary('full')`

Both share `marketBusy`, take no confirmation dialog (D5), and on success set
`已送出經濟快報預覽（快報，資料日 YYYY-MM-DD）` / `（完整版，…）` from `previewYmd`; on a failed send
they fall back to `sendResultText(next.send)`, exactly as `handleHoldingsPreview` does.

No CSS change: `.ai-actions` already wraps.

## 8. Test charter

| Case | Expected | Layer / file |
| ---- | ---- | ---- |
| `preview-market` with a missing or bad `edition` | `bad-request`, `post` never called | `discordMySettings.test.ts` |
| no market webhook stored | `not-configured`, `post` never called | same |
| `countManualToday` at the cap | `quota`, `post` never called | same |
| market file with no usable day | `no-market-data`, `post` never called | same |
| happy path, `brief` | posts once, to the **account's** URL and not the global one; `finishMarket` called with `'preview'`; `previewYmd` is the market day | same |
| happy path, `full` | the `full` edition reaches the builder | same |
| payload carries the `【預覽】` marker | content starts `## 【預覽】` | same |
| post fails | `send.ok` false, `finishMarket` outcome `failed`, still `ok: true` | same |
| `market_enabled` false | still sends (D4) | same |
| `test-market` | `finishMarket` called with `'test'` — the quota regression guard | same |
| admin `preview` op | unchanged behaviour after the D2 extraction | `discordRun.test.ts` (existing, untouched) |
| `buildMarketPreview` on a non-market day | falls back to the latest day in the file | `discordRun.test.ts` |
| the two buttons appear only when a market webhook is stored | absent otherwise | `DiscordMySettings.test.tsx` |
| clicking 預覽快報 | calls the service with `'brief'` and reports the data date | same |

## 9. Verify

From `sources/`:

```
npx vitest run
npm run build
npm run lint
npm run typecheck:edge
```

## 10. Out of scope

- Any schema, cron or Edge action change beyond the new `op`. `'test'` and `'preview'` are
  already allowed by `user_discord_send_log_kind_check`.
- The admin console's global preview buttons and their dialog.
- Changing `MANUAL_SENDS_PER_DAY`, or giving 經濟快報 a quota separate from 持股.
- Backfilling or rewriting existing `kind = 'market'` rows.
