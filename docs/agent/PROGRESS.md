# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 2 step 2d — deployed to DEV and verified end to end; load-state polish committed
- Status: 🔄 **0.9.58-dev.5 on `dev`** (`2eedfb6`, not pushed) — DEV Supabase has §14 + §15 and `stock-report` v13; PROD untouched, awaits explicit OK
- Timestamp: 2026-09-18 11:47:04 Asia/Taipei

---

## 📅 Log: 2026-09-18 11:47:04 Asia/Taipei (Task 165 Phase 2 step 2d — DEV deploy, 0.9.58-dev.5)

**Why**: the user saw no schedule or account fields in the admin Discord panel. Cause: the new UI called `discord-accounts`, which DEV Edge did not have yet (unauthenticated probe: `discord-accounts` → 400 `Unknown action`, `discord-webhook` → 401), so the panel showed only an error box. The user then authorized the DEV deploy and testing.

**DEV deploy** (explicit OK, all writes with the DEV identity predicate in the same transaction): precheck (read-only, structural `LIKE` only) → §14 tables, `market_webhook_url`, kind CHECK with `market`; `discord-holdings-daily` created at `5 9 * * 1-5` by cloning `discord-summary-brief`'s command (body and timeout replaced, then checked by `LIKE` inside the transaction; the command text was never selected); §15 `discord_schedule_get` / `discord_schedule_set` (ACL: postgres + service_role only). `stock-report` deployed with `--no-verify-jwt --use-api`: v12 → v13, ezbr `068be7e5…` → `c439abab…`, from commit `9345400`.

**Tests on DEV**: SQL inside a rolled-back transaction — 18:30/22:00 moves all three jobs (`30 10`, `30 10`, `0 14`); 17:00, 18:03, full 20:55 and NULL refused; role `authenticated` denied. End to end with a temporary admin user (created and deleted through the Auth admin API; keys kept in env, never printed): list, set-schedule (+ 17:00 → 400 `invalid-time`, restored to 17:05/21:30), set/test/clear 經濟快報, set/enable/test/clear 個人持股報告 (test sends to a fake-token webhook reach Discord and come back `webhook-gone`), invalid URL → 400, unknown account → 400, demoted user → 403 — all passed. One transient 500 on the very first run: `JWT issued at future` from PostgREST in `listDiscordAccountSettings` (clock skew); not reproduced on a second full run, only occurrence in `app_log`. Cleanup verified: 0 temp users, 0 settings/log rows, schedule `5 9` / `5 9` / `30 13`.

**0.9.58-dev.5** (`2eedfb6`): while loading or after a load failure the panel keeps a heading (「Discord 排程與各帳號設定」, 「載入中…」 or the error); `Unknown action` maps to 「後端尚未部署這個功能」. `npm test` 2494 passed / 7 skipped; build, typecheck:edge, lint, sync --check exit 0; browser check at 1280 / 390 px passed.

**Next**: a real test send to a private webhook from the admin console; watch one 17:05 and 21:30 round; PROD needs explicit OK.

---

## 📅 Log: 2026-09-18 10:36:45 Asia/Taipei (Task 165 Phase 2 step 2d, 0.9.58-dev.4)

**Commit on `dev`** (not pushed): `247b37f` 0.9.58-dev.4.

**User decisions** (sketch approved in chat): every Discord webhook is managed from the admin console; the per-user "Discord 推播" dialog and the `discord-holdings-settings` action are removed; per account, 經濟快報 (= full edition) inherits the global webhook by default and inherit sends nothing extra, while a custom URL gets a second copy; 個人持股報告 has no inherit; brief + holdings go out together (default 17:05); drop-downs set the brief+holdings time and the full time. Spec: `docs/agent/specs/discord-admin-accounts.md`.

**Design**: the schedule lives in pg_cron — `discord_schedule_set()` (§15, SECURITY DEFINER, service_role only) runs `cron.alter_job` on the three existing jobs; no tick job, no schedule table. Verified on DEV (read-only query): pg_cron 1.6.4, `cron.alter_job` exists, every job owner is `postgres`. Ranges: brief 17:05–20:55, full 21:00–23:55, 5-minute steps (re-checked in SQL; NULL refused). No automatic re-send. No global webhook → the full edition is skipped, including every per-account copy. Copies are grouped by URL; a URL equal to the global one is not posted again; copies are logged in `user_discord_send_log` as `kind = 'market'`.

**Code**: new Edge modules `discordSchedule.ts`, `discordTargets.ts`, `discordAccounts.ts` (action `discord-accounts`, assertAdmin); `runDiscordSummary` gains optional `loadMarketOverrides` / `finishMarketOverride`; schema §14 adds `market_webhook_url`, `kind 'market'` and moves the holdings job to 17:05; new §15 adds `discord_schedule_get` / `discord_schedule_set`. Browser: `src/services/discordAccounts.ts` and `Admin/DiscordAccountsSection.tsx` (schedule drop-downs + account table and editor), mounted after `DiscordSection`; deleted `Settings/DiscordPushSection.tsx`, `services/discordHoldings.ts`, `scripts/verify-discord-push-e2e.cjs` (its row removed from `docs/UnitTests/E2E.md`).

**Review**: Edge + schema reviewer PASS with 2 RISKs (no paging on the two `user_discord_settings` reads, BUG-066 convention) — both fixed, plus a NULL-argument check in `discord_schedule_set`. The browser part was not separately reviewed (no client-side auth decision; "no URL in the DOM" is covered by tests).

**Verification** (from `sources/`): `npm test` 147 files, 2492 passed / 7 skipped; `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0. The SQL functions have not run on any database yet.

**Browser check** (2026-09-18, Supabase-mode vite on 127.0.0.1:5317, every backend call mocked with `page.route`, ad-hoc script not committed): header menu has no 「Discord 推播」; schedule save, hour-17 minute rule, account table, 經濟快報 custom → test → back to inherit, holdings set → toggle → test → clear; no token in the DOM, bearer on every call, no page overflow, no page errors — 1280 px and 390 px, all passed. It found one real bug, now fixed: the toggle's label text sat inside the 38 px `adm-toggle` pill and overflowed onto 「測試持股報告」, so clicking 「測試」 turned the daily push off. Also fixed: editor moved out of the scrolling table (clipped at 390 px), label above each URL input, compact `HH : MM` schedule rows, 「編輯」 button text.

**Deploy notes**: re-applying schema §13/§14 resets the schedule to 17:05 / 21:30. DEV deploy needs explicit OK.
