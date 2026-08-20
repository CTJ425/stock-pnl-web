# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.3-dev.2 and dev.3 releases recorded; dev.2 superceded by dev.3
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 13:03:55 Asia/Taipei

---

## 📅 Log: 2026-08-20 13:03:55 Asia/Taipei (0.9.3-dev.2 + dev.3 — 賣出階梯聯集窗口迭代及現價聚簇設計定稿)

- **Release**: Two iterations on `dev` branch (Task 121 dev.2, Task 122 dev.3); frontend only, no deployment yet.
- **Scope**: Iterative refinement of sell ladder UI design in response to user feedback on price divergence causing layout instability.
- **What changed** (Task 121 & 122):
  1. **dev.2 (intermediate, superseded)** — Dynamic union window covering both average cost and current price; step grid changed to "pretty prices" (1/2/2.5/5/10 × 10^k, ~12 steps); summary marks row with price/relative%/P&L. Two FAIL items from reviewer (mark row rounding, title consistency) fixed before submission. User feedback: unstable when cost and price diverge significantly.
  2. **dev.3 (current, active)** — Fixed-window design: main ladder anchored to ±10% average cost (nine 2.5% steps); current price cluster (±2.5%/±5%/±7.5%, seven rows) when outside window; gap divider between clusters; all dev.2 union window and pretty-price logic removed (dead-code cleanup verified). Title reverts to 「賣出階梯 · 持有均價 ±10%」 or by context. Mark summary and click-to-input behaviour unchanged. Watch stocks (no average cost) identical to 0.9.1.
- **Testing**: `npx vitest run` → 73 files, **1111 passed**, 0 failed. `npx tsc --noEmit` clean; `npx oxlint` 0 errors (5 pre-existing only-export-components); `npm run build` ok.
- **Review**: `route:reviewer` found one false-positive FAIL (tests undeclared by builder); main session confirmed tests pre-written before builder dispatch; PASS on code quality (no defects on dead-code cleanup, cluster boundaries, deduplication, gap row, watch stock parity, per-row computation, CSS).
- **Unfinished**: None — both versions complete. Awaiting user visual check on DEV before merge to main.

---

## 📅 Log: 2026-08-20 11:21:23 Asia/Taipei (0.9.3-dev.1 — 賣出階梯均價錨點 + 觀察股票 Modal 設計精化)

- **Release**: Version 0.9.3-dev.1 on `dev` branch (frontend only, no deployment yet).
- **Scope**: Two feature enhancements: average cost anchoring for sell ladder, and Material Design styling for watch modal. No schema changes, no Edge function changes, no migration required.
- **What changed** (Task 119 & 120):
  1. **Sell ladder average cost anchor** — `whatIf.ts:sellLadder()` gains optional `LadderMarks` parameter. All nine steps marked `kind: 'step'`; break-even and average cost rows inserted dynamically when falling inside ±10% window. New `LadderKind: 'avgCost'`. Deduplication rank: `current:3 > avgCost:2 > breakEven:1 > step:0`. All mark prices snapped to 0.01 grid before window check. `WhatIfTab` anchor is holding average cost (when set and > 0), else previous current price. Heading and relative column label switch context. No new CSS colors.
  2. **Watch modal Material styling** — `AddWatchModal.tsx` result list gains semantic classes. `index.css` new `.watch-results*` rules: 48px touch targets, full-width accent underline on search focus, hover/active/`:focus-visible` states, reusing only existing custom properties (`--accent`, `--accent-strong`, `--ink-secondary`, `--border`, `--shadow-card`). No new color literals, no component library added.
- **Testing**: `npx vitest run` → 73 files, **1100 passed**, 0 failed. `npx tsc --noEmit` clean; `npx oxlint` 0 errors; `npm run build` ok.
- **Review**: `route:reviewer` round 1 had one real blocker for Task 119 (mark rows unrounded, causing duplicate display text); fixed by snapping to 0.01 grid; three new tests added and now pass. Second finding (builder edited tests) rejected; tests were written by main session before dispatch.
- **Unfinished**: None — both tasks complete. Awaiting user visual check on DEV before any merge to main.

---

