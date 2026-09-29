# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.4 released (BUG-086 quote cache lock measured from fetch time); BUG-087 (same-day buy vs broker) opened
- Status: ✅ `main` = `dev` = 0.10.4 (d75445e), `stock-price` deployed DEV v24 + PROD v14 (sha `66664c27…`); main CI green, Release 0.10.4 created
- Timestamp: 2026-09-29 15:20:00 Asia/Taipei

---

## 📅 Log: 2026-09-29 15:20:00 Asia/Taipei (DEV data synced from PROD; BUG-088 opened)
- User saw DEV and PROD dashboards differ for the same workspace. Cause: DEV transaction data had drifted (DEV RON held 2303 2,000 @160 from test rows dated 9/27, a Sunday; PROD has the real 9/7–9/23 trades). Not code.
- Synced PROD → DEV on user request (PROD read-only): PROD 玉山證卷 → DEV SNAP正式區 (63 rows), PROD Ron的投資組合 → DEV RON (62 rows); DEV rows deleted and re-inserted with PROD ids and the DEV workspace owner's user_id, fee_rate / fee_rebate copied. Guarded by the DEV identity predicate inside one DO block. Verified: per-workspace md5 over all columns identical on both sides. Pre-sync DEV backup (120 rows, 2 workspaces) kept in the session scratchpad only. No triggers on `transactions`; `tx_split_log` empty on both.
- Remaining 2 TWD gap vs 元大 on 2303 → BUG-088 (per-lot vs whole-position flooring).

---

## 📅 Log: 2026-09-29 14:30:00 Asia/Taipei (BUG-086, 0.10.4 released; BUG-087 opened)
- User reported 6560 欣普羅 (bought today) at −389 / break-even 32.79 on the dashboard vs −340 / 32.75 at the broker; 0050 / 2303 match. Analysis in BUG-087: only a 0.15% tax reproduces both broker numbers; the P&L core never used it (`sellTaxRate` 0.3% since 58a1a42). User disputes (same-day buys used to match) and asked for a full P&L-core review — code read of `estimateUnrealized` / `holdingRows` / `breakEvenPrice` found no date-dependent path; recompute of this trade with every release tag 0.9.0 → 0.10.4 (78 tags) gives −389 / 32.79 in all of them — no regression.
- User also saw DEV and PROD closes differ → BUG-086 (see FIXED_BUG.md): `twQuoteTtlMs` lock measured from now but compared with row age. Fixed in `quoteWindow.ts`, tests updated.
- Verify: vitest 148 files / 2,510 tests, 2,503 passed, 7 skipped; build, typecheck:edge, lint exit 0; dev CI green. DEV/PROD curl smoke returned 9/29 closes.
- Release: 3fa4075 at 0.10.4-dev.1 on `dev`, d75445e `chore(release): 0.10.4`, ff `main`, `main:dev` synced. User authorized merging to PROD in this session.

---
