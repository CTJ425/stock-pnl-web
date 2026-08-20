# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task 123 BUG-032 fix recorded; moved to FIXED_BUG.md, added to CHANGELOG.md, Task and PROGRESS entries updated
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 13:42:49 Asia/Taipei

---

## 📅 Log: 2026-08-20 13:42:49 Asia/Taipei (Task 123 — BUG-032 修正：買進費用重複計算 fix recorded, version 0.9.4-dev.1)

- **Task**: Task 123 (spec: `docs/agent/specs/123-bug032-raw-avg-cost.md`)
- **Scope**: Bug fix for WhatIfTab held stock simulator — buy fee was counted twice (fee-inclusive avgCost seed + fee added by whatIf).
- **What was recorded**: BUG-032 entry moved from BUG_FIX.md to FIXED_BUG.md with full resolution details (root cause, files changed, verification results). CHANGELOG.md gained 0.9.4-dev.1 section (4 bullets: fee fix, test coverage, references, non-changes). Task 123 added to TASK_ARCHIVE.md as ✅ complete. All files' version stamps (version.ts, package.json, README.md, package-lock.json) set by main session to 0.9.4-dev.1.
- **Resolution chosen**: Use raw traded price (option 1) — replace `avgCost` prop with `rawAvgCost` (fee-exclusive `pos.rawCost / pos.qty`) throughout WhatIfTab, StockDetailPage, AnalysisPage, and tests. Fee counted exactly once now. Change is plumbing only; no maths changes.
- **Verification verified**: Unit tests (1113 passed), TypeScript (0 errors), oxlint (0 errors), build (ok). Reviewer (route:reviewer) **PASS**, zero findings on end-to-end path, no other Holding.avgCost consumers affected, new prop optional, watched stocks behaviour unchanged.
- **Records finalized**: Destination writes (FIXED_BUG.md, CHANGELOG.md, TASK_ARCHIVE.md) completed; source writes (BUG_FIX.md entry deletion) completed; PROGRESS.md updated (this entry added, header updated, oldest entry rolled to archive). All grep counts verified.
- **Unfinished**: None — Task 123 complete.

---

## 📅 Log: 2026-08-20 13:15:00 Asia/Taipei (0.9.3 release finalized — 賣出階梯均價錨點與現價聚簇 + Modal Material 化)

- **Release**: Version 0.9.3 finalized and recorded; ready to ship to `main`.
- **Scope**: Official release consolidating four completed tasks (119, 120, 121, 122) covering sell ladder average cost anchoring, price clustering, summary marks, and Material Design modal styling.
- **What shipped**: (1) Sell ladder now anchors to holding average cost (±10%, nine 2.5% steps); mark rows (current price, average cost, break-even) inserted dynamically when falling inside window; all prices snapped to 0.01 grid. (2) When current price falls outside window, a secondary cluster (±2.5%/±5%/±7.5%) is rendered with non-clickable gap divider (`whatif-ladder-gap`) between. `LadderRow` gains `group: 'anchor' | 'quote'`. (3) Summary mark row above ladder showing price, relative %, P&L at each mark price, clickable to input sell price. (4) Watch modal (`AddWatchModal.tsx`) gains semantic classes (`.watch-results*` family) and Material styling: 48px touch targets, hover/active/focus-visible states, full-width accent underline on search focus, using only existing custom properties (no new color literals, no component library). Watch stocks (without average cost) behave identically to 0.9.1.
- **Process note**: Development proceeded through two iterations (dev.1, dev.2, dev.3). Task 121 (dev.2: union window + pretty price grid) was superseded after user feedback; entire design removed in dev.3 and replaced with fixed window + quote clustering approach.
- **Testing**: `npx vitest run` → 73 files, **1111 passed**. `npx tsc --noEmit` clean; `npx oxlint src` 0 errors (5 pre-existing only-export-components); `npm run build` ok.
- **Records finalized**: CHANGELOG.md consolidated three dev sections into one 0.9.3 entry; TASK.md cleaned (119, 120, 121, 122 moved to TASK_ARCHIVE.md); PROGRESS.md this entry added; BUG_FIX.md verified (fee-inclusive avgCost double-count remains open, needs user decision).


