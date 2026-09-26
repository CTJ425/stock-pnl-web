# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 170 — 0.9.71 released (statement redesign, app icons); old tasks archived out of TASK.md
- Status: ✅ `main` = `dev` = 0.9.71 (495d974), Pages live. ⏳ PROD DDL `fee_rebate` owed by the user (`docs/agent/prod-0.9.71-migration.sql`); until then saving 月退 on PROD fails with 「儲存折扣退還方式失敗」, everything else works (column-set fallback)
- Timestamp: 2026-09-27 06:10:00 Asia/Taipei

---

## 📅 Log: 2026-09-27 06:10:00 Asia/Taipei (Task 170, 0.9.71 released)
- User approved the DEV build (「目前這個版本看起來不錯」) and asked to archive old handoff items and finish the new task. TASK.md: every task opened before Task 170 moved verbatim to `TASK_ARCHIVE.md` (`## Archived 2026-09-27 —— unfinished tasks before Task 170`); Task 47 (recurring) kept.
- Icons: favicon.svg, apple-touch-icon (180), icon-192/512, maskable-512 re-rendered from the statement mark (Playwright, white tile; maskable at 50% for the safe circle); manifest background/theme `#ffffff`. 02e2642 (0.9.71-dev.2).
- Release: 495d974 `chore(release): 0.9.71`, ff to `main`, `main:dev` synced. CI + Sync GitHub Releases success, Release 0.9.71 exists; Pages serves the new bundle (`fee_rebate` present) and the new favicon.
- PROD DDL via the Management API was **denied** by the permission classifier ([Production Deploy]); not retried. SQL for the SQL Editor: `docs/agent/prod-0.9.71-migration.sql` (PROD identity guard + check query). PROD `stock-report` not redeployed (type-only engine change).
- Verify before release: vitest 2,495 passed / 7 skipped / 0 failed; build, typecheck:edge, lint exit 0.

---

## 📅 Log: 2026-09-27 05:37:04 Asia/Taipei (Task 170, 0.9.71-dev.1)
- User asked (2026-09-26) for a full UI/UX redesign via the `impeccable` skill: PRODUCT.md written (init), direction round picked 「券商對帳單」 (seed 6e53c8cb, kind pick), mockup reviewed and published as a private artifact (claude.ai/artifact/TayczZvWjGtebLsoEWaTb3), user approved with two changes: fee basis derived from the workspace fee settings, no metadata strip. Direction contract: `.impeccable/surfaces/sources-src-components-dashboard-dashboardpage-tsx.md`; system: `DESIGN.md` + `.impeccable/design.json`.
- DEV baseline before the change: REST export of every public table except `app_secrets` into `.snapshots/dev-baseline-2026-09-26-redesign/` (gitignored; `snapshot.cjs` needs Docker, which this host lacks) plus local-mode screenshots. Logged-in DEV screenshots were **not** taken: minting a session for a DEV account was denied by the permission classifier.
- Code: tokens.css re-valued (Carbon names kept), Public Sans + Noto Sans TC, buttons/fields/tags/notices/toast/nav restyled; dashboard rewritten (`DashboardPage`, `HoldingsLedger`, `dashboardSums`), `WorkspaceFeeSettings` shared by the dashboard panel and the workspace menu; `utils/pnlBasis.ts` derives the basis (月退 + discount → 牌告 0.1425%); `useUsdTwdRate` for the TWD-combined totals; AnalysisPage uses the same basis.
- Data: `workspaces.fee_rebate TEXT` + CHECK (instant|monthly) in schema.sql and verify.sql; applied on DEV with an identity guard, PostgREST sees it (HTTP 200). `listWorkspaces` steps down column sets so a DB without the column still logs in. Edge engine `models.ts` re-synced (type only).
- Verify: vitest 147 files / 2,502 tests, 2,495 passed, 7 skipped, 0 failed; `npm run build`, `typecheck:edge`, `lint` exit 0; impeccable detector 0 findings on the new files; Playwright local mode 1440/390 light/dark: no horizontal overflow, no console errors.
