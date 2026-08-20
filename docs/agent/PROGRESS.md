# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 123 BUG-032 fix recorded; moved to FIXED_BUG.md, added to CHANGELOG.md, Task and PROGRESS entries updated
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 13:42:49 Asia/Taipei

---

## 📅 Log: 2026-08-20 13:47:54 Asia/Taipei (0.9.4 official release — BUG-032 修正：買進費用重複計算)

- **Release**: Version 0.9.4 shipped to `main` branch; GitHub Pages deployment automatically triggered by `main` push; official GitHub Release created by `.github/workflows/release.yml`.
- **Scope**: Bug fix release. Single change: BUG-032 (Task 123) — held stock buy fee was counted twice in P&L simulator. Fix applied: held stock 買進價 now defaults to fee-exclusive `rawAvgCost` instead of fee-inclusive `avgCost`; fee counted exactly once in `whatIf()`.
- **What shipped**: WhatIfTab, StockDetailPage, AnalysisPage, and related tests updated to use `rawAvgCost` prop. (1) `WhatIfTab.tsx` — 買進價 default changed to `rawAvgCost` (fee-exclusive `pos.rawCost / pos.qty`); used in `isHeld` check, ladder anchor, avgCost mark, and marks strip. Hint text: 「買進價預設為成交均價 <price>（未含手續費）」. (2) `StockDetailPage.tsx` — `StockDetailPageProps` gains `rawAvgCost?: number | null` (defaults null), forwarded to `WhatIfTab`. (3) `AnalysisPage.tsx` — passes `selected.row.holding.rawAvgCost`. (4) `WhatIfTab.test.tsx` — two new test cases verify fee counted once and hint text accuracy.
- **What was not changed**: `pnlEngine.ts`, `fees.ts`, `whatIf()` signature/math, 庫存總覽, 年度報告, `estimateUnrealized`, `ReportHolding` / `reportProxy.ts`. Pure frontend fix, no schema, no Edge, no migration.
- **Testing**: `npx vitest run` → 73 files / **1113 tests**, all pass. `npx tsc --noEmit` → 0 errors. `npx oxlint src` → 0 errors (5 pre-existing only-export-components). `npm run build` → ok. Frontend only — no Supabase, no Edge, no schema.
- **Unfinished**: None — 0.9.4 complete and live.

---

## 📅 Log: 2026-08-20 13:42:49 Asia/Taipei (Task 123 — BUG-032 修正：買進費用重複計算 fix recorded, version 0.9.4-dev.1)

- **Task**: Task 123 (spec: `docs/agent/specs/123-bug032-raw-avg-cost.md`)
- **Scope**: Bug fix for WhatIfTab held stock simulator — buy fee was counted twice (fee-inclusive avgCost seed + fee added by whatIf).
- **What was recorded**: BUG-032 entry moved from BUG_FIX.md to FIXED_BUG.md with full resolution details (root cause, files changed, verification results). CHANGELOG.md gained 0.9.4-dev.1 section (4 bullets: fee fix, test coverage, references, non-changes). Task 123 added to TASK_ARCHIVE.md as ✅ complete. All files' version stamps (version.ts, package.json, README.md, package-lock.json) set by main session to 0.9.4-dev.1.
- **Resolution chosen**: Use raw traded price (option 1) — replace `avgCost` prop with `rawAvgCost` (fee-exclusive `pos.rawCost / pos.qty`) throughout WhatIfTab, StockDetailPage, AnalysisPage, and tests. Fee counted exactly once now. Change is plumbing only; no maths changes.
- **Verification verified**: Unit tests (1113 passed), TypeScript (0 errors), oxlint (0 errors), build (ok). Reviewer (route:reviewer) **PASS**, zero findings on end-to-end path, no other Holding.avgCost consumers affected, new prop optional, watched stocks behaviour unchanged.
- **Records finalized**: Destination writes (FIXED_BUG.md, CHANGELOG.md, TASK_ARCHIVE.md) completed; source writes (BUG_FIX.md entry deletion) completed; PROGRESS.md updated (this entry added, header updated, oldest entry rolled to archive). All grep counts verified.
- **Unfinished**: None — Task 123 complete.

