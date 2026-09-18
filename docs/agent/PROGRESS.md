# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 2 step 2d revision 2 — admin Discord panel reworked per user feedback, deployed to DEV
- Status: 🔄 **0.9.58-dev.6 on `dev`** (`bb31d61`, not pushed) — DEV Supabase has §14 + §15 (17:30 schedule) and `stock-report` v14; PROD untouched, awaits explicit OK
- Timestamp: 2026-09-18 12:24:08 Asia/Taipei

---

## 📅 Log: 2026-09-18 12:24:08 Asia/Taipei (Task 165 Phase 2 step 2d revision 2, 0.9.58-dev.6)

**User feedback, five items** (spec `docs/agent/specs/discord-admin-accounts.md` §9, which overrides D2 and D7): accounts and the global webhook at the top with the explanations at the bottom; one click switches account and the editor must name it; a per-account 「完整推送測試」; the schedule as a half-hour drop-down instead of typing, fields and order reworked; general UI polish. Asked and answered before building: the grid is on the hour and half hour, so 17:05 is gone and the brief default becomes 17:30; deploy to DEV and commit was authorized.

**Code**: `discordSchedule.ts` now exports `SCHEDULE_OPTIONS` (brief 17:30–20:30, full 21:00–23:30) and drops `SCHEDULE_HOURS` / `scheduleMinuteOptions`; `discordAccounts.ts` gains op `holdings-preview` (delegates to `runHoldingsSettingsOp`'s existing `preview`, returns `previewYmd`); schema §13/§14 default to `'30 9 * * 1-5'` and §15's SQL check accepts only minute 0 or 30 in those ranges. Browser: `AdminConsolePage` renders `DiscordSection` → `DiscordAccountsSection` (accounts, then schedule) → new `DiscordHelpSection`; the global card's heading is 「全域 Webhook」, its recent-sends table is behind a 「最近發送紀錄（N 筆）」 toggle and the how-to moved to the help card; the account section is master–detail (`nav aria-label="帳號清單"`, `aria-current`, first account selected, detail titled with the email and its last send); 「完整推送測試」 reports 「已送出完整持股報告（資料日 …）」; an off-grid stored time shows as 「（目前設定，請改選）」 and blocks saving; scoped `dsc-*` CSS only.

**DEV**: `discord_schedule_set` replaced via `CREATE OR REPLACE` inside a transaction with the DEV identity predicate, then the schedule moved to 17:30 / 21:30 (all three jobs read `30 9`, `30 9`, `30 13`); `stock-report` deployed v13 → v14, ezbr `c439abab…` → `9fab9a41…`. End-to-end with a temporary admin user: 17:00 / 17:05 / 18:15 / full 21:15 all refused with 400 `invalid-time`, 18:30 / 22:00 accepted and restored, market and holdings set/test/clear, `holdings-preview` → 409 `no-holdings` (that account holds nothing, so the op is wired), unknown account 400, demoted user 403 — all passed, temp account deleted.

**Verification**: `npm test` 2512 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. Browser check (Supabase-mode vite, all backend calls mocked, ad-hoc script not committed) 13 checks at 1280 px and 390 px: panel order, collapsed recent sends, account list and one-click switch, half-hour drop-downs and save, market custom → test → inherit, holdings set → toggle → connection test → full report → clear, help card, no token in the DOM, bearer on every call, no overflow, no page errors. Two polish rounds came out of reading the screenshots: the first fixed a real bug (toggle label overflowing onto 「測試持股報告」), the second separated the holdings rows, removed the duplicated inline hint and made the account rows look clickable.

**Next**: real test sends to a private webhook from the admin console; watch one 17:30 and 21:30 round on DEV; PROD needs explicit OK (merge `main`, §14 + §15, clone cron, deploy).

---

## 📅 Log: 2026-09-18 11:47:04 Asia/Taipei (Task 165 Phase 2 step 2d — DEV deploy, 0.9.58-dev.5)

**Why**: the user saw no schedule or account fields in the admin Discord panel. Cause: the new UI called `discord-accounts`, which DEV Edge did not have yet (unauthenticated probe: `discord-accounts` → 400 `Unknown action`, `discord-webhook` → 401), so the panel showed only an error box. The user then authorized the DEV deploy and testing.

**DEV deploy** (explicit OK, all writes with the DEV identity predicate in the same transaction): precheck (read-only, structural `LIKE` only) → §14 tables, `market_webhook_url`, kind CHECK with `market`; `discord-holdings-daily` created at `5 9 * * 1-5` by cloning `discord-summary-brief`'s command (body and timeout replaced, then checked by `LIKE` inside the transaction; the command text was never selected); §15 `discord_schedule_get` / `discord_schedule_set` (ACL: postgres + service_role only). `stock-report` deployed with `--no-verify-jwt --use-api`: v12 → v13, ezbr `068be7e5…` → `c439abab…`, from commit `9345400`.

**Tests on DEV**: SQL inside a rolled-back transaction — 18:30/22:00 moves all three jobs (`30 10`, `30 10`, `0 14`); 17:00, 18:03, full 20:55 and NULL refused; role `authenticated` denied. End to end with a temporary admin user (created and deleted through the Auth admin API; keys kept in env, never printed): list, set-schedule (+ 17:00 → 400 `invalid-time`, restored to 17:05/21:30), set/test/clear 經濟快報, set/enable/test/clear 個人持股報告 (test sends to a fake-token webhook reach Discord and come back `webhook-gone`), invalid URL → 400, unknown account → 400, demoted user → 403 — all passed. One transient 500 on the very first run: `JWT issued at future` from PostgREST in `listDiscordAccountSettings` (clock skew); not reproduced on a second full run, only occurrence in `app_log`. Cleanup verified: 0 temp users, 0 settings/log rows, schedule `5 9` / `5 9` / `30 13`.

**0.9.58-dev.5** (`2eedfb6`): while loading or after a load failure the panel keeps a heading (「Discord 排程與各帳號設定」, 「載入中…」 or the error); `Unknown action` maps to 「後端尚未部署這個功能」. `npm test` 2494 passed / 7 skipped; build, typecheck:edge, lint, sync --check exit 0; browser check at 1280 / 390 px passed.

**Next**: a real test send to a private webhook from the admin console; watch one 17:05 and 21:30 round; PROD needs explicit OK.

