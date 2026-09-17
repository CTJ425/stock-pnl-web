# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 1 — 0.9.57-dev.1 committed and pushed to `dev`; DEV schema, cron and Edge deployed and verified
- Status: 🔄 **DEV DEPLOYED** — waiting for the webhook to be set in the DEV admin console; PROD not started
- Timestamp: 2026-09-17 14:54:00 Asia/Taipei

---

## 📅 Log: 2026-09-17 14:54:00 Asia/Taipei (Task 165 Phase 1, 0.9.57-dev.1 — DEV deployed)

**Pushed to `dev`** (not `main`, per user): commit `c74d371` `feat: 0.9.57-dev.1 — Discord 每日盤後總結第一階段（Task 165）`. Version synced in `version.ts`, `package.json` / lock and the README badge; the CHANGELOG section is written at release time, as with earlier dev versions.

**DEV database** (`zyebvayngwrqzoaicbwd`): §13 applied as one DO block behind the DEV/PROD identity predicate. `discord-summary-brief` (`5 9 * * 1-5`) and `discord-summary-full` (`30 13 * * 1-5`) were cloned from `market-data-daily` with `replace()` on the action, so `CRON_SECRET` was never read. Verified structurally: RLS on and 0 policies on both tables; `anon` / `authenticated` have no privileges; `service_role` can read and insert; `discord_send_log_once` exists; both jobs target the DEV host with the real secret header, no placeholder, 60 s timeout; `market-data-daily` untouched. Updated `verify.sql` installed; `verify_setup()` 10/10 PASS (17 tables, 9 jobs, cron http 200).

**DEV Edge**: `stock-report` v8 → v9, `ezbr_sha256` `11fd4dcd…` → `b8e470f0…`, `verify_jwt=false`, deployed from `c74d371` with `--use-api`. Smoke: `discord-summary` with no / wrong `x-cron-secret` → 401; `discord-webhook` without an admin session → 401; the next `source-probe` call at 06:50 UTC → 200, so existing actions are unaffected.

**Tooling on this host**: the Supabase CLI was not installed — added with `npm i -g supabase` (2.117.0). `supabase functions deploy` needs `--use-api` here (the container bundler reports `entrypoint path does not exist`). `db query --linked --project-ref <ref>` works without `supabase link`.

**Next**: the webhook is set in the DEV admin console (local `npm run dev`) and 測試發送 is run; until then each scheduled run records a `no-webhook` skip. PROD waits for an explicit OK.

---

## 📅 Log: 2026-09-17 13:51:06 Asia/Taipei (Task 165 Phase 1, unversioned — `dev` working tree)

**What**: Market-wide after-hours summary posted to one admin-configured Discord webhook, weekdays 17:05 (brief) and 21:30 (full). Design decided with the user step by step; spec `docs/agent/specs/discord-daily-summary.md`. No per-user data (holdings summary is Phase 2).

**Changed**
- Edge (`stock-report`): new pure modules `discordUrl.ts`, `discordWebhook.ts`, `marketMargin.ts`, `globalIndexClose.ts`, `discordSummary.ts`, `discordRun.ts`; `index.ts` wires `discord-summary` (x-cron-secret) and `discord-webhook` (admin JWT). Neither is in `ADMIN_RUN_JOBS`.
- DDL (`schema.sql` §13): `app_secrets` (RLS on, no policies, revoked from anon/authenticated), `discord_send_log` + partial unique index `discord_send_log_once`, cron `discord-summary-brief` `5 9 * * 1-5` and `discord-summary-full` `30 13 * * 1-5`. `verify.sql` now expects 17 tables and checks RLS on both new ones.
- Snapshots: `SECRET_TABLES = ['public.app_secrets']` is always excluded, also under `--with-cache`; `discord_send_log` joins `CACHE_TABLES`.
- Admin console: new `Discord` panel (`DiscordSection.tsx`, `services/discordWebhook.ts`) — shows only the last 4 token characters; set / clear / test send; recent sends table.

**Data sources** (checked against real responses on 2026-09-17): `market/daily.json` (TAIEX + 三大法人); TWSE `MI_MARGN?selectType=MS` fetched at send time (market 融資融券 totals); Yahoo chart 1d/5d for 8 indices fetched at send time (last completed session only); `macro/us.json`; `fx/twd.json`.

**Review**: Edge modules PASS with 4 RISKs — 2 fixed (a null macro value rendered as 0; unsorted Yahoo bars), 2 accepted as RISK-014. Admin section FAIL, then fixed (rejections shown verbatim, one in-flight flag, 45 s invoke timeout, admin-console markup). Main session read the `index.ts` / `schema.sql` / `verify.sql` diffs and fixed a DB read error being reported as "not configured".

**Verification** (from `sources/`): `npm test` 136 files, 2174 passed / 7 skipped, exit 0; `npm run build` exit 0; `npm run typecheck:edge` exit 0. `node_modules` was missing and was restored with `npm ci`.

**Not done**: commit + version bump; apply §13 on DEV (clone an existing job's command so `CRON_SECRET` is never read); deploy `stock-report` to DEV with `--no-verify-jwt`; set the webhook in the DEV admin console and run 測試發送; PROD only after explicit OK.
