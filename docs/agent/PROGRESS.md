# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.10.1 released (Task 172: 今日損益 removed, 年度收益 手續費 / 交易稅 columns)
- Status: ✅ `main` = `dev` = 0.10.1 (cdcac9d), Pages live, Release 0.10.1 created; no Supabase change
- Timestamp: 2026-09-28 15:07:22 Asia/Taipei

---

## 📅 Log: 2026-09-28 15:07:22 Asia/Taipei (0.10.1 released, Task 172)
- User approved the local screenshots and asked to merge straight to `main`. c77f523 `feat(ui)` at 0.10.1-dev.1 pushed to `dev` (CI green), cdcac9d `chore(release): 0.10.1` (CHANGELOG heading finalized), ff `main`, `main:dev` synced — all four refs at cdcac9d.
- `main` CI green; Sync GitHub Releases created Release 0.10.1 (not draft); Pages serves the new bundle (`appLog-*.js` carries `0.10.1`). No Supabase change in this release.

---

## 📅 Log: 2026-09-28 14:54:57 Asia/Taipei (Task 172, 0.10.1)
- User asked where 今日損益 comes from ((現價 − 昨收) × 目前股數, no fees, ignores same-day trades), then asked to delete everything 今日損益 and to split 年度收益's 手續費 / 稅金 column (option C), designed with impeccable. Decisions taken via AskUserQuestion: dashboard hero becomes 未實現淨損益; 漲跌幅 column stays.
- Dashboard: totals are 未實現淨損益 (hero, as-of + refresh, TW/US split, fee-basis link) + 持倉市值; 今日損益 column, subtotal, sort and footnote removed (footnotes renumbered 1–2); sort default 市值, 未實現損益 replaces the today sort; `rowToday` / `today` / `prevValue` deleted from `dashboardSums.ts`. Phone row: `'stock stock unr' / 'px chg unr'`, return under the P&L. `.stmt-totals` now `grid-auto-flow: column` (lead 1.35fr, rest 1fr) so 年度收益's 3 totals and the dashboard's 2 share it; `.stmt-tot-today` → `.stmt-tot-lead`.
- 個股分析 我的持股: 今日損益 cell removed (grid 4 → 3; on phones the third spans the row).
- 年度收益: `FeeCell` → `FeeCells` = 手續費 (fees − feesTax) + 交易稅 (feesTax) columns on every row, zero → muted dash, TW whole dollars; footnotes 8 手續費 / 9 交易稅 / 10 筆數 (`columnHelp.ts` brokerage/tax).
- DESIGN.md + dashboard surface brief updated.
- Verify: vitest 148 files / 2,505 tests, 2,498 passed, 7 skipped (new YearlyPage fee-split test); build and lint exit 0; impeccable detect `[]`. Playwright on local mode (seeded store + price cache) 1440/390 light/dark: no horizontal overflow, no page errors; 年度收益 10 columns fit at 1440. Not seen in a browser: 個股分析 (needs cloud mode) — covered by QuoteTab tests only.

---
