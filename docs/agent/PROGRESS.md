# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 124 成本基數精確度修正 recorded; added to CHANGELOG.md, TASK.md, PROGRESS entries updated; oldest log rolled to archive
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 14:41:35 CST

---

## 📅 Log: 2026-08-20 14:41:35 CST (Task 124 0.9.5-dev.1 損益試算成本基數精確度修正 recorded)

- **Task**: Task 124 (spec: `docs/agent/specs/124-whatif-real-cost-basis.md`)
- **Scope**: Three genuine defects on real PROD position (0050, 玉山証券 workspace: 4,000 shares, `rawCost` 416,900 → `rawAvgCost` 104.2250, `cost` 417,492 → `avgCost` 104.3730, quote 103.80).
- **What was fixed**: (1) 買進價 rounding: 104.225's binary trap → new `roundPrice()` helper (`Math.round((value + Number.EPSILON) * 100) / 100`), used by both seed and ladder; (2) buy fee recalculation: `whatIf()` gains optional `buyFee` override, WhatIfTab supplies real fee, so 投入成本 exact match 庫存總覽 (−3,298 exact parity on reference position); (3) ledger labels: buy side shows 成交均價（未含費）& 實付手續費, source in hint, sell side shows 現價.
- **Files changed**: `sources/src/utils/formatters.ts` (new `roundPrice`), `sources/src/components/StockDetail/whatIf.ts` (buyFee override, snap fix), `WhatIfTab.tsx` (seed re-keyed, labels), `StockDetailPage.tsx`, `AnalysisPage.tsx`, `sources/src/index.css`.
- **Tests added**: `sources/src/utils/formatters.test.ts` (rounding trap values); `whatIf.test.ts` & `WhatIfTab.test.tsx` gained 104.23 seed, 417,492 cost parity, −3,298 P&L match, edited-price fee rate, and label test cases.
- **Verification**: `npx vitest run` 74 files / **1125 tests** all pass; `npx tsc --noEmit` 0 errors; `npx oxlint src` 0 errors (5 pre-existing); `npm run build` ok. Frontend only — no Supabase, no Edge, no schema, no migration.
- **Reviewer verdict**: `route:reviewer` **PASS** with three RISKS fixed pre-delivery: (1) `sellLadder` snap now uses `roundPrice`, not local `Math.round`; (2) WhatIfTab re-seeds on `[ticker, rawAvgCost, avgCost, heldQty]` to sync on workspace switch; (3) `buyFee` clamped to 0 when not finite or not > 0. Spec formula (`roundPrice`) also corrected — old formula returned 0.14 for 0.145, verified fix across 0.145 / 1.005 / 104.225 / 8888.885 / 12345.675.
- **Records finalized**: CHANGELOG.md gained 0.9.5-dev.1 section (7 bullets, house style); Task 124 added to TASK.md as 🔄 (awaiting user's real-position check); this PROGRESS entry added.
- **Unfinished**: User verification on real PROD position (0050, 玉山) — compare 損益試算 against 庫存總覽 for precision match (投入成本、損益、手續費).

---

## 📅 Log: 2026-08-20 13:42:49 Asia/Taipei (Task 123 — BUG-032 修正：買進費用重複計算 fix recorded, version 0.9.4-dev.1)

- **Task**: Task 123 (spec: `docs/agent/specs/123-bug032-raw-avg-cost.md`)
- **Scope**: Bug fix for WhatIfTab held stock simulator — buy fee was counted twice (fee-inclusive avgCost seed + fee added by whatIf).
- **What was recorded**: BUG-032 entry moved from BUG_FIX.md to FIXED_BUG.md with full resolution details (root cause, files changed, verification results). CHANGELOG.md gained 0.9.4-dev.1 section (4 bullets: fee fix, test coverage, references, non-changes). Task 123 added to TASK_ARCHIVE.md as ✅ complete. All files' version stamps (version.ts, package.json, README.md, package-lock.json) set by main session to 0.9.4-dev.1.
- **Resolution chosen**: Use raw traded price (option 1) — replace `avgCost` prop with `rawAvgCost` (fee-exclusive `pos.rawCost / pos.qty`) throughout WhatIfTab, StockDetailPage, AnalysisPage, and tests. Fee counted exactly once now. Change is plumbing only; no maths changes.
- **Verification verified**: Unit tests (1113 passed), TypeScript (0 errors), oxlint (0 errors), build (ok). Reviewer (route:reviewer) **PASS**, zero findings on end-to-end path, no other Holding.avgCost consumers affected, new prop optional, watched stocks behaviour unchanged.
- **Records finalized**: Destination writes (FIXED_BUG.md, CHANGELOG.md, TASK_ARCHIVE.md) completed; source writes (BUG_FIX.md entry deletion) completed; PROGRESS.md updated (this entry added, header updated, oldest entry rolled to archive). All grep counts verified.
- **Unfinished**: None — Task 123 complete.

