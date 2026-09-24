# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 167 — 0.9.68 released; PROD and DEV Supabase deployed
- Status: ✅ `main` = `dev` = 0.9.68; PROD + DEV `stock-report` same bundle; AI objects removed on both
- Timestamp: 2026-09-24 15:00:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 15:00:00 Asia/Taipei (Task 167, PROD Supabase for 0.9.68)
- User authorized the PROD deploy. From clean tree c689ed2: PROD `stock-report` → v17, `ezbr_sha256` `f0ecd8ed9cbc` (same as DEV v29); `ai-proxy` deleted (404); linked to PROD, read-only check `is_prod=true` / `is_dev=false` (`app_settings` had 0 rows), guarded DO block dropped `get_ai_settings()` + `app_settings`; `verify.sql` installed, `verify_setup()` 10/10 PASS; re-linked to DEV (`project-ref` = `zyebvayngwrqzoaicbwd`).
- Smoke: `discord-account-tick` without secret → 401. Remaining in Task 167: user check of a real 券商 card.
- 15:20 — prompt audit of CLAUDE.md + 8 skills: 7 stale facts fixed (d33cedc); follow-ups: `functions download` works with `sbuse stock` and DEV `stock-report` matches the repo file for file (6008187), stale `.gemini` report path dropped from `run-all-e2e.cjs`, `probe-ops` Edge limits now cite the hosted docs (74b9ab9). Global `~/.claude/CLAUDE.md` gained § This machine (not in git).

---

## 📅 Log: 2026-09-24 14:40:00 Asia/Taipei (Task 167, 0.9.68 released)
- Pre-merge review of `main..dev` found and fixed 3 leftovers: stale `isAiAdmin()` comment in `stock-report/index.ts` (now points to `adminStatus.isAdmin()`), `public.app_settings` in `snapshotPlan.test.mjs`, and **`run-all-e2e.cjs` still clicking `button.fab`** (now `button.header-add`; selector verified at 1440 / 375 px in local mode — the script itself needs Supabase mode + credentials, not run).
- 0.9.68 finalized (a029192): CHANGELOG's three dev entries merged into one; `main` fast-forwarded and pushed, `main:dev` synced. Release 0.9.68 created by the sync workflow; CI success. Cloudflare Pages live: the PROD login page no longer renders `.version-badge` (0.9.67 did).
- DEV `stock-report` redeployed from a029192 → v29 `f0ecd8ed9cbc`.
- **PROD not touched**: `supabase functions deploy … --project-ref hrilemueiqyaoiwnkeuu` was denied by the auto-mode classifier ("Production Deploy"). Still owed on PROD: deploy `stock-report --no-verify-jwt` (券商 figure), delete `ai-proxy`, guarded DROP of `get_ai_settings()` + `app_settings` (needs `supabase link` to PROD, then back to DEV), `verify.sql` + `verify_setup()`. Until then PROD cards have no 券商 figure and the unused AI objects remain; nothing breaks.

---
