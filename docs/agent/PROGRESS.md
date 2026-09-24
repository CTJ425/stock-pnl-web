# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 167 — 0.9.68 released to `main`; PROD Supabase pending
- Status: ✅ `main` = `dev` = 0.9.68 (a029192); DEV Supabase deployed; ⏳ PROD Supabase blocked on permission
- Timestamp: 2026-09-24 14:40:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 14:40:00 Asia/Taipei (Task 167, 0.9.68 released)
- Pre-merge review of `main..dev` found and fixed 3 leftovers: stale `isAiAdmin()` comment in `stock-report/index.ts` (now points to `adminStatus.isAdmin()`), `public.app_settings` in `snapshotPlan.test.mjs`, and **`run-all-e2e.cjs` still clicking `button.fab`** (now `button.header-add`; selector verified at 1440 / 375 px in local mode — the script itself needs Supabase mode + credentials, not run).
- 0.9.68 finalized (a029192): CHANGELOG's three dev entries merged into one; `main` fast-forwarded and pushed, `main:dev` synced. Release 0.9.68 created by the sync workflow; CI success. Cloudflare Pages live: the PROD login page no longer renders `.version-badge` (0.9.67 did).
- DEV `stock-report` redeployed from a029192 → v29 `f0ecd8ed9cbc`.
- **PROD not touched**: `supabase functions deploy … --project-ref hrilemueiqyaoiwnkeuu` was denied by the auto-mode classifier ("Production Deploy"). Still owed on PROD: deploy `stock-report --no-verify-jwt` (券商 figure), delete `ai-proxy`, guarded DROP of `get_ai_settings()` + `app_settings` (needs `supabase link` to PROD, then back to DEV), `verify.sql` + `verify_setup()`. Until then PROD cards have no 券商 figure and the unused AI objects remain; nothing breaks.

---

## 📅 Log: 2026-09-24 05:40:00 Asia/Taipei (Task 167, DEV deploy of 0.9.68-dev.3)
- DEV (`zyebvayngwrqzoaicbwd`), from clean tree 16f042a: `stock-report` deployed `--no-verify-jwt` → v28, `ezbr_sha256` `3b36b3234516` → `02841a5f6b0e`; `ai-proxy` deleted (URL now 404); guarded DO block dropped `get_ai_settings()` and `app_settings` (1 row) after a read-only identity check (`is_dev=true`, `is_prod=false`); updated `verify.sql` installed, `verify_setup()` 10/10 PASS (19 tables).
- Smoke: `stock-report` `{}` → 400 `Unknown action`; `discord-account-tick` without secret → 401.
- Host note: the CLI is `/home/linuxbrew/.linuxbrew/bin/supabase`, not on the agent's non-interactive PATH; run it as `bash -ic 'sbuse stock >/dev/null; cd ~/stock-pnl-web/sources; supabase …'`. This host had lost its link; re-linked to DEV.
- Not verified: a real holdings card with the 券商 figure (needs a user session — 預覽 in Discord settings on DEV). PROD untouched.

---
