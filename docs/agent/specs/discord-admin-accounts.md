# Spec: Discord webhooks managed by the admin, with an adjustable schedule (Task 165 Phase 2 step 2d)

Status: approved by the user 2026-09-18 (sketch in chat). Version target: `0.9.58-dev.4`.
Builds on `discord-daily-summary.md` (Phase 1, deployed) and `discord-holdings.md` (Phase 2,
committed on `dev`, **not deployed** — §14 DDL has never run on DEV or PROD).

## 1. Decisions (from the user)

| # | Decision |
|---|---|
| U1 | The admin console manages every Discord webhook. The per-user "Discord 推播" dialog in the header menu is **removed**, and the per-user Edge action `discord-holdings-settings` is removed with it. |
| U2 | Global webhook (existing `app_secrets.discord_webhook_url`) stays as it is: brief + full edition. |
| U3 | Each account has two settings: **經濟快報** (= the existing *full* edition) and **個人持股報告** (the Phase 2 card). |
| U4 | 經濟快報 per account is **繼承全域** by default (`market_webhook_url IS NULL`). Inherit sends **nothing extra** — the global channel already has it. Only an account with its own URL gets a second copy, at the same run. |
| U5 | 個人持股報告 has **no inherit** (holdings are private and must never reach the shared channel). Default: not configured. |
| U6 | The brief and every holdings card go out **at the same time** (default 17:05). |
| U7 | The admin sets two times with drop-downs: brief+holdings, and full. Weekdays only, Asia/Taipei. |

## 2. Design decisions (main session)

| # | Decision | Why |
|---|---|---|
| D1 | The schedule lives in `pg_cron` itself. Saving calls a `SECURITY DEFINER` SQL function that runs `cron.alter_job(schedule := …)` on the three existing jobs. No tick job, no schedule table. | Exact send time; no new cron job to create (creating one means cloning a command that carries `CRON_SECRET`). Verified on DEV 2026-09-18: pg_cron 1.6.4, `cron.alter_job` exists, every job owner is `postgres`. |
| D2 | Allowed times: brief 17:05–20:55, full 21:00–23:55, minutes in steps of 5. | `fx/twd.json` refreshes at 17:00 (why the brief is 17:05); margin totals publish after ~21:00. The two ranges do not overlap, so brief < full always holds. |
| D3 | No automatic re-send of a failed post (same as today). | A re-send needs per-target idempotency; not asked for. |
| D4 | If the global webhook is not configured, the full edition is skipped (`no-webhook`) **including** every per-account copy. | Per-account copies are an add-on to the global run; keeps the claim model of Phase 1 unchanged. |
| D5 | Per-account copies are grouped by URL: one post per distinct URL; a URL equal to the global URL is not posted again. | U4. |
| D6 | Per-account copies are logged in `user_discord_send_log` with `kind = 'market'`. | The account table shows one "last send" per account. |
| D7 | The admin console has no "預覽今日持股" button. `runHoldingsSettingsOp` keeps `preview`; it is not exposed. | Agreed in the sketch. |

## 3. Contract

### 3.1 `stock-report/discordSchedule.ts` (new, pure; imported by Edge and by the browser)

```ts
export type ScheduleSlot = 'brief' | 'full'
export const DISCORD_SCHEDULE_JOBS = {
  brief: 'discord-summary-brief', holdings: 'discord-holdings-daily', full: 'discord-summary-full',
} as const
export const DEFAULT_DISCORD_SCHEDULE = { brief: '17:05', full: '21:30' } as const
export const SCHEDULE_HOURS: Record<ScheduleSlot, readonly number[]>  // brief [17,18,19,20], full [21,22,23]
export function scheduleMinuteOptions(slot: ScheduleSlot, hour: number): number[]
  // 0,5,…,55; brief hour 17 starts at 5; an hour outside SCHEDULE_HOURS[slot] → []
export function isValidScheduleTime(slot: ScheduleSlot, hhmm: unknown): hhmm is string
  // exactly /^\d{2}:\d{2}$/, hour in SCHEDULE_HOURS[slot], minute in scheduleMinuteOptions(slot, hour)
export function scheduleTimeParts(hhmm: string): { hour: number; minute: number }
export function cronToTaipeiTime(expr: string): string | null
  // only /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/ (minute, UTC hour) → 'HH:MM' at UTC+8; minute > 59,
  // UTC hour > 23 or a Taipei hour past 23 → null
export interface ScheduleView { brief: string | null; full: string | null; holdingsAligned: boolean }
export function scheduleFromJobs(rows: Array<{ jobname: string; schedule: string }>): ScheduleView
  // brief/full from their jobs (missing or unparsable → null); holdingsAligned = the holdings job's
  // time is non-null and equals brief
```

### 3.2 `stock-report/discordTargets.ts` (new, pure)

```ts
export interface MarketOverride { userId: string; url: string }
export interface MarketTarget { url: string; userIds: string[] }
export function groupMarketTargets(globalUrl: string, overrides: MarketOverride[]): MarketTarget[]
  // URLs compared after trim(); a URL equal to the trimmed global URL is dropped; the rest are grouped by URL
  // in order of first appearance; userIds keep input order
```

### 3.3 `runDiscordSummary` (`discordRun.ts`, additive)

Two optional deps on `SummaryDeps`:

```ts
loadMarketOverrides?: () => Promise<MarketOverride[]>
finishMarketOverride?: (userId: string, ymd: string, outcome: RunOutcome) => Promise<void>
```

- Only `edition === 'full'` uses them, and only after the global post and its `finishSend`
  (the global result does not matter: sent or failed).
- Not called when the run ends earlier: `no-market-day`, `no-webhook` (D4), `already-sent`.
- Same payload object as the global post. One `post` per `groupMarketTargets(url, overrides)`
  target; `finishMarketOverride` once per userId of that target with the target's outcome.
- `loadMarketOverrides` rejects → `log` warn `discord market overrides failed`, detail `{}` → no copies.
- A `post` that throws → that target's outcome is `{ kind: 'failed', httpStatus: null, reason: 'network' }`.
  A `finishMarketOverride` that throws → `log` warn and continue. Neither stops the loop.
- A failed copy → `log` warn `discord market override send failed`, detail `{ status, code, users }`
  (`users` = count). Never a URL.
- The returned `RunOutcome` is the global outcome, unchanged.
- Absent deps → behaviour identical to today (every existing test stays green unchanged).

### 3.4 `stock-report/discordAccounts.ts` (new)

```ts
export interface AccountSettingsRow { userId: string; enabled: boolean; webhookUrl: string | null; marketWebhookUrl: string | null }
export interface DiscordAccountsDeps extends HoldingsSettingsDeps {
  listAccounts: () => Promise<Array<{ userId: string; email: string | null }>>
  listSettings: () => Promise<AccountSettingsRow[]>
  saveMarketWebhook: (userId: string, url: string | null) => Promise<void>  // upsert; null = inherit
  readScheduleJobs: () => Promise<Array<{ jobname: string; schedule: string }>>
  writeSchedule: (s: { briefHour: number; briefMinute: number; fullHour: number; fullMinute: number }) => Promise<void>
}
export interface DiscordAccountRow {
  userId: string
  email: string | null
  market: { custom: boolean; last4: string | null }
  holdings: { configured: boolean; last4: string | null; enabled: boolean }
  lastSend: LastSend | null
}
export type DiscordAccountsResult =
  | { ok: true; schedule: ScheduleView; accounts: DiscordAccountRow[]; send?: DiscordSendResult }
  | { ok: false; error: Extract<HoldingsSettingsResult, { ok: false }>['error'] | 'invalid-time' | 'unknown-user' }
export async function runDiscordAccountsOp(deps: DiscordAccountsDeps, input: unknown): Promise<DiscordAccountsResult>
```

`LastSend.kind` in `holdingsRun.ts` widens to `HoldingsKind | 'market'`.

Every success returns the full snapshot: `schedule = scheduleFromJobs(readScheduleJobs())`;
`accounts` = every `listAccounts` entry, sorted by email (`null` last, then userId), joined with
its `listSettings` row (none → inherit / not configured / disabled) and `lastSend(userId)`.

| op | input | behaviour |
|---|---|---|
| `list` | — | snapshot |
| `set-schedule` | `brief`, `full` ('HH:MM') | both `isValidScheduleTime` else `invalid-time`, nothing written; `writeSchedule(parts)` |
| `set-market` | `userId`, `url` | `isDiscordWebhookUrl` else `invalid-url`; `saveMarketWebhook(userId, url.trim())` |
| `clear-market` | `userId` | `saveMarketWebhook(userId, null)` |
| `test-market` | `userId` | no custom URL → `not-configured`; `countManualToday ≥ MANUAL_SENDS_PER_DAY` → `quota`; `post(url, buildTestPayload(nowIso))`; `finish(userId, ymd, 'test', outcome)`; snapshot + `send` |
| `holdings-set` / `holdings-clear` / `holdings-enable` / `holdings-test` | `userId` (+ `url` / `enabled`) | `runHoldingsSettingsOp(deps, userId, { op: 'set' \| 'clear' \| 'enable' \| 'test', url, enabled })`; its error is returned as is; success → snapshot (+ `send` for test) |

Input rules, checked in this order: not a plain object, or unknown `op` → `bad-request`. Every op
with `userId`: not a UUID string (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`)
→ `bad-request`; not in `listAccounts` → `unknown-user`, nothing written. The result never contains
a webhook URL.

### 3.5 Edge wiring (`index.ts`)

- New action `discord-accounts`, gate `assertAdmin`. Deps = `holdingsDataDeps()` + the existing
  holdings settings readers/writers + `listAccounts` (`db.auth.admin.listUsers`, perPage 1000,
  loop until a short page) + `listSettings` (`user_discord_settings`) + `saveMarketWebhook` (upsert
  `market_webhook_url`, `updated_at`; `onConflict: 'user_id'`) + `readScheduleJobs`
  (`rpc('discord_schedule_get')`) + `writeSchedule` (`rpc('discord_schedule_set', { brief_hour,
  brief_minute, full_hour, full_minute })`). HTTP: `bad-request` / `invalid-url` / `invalid-time`
  / `not-configured` / `unknown-user` → 400, `quota` → 429, other errors → 409.
- Remove the `discord-holdings-settings` branch and `handleDiscordHoldingsSettings`.
- `handleDiscordSummary`: add `loadMarketOverrides` (`user_id, market_webhook_url` where not null)
  and `finishMarketOverride` (insert `kind: 'market'`, status/http_status/reason from the outcome).
- Comments that say "17:15" now say the holdings card goes out with the brief.

### 3.6 Schema (`sources/supabase/schema.sql`)

- §14: `ALTER TABLE user_discord_settings ADD COLUMN IF NOT EXISTS market_webhook_url TEXT;`
  `user_discord_send_log.kind` allows `'market'`: drop and re-add the kind CHECK by name
  (`user_discord_send_log_kind_check`), idempotent. The `discord-holdings-daily` job is created at
  `'5 9 * * 1-5'` (17:05). Header comment updated (17:05, admin-managed, `market` rows).
- New §15 after §14 (before §6e): `public.discord_schedule_get()` returns `(jobname text, schedule
  text)` for the three job names only — **never the `command` column**. `public.discord_schedule_set(
  brief_hour int, brief_minute int, full_hour int, full_minute int)`: re-checks D2 ranges and
  `% 5`, raises unless all three jobs exist, then `cron.alter_job(job_id, schedule := format('%s %s
  * * 1-5', minute, hour - 8))` for brief + holdings (brief time) and full. Both functions
  `SECURITY DEFINER`, `SET search_path = pg_catalog`, `cron.job` fully qualified, `REVOKE ALL …
  FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`.

### 3.7 Browser

- `src/services/discordAccounts.ts` (new): action `discord-accounts`, literal `timeout: 45_000` in
  every call. Error handling copies `discordWebhook.ts` (`discordOpFailed`: status + known code
  only, never `error.message`). Extra codes: `invalid-time` → `時間不在可選範圍`, `unknown-user` →
  `找不到這個帳號`, `quota` → `今天的手動發送次數已用完`. No client → `本機模式無法設定 Discord`.

  ```ts
  getDiscordAccounts(): Promise<DiscordAccountsSnapshot>                       // { op: 'list' }
  saveDiscordSchedule(brief: string, full: string)                              // set-schedule
  saveMarketWebhook(userId, url) / clearMarketWebhook(userId) / testMarketWebhook(userId)
  saveHoldingsWebhook(userId, url) / clearHoldingsWebhook(userId)
  setHoldingsEnabled(userId, enabled) / testHoldingsWebhook(userId)
  // every function resolves to the snapshot { schedule, accounts, send? }
  ```
- `src/components/Admin/DiscordAccountsSection.tsx` (new), mounted in `AdminConsolePage.tsx`
  directly after `<DiscordSection />` on the `discord` panel. Two `section glass adm-panel` blocks;
  the exact labels are fixed by `DiscordAccountsSection.test.tsx`. Layout rules the test relies
  on: each account is one `<tr>`; the email (or `（無 Email）`) appears as text only in its row;
  the editor is `role="region"` with `aria-label="<email> 的 Discord 設定"`, one open at a time,
  and stays open after an op; each editor has one message area; after any success the snapshot
  replaces the state and the URL inputs are cleared. URL inputs are `type="password"`. Schedule
  selects use two-digit option values (`'17'`, `'05'`).
- `DiscordSection.tsx` hint text becomes
  `平日發送快報與完整版，時間在下方「Discord 排程」調整；當天沒有台股大盤資料時不送。`
- Delete `src/components/Settings/DiscordPushSection.tsx`, `src/services/discordHoldings.ts`,
  `scripts/verify-discord-push-e2e.cjs`; remove the menu item, state and modal from `AppShell.tsx`.

## 4. Files (exhaustive for the builder)

Edit: `sources/supabase/functions/stock-report/{discordRun.ts,holdingsRun.ts,index.ts}`,
`sources/supabase/schema.sql`, `sources/src/components/Admin/{AdminConsolePage.tsx,DiscordSection.tsx}`,
`sources/src/components/AppShell.tsx`.
Create: `sources/supabase/functions/stock-report/{discordSchedule.ts,discordTargets.ts,discordAccounts.ts}`,
`sources/src/services/discordAccounts.ts`, `sources/src/components/Admin/DiscordAccountsSection.tsx`.
Delete: `sources/src/components/Settings/DiscordPushSection.tsx`, `sources/src/services/discordHoldings.ts`,
`sources/scripts/verify-discord-push-e2e.cjs`.
Version files per the `versioning` skill are **not** in scope (main session bumps).

## 5. Verify (from `sources/`)

`npm test` (all green), `npm run build`, `npm run typecheck:edge`, `npm run lint`,
`node scripts/sync-edge-engine.cjs --check` — each exit 0.

## 6. Non-goals

No deploy, no DDL on DEV/PROD, no change to the brief/full/holdings content, no preview in the
account editor, no per-account time, no retry, no change to `runWebhookOp` or `app_secrets`.

## 7. Test charter

| Case | Expected outcome | Layer / file |
|---|---|---|
| Time ranges, minute steps, 17:00 refused, malformed strings | per §3.1 | unit / `discordSchedule.test.ts` |
| cron ↔ Taipei time, holdings alignment, missing jobs | per §3.1 | unit / `discordSchedule.test.ts` |
| Grouping, trim, global dropped, order | per §3.2 | unit / `discordTargets.test.ts` |
| Full edition sends copies after global; brief never; skipped paths never; failures isolated; no URL in logs | per §3.3 | unit / `discordRunMarket.test.ts` |
| Every op, validation order, unknown user, quota, snapshot shape, no URL in result | per §3.4 | unit / `discordAccounts.test.ts` |
| Service bodies, timeouts, error text | per §3.7 | unit / `src/services/discordAccounts.test.ts` |
| Schedule selects, save, account table, market inherit/custom, holdings set/toggle/test/clear, no URL in DOM | per §3.7 | component / `DiscordAccountsSection.test.tsx` |
| Hint text | new text | component / `DiscordSection.test.tsx` |

## 8. Deploy notes (later, on explicit OK only)

DEV: apply §14 + §15; the holdings job needs the §6c clone procedure (new job). Then check
`discord_schedule_get()` returns three rows and one save round-trips. PROD after DEV verify.

## 9. Revision 2 (user feedback 2026-09-18, target 0.9.58-dev.6)

Decisions (user): R1 layout order 全域 → 帳號 → 排程 → 說明, explanations at the bottom. R2 the account
editor switches with one click and always shows whose settings it is. R3 a per-account 「完整推送測試」
(the real holdings card, labelled as a preview). R4 schedule is a drop-down every half hour — brief
17:30–20:30, full 21:00–23:30; 17:05 is no longer offered and the default becomes 17:30. R5 UI polish.
Deploy to DEV, test end to end, then commit (authorized).

This section overrides D2, D7 and the §3.1 / §3.7 details it names.

### 9.1 Edge

- `discordSchedule.ts`: `DEFAULT_DISCORD_SCHEDULE = { brief: '17:30', full: '21:30' }`;
  `SCHEDULE_OPTIONS: Record<ScheduleSlot, readonly string[]>` = brief `17:30 … 20:30`, full
  `21:00 … 23:30` (every 30 minutes); `isValidScheduleTime(slot, v)` = `v` is one of them.
  `SCHEDULE_HOURS` and `scheduleMinuteOptions` are removed.
- `discordAccounts.ts`: new op `holdings-preview` (`userId`) → `runHoldingsSettingsOp(deps, userId,
  { op: 'preview' })`; its error is returned as is (`not-configured`, `quota`, `no-market-data`,
  `no-holdings`); success → snapshot + `send` + `previewYmd`. The success type gains `previewYmd?: string`.
- `schema.sql`: §13 `discord-summary-brief` and §14 `discord-holdings-daily` default to
  `'30 9 * * 1-5'` (17:30); §15 `discord_schedule_set` accepts only minute 0 or 30, brief 17:30–20:30,
  full 21:00–23:30 (NULL refused). Comments updated.
- No `index.ts` change is required (`no-holdings` / `no-market-data` already map to 409).

### 9.2 Browser

Page order on the `discord` panel (`AdminConsolePage.tsx`): `DiscordSection` → `DiscordAccountsSection`
(accounts, then schedule) → new `DiscordHelpSection`.

- `DiscordSection` (global card): heading 「全域 Webhook」; the hint paragraph and the
  「如何取得 Discord Webhook 網址」 `<details>` move out (to the help card, content unchanged); the
  recent-sends table is collapsed behind a button 「最近發送紀錄（N 筆）」 (`aria-expanded`), hidden when
  there are no rows.
- `DiscordAccountsSection`:
  - Loading / load failure: one panel with heading 「各帳號設定與發送排程」 and 「載入中…」 or the error.
  - 「各帳號設定」: master–detail. Left: `<nav aria-label="帳號清單">` of buttons (email or
    「（無 Email）」 plus a status line `繼承|自訂・推送中|已暫停|未設定`), the current one has
    `aria-current="true"`; the first account is selected on load; one click switches. Right: `role="region"`
    `aria-label="<label> 的 Discord 設定"` with an `<h4>` of the label, 「上次發送：<ymd> <kind> <status>」
    or 「上次發送：—」, then two blocks:
    - 經濟快報: radios 繼承全域 / 自訂 Webhook; 「目前：繼承全域（不另外發送）」 or 「目前：自訂 …last4」;
      in custom mode the URL input + 「儲存經濟快報網址」 + (when saved) 「測試經濟快報連線」.
    - 個人持股報告: 「目前：…last4」 or 「目前：未設定」; URL input + 「儲存持股報告網址」; when
      configured: a toggle row (childless `adm-toggle`, `aria-label="每個交易日推送個人持股報告"`, visible
      「每日推送」), then 「測試持股報告連線」 「完整推送測試」 「清除持股報告網址」.
      「完整推送測試」 success text: 「已送出完整持股報告（資料日 <previewYmd>）」.
    Switching accounts resets inputs and messages. At ≤ 720 px the list stacks above the detail.
  - 「發送排程（平日・台北時間）」: rows 「快報＋個人持股報告」 and 「經濟快報（完整版）」, each one
    `<select>` (`aria-label` 「快報與個人持股報告發送時間」 / 「經濟快報發送時間」) with the
    `SCHEDULE_OPTIONS`; a current value that is not an option is shown as an extra first option
    「<time>（目前設定，請改選）」 and blocks 「儲存排程」 until changed. Existing save / drift / lock rules stay.
- `DiscordHelpSection` (new, static): heading 「說明」; rules 「繼承全域不另外發送；自訂網址才多送一份」,
  「個人持股報告只送到該帳號自己的網址」, 「全域未設定時經濟快報不送」, 「當天沒有台股大盤資料時不送」
  (plus the weekday / Taipei time note); then the moved how-to `<details>`.
- Service: `previewHoldingsReport(userId)` → op `holdings-preview`, literal `timeout: 90_000`; extra
  error texts `no-holdings` 「這個帳號目前沒有持股」, `no-market-data` 「找不到任何台股大盤資料」.
- Styling: selects must look like drop-downs (reuse `.field select` styling); scoped `dsc-*` rules may be
  added to `src/index.css`; reuse existing tokens (`--cds-*`, `--sp-*`), `badge`, `adm-side-item` look.

### 9.3 Tests (written first)

`discordSchedule.test.ts`, `discordAccounts.test.ts` (Edge), `src/services/discordAccounts.test.ts`,
`DiscordAccountsSection.test.tsx`, `DiscordSection.test.tsx`, new `DiscordHelpSection.test.tsx`.
