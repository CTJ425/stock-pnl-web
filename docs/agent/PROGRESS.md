# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 170 — statement redesign (券商對帳單) on `dev` as 0.9.71-dev.1; DEV DDL `workspaces.fee_rebate` applied
- Status: 🔄 `dev` = 0.9.71-dev.1, `main` = 0.9.70. Waiting for the user's review before `main`; PROD DDL not applied yet
- Timestamp: 2026-09-27 05:37:04 Asia/Taipei

---

## 📅 Log: 2026-09-27 05:37:04 Asia/Taipei (Task 170, 0.9.71-dev.1)
- User asked (2026-09-26) for a full UI/UX redesign via the `impeccable` skill: PRODUCT.md written (init), direction round picked 「券商對帳單」 (seed 6e53c8cb, kind pick), mockup reviewed and published as a private artifact (claude.ai/artifact/TayczZvWjGtebLsoEWaTb3), user approved with two changes: fee basis derived from the workspace fee settings, no metadata strip. Direction contract: `.impeccable/surfaces/sources-src-components-dashboard-dashboardpage-tsx.md`; system: `DESIGN.md` + `.impeccable/design.json`.
- DEV baseline before the change: REST export of every public table except `app_secrets` into `.snapshots/dev-baseline-2026-09-26-redesign/` (gitignored; `snapshot.cjs` needs Docker, which this host lacks) plus local-mode screenshots. Logged-in DEV screenshots were **not** taken: minting a session for a DEV account was denied by the permission classifier.
- Code: tokens.css re-valued (Carbon names kept), Public Sans + Noto Sans TC, buttons/fields/tags/notices/toast/nav restyled; dashboard rewritten (`DashboardPage`, `HoldingsLedger`, `dashboardSums`), `WorkspaceFeeSettings` shared by the dashboard panel and the workspace menu; `utils/pnlBasis.ts` derives the basis (月退 + discount → 牌告 0.1425%); `useUsdTwdRate` for the TWD-combined totals; AnalysisPage uses the same basis.
- Data: `workspaces.fee_rebate TEXT` + CHECK (instant|monthly) in schema.sql and verify.sql; applied on DEV with an identity guard, PostgREST sees it (HTTP 200). `listWorkspaces` steps down column sets so a DB without the column still logs in. Edge engine `models.ts` re-synced (type only).
- Verify: vitest 147 files / 2,502 tests, 2,495 passed, 7 skipped, 0 failed; `npm run build`, `typecheck:edge`, `lint` exit 0; impeccable detector 0 findings on the new files; Playwright local mode 1440/390 light/dark: no horizontal overflow, no console errors.

---

## 📅 Log: 2026-09-25 23:30:00 Asia/Taipei (Task 169, 0.9.70 released)
- User asked to merge straight to `main`. 8b0e663 (0.9.70-dev.1) pushed to `dev`, CI success; 13ed768 finalized 0.9.70, `main` fast-forwarded, `main:dev` synced (both tips 13ed768).
- `main` CI + Sync GitHub Releases success; Release 0.9.70 published. Pages `appLog-*.js` carries `0.9.70`. Frontend-only change: no Edge / DDL to deploy. No browser check of the search behaviour itself (covered by the unit test only).
