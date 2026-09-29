# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.4 released (BUG-086 quote cache lock measured from fetch time); BUG-087 (same-day buy vs broker) opened
- Status: ✅ `main` = `dev` = 0.10.4 (d75445e), `stock-price` deployed DEV v24 + PROD v14 (sha `66664c27…`); main CI green, Release 0.10.4 created
- Timestamp: 2026-09-29 14:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-29 14:30:00 Asia/Taipei (BUG-086, 0.10.4 released; BUG-087 opened)
- User reported 6560 欣普羅 (bought today) at −389 / break-even 32.79 on the dashboard vs −340 / 32.75 at the broker; 0050 / 2303 match. Analysis in BUG-087: only a 0.15% tax reproduces both broker numbers; the P&L core never used it (`sellTaxRate` 0.3% since 58a1a42). User disputes (same-day buys used to match) and asked for a full P&L-core review — code read of `estimateUnrealized` / `holdingRows` / `breakEvenPrice` found no date-dependent path; recompute of this trade with every release tag 0.9.0 → 0.10.4 (78 tags) gives −389 / 32.79 in all of them — no regression.
- User also saw DEV and PROD closes differ → BUG-086 (see FIXED_BUG.md): `twQuoteTtlMs` lock measured from now but compared with row age. Fixed in `quoteWindow.ts`, tests updated.
- Verify: vitest 148 files / 2,510 tests, 2,503 passed, 7 skipped; build, typecheck:edge, lint exit 0; dev CI green. DEV/PROD curl smoke returned 9/29 closes.
- Release: 3fa4075 at 0.10.4-dev.1 on `dev`, d75445e `chore(release): 0.10.4`, ff `main`, `main:dev` synced. User authorized merging to PROD in this session.

---

## 📅 Log: 2026-09-29 13:26:55 Asia/Taipei (Task 174, 0.10.3 released)
- User wanted each holding's current price readable at a glance. Two mockups (stronger price in the ledger / a 今日行情 strip) were rejected; the owner chose colouring the price itself: red above, green below, normal ink when flat. Baseline is yesterday's close (`prevClose`) — the holdings quote carries no open price, and broker apps use 平盤價 too.
- `HoldingsLedger.tsx`: price span gets `hl-px` + `pnl-up`/`pnl-down`; no colour when `priceStale`, `dayChange` null or 0. `dashboard.css`: `.hl-px` bold in `--ink` (also overrides the grey phone cell). Footnote 1 explains the colours. New DashboardPage test covers up / down / flat / stale / no prevClose.
- Verify: vitest 148 files / 2,506 tests, 2,499 passed, 7 skipped; build, typecheck:edge, lint exit 0. No browser pass.
- Release: 049976f at 0.10.3-dev.1 on `dev`, dbf1c10 `chore(release): 0.10.3`, ff `main`, `main:dev` synced — all refs at dbf1c10. `main` CI green, Release 0.10.3 created, Pages CSS carries `.hl-px`. No Supabase change.

---

