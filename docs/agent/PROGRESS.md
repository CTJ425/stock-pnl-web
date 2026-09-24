# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 168 — 0.9.69 released to `main`
- Status: ✅ `main` = `dev` = 0.9.69 (87050f7); Pages live; DEV Edge = repo; PROD Edge still pre-0.9.69 (awaiting user OK)
- Timestamp: 2026-09-24 23:55:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 23:55:00 Asia/Taipei (Task 168, 0.9.69 released)
- User asked to merge to `main`. Release gates at 23:42 found `ProbeWarRoom.test` failing: it read the wall clock and failed every night after 22:30 Taipei (融資融券 window closed → label changes). Pinned the clock with fake Date, added a test for all three empty-card labels. Gates: 2,470 passed / 7 skipped, exit 0; build, typecheck:edge, lint exit 0.
- 87050f7: 0.9.69 finalized, `main` fast-forwarded, `main:dev` synced. CI + Sync GitHub Releases success; Release 0.9.69 published. Pages serves `0.9.69` (in the `appLog-*.js` chunk); browser load of `#/transactions` on PROD keeps the hash, shows login, 0 console errors.
- PROD Edge not deployed (`stock-report` v17, `stock-price` unchanged): user only asked for the merge. Both refactors are behaviour-identical, so PROD keeps working; deploy when the user OKs it.

---

## 📅 Log: 2026-09-24 17:45:00 Asia/Taipei (Task 168, 0.9.69-dev.1)
- A–H done in 9 commits (11b9662…1b35efc). CI on 1b35efc failed: 1 unhandled "window is not defined" after AppShell.a11y (threads pool runs React work queued by a still-mounted tree after jsdom teardown; forks never did; RTL auto-cleanup was never active because vitest `globals` is off) → global `afterEach(cleanup)` in test setup. Gates on the final tree: 2,469 passed / 7 skipped; build, lint, typecheck:edge exit 0; `sync-edge-engine --check` clean.
- `stock-report` refactor: 26 actions × gate compared against the old if-chain by script, identical. DEV v30 `08606770fa09` smoke: unknown/`__proto__` 400, null body 400, cron actions without secret 401, admin actions 401, `generate` 401, OPTIONS 204; `source-probe` (x-cron-secret, action `probe`) 200 at 09:35 UTC after deploy.
- Findings on the way: oxlint 1.85 added 95 warnings (62 zero-width spaces in comments → removed; 4 React-Compiler rules → off in `.oxlintrc.json`, app does not use the compiler); `WorkspaceProvider` built a new provider per render (`useRef(new …)`) → `useState` initialiser; the health report's "89 hard-coded hex colours" was wrong (85 are token definitions); its "15 lint warnings" was truncated output (45).
- Browser (Playwright, local-mode build, 1280 px): TransactionsPage chunk not fetched on first paint, fetched on tab click; reload on `#/yearly` stays; back → `#/transactions` → dashboard; 新增交易 form opens; 0 console errors. Playwright 1.63 needed `npx playwright install chromium`; `e2e-dev.yml` never installed a browser (latent — the job has only ever skipped for missing secrets) → step added.
- Not verified: generate-all / Discord tick paths on v30 (tonight's DEV batch); Supabase-mode pages (analysis, macro, fx, admin) in a browser.

---
