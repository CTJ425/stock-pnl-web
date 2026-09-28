# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.2 released (Task 173: 持股明細 sort buttons removed, fixed 市值 order)
- Status: ✅ `main` = `dev` = 0.10.2 (b6cd4fe), Pages live, Release 0.10.2 created; no Supabase change
- Timestamp: 2026-09-28 15:22:00 Asia/Taipei

---

## 📅 Log: 2026-09-28 15:22:00 Asia/Taipei (Task 173, 0.10.2 released)
- User found the 持股明細 sort buttons (市值 / 未實現損益 / 代號) useless — within a market group of a few holdings the order rarely changed — and asked to remove them and merge straight to `main`.
- `HoldingsLedger.tsx`: `LedgerSort`, sort state, `.hl-sort` group and CSS removed; `sortRows(rows)` fixed to 市值 descending, missing quote last; head reads 「N 檔・依市值排列」. DESIGN.md ledger line updated. DashboardPage test asserts no 排序 group.
- Verify: vitest 148 files / 2,505 tests, 2,498 passed, 7 skipped; build, typecheck:edge, lint exit 0. No browser pass (removal only).
- Release: 30158f1 at 0.10.2-dev.1 on `dev` (CI green), b6cd4fe `chore(release): 0.10.2`, ff `main`, `main:dev` synced — all refs at b6cd4fe. `main` CI green, Release 0.10.2 created, Pages bundle carries `0.10.2`. No Supabase change.

---

## 📅 Log: 2026-09-28 15:07:22 Asia/Taipei (0.10.1 released, Task 172)
- User approved the local screenshots and asked to merge straight to `main`. c77f523 `feat(ui)` at 0.10.1-dev.1 pushed to `dev` (CI green), cdcac9d `chore(release): 0.10.1` (CHANGELOG heading finalized), ff `main`, `main:dev` synced — all four refs at cdcac9d.
- `main` CI green; Sync GitHub Releases created Release 0.10.1 (not draft); Pages serves the new bundle (`appLog-*.js` carries `0.10.1`). No Supabase change in this release.

---
