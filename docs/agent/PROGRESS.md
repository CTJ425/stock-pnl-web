# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 2 step 2d — admin-managed Discord webhooks + adjustable schedule committed on `dev`
- Status: 🔄 **0.9.58-dev.4 on `dev`** (`247b37f`, not pushed) — Supabase DEV not deployed (§14 + §15 DDL, cron, `stock-report`); awaiting explicit OK
- Timestamp: 2026-09-18 10:36:45 Asia/Taipei

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

---

## 📅 Log: 2026-09-17 18:34:45 Asia/Taipei (Task 165 Phase 2 steps 2b + 2c, 0.9.58-dev.2 / dev.3)

**Commits on `dev`** (not pushed): `fe6845f` 0.9.58-dev.2 (2b), `66f2a8f` 0.9.58-dev.3 (2c). Spec `docs/agent/specs/discord-holdings.md` now carries the exact contracts for §2.2–2.7.

**2b — pure modules** (`stock-report/holdingQuotes.ts`, `holdingsCard.ts`): last completed Yahoo daily bar per ticker (.TW then .TWO, memoized per run); one ledger per workspace, merged by key + direction with each workspace's `fee_rate` and per-leg minimum fee; SHORT basis = short proceeds and inverted day P&L; totals from quoted rows only, market value and cost from LONG rows; TWD/USD separate; two-line rows ≤ 36 columns, stale ⚠️ marks, 2,800-character budget with `…另 N 檔`. The width table, colours and fee constants are re-stated (D6) and guarded by `scripts/lib/edgeConstants.test.mjs`. Reviewer PASS; its no-drift-test RISK fixed.

**2c — wiring** (`holdingsRun.ts`, `index.ts` additive, schema §14, `snapshotPlan.cjs`, `src/services/discordHoldings.ts`, `src/components/Settings/DiscordPushSection.tsx`, `AppShell.tsx` menu item): daily run at 17:15 (`discord-holdings`, x-cron-secret) with market-day gate, claim-then-send per user, 80 s start budget; settings ops (`discord-holdings-settings`, user JWT) get/set/clear/enable/test/preview, URL never returned, 10 manual sends per day; `makeChartFetch` adds an 8 s timeout and one retry on network/429/5xx. Dialog uses existing global classes and the admin `adm-toggle`. S15 in `snapshotPlan.test.mjs` updated 8 → 9 placeholder substitutions (the new cron job). Reviewer PASS with 4 RISKs: run budget lowered 110 → 80 s; RISK-015/016/017 recorded in `BUG_FIX.md`.

**Process note**: the step-2c test files were written while the 2b builder was still running, which reddened its full gate; they were parked, 2b verified alone, then restored. `pkill -f "vite --port 5317"` kills the calling shell too (its own command line matches) — stop the server by its listening PID instead.

**Verification** (from `sources/`): `npm test` 144 files, 2386 passed / 7 skipped; `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0; `TZ=UTC` rerun of the dialog test passed; D6 frozen files unchanged; existing files only gained lines (`snapshotPlan.cjs` one list line changed). E2E against Supabase-mode vite on 127.0.0.1:5317: new `scripts/verify-discord-push-e2e.cjs` 13/13 (desktop + 390 px, token never in the DOM, bearer on every call), `run-all-e2e.cjs` 16/16.

**Also this session**: the 5173 dev server (started 14:40) was serving a pre-Discord `AdminConsolePage.tsx` because Vite missed the 16:37 rewrite; `touch` on the three Discord files fixed it without content changes.

**Next**: DEV deploy on explicit OK — apply §14 DDL, create `discord-holdings-daily` by cloning an existing job's command behind the identity guard, deploy `stock-report` (`--no-verify-jwt --use-api`), then a real test/preview from a private webhook and the next 17:15 round.
