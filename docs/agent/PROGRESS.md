# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 167 — 0.9.68-dev.1 on `dev` (AI removed, header 新增交易, Discord 券商)
- Status: 🔄 `dev` at 0.9.68-dev.3, deployed to DEV; `main` / PROD at 0.9.67
- Timestamp: 2026-09-24 05:40:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 05:40:00 Asia/Taipei (Task 167, DEV deploy of 0.9.68-dev.3)
- DEV (`zyebvayngwrqzoaicbwd`), from clean tree 16f042a: `stock-report` deployed `--no-verify-jwt` → v28, `ezbr_sha256` `3b36b3234516` → `02841a5f6b0e`; `ai-proxy` deleted (URL now 404); guarded DO block dropped `get_ai_settings()` and `app_settings` (1 row) after a read-only identity check (`is_dev=true`, `is_prod=false`); updated `verify.sql` installed, `verify_setup()` 10/10 PASS (19 tables).
- Smoke: `stock-report` `{}` → 400 `Unknown action`; `discord-account-tick` without secret → 401.
- Host note: the CLI is `/home/linuxbrew/.linuxbrew/bin/supabase`, not on the agent's non-interactive PATH; run it as `bash -ic 'sbuse stock >/dev/null; cd ~/stock-pnl-web/sources; supabase …'`. This host had lost its link; re-linked to DEV.
- Not verified: a real holdings card with the 券商 figure (needs a user session — 預覽 in Discord settings on DEV). PROD untouched.

---

## 📅 Log: 2026-09-24 02:06:00 Asia/Taipei (Task 167, 0.9.68-dev.1)
- Committed and pushed `dev` a3d1554 (0.9.68-dev.1): AI removed end to end (frontend, `ai-proxy` source, `schema.sql` now DROPs `app_settings` + `get_ai_settings()`; RISK-013 closed); 新增交易 moved into the header; Discord holdings card shows the 券商 figure (spec discord-holdings.md Revision 9); CLAUDE.md gained § Release workflow.
- **Verify**: `npm test` 2,459 passed / 7 skipped / 0 failed; `npm run build`, `npm run lint`, `npm run typecheck:edge` exit 0.
- **Blocked — DEV not deployed**: the `supabase` CLI is not installed on this host (Node moved to v26 under nvm; no binary anywhere, no `~/.supabase`). Still to do on DEV: `supabase functions deploy stock-report --no-verify-jwt`, `supabase functions delete ai-proxy`, and `DROP FUNCTION IF EXISTS public.get_ai_settings(); DROP TABLE IF EXISTS app_settings;` with the DEV identity predicate in the same query. PROD after `main`.
- Browser layout: Playwright system deps installed by the user 2026-09-24 (`sudo env "PATH=$PATH" npx playwright install-deps chromium`; plain `sudo npx` fails, nvm is not on root's PATH). Dev server must run in local mode for screenshots: `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev`.
- 05:05 — 0.9.68-dev.2: version moved from `.version-badge` (fixed bottom-left, removed from `App.tsx`) to `.footer-version` at the end of the footer disclaimer in `AppShell.tsx`; on ≤ 720 px the footer now carries the bottom-nav clearance and `main.container` bottom padding drops to 24 px. Not shown on the login page any more. Tests 2,459 passed; build, lint, typecheck:edge exit 0.

- 0.9.68-dev.3: on ≤ 720 px `.header-add` gets `order: 1` (after the workspace menu, before `.header-meta`); verified at 1440 / 1024 / 375 / 320 px — no header overflow, no horizontal scroll, version 31 px above the bottom nav, modal opens.
---
