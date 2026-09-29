# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.6 released: Discord holdings card follows each workspace's fee_rebate / fee_rounding
- Status: ✅ `main` = `dev` = 0.10.6 (70cd957); PROD `stock-report` v21 = DEV v33 (sha `98a86b7a…`)
- Timestamp: 2026-09-29 17:52:30 Asia/Taipei

---

## 📅 Log: 2026-09-29 17:42:14 Asia/Taipei (BUG-088 follow-up: Discord card fee settings, 0.10.6-dev.1)
- User reported: after changing 分批買進時的預扣算法 or 現折／月退, the dashboard changed but the Discord push did not. Confirmed: `loadHoldingsWorkspaces` selected only `id, fee_rate`, so the card ignored `fee_rebate` / `fee_rounding` (BUG-088 had listed the Edge card as "not applied").
- Fix (b339777): select both columns; `buildLedgers` derives `rounding` and `basis` (Edge copy of `pnlBasis`); each workspace leg passes `rounding` to `estimateUnrealized` and takes the 牌告 figure as its main unrealized under 月退, then legs are summed (user chose per-workspace-then-sum for merged keys). Break-even unchanged: its synthetic single lot makes lot vs position identical.
- Verify: new `holdingsCard.test.ts` cases incl. independent oracle Ron 2303 月退+整筆 −17,995 / 月退+每批 −17,993; vitest 2,526 passed, 7 skipped; build, typecheck:edge, lint exit 0. DEV deploy from clean b339777: v32 → v33, sha `58e94285…` → `98a86b7a…`, verify_jwt false, POST `{}` → 400. Not verified: an actual Discord post on DEV (would send to a real webhook) — user can check via 管理 → Discord 預覽.
- Release (2026-09-29 17:52:30): user said merge straight to PROD. 70cd957 `chore(release): 0.10.6`, ff `main`, `git push origin main:dev`; CI + Sync GitHub Releases green, `gh release view 0.10.6` exists. PROD `stock-report` deployed from clean `main` 70cd957 with `--no-verify-jwt`: v20 → v21, sha `58e94285…` → `98a86b7a…` (= DEV v33), verify_jwt false, POST `{}` → 400. No DDL. Still unverified: a real Discord post.

---

## 📅 Log: 2026-09-29 16:20:50 Asia/Taipei (UI/UX critique + fixes; 0.10.5 released)
- User asked for UI/UX suggestions on dev, then to fix them all. `/impeccable critique` (single context, no subagents): 25/36. Screenshots via a Playwright script with mocked auth/rest/stock-price (session scratchpad only), 1440 light + 390 dark/light.
- Fixed: (1) 交易紀錄 ≤720px folds each row into a two-line entry (`tx-m-meta` cell, `tables.css` 720 block) instead of a sideways-scrolling table; (2) 類型 = direction mark 買 (solid) / 賣 (outlined) + nature chip (`txDirection`, `txNatureChipLabel`; `txChipLabel` removed), row edit/delete are ghost buttons shown on hover/focus with a pointer, always shown in the phone layout; (4) 累計已實現損益 passes new `LineSeriesChart` `includeZero` and releases the 760px cap, 三大法人 chart uses `.chart-with-legend` + side legend; (5) `.fx-panel.glass` gets inner padding (trend + source panels no longer touch the border); (6) `.inst-metric-seg` pressed state = solid ink fill like `.m-range` / watch view toggle.
- Skipped (3) 今日損益 on the dashboard: removed on the owner's request in 0.10.1 (CHANGELOG, `DashboardPage.tsx:5`); the repeated 台股 sub-line only appears without a USD rate.
- Verify: vitest 148 files / 2,525 tests, 2,518 passed, 7 skipped; build, lint, typecheck:edge exit 0; `verify-fee-rate-e2e.cjs` and `verify-pnl-rounding-e2e.cjs` pass against :5173; impeccable detect only the pre-existing Admin `transition: width`.
- Release (2026-09-29 16:28:20): user said merge straight to `main`. a464562 (0.10.5-dev.3) on `dev`, then 4dd8fe1 `chore(release): 0.10.5` (dev.1–dev.3 CHANGELOG sections merged into one 0.10.5 section), ff `main`, `git push origin main:dev`. main CI green, Sync GitHub Releases green, `gh release view 0.10.5` exists. Not done: PROD `fee_rounding` DDL and PROD `stock-report` redeploy (BUG-088 → Status).
- PROD ops (2026-09-29 16:33:02, user authorized both): `stock-report` deployed from 9167a40 with `--no-verify-jwt` (details in BUG-088 Status). `fee_rounding` DDL via Management API denied by the auto-mode classifier before running (pre-check had confirmed the column is absent); not retried. SQL: `docs/agent/prod-0.10.5-migration.sql`. Re-authorized by the user → applied 2026-09-29 16:36:13; checks in BUG-088 Status.

---
