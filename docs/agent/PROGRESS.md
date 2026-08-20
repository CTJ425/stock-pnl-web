# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.3-dev.2 and dev.3 releases recorded; dev.2 superceded by dev.3
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 13:03:55 Asia/Taipei

---

## 📅 Log: 2026-08-20 13:15:00 Asia/Taipei (0.9.3 release finalized — 賣出階梯均價錨點與現價聚簇 + Modal Material 化)

- **Release**: Version 0.9.3 finalized and recorded; ready to ship to `main`.
- **Scope**: Official release consolidating four completed tasks (119, 120, 121, 122) covering sell ladder average cost anchoring, price clustering, summary marks, and Material Design modal styling.
- **What shipped**: (1) Sell ladder now anchors to holding average cost (±10%, nine 2.5% steps); mark rows (current price, average cost, break-even) inserted dynamically when falling inside window; all prices snapped to 0.01 grid. (2) When current price falls outside window, a secondary cluster (±2.5%/±5%/±7.5%) is rendered with non-clickable gap divider (`whatif-ladder-gap`) between. `LadderRow` gains `group: 'anchor' | 'quote'`. (3) Summary mark row above ladder showing price, relative %, P&L at each mark price, clickable to input sell price. (4) Watch modal (`AddWatchModal.tsx`) gains semantic classes (`.watch-results*` family) and Material styling: 48px touch targets, hover/active/focus-visible states, full-width accent underline on search focus, using only existing custom properties (no new color literals, no component library). Watch stocks (without average cost) behave identically to 0.9.1.
- **Process note**: Development proceeded through two iterations (dev.1, dev.2, dev.3). Task 121 (dev.2: union window + pretty price grid) was superseded after user feedback; entire design removed in dev.3 and replaced with fixed window + quote clustering approach.
- **Testing**: `npx vitest run` → 73 files, **1111 passed**. `npx tsc --noEmit` clean; `npx oxlint src` 0 errors (5 pre-existing only-export-components); `npm run build` ok.
- **Records finalized**: CHANGELOG.md consolidated three dev sections into one 0.9.3 entry; TASK.md cleaned (119, 120, 121, 122 moved to TASK_ARCHIVE.md); PROGRESS.md this entry added; BUG_FIX.md verified (fee-inclusive avgCost double-count remains open, needs user decision).

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


