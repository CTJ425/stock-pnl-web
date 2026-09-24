# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 167 — 0.9.68-dev.1 on `dev` (AI removed, header 新增交易, Discord 券商)
- Status: 🔄 `dev` at 0.9.68-dev.3; DEV Supabase not deployed (no CLI on host); `main` at 0.9.67
- Timestamp: 2026-09-24 02:06:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 02:06:00 Asia/Taipei (Task 167, 0.9.68-dev.1)
- Committed and pushed `dev` a3d1554 (0.9.68-dev.1): AI removed end to end (frontend, `ai-proxy` source, `schema.sql` now DROPs `app_settings` + `get_ai_settings()`; RISK-013 closed); 新增交易 moved into the header; Discord holdings card shows the 券商 figure (spec discord-holdings.md Revision 9); CLAUDE.md gained § Release workflow.
- **Verify**: `npm test` 2,459 passed / 7 skipped / 0 failed; `npm run build`, `npm run lint`, `npm run typecheck:edge` exit 0.
- **Blocked — DEV not deployed**: the `supabase` CLI is not installed on this host (Node moved to v26 under nvm; no binary anywhere, no `~/.supabase`). Still to do on DEV: `supabase functions deploy stock-report --no-verify-jwt`, `supabase functions delete ai-proxy`, and `DROP FUNCTION IF EXISTS public.get_ai_settings(); DROP TABLE IF EXISTS app_settings;` with the DEV identity predicate in the same query. PROD after `main`.
- Browser layout: Playwright system deps installed by the user 2026-09-24 (`sudo env "PATH=$PATH" npx playwright install-deps chromium`; plain `sudo npx` fails, nvm is not on root's PATH). Dev server must run in local mode for screenshots: `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev`.
- 05:05 — 0.9.68-dev.2: version moved from `.version-badge` (fixed bottom-left, removed from `App.tsx`) to `.footer-version` at the end of the footer disclaimer in `AppShell.tsx`; on ≤ 720 px the footer now carries the bottom-nav clearance and `main.container` bottom padding drops to 24 px. Not shown on the login page any more. Tests 2,459 passed; build, lint, typecheck:edge exit 0.

- 0.9.68-dev.3: on ≤ 720 px `.header-add` gets `order: 1` (after the workspace menu, before `.header-meta`); verified at 1440 / 1024 / 375 / 320 px — no header overflow, no horizontal scroll, version 31 px above the bottom nav, modal opens.
---

## 📅 Log: 2026-09-23 10:40:00 Asia/Taipei (BUG-085, 0.9.67)
- Fixed BUG-085: watchlist industry group flipped between 半導體業 and 其他 for 8150 (南茂), because `price_cache` did not store `industry`. See `FIXED_BUG.md` BUG-085 and `docs/agent/specs/BUG-085.md`.
- Released 0.9.67: `main` and `dev` both at 8ee2065. DEV and PROD: DDL applied, `stock-price` redeployed and verified.

---
