# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — 0.9.58 deployed to PROD (§14 + §15, holdings cron, `stock-report` v10)
- Status: ✅ **0.9.58 on `dev` and `main`, deployed to DEV and PROD** — next: watch one real 17:30 / 21:30 round on PROD
- Timestamp: 2026-09-18 15:46:22 Asia/Taipei

---

## 📅 Log: 2026-09-18 15:46:22 Asia/Taipei (Task 165 — 0.9.58 on PROD)

**Authorization**: explicit user OK for PROD, with git work to follow the `versioning` and `ship` skills.

**Correction to the records**: PROD already had Phase 1 — `app_secrets`, `discord_send_log`, `discord-summary-brief` (`5 9`) and `discord-summary-full` (`30 13`), a global webhook, and 3 send-log rows. The earlier notes saying PROD had none of Task 165 were wrong; only Phase 2 was missing. PROD `stock-report` was v9 (ezbr `068be7e5…`, the pre-Phase-2 bundle).

**PROD DDL** (one transaction, `-f` file, guarded by `command LIKE '%hrilemueiqyaoiwnkeuu%'` AND NOT `'%zyebvayngwrqzoaicbwd%'`): §14 tables, `market_webhook_url`, the kind CHECK with `market`, the once-per-day index; `discord-holdings-daily` created at `30 9 * * 1-5` by cloning `discord-summary-brief`'s command (body and timeout replaced, then checked by `LIKE` inside the transaction — the command text was never selected); §15 `discord_schedule_get` / `discord_schedule_set` (ACL postgres + service_role only); then `discord_schedule_set(17, 30, 21, 30)`. Result: `discord-summary-brief 30 9`, `discord-holdings-daily 30 9`, `discord-summary-full 30 13`, 10 jobs in total.

**PROD Edge**: `stock-report` deployed from `869390c` with `--no-verify-jwt --use-api`: v9 → v10, ezbr `068be7e5…` → `1c93c3fc…`, identical to DEV v19. Probes: `discord-accounts` and `discord-webhook` 401 without a token, `discord-holdings-settings` 400.

**PROD verification**: `verify.sql` installed with `-f`; `verify_setup()` 10/10 PASS — all 19 tables, 10 jobs 0 inactive, recent cron HTTP 200, RLS on every user table. No temporary admin was created on PROD, to leave its users untouched; the same bundle passed the full admin-op check on DEV.

**Next**: watch one real 17:30 round (brief + holdings) and one 21:30 round (full edition) on PROD.

---

## 📅 Log: 2026-09-18 15:33:33 Asia/Taipei (Task 165 — release 0.9.58)

**Release**: the user approved the markdown cards and asked to deploy, commit and merge to `main`. Versions set to `0.9.58` (`version.ts`, `package.json`, lock, README badge); `docs/agent/CHANGELOG.md` gained a finalized 0.9.58 section (no pending wording, so the Release body published on the `main` push is correct). `main` was fast-forwarded to the release commit, so `main` and `dev` point at the same commit.

**Gap closed before release**: `sources/supabase/verify.sql` did not know Phase 2's tables. Added `user_discord_settings` and `user_discord_send_log` to the table list and the RLS list, and the table message now reads `all 19 present`. Installed on DEV and run: all 10 checks PASS. Pitfall recorded: `supabase db query "$(cat verify.sql)"` fails because the file's first line starts with `--`, which the CLI parses as a flag — use `supabase db query --linked --project-ref <ref> -f supabase/verify.sql`.

**Gate** (from `sources/`): `npm test` 149 files (148 passed, 1 skipped), 2,537 tests: 2,530 passed / 7 skipped; `npx tsc --noEmit`, `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0. DEV probes: `discord-accounts` and `discord-webhook` answer 401 without a token, the retired `discord-holdings-settings` answers 400.

**Not done — needs the user**: `git push origin dev main` (no credentials on this host). PROD Supabase has **none** of Task 165 applied yet — not even Phase 1's §13 — so a `main` push alone changes nothing on PROD's Edge or database. PROD rollout: §13 + §14 + §15 with the DEV identity predicate swapped for PROD's, cron jobs created by cloning an existing command, `stock-report` deployed with `--no-verify-jwt --use-api`, `verify.sql` installed with `-f`, `verify_setup()` run, the global webhook set in the PROD admin console. Awaiting explicit OK.
