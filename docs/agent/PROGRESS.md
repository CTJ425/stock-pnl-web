# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — 0.9.57 released to `main`; DEV fully deployed
- Status: ✅ **0.9.57 ON `main`** — PROD Supabase (schema §13 + `stock-report`) not deployed, awaiting explicit OK
- Timestamp: 2026-09-17 16:33:21 Asia/Taipei

---

## 📅 Log: 2026-09-17 16:33:21 Asia/Taipei (Task 165, 0.9.57 — merged to `main`)

**Released 0.9.57** at the user's request: `dev` fast-forwarded into `main`, both branches synced. The frontend goes live through Cloudflare Pages from `main`. PROD Supabase was not touched: schema §13 is not applied and `stock-report` is not redeployed, so the PROD admin console's Discord panel answers an error until both are done (awaiting explicit OK).

**Changes since 0.9.57-dev.1** (all verified on DEV; `stock-report` v9 → v12):
- dev.2 `e179a32`: the admin Discord panel gains a collapsible webhook setup guide (no Bot or API key needed; 7 steps; security note).
- dev.3 `6dc6f52`: 預覽快報 / 預覽完整版 send the real content immediately (`【預覽】` prefix, logged as `test`, never take the daily slot, fall back to the latest market day, skip rows with a malformed `date`). Error messages add known codes, e.g. `HTTP 409：找不到任何台股大盤資料`. Review round 1 FAIL (a malformed date could be chosen as latest) was fixed.
- dev.4 `cda426c`: one card per block, 🔴 / 🟢 / ⚪, a per-card data stamp (`09/17 15:05 更新`, `⚠️ 09/16 資料・非今日`), 盤後初步／完整 from the `market/daily.json` `asOf` (19:30 Taipei). Found while designing it: the newest USD/TWD point was 09/16 while the earlier brief presented it as today's. Review PASS; an unparseable `asOf` is now treated as unknown.
- dev.5 `963bfa3`: card bodies became monospace tables padded by display width (CJK and emoji count 2); Chinese names kept per the user; macro labels shortened by FRED id. The admin send log shows Asia/Taipei `YYYY-MM-DD HH:mm:ss`.

**DEV evidence**: the user set the webhook; the test send at 15:11 and the previews from 15:25 are HTTP 200 in `discord_send_log`. Every deploy was re-checked with 401 on unauthenticated calls and a 200 from the next `source-probe` call.

**Verification** (from `sources/`): `npm test` 137 files, 2201 passed / 7 skipped; a `TZ=UTC` rerun of the layout and log-time tests passed; `npm run build`, `npm run typecheck:edge`, `npm run lint` exit 0.

**Next**: PROD — apply §13 (clone an existing job's command behind the identity guard, then `verify_setup()`), deploy `stock-report` with `--no-verify-jwt --use-api`, set the PROD webhook. Watch the first real DEV 17:05 / 21:30 rounds and check phone alignment of the 國際指數 / 美國總經 tables.

---

## 📅 Log: 2026-09-17 14:54:00 Asia/Taipei (Task 165 Phase 1, 0.9.57-dev.1 — DEV deployed)

**Pushed to `dev`** (not `main`, per user): commit `c74d371` `feat: 0.9.57-dev.1 — Discord 每日盤後總結第一階段（Task 165）`. Version synced in `version.ts`, `package.json` / lock and the README badge; the CHANGELOG section is written at release time, as with earlier dev versions.

**DEV database** (`zyebvayngwrqzoaicbwd`): §13 applied as one DO block behind the DEV/PROD identity predicate. `discord-summary-brief` (`5 9 * * 1-5`) and `discord-summary-full` (`30 13 * * 1-5`) were cloned from `market-data-daily` with `replace()` on the action, so `CRON_SECRET` was never read. Verified structurally: RLS on and 0 policies on both tables; `anon` / `authenticated` have no privileges; `service_role` can read and insert; `discord_send_log_once` exists; both jobs target the DEV host with the real secret header, no placeholder, 60 s timeout; `market-data-daily` untouched. Updated `verify.sql` installed; `verify_setup()` 10/10 PASS (17 tables, 9 jobs, cron http 200).

**DEV Edge**: `stock-report` v8 → v9, `ezbr_sha256` `11fd4dcd…` → `b8e470f0…`, `verify_jwt=false`, deployed from `c74d371` with `--use-api`. Smoke: `discord-summary` with no / wrong `x-cron-secret` → 401; `discord-webhook` without an admin session → 401; the next `source-probe` call at 06:50 UTC → 200, so existing actions are unaffected.

**Tooling on this host**: the Supabase CLI was not installed — added with `npm i -g supabase` (2.117.0). `supabase functions deploy` needs `--use-api` here (the container bundler reports `entrypoint path does not exist`). `db query --linked --project-ref <ref>` works without `supabase link`.

**Next**: the webhook is set in the DEV admin console (local `npm run dev`) and 測試發送 is run; until then each scheduled run records a `no-webhook` skip. PROD waits for an explicit OK.

