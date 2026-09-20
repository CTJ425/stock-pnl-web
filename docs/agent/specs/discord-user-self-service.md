# Spec — Discord self-service webhooks (Task 165, step 2e)

- Agent: Claude
- Status: DRAFT — awaiting user approval
- Timestamp: 2026-09-19 Asia/Taipei
- Supersedes: `discord-admin-accounts.md` decision "the per-user settings dialog is removed".
  The admin console keeps every control it has today; this spec **adds** a self-service page.

## 1. Goal

Let every signed-in account manage its own two Discord webhooks — 經濟快報 (market) and
個人持股 (holdings) — and test-push both, without an admin. The global 經濟快報 webhook stays
admin-owned and stays the content source.

## 2. Decisions (user, 2026-09-19)

| # | Decision |
| - | -------- |
| D1 | "Inherit global" means **inherit the content, not the channel**: the per-account copy is the same payload sent to the account's own webhook. (Already the implemented behaviour.) |
| D2 | Two webhooks per account, one per report type. `market_webhook_url` and `webhook_url` stay separate columns. |
| D3 | The admin keeps the global 經濟快報 webhook (`app_secrets.discord_webhook_url`). |
| D4 | Per-account copies go out for **both editions** (brief and full), not full only. |
| D5 | Add `market_enabled` so an account can pause 經濟快報 without erasing its URL. |
| D6 | Test push always sends to the **stored** URL. The Edge Function never accepts a URL from the request body. |
| D7 | The admin console keeps per-account editing (admin may still edit any account). |

## 3. Schema change

`sources/supabase/schema.sql` §14:

```sql
ALTER TABLE user_discord_settings ADD COLUMN IF NOT EXISTS market_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Backfill: every account that already has a custom market webhook keeps receiving copies.
UPDATE user_discord_settings SET market_enabled = TRUE WHERE market_webhook_url IS NOT NULL;
```

The backfill is mandatory. Without it, shipping D5 silently stops every existing per-account
經濟快報 copy.

RLS is unchanged: `user_discord_settings` keeps RLS on with **no policies** and
`REVOKE ALL FROM anon, authenticated`. The webhook URL is a secret; the browser must never be
able to read the column. All access stays server-side through the Edge Function.

## 4. Send semantics

A per-account 經濟快報 copy is sent iff:

```
market_enabled = TRUE AND market_webhook_url IS NOT NULL
```

| `market_enabled` | `market_webhook_url` | Result |
| --- | --- | --- |
| FALSE | NULL | No copy. The account reads the admin's global channel. |
| FALSE | set | No copy (paused, URL kept). |
| TRUE | NULL | No copy. UI must treat this as "未設定" and block the toggle. |
| TRUE | set | Copy of **both** the brief and the full edition to that URL. |

個人持股 is unchanged: sent iff `enabled = TRUE AND webhook_url IS NOT NULL`.

## 5. Edge Function changes

`sources/supabase/functions/stock-report/`

1. **`discordRun.ts:189`** — remove the `if (edition === 'full')` gate so
   `sendMarketOverrides` runs for both editions (D4). Two `kind = 'market'` rows per account per
   day is expected; the unique index on `user_discord_send_log` covers `kind = 'daily'` only, so
   no constraint change is needed.
2. **`index.ts` `loadDiscordMarketOverrides` (~4201–4217)** — add `market_enabled = true` to the
   filter alongside `market_webhook_url IS NOT NULL`.
3. **New action `discord-my-settings`** in the `index.ts` action switch, gated by the existing
   `assertUser(req)` helper (`index.ts:978`), which returns `{ userId }` from the verified JWT.
   Ops, all scoped to that `userId`:
   - `get` — returns the `MySettingsResult` of §5b.2 verbatim, i.e. `{ ok, status: { market: { enabled, configured, last4 }, holdings } }`. Never the URLs. **Corrected 2026-09-19**: this line first described a flat shape, which contradicted §5b.2 and is what the frontend was built against. §5b.2 is the wire format; there is no `sendsUsedToday` field.
   - `set-market` / `clear-market` — write / clear `market_webhook_url`. `clear-market` also sets `market_enabled = false`.
   - `toggle-market` — set `market_enabled`. Reject with 400 when `market_webhook_url IS NULL`.
   - `set-holdings` / `clear-holdings` / `toggle-holdings` — the same three for `webhook_url` / `enabled`.
   - `test-market` — test payload to the stored `market_webhook_url`, logged `kind = 'market'`.
   - `test-holdings` — test payload to the stored `webhook_url`, logged `kind = 'test'`.
   - `preview-holdings` — the real holdings card, logged `kind = 'preview'`.
   Reuse the existing handlers in `discordAccounts.ts` / `holdingsRun.ts`; this action is a
   thin JWT-scoped wrapper, not a second implementation.
4. **Quota** — `test-*` and `preview-holdings` charge the existing
   `MANUAL_SENDS_PER_DAY = 10` allowance (`holdingsRun.ts:208`).

## 5b. Contract decisions forced by the tests (2026-09-19)

Written while the failing tests were compiled against the real signatures. These are binding.

1. **One predicate, one place.** `MarketOverride` (`discordTargets.ts`) gains a **required**
   `enabled: boolean`, and `groupMarketTargets` drops any entry with `enabled === false`.
   `loadDiscordMarketOverrides` therefore selects `market_enabled` and keeps filtering on
   `market_webhook_url IS NOT NULL` only — it must **not** add `.eq('market_enabled', true)`.
   Reason: the opt-out is a user-visible switch whose wrong answer is silent; putting it in SQL
   alone leaves it untestable, and making the field optional would make a missing flag mean
   "enabled" (fail-open).
2. **`discordMySettings.ts` is a new module**, so the ops are unit-testable without a Request:

   ```ts
   export interface MySettingsDeps extends HoldingsSettingsDeps {
     readMarket: (userId: string) => Promise<{ enabled: boolean; webhookUrl: string | null }>
     saveMarketWebhook: (userId: string, url: string | null) => Promise<void>
     setMarketEnabled: (userId: string, enabled: boolean) => Promise<void>
     finishMarket: (userId: string, ymd: string, outcome: HoldingsOutcome) => Promise<void>
   }
   export interface MySettingsStatus {
     market: { enabled: boolean; configured: boolean; last4: string | null }
     holdings: HoldingsSettingsStatus
   }
   export type MySettingsResult =
     | { ok: true; status: MySettingsStatus; send?: DiscordSendResult; previewYmd?: string; missingQuotes?: number }
     | { ok: false; error: 'bad-request' | 'invalid-url' | 'not-configured' | 'quota' | 'no-market-data' | 'no-holdings' }
   export async function runMySettingsOp(deps: MySettingsDeps, userId: string, input: unknown): Promise<MySettingsResult>
   ```

   `finishMarket` records `kind = 'market'`, the same row the admin market test writes.
3. **Holdings ops delegate**, they are not reimplemented: `set-holdings` / `clear-holdings` /
   `toggle-holdings` / `test-holdings` / `preview-holdings` map onto `runHoldingsSettingsOp`'s
   existing `set` / `clear` / `enable` / `test` / `preview`.
4. **`toggle-market` with no stored URL returns `not-configured`** (HTTP 400), and
   `clear-market` also sets `market_enabled = false`.
5. **`index.ts` maps the result to HTTP** exactly as `handleDiscordAccounts` does:
   `bad-request` / `invalid-url` / `not-configured` → 400, `quota` → 429, the rest → 409.
6. **The DB row shape is checked by a test, not by the compiler.** `db.from(...).select(...)`
   types as `any`, so a column missing from a `select` is invisible to `npm run build` — that is
   exactly how `loadDiscordMarketOverrides` shipped without `market_enabled` and would have
   silently dropped every per-account copy. `discordTargets.ts` therefore exports a pure
   `toMarketOverride(row)` mapper that **throws** on a missing or non-boolean `market_enabled`,
   and `loadDiscordMarketOverrides` maps its rows through it. A throw is caught by the existing
   `try` in `sendMarketOverrides` and logged as `discord market overrides failed`, so a bad
   deploy is loud instead of silent.
7. **Destructive writes go in the safe order.** `clear-market` sets `market_enabled = false`
   **before** clearing the URL, in both modules. A crash between the two writes then leaves
   `(enabled false, URL set)` — paused, harmless — never `(enabled true, URL null)`.
8. **The schema §14 block runs once.** The column add and the backfill live together inside a
   `DO $$ ... IF NOT EXISTS (information_schema.columns ...) $$` guard, so re-applying
   `schema.sql` months later cannot re-enable an account that has since switched itself off.
9. **Not unit-testable, so the reviewer checks it by reading the code**: the 401 path. The
   `assertUser(req)` call must be the first statement of the `discord-my-settings` branch, before
   any table access, in the same shape as the `assertAdmin` branches.

## 6. Frontend changes

`sources/src/`

1. **`services/discordMySettings.ts`** (new) — one call per op in §5.3.
2. **`components/Settings/DiscordMySettings.tsx`** (new) — the self-service panel. Mirrors the
   per-account card of `Admin/DiscordAccountsSection.tsx`, for the signed-in account only:
   - 經濟快報: status line (`目前：自訂 …{last4}` / `目前：未設定（使用全域頻道）`), a
     write-only URL input, 儲存 / 清除, a 啟用 toggle disabled until a URL is stored, and
     「測試經濟快報連線」.
   - 個人持股報告: the same shape plus 「完整推送測試」.
   - Both test buttons are disabled until the URL is stored (D6). The save button is the only
     path to a stored URL — no "test this unsaved value".
   - Short copy stating that 未設定 means the account reads the admin's global channel.
3. **`components/AppShell.tsx`** — extend `View` (line 71) with `'discord'`, add
   `onOpenDiscord` to `UserMenu` (line 431) next to the existing `onOpenAdmin`, and mount the
   panel in the view switch (~line 894). Available to every signed-in account, not admin-gated.
4. **`components/Admin/DiscordAccountsSection.tsx`** — add the 經濟快報 啟用 toggle so the admin
   can set `market_enabled` too (D7). No other admin change.
5. **`components/Admin/DiscordHelpSection.tsx`** — the rule "繼承全域不另外發送；自訂網址才多送
   一份" now applies to both editions. Update the wording.

## 7. Security invariants (must hold; the reviewer checks these)

- `discord-my-settings` derives `user_id` **only** from `assertUser`. It never reads a `userId`
  from the request body. A body-supplied id would let any account rewrite another account's
  webhook.
- No op accepts a webhook URL to send to. Sends always read the URL back from the table,
  otherwise the Edge Function becomes an open Discord relay.
- Responses carry `last4` only, never the stored URL.
- `stock-report` runs with `--no-verify-jwt` on cloud, so `assertUser` is the only gate. It must
  be called before any work in the new branch, in the same shape as the `assertAdmin` branches.

## 8. Tests

- `discordRunMarket.test.ts` — a per-account copy goes out for the brief edition too (D4).
- `discordAccounts.test.ts` — `market_enabled = false` with a URL set sends nothing;
  `toggle-market` with a NULL URL is rejected.
- New `discordMySettings.test.ts` — every op writes only the caller's row; a body-supplied
  `userId` is ignored; no response contains a full URL.
- New `DiscordMySettings.test.tsx` — test buttons disabled until saved; toggle disabled until a
  URL exists; status lines.
- Existing schema/migration expectations updated for `market_enabled`.

## 9. Verify

```
npm run build          # from sources/ — the Verify line; npx tsc --noEmit does NOT cover tests
npm run lint
npm run typecheck:edge
npx vitest run
```

## 10. Out of scope

- Changing who owns the global webhook or the send schedule.
- Any RLS policy on `user_discord_settings`.
- Letting a user test an unsaved URL.

## 11. Test charter

| Case | Expected outcome | Layer / file |
| ---- | ---- | ---- |
| Brief edition with one enabled market override | A copy is sent to the override URL (today: full only) | Edge / `discordRunMarket.test.ts` |
| Full edition with one enabled market override | A copy is sent (unchanged behaviour) | Edge / `discordRunMarket.test.ts` |
| `market_enabled = false`, `market_webhook_url` set | No copy for either edition | Edge / `discordRunMarket.test.ts` |
| `market_enabled = true`, `market_webhook_url` NULL | No copy; no crash | Edge / `discordRunMarket.test.ts` |
| Override URL equal to the global URL | Still filtered out by `groupMarketTargets` | Edge / `discordTargets.test.ts` |
| `discord-my-settings` `toggle-market` with NULL URL | 400, row unchanged | Edge / `discordMySettings.test.ts` |
| `discord-my-settings` with a `userId` in the body ≠ JWT user | The JWT user's row is written; the body id is ignored | Edge / `discordMySettings.test.ts` |
| `discord-my-settings` `get` response | Contains `last4` only; no field holds a full URL | Edge / `discordMySettings.test.ts` |
| `discord-my-settings` `test-market` when `market_webhook_url` is NULL | 400, nothing sent | Edge / `discordMySettings.test.ts` |
| Any `discord-my-settings` op without a valid JWT | 401 before any table access | Edge / `discordMySettings.test.ts` |
| Test buttons before a URL is stored | Disabled | UI / `DiscordMySettings.test.tsx` |
| 啟用 toggle before a URL is stored | Disabled | UI / `DiscordMySettings.test.tsx` |
| Saved state | Status line shows `…{last4}`, never the URL | UI / `DiscordMySettings.test.tsx` |

---

## Revision 1 (user, 2026-09-20) — one UI for every account; the inherited state becomes legible

Two complaints drove this. First, the admin console carried a privileged variant of the same
settings UI, so an admin setting up their own Discord saw a different screen from everyone else.
Second, `目前：未設定（使用全域頻道）` reads the same whether the global webhook is configured or
not, so an account cannot tell whether it receives 經濟快報 at all.

| # | Decision |
| - | -------- |
| R1 | Every account, admin included, manages its own two webhooks through **one** page: `Settings/DiscordMySettings.tsx`. There is no privileged variant of it. |
| R2 | The admin console keeps **site-wide controls only**: the global 經濟快報 webhook with its test/preview buttons, and the send schedule. |
| R3 | The per-account block in the admin console becomes a **read-only status list** — who has configured what, and each account's last send. No inputs, no toggles, no test buttons. |
| R4 | The send schedule moves into the global webhook block, because it is a site-wide setting and its old home is now read-only. |
| R5 | `discord-my-settings` `get` also reports the **global** webhook's state, so the self-service page can say whether inheriting actually delivers anything. |
| R6 | **Deferred to step 2f**: per-account schedule times. It needs a cron tick model (one 30-minute job that asks which accounts are due) instead of today's three fixed `pg_cron` jobs, plus a `(user_id, taipei_ymd)` unique index for `kind = 'market'`, and it only applies to accounts that have their own webhook. Not in this revision. |
| R7 | Scope choice: the per-account mutation ops of `discord-accounts` **stay on the Edge**; only their UI is removed. Deleting them would take a batch of tests with them, which is more than "make the UI consistent" asks for. The admin keeps the ability through the API, not through a screen. |

### Status shape

`MySettingsStatus` gains a `global` block. The frontend type follows automatically — it is
`import type`d from the Edge module (§5b addendum after round 1), so a divergence is a compile
error rather than an `undefined` at runtime.

```ts
export interface MySettingsStatus {
  global: { configured: boolean; last4: string | null }
  market: { enabled: boolean; configured: boolean; last4: string | null }
  holdings: HoldingsSettingsStatus
}
```

The dep that fills it is the one the admin path already uses to read `app_secrets`; do not add a
second reader.

### What the 經濟快報 block says

Two lines, so the two channels are never confused:

| State | Line |
| ---- | ---- |
| global configured | `全域頻道：已設定 …{last4} — 你會在共用頻道收到` |
| global not configured | `全域頻道：管理員尚未設定，目前沒有人收得到` |
| own URL absent | `我的頻道：未設定（不另外發送）` |
| own URL present, enabled | `我的頻道：…{last4}（推送中）` |
| own URL present, paused | `我的頻道：…{last4}（已暫停）` |

The 個人持股 block keeps its single status line — it has no global counterpart to inherit from.

### R8 — inheriting is not a switch (user, 2026-09-20)

Reported: 經濟快報's 啟用 toggle and 測試連線 button are dead on an account that inherits, even
though the line above says `全域頻道：已設定`. Investigated end to end first — saving a valid URL
does unlock both controls and auto-enables the switch, and clearing restores the previous state,
so the write path is correct. The defect is the UI.

**Inheriting the global channel is not something this app can switch on or test.** The post goes
to the admin's shared channel; whether an account sees it depends on that account's Discord
membership, not on any app state. A control that can never fire reads as broken, especially
directly under a line confirming the global channel *is* configured.

So while `market.configured` is false, the 經濟快報 block renders **neither** control — not a
disabled one — and shows instead:

```
要在自己的頻道也收到一份，請在上方設定 Webhook 網址。
```

Both controls appear as soon as a URL is stored. The 個人持股 block keeps its disabled-until-saved
controls: its status line (`目前：未設定`) is unambiguous on its own, so a greyed control there does
not contradict anything on screen.
