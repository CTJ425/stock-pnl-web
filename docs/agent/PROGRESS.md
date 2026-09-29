# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.5-dev.2 on DEV (BUG-088 flooring choice + fee settings preview + P&L E2E); 0.10.4 on PROD
- Status: ✅ `main` = `dev` = 0.10.4 (d75445e), `stock-price` deployed DEV v24 + PROD v14 (sha `66664c27…`); main CI green, Release 0.10.4 created
- Timestamp: 2026-09-29 17:00:00 Asia/Taipei

---

## 📅 Log: 2026-09-29 16:10:00 Asia/Taipei (BUG-088, 0.10.5-dev.1 on DEV)
- User asked to test on DEV first and not disturb the core. Added a per-workspace choice 每一批分開算 / 整筆一起算 (`workspaces.fee_rounding`); default per lot keeps every existing figure. Details and verification in BUG-088.
- Note: during testing the user was also editing DEV (workspaces renamed SNAP-Ivan正式區 / SNAP-RON正式區, RON set to 現折, 空單測試 removed) — the dashboard's net figure on RON follows that setting, not a bug.
- Verify: vitest 148 files / 2,522 tests, 2,515 passed, 7 skipped; build, typecheck:edge, lint exit 0. Commit 8b56632 on `dev`; `main` / PROD untouched.
- Follow-up (user): preview fee changes before saving, and an E2E that adds trades and checks the P&L. 58dee12 (0.10.5-dev.2): `onPreview` preview + tag; `verify-pnl-rounding-e2e.cjs` 7/7 pass (listed in docs/UnitTests/E2E.md). vitest 2,524 tests, 2,517 passed, 7 skipped; build, typecheck:edge, lint exit 0; impeccable detect clean; screenshots 1440 light / 390 dark, no overflow. No Supabase change in dev.2.

---

## 📅 Log: 2026-09-29 15:20:00 Asia/Taipei (DEV data synced from PROD; BUG-088 opened)
- User saw DEV and PROD dashboards differ for the same workspace. Cause: DEV transaction data had drifted (DEV RON held 2303 2,000 @160 from test rows dated 9/27, a Sunday; PROD has the real 9/7–9/23 trades). Not code.
- Synced PROD → DEV on user request (PROD read-only): PROD 玉山證卷 → DEV SNAP正式區 (63 rows), PROD Ron的投資組合 → DEV RON (62 rows); DEV rows deleted and re-inserted with PROD ids and the DEV workspace owner's user_id, fee_rate / fee_rebate copied. Guarded by the DEV identity predicate inside one DO block. Verified: per-workspace md5 over all columns identical on both sides. Pre-sync DEV backup (120 rows, 2 workspaces) kept in the session scratchpad only. No triggers on `transactions`; `tx_split_log` empty on both.
- Remaining 2 TWD gap vs 元大 on 2303 → BUG-088 (per-lot vs whole-position flooring).

---
