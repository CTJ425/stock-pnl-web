# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.3 released (Task 174: 持股明細 現價 coloured against yesterday's close)
- Status: ✅ `main` = `dev` = 0.10.3 (dbf1c10), Pages live, Release 0.10.3 created; no Supabase change
- Timestamp: 2026-09-29 13:26:55 Asia/Taipei

---

## 📅 Log: 2026-09-29 13:26:55 Asia/Taipei (Task 174, 0.10.3 released)
- User wanted each holding's current price readable at a glance. Two mockups (stronger price in the ledger / a 今日行情 strip) were rejected; the owner chose colouring the price itself: red above, green below, normal ink when flat. Baseline is yesterday's close (`prevClose`) — the holdings quote carries no open price, and broker apps use 平盤價 too.
- `HoldingsLedger.tsx`: price span gets `hl-px` + `pnl-up`/`pnl-down`; no colour when `priceStale`, `dayChange` null or 0. `dashboard.css`: `.hl-px` bold in `--ink` (also overrides the grey phone cell). Footnote 1 explains the colours. New DashboardPage test covers up / down / flat / stale / no prevClose.
- Verify: vitest 148 files / 2,506 tests, 2,499 passed, 7 skipped; build, typecheck:edge, lint exit 0. No browser pass.
- Release: 049976f at 0.10.3-dev.1 on `dev`, dbf1c10 `chore(release): 0.10.3`, ff `main`, `main:dev` synced — all refs at dbf1c10. `main` CI green, Release 0.10.3 created, Pages CSS carries `.hl-px`. No Supabase change.

---

## 📅 Log: 2026-09-28 15:22:00 Asia/Taipei (Task 173, 0.10.2 released)
- User found the 持股明細 sort buttons (市值 / 未實現損益 / 代號) useless — within a market group of a few holdings the order rarely changed — and asked to remove them and merge straight to `main`.
- `HoldingsLedger.tsx`: `LedgerSort`, sort state, `.hl-sort` group and CSS removed; `sortRows(rows)` fixed to 市值 descending, missing quote last; head reads 「N 檔・依市值排列」. DESIGN.md ledger line updated. DashboardPage test asserts no 排序 group.
- Verify: vitest 148 files / 2,505 tests, 2,498 passed, 7 skipped; build, typecheck:edge, lint exit 0. No browser pass (removal only).
- Release: 30158f1 at 0.10.2-dev.1 on `dev` (CI green), b6cd4fe `chore(release): 0.10.2`, ff `main`, `main:dev` synced — all refs at b6cd4fe. `main` CI green, Release 0.10.2 created, Pages bundle carries `0.10.2`. No Supabase change.

---
