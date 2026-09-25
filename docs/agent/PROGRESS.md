# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 169 — 年度收益 search auto-expands matched years / sells (uncommitted)
- Status: 🔄 code + test done on working tree; `main` = 0.9.69
- Timestamp: 2026-09-25 15:20:00 Asia/Taipei

---

## 📅 Log: 2026-09-25 15:20:00 Asia/Taipei (Task 169, 年度收益 search auto-expand)
- User: searching a stock on 年度收益 showed nothing until the 2026 year row was expanded by hand. Cause: the search re-aggregates rows but `expanded` / `expandedTickers` stay at their default (collapsed), so the matching ticker and sell rows are hidden.
- Fix (`YearlyPage.tsx` `YearlySection`): when the trimmed query changes, set state during render — non-empty query opens every matched year and every ticker with sells; clearing it folds back to collapsed. Manual toggles still work until the query changes.
- New test in `YearlyPage.test.tsx` fails without the fix, passes with it. `npm test` 2,471 passed / 7 skipped; `npm run build` green. Not committed, not browser-checked.

---

## 📅 Log: 2026-09-25 00:05:00 Asia/Taipei (Task 168, PROD Edge for 0.9.69)
- User authorized DEV + PROD Supabase changes. Pre-check of the DEV night on `stock-report` v30: 92 cron calls 200; 9 batch runs, 16 reports, T86/margin/borrow all in for 20260924. Non-regressions: 1× 500 `discord-account-tick` "JWT issued at future" (same message 09-18, 09-21 — Supabase clock skew); 3 pg_net timeouts (also seen before the deploy); 3 web `render` errors "reading 'useState'" came from the user's own `vite --host` dev server started 06:23, i.e. before the React upgrade (stale `.vite/deps`) — restart it.
- From clean tree e6cb49e (Edge files = `main` 87050f7): DEV `stock-price` → v23 (comment-only catch-up); PROD `stock-report` → v18 `--no-verify-jwt`, PROD `stock-price` → v13. `ezbr_sha256` PROD = DEV for all three functions (`08606770fa09`, `7cd8c40333bc`, `15e55893c25c`); `verify_jwt` unchanged.
- PROD smoke: OPTIONS 204; unknown / `__proto__` 400; cron actions without secret 401; admin-status (anon) 401; generate 401; twlist 200 (32,197 rows); prices TPE:2330 200. Linked to PROD: `verify_setup()` 10/10 PASS; cron calls after deploy (16:00 UTC) 2× 200; edge `app_log` errors since deploy 0. Re-linked to DEV (`project-ref` = `zyebvayngwrqzoaicbwd`).

---
