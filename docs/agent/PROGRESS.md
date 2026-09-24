# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 168 done — 0.9.69 on `main`, PROD + DEV Edge deployed
- Status: ✅ `main` = 0.9.69; PROD and DEV run identical bundles (`stock-report` `08606770fa09`, `stock-price` `7cd8c40333bc`); linked back to DEV
- Timestamp: 2026-09-25 00:05:00 Asia/Taipei

---

## 📅 Log: 2026-09-25 00:05:00 Asia/Taipei (Task 168, PROD Edge for 0.9.69)
- User authorized DEV + PROD Supabase changes. Pre-check of the DEV night on `stock-report` v30: 92 cron calls 200; 9 batch runs, 16 reports, T86/margin/borrow all in for 20260924. Non-regressions: 1× 500 `discord-account-tick` "JWT issued at future" (same message 09-18, 09-21 — Supabase clock skew); 3 pg_net timeouts (also seen before the deploy); 3 web `render` errors "reading 'useState'" came from the user's own `vite --host` dev server started 06:23, i.e. before the React upgrade (stale `.vite/deps`) — restart it.
- From clean tree e6cb49e (Edge files = `main` 87050f7): DEV `stock-price` → v23 (comment-only catch-up); PROD `stock-report` → v18 `--no-verify-jwt`, PROD `stock-price` → v13. `ezbr_sha256` PROD = DEV for all three functions (`08606770fa09`, `7cd8c40333bc`, `15e55893c25c`); `verify_jwt` unchanged.
- PROD smoke: OPTIONS 204; unknown / `__proto__` 400; cron actions without secret 401; admin-status (anon) 401; generate 401; twlist 200 (32,197 rows); prices TPE:2330 200. Linked to PROD: `verify_setup()` 10/10 PASS; cron calls after deploy (16:00 UTC) 2× 200; edge `app_log` errors since deploy 0. Re-linked to DEV (`project-ref` = `zyebvayngwrqzoaicbwd`).

---

## 📅 Log: 2026-09-24 23:55:00 Asia/Taipei (Task 168, 0.9.69 released)
- User asked to merge to `main`. Release gates at 23:42 found `ProbeWarRoom.test` failing: it read the wall clock and failed every night after 22:30 Taipei (融資融券 window closed → label changes). Pinned the clock with fake Date, added a test for all three empty-card labels. Gates: 2,470 passed / 7 skipped, exit 0; build, typecheck:edge, lint exit 0.
- 87050f7: 0.9.69 finalized, `main` fast-forwarded, `main:dev` synced. CI + Sync GitHub Releases success; Release 0.9.69 published. Pages serves `0.9.69` (in the `appLog-*.js` chunk); browser load of `#/transactions` on PROD keeps the hash, shows login, 0 console errors.
- PROD Edge not deployed (`stock-report` v17, `stock-price` unchanged): user only asked for the merge. Both refactors are behaviour-identical, so PROD keeps working; deploy when the user OKs it.

---
