# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 189 on DEV (0.10.21-dev.2)** — 月退 list-price cost only after the owner saves the new settings; PROD Ron snapshot on DEV.
- Status: 🔄 `dev` only; DEV DDL + Edge applied; PROD = 0.10.20, untouched. Awaiting the user's DEV test.
- Timestamp: 2026-10-02 17:10:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 17:10:00 Asia/Taipei (Task 189, 0.10.21-dev.2 — PROD Ron snapshot, regression fixed)
- **Snapshot**: PROD Ron的投資組合 (65 rows, settings 0.0004275 / 月退 / 整筆 / 當沖稅 false) copied over DEV demo01 「Ron」; Σfee_tax 11,926 and Σprice×qty 7,446,140 equal on both. Raw rows and the DEV before-image are outside the repo: `~/stock-pnl-web-snapshots/2026-10-02-ron/`. Owner says 0.10.20 matches the 元大 app.
- **Regression (user report: 聯電 off)**: dev.1 lifted the cost of every 月退 workspace; on the snapshot 2303 went −1,070 → −1,393, 009828 −10. Ron is 月退 only for the posted-rate sell; 元大 is 日退.
- **Fix (user's choice)**: `listPriceCost` — the uplift needs 月退 and a saved `sell_fee_basis`; NULL = the 0.10.20 figure. Snapshot re-run equals 0.10.20 on all three holdings.
- **Verified**: vitest 2,819 pass / 7 skipped; build / lint / `typecheck:edge` exit 0; both Playwright scripts PASS. DEV Edge `stock-report` v41 from clean `36b2ed0`, ezbr b5f9b528… → c3e280bd0730…, verify_jwt false.
- **Left**: user test on DEV (玉山 workspace needs one 儲存 to show −610); PROD only on explicit OK.
---
## 📅 Log: 2026-10-02 16:30:00 Asia/Taipei (Task 189, 0.10.21-dev.1 on DEV)
- **Report**: 玉山 009828 App −610 vs dashboard −515; user asked how 月退 should work and to keep 元大 right.
- **Root cause**: the 牌告 figure swapped only the sell fee; a 月退 app's cost holds the list buy fee settlement took (152 vs recorded 57). 元大 (日退, posted-rate sell) was only matching because its workspace was set 月退.
- **Fix (A2, user's choice)**: `sell_fee_basis` column split off `fee_rebate`; 月退 lifts the 券商 cost by `monthlyRebateCostUplift`. Details and broker sources: TASK.md Task 189.
- **Verified**: vitest 2,817 pass / 7 skipped; build, lint, `typecheck:edge` exit 0; two Playwright scripts PASS on the local vite (mocked backend) incl. 390px; DEV DDL applied with identity guard, `verify_setup()` 10/10; DEV Edge `stock-report` v40 from `8bd36d9`, ezbr → b5f9b528….
- **Left**: user test on DEV; Ron的投資組合 must be switched to 日退 + 牌告 when this reaches PROD; PROD only on explicit OK.
