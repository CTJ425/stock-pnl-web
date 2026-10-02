# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.21 released** — 月退 list-price cost + separate sell-fee basis (Task 189); PROD settings of 玉山證卷 / Ron的投資組合 set with no figure change.
- Status: ✅ `main` = `dev` = `99cbe50` (+ docs); PROD DDL + Edge applied and verified; live site serves 0.10.21.
- Timestamp: 2026-10-02 15:25:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 15:25:00 Asia/Taipei (0.10.21 released — Task 189)
- **Release**: gates (`npm test` 2,819 pass / 7 skipped, `npm run build`, `npm run typecheck:edge`) green; `main` = `dev` = `99cbe50`; CI + Release 0.10.21 by CI (body checked); live bundle carries `sell_fee_basis`.
- **PROD**: DDL `sell_fee_basis` (identity-guarded), `verify_setup()` 10/10; Edge `stock-report` v25, ezbr c3e280bd0730… (= DEV v41).
- **PROD settings (user's request)**: Ron的投資組合 → 現折／日退 + 牌告; 玉山證卷 → 月退 + 牌告. Every holding's figure and ROI identical before/after on the same quotes (玉山 76,779 total, Ron −11,038); details TASK 189 item 6.
- **Left**: TASK 189 items 7 and 11 (00685L is never discounted; one rate per workspace).
---
## 📅 Log: 2026-10-02 17:10:00 Asia/Taipei (Task 189, 0.10.21-dev.2 — PROD Ron snapshot, regression fixed)
- **Snapshot**: PROD Ron的投資組合 (65 rows, settings 0.0004275 / 月退 / 整筆 / 當沖稅 false) copied over DEV demo01 「Ron」; Σfee_tax 11,926 and Σprice×qty 7,446,140 equal on both. Raw rows and the DEV before-image are outside the repo: `~/stock-pnl-web-snapshots/2026-10-02-ron/`. Owner says 0.10.20 matches the 元大 app.
- **Regression (user report: 聯電 off)**: dev.1 lifted the cost of every 月退 workspace; on the snapshot 2303 went −1,070 → −1,393, 009828 −10. Ron is 月退 only for the posted-rate sell; 元大 is 日退.
- **Fix (user's choice)**: `listPriceCost` — the uplift needs 月退 and a saved `sell_fee_basis`; NULL = the 0.10.20 figure. Snapshot re-run equals 0.10.20 on all three holdings.
- **Verified**: vitest 2,819 pass / 7 skipped; build / lint / `typecheck:edge` exit 0; both Playwright scripts PASS. DEV Edge `stock-report` v41 from clean `36b2ed0`, ezbr b5f9b528… → c3e280bd0730…, verify_jwt false.
- **Left**: user test on DEV (玉山 workspace needs one 儲存 to show −610); PROD only on explicit OK.
