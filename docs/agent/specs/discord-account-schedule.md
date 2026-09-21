# Spec — Per-account Discord send times (Task 165, step 2f)

- Agent: Claude
- Status: DRAFT
- Timestamp: 2026-09-20 Asia/Taipei
- Follows: `discord-user-self-service.md` §Revision 1 R6, which deferred this.

## 1. Goal

Let every account choose when its own Discord messages arrive, instead of everybody sharing the
admin's two times. The admin's schedule stays, and becomes the default that an account inherits.

## 2. Why the current model cannot do it

Today the schedule *is* three `pg_cron` jobs, altered in place by `discord_schedule_set`. One job =
one time for everyone. Per-account times therefore need a different shape: one job that fires often
and asks who is due.

## 3. Decisions

| # | Decision |
| - | -------- |
| D1 | **One 30-minute tick.** A new cron job `discord-account-tick` runs `0,30 9-15 * * 1-5` UTC (Taipei 17:00–23:30) and performs every per-account send. |
| D2 | **Three nullable time columns**, one per control, each `NULL` = inherit: `market_brief_time`, `market_full_time`, `holdings_time`. Each drop-down lives in the block it belongs to — 經濟快報 has two editions, 個人持股 has one. |
| D3 | **The global schedule is the inherited default.** `market_brief_time`/`holdings_time` inherit the global brief time; `market_full_time` inherits the global full time. |
| D4 | **Per-account copies leave the summary jobs.** `runDiscordSummary` posts to the global webhook only; `sendMarketOverrides` moves into the tick. |
| D5 | **`discord-holdings-daily` is retired.** Its work is the tick's. `discord_schedule_set` then alters two jobs, and `holdingsAligned` disappears from the schedule view. |
| D6 | **Content is built at the account's own time**, not copied from the global post. An account that picks 22:30 gets the 完整版 built from 22:30 data, which may differ slightly from the 21:30 global post. This is intended — you get the market as of the time you chose — but it means the per-account message is no longer byte-identical to the global one. |
| D7 | **Same windows as the admin's**, re-validated server-side: brief/holdings 17:30–20:30, full 21:00–23:30, half-hour steps. The browser's choice is never trusted. |

## 4. Schema

`user_discord_settings`, in a `DO $$ ... IF NOT EXISTS (information_schema.columns ...)` block per
column so a re-apply cannot overwrite a user's choice:

```sql
ALTER TABLE user_discord_settings ADD COLUMN IF NOT EXISTS market_brief_time TEXT;
ALTER TABLE user_discord_settings ADD COLUMN IF NOT EXISTS market_full_time  TEXT;
ALTER TABLE user_discord_settings ADD COLUMN IF NOT EXISTS holdings_time     TEXT;
ALTER TABLE user_discord_settings DROP CONSTRAINT IF EXISTS user_discord_settings_times_check;
ALTER TABLE user_discord_settings ADD CONSTRAINT user_discord_settings_times_check CHECK (
  (market_brief_time IS NULL OR market_brief_time ~ '^[0-2][0-9]:[0-5][0-9]$') AND
  (market_full_time  IS NULL OR market_full_time  ~ '^[0-2][0-9]:[0-5][0-9]$') AND
  (holdings_time     IS NULL OR holdings_time     ~ '^[0-2][0-9]:[0-5][0-9]$')
);
```

The CHECK guards the **shape** only. The allowed window is enforced in the Edge Function, next to
the same `SCHEDULE_OPTIONS` the admin path uses, so there is one window definition.

`user_discord_send_log` — the two market editions must be told apart, or the tick cannot know which
one it already sent:

```sql
ALTER TABLE user_discord_send_log DROP CONSTRAINT IF EXISTS user_discord_send_log_kind_check;
ALTER TABLE user_discord_send_log ADD CONSTRAINT user_discord_send_log_kind_check
    CHECK (kind IN ('daily', 'preview', 'test', 'market', 'market-brief', 'market-full'));

CREATE UNIQUE INDEX IF NOT EXISTS user_discord_send_log_market_brief_once
    ON user_discord_send_log (user_id, taipei_ymd)
    WHERE kind = 'market-brief' AND status IN ('claimed', 'sent');
CREATE UNIQUE INDEX IF NOT EXISTS user_discord_send_log_market_full_once
    ON user_discord_send_log (user_id, taipei_ymd)
    WHERE kind = 'market-full' AND status IN ('claimed', 'sent');
```

`'market'` stays in the CHECK for the rows already written; nothing writes it any more.

**These indexes are the exactly-once guard and they are new work, not a rename.** Today
`finishDiscordMarketOverride` *inserts* a finished row with no prior claim, because the summary job
ran once a day and could not race itself. A tick that fires every 30 minutes can, so the tick must
**claim first, then update** — the same shape as `claimHoldingsDaily` + `finish`.

## 5. Edge

### 5.1 New module `accountTick.ts`

```ts
export interface AccountRow {
  userId: string
  marketWebhookUrl: string | null
  marketEnabled: boolean
  marketBriefTime: string | null
  marketFullTime: string | null
  holdingsWebhookUrl: string | null
  holdingsEnabled: boolean
  holdingsTime: string | null
}

export interface GlobalSchedule { brief: string | null; full: string | null }

export interface DueStreams { marketBrief: boolean; marketFull: boolean; holdings: boolean }

/** Pure. `hhmm` is Taipei wall-clock, already rounded to the half hour by the caller. */
export function dueAt(hhmm: string, global: GlobalSchedule, row: AccountRow): DueStreams
```

`dueAt` is the whole inherit rule in one testable function:

- `marketBrief` — `marketEnabled && marketWebhookUrl !== null && (marketBriefTime ?? global.brief) === hhmm`
- `marketFull` — same with `marketFullTime ?? global.full`
- `holdings` — `holdingsEnabled && holdingsWebhookUrl !== null && (holdingsTime ?? global.brief) === hhmm`

A `null` on both sides must never count as due: if the global time is unknown (`null`, i.e. the cron
job is missing) an inheriting account is **not** due, rather than due at every tick.

```ts
export async function runAccountTick(deps: TickDeps): Promise<TickResult>
```

Per tick: resolve `ymd` and `hhmm` from `deps.now()`, skip entirely when the day is not a market day
(same `findMarketDay` test the other runs use), list accounts, and for each due stream claim → send →
finish. Market payloads are built **once per edition per tick** and shared by every account due at
that minute. Honours a time budget like `runHoldingsDaily` does and reports `leftOver`.

### 5.2 Shared builders, not copies

- `discordRun.ts` exports the gather+build step so the tick produces an edition payload without a
  second implementation of it.
- `holdingsRun.ts` exports its per-user send step for the same reason.
- `groupMarketTargets` keeps its job: accounts due at the same minute that share a URL get one post.

### 5.3 Action

`discord-account-tick`, gated by `assertCronSecret`, in the same shape as `discord-holdings`.

### 5.4 Self-service ops

`discord-my-settings` gains `set-times` carrying `{ marketBriefTime, marketFullTime, holdingsTime }`,
each `string | null`. Each value is validated against `SCHEDULE_OPTIONS` for its slot and rejected
with `invalid-time` otherwise. `MySettingsStatus` reports the three stored values plus the resolved
`globalSchedule`, so the page can label the inherit option with the actual inherited time.

## 6. Cron

```sql
SELECT cron.schedule('discord-account-tick', '0,30 9-15 * * 1-5', $$ ... "action":"discord-account-tick" ... $$);
SELECT cron.unschedule('discord-holdings-daily');
```

`discord_schedule_set` alters `discord-summary-brief` and `discord-summary-full` only.

## 7. Frontend

- 經濟快報 block: two drop-downs, 「快報發送時間」 and 「完整版發送時間」, each with a first option
  `跟隨全域（HH:MM）`. Shown only when the account has its own webhook — with no own channel there is
  nothing to time.
- 個人持股 block: one drop-down 「發送時間」, shown only when a holdings webhook is stored.
- The admin console's schedule block keeps its two drop-downs, relabelled: the brief time now also
  states that it is the default for accounts that inherit. `holdingsAligned` and its warning go.

## 8. Test charter

| Case | Expected | Layer |
| ---- | ---- | ---- |
| inherit, global brief = tick time | `marketBrief` due | `accountTick.test.ts` |
| custom time = tick time, global differs | due | same |
| custom time ≠ tick time | not due | same |
| global brief `null`, account inherits | **not** due | same |
| market webhook null but time matches | not due | same |
| `marketEnabled` false, time matches | not due | same |
| holdings inherits the **brief** time, not full | due at brief time only | same |
| two accounts, same URL, same minute | one post, two log rows | `accountTick.test.ts` |
| claim returns false (already sent) | no post for that stream | same |
| not a market day | nothing sent, result says so | same |
| budget exceeded | stops, reports `leftOver` | same |
| `set-times` with a time outside the window | `invalid-time`, nothing written | `discordMySettings.test.ts` |
| `set-times` with `null` | stores `null` (inherit) | same |
| `runDiscordSummary` | posts to the global webhook only, never a per-account copy | `discordRunMarket.test.ts` |

## 9. Verify

```
npx vitest run ; npm run build ; npm run lint ; npm run typecheck:edge
```

## 10. Out of scope

- Changing the windows, or allowing per-minute precision.
- Any per-account schedule for the global channel itself.
