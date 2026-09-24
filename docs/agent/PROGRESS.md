# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 168 — health-check follow-ups A–H on `dev` as 0.9.69-dev.1; DEV Edge deployed
- Status: 🔄 `dev` = 0.9.69-dev.1 (1b35efc), `main` = 0.9.68; DEV `stock-report` v30 / `stock-price` v22; PROD untouched
- Timestamp: 2026-09-24 17:45:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 17:45:00 Asia/Taipei (Task 168, 0.9.69-dev.1)
- A–H done in 9 commits (11b9662…1b35efc). Gates on the final tree: 2,469 passed / 7 skipped; build, lint, typecheck:edge exit 0; `sync-edge-engine --check` clean.
- `stock-report` refactor: 26 actions × gate compared against the old if-chain by script, identical. DEV v30 `08606770fa09` smoke: unknown/`__proto__` 400, null body 400, cron actions without secret 401, admin actions 401, `generate` 401, OPTIONS 204; `source-probe` (x-cron-secret, action `probe`) 200 at 09:35 UTC after deploy.
- Findings on the way: oxlint 1.85 added 95 warnings (62 zero-width spaces in comments → removed; 4 React-Compiler rules → off in `.oxlintrc.json`, app does not use the compiler); `WorkspaceProvider` built a new provider per render (`useRef(new …)`) → `useState` initialiser; the health report's "89 hard-coded hex colours" was wrong (85 are token definitions); its "15 lint warnings" was truncated output (45).
- Browser (Playwright, local-mode build, 1280 px): TransactionsPage chunk not fetched on first paint, fetched on tab click; reload on `#/yearly` stays; back → `#/transactions` → dashboard; 新增交易 form opens; 0 console errors. Playwright 1.63 needed `npx playwright install chromium`; `e2e-dev.yml` never installed a browser (latent — the job has only ever skipped for missing secrets) → step added.
- Not verified: generate-all / Discord tick paths on v30 (tonight's DEV batch); Supabase-mode pages (analysis, macro, fx, admin) in a browser.

---

## 📅 Log: 2026-09-24 15:00:00 Asia/Taipei (Task 167, PROD Supabase for 0.9.68)
- User authorized the PROD deploy. From clean tree c689ed2: PROD `stock-report` → v17, `ezbr_sha256` `f0ecd8ed9cbc` (same as DEV v29); `ai-proxy` deleted (404); linked to PROD, read-only check `is_prod=true` / `is_dev=false` (`app_settings` had 0 rows), guarded DO block dropped `get_ai_settings()` + `app_settings`; `verify.sql` installed, `verify_setup()` 10/10 PASS; re-linked to DEV (`project-ref` = `zyebvayngwrqzoaicbwd`).
- Smoke: `discord-account-tick` without secret → 401. Remaining in Task 167: user check of a real 券商 card.
- 15:20 — prompt audit of CLAUDE.md + 8 skills: 7 stale facts fixed (d33cedc); follow-ups: `functions download` works with `sbuse stock` and DEV `stock-report` matches the repo file for file (6008187), stale `.gemini` report path dropped from `run-all-e2e.cjs`, `probe-ops` Edge limits now cite the hosted docs (74b9ab9). Global `~/.claude/CLAUDE.md` gained § This machine (not in git).

---
