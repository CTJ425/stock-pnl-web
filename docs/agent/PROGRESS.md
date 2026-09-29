# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.5 released; PROD `stock-report` deployed; PROD `fee_rounding` DDL blocked by the permission classifier → user runs `docs/agent/prod-0.10.5-migration.sql`
- Status: ✅ `main` = `dev` = 0.10.5; PROD `stock-report` v20 (sha `58e94285…` = DEV v32). ⏳ PROD DDL (BUG-088)
- Timestamp: 2026-09-29 16:33:02 Asia/Taipei

---

## 📅 Log: 2026-09-29 16:20:50 Asia/Taipei (UI/UX critique + fixes; 0.10.5 released)
- User asked for UI/UX suggestions on dev, then to fix them all. `/impeccable critique` (single context, no subagents): 25/36. Screenshots via a Playwright script with mocked auth/rest/stock-price (session scratchpad only), 1440 light + 390 dark/light.
- Fixed: (1) 交易紀錄 ≤720px folds each row into a two-line entry (`tx-m-meta` cell, `tables.css` 720 block) instead of a sideways-scrolling table; (2) 類型 = direction mark 買 (solid) / 賣 (outlined) + nature chip (`txDirection`, `txNatureChipLabel`; `txChipLabel` removed), row edit/delete are ghost buttons shown on hover/focus with a pointer, always shown in the phone layout; (4) 累計已實現損益 passes new `LineSeriesChart` `includeZero` and releases the 760px cap, 三大法人 chart uses `.chart-with-legend` + side legend; (5) `.fx-panel.glass` gets inner padding (trend + source panels no longer touch the border); (6) `.inst-metric-seg` pressed state = solid ink fill like `.m-range` / watch view toggle.
- Skipped (3) 今日損益 on the dashboard: removed on the owner's request in 0.10.1 (CHANGELOG, `DashboardPage.tsx:5`); the repeated 台股 sub-line only appears without a USD rate.
- Verify: vitest 148 files / 2,525 tests, 2,518 passed, 7 skipped; build, lint, typecheck:edge exit 0; `verify-fee-rate-e2e.cjs` and `verify-pnl-rounding-e2e.cjs` pass against :5173; impeccable detect only the pre-existing Admin `transition: width`.
- Release (2026-09-29 16:28:20): user said merge straight to `main`. a464562 (0.10.5-dev.3) on `dev`, then 4dd8fe1 `chore(release): 0.10.5` (dev.1–dev.3 CHANGELOG sections merged into one 0.10.5 section), ff `main`, `git push origin main:dev`. main CI green, Sync GitHub Releases green, `gh release view 0.10.5` exists. Not done: PROD `fee_rounding` DDL and PROD `stock-report` redeploy (BUG-088 → Status).
- PROD ops (2026-09-29 16:33:02, user authorized both): `stock-report` deployed from 9167a40 with `--no-verify-jwt` (details in BUG-088 Status). `fee_rounding` DDL via Management API denied by the auto-mode classifier before running (pre-check had confirmed the column is absent); not retried. SQL: `docs/agent/prod-0.10.5-migration.sql`.

---

## 📅 Log: 2026-09-29 16:10:00 Asia/Taipei (BUG-088, 0.10.5-dev.1 on DEV)
- User asked to test on DEV first and not disturb the core. Added a per-workspace choice 每一批分開算 / 整筆一起算 (`workspaces.fee_rounding`); default per lot keeps every existing figure. Details and verification in BUG-088.
- Note: during testing the user was also editing DEV (workspaces renamed SNAP-Ivan正式區 / SNAP-RON正式區, RON set to 現折, 空單測試 removed) — the dashboard's net figure on RON follows that setting, not a bug.
- Verify: vitest 148 files / 2,522 tests, 2,515 passed, 7 skipped; build, typecheck:edge, lint exit 0. Commit 8b56632 on `dev`; `main` / PROD untouched.
- Follow-up (user): preview fee changes before saving, and an E2E that adds trades and checks the P&L. 58dee12 (0.10.5-dev.2): `onPreview` preview + tag; `verify-pnl-rounding-e2e.cjs` 7/7 pass (listed in docs/UnitTests/E2E.md). vitest 2,524 tests, 2,517 passed, 7 skipped; build, typecheck:edge, lint exit 0; impeccable detect clean; screenshots 1440 light / 390 dark, no overflow. No Supabase change in dev.2.

---

