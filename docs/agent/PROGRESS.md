# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.3-dev.1 and 0.9.2 releases recorded
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 11:21:23 Asia/Taipei

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

## 📅 Log: 2026-08-20 10:55:00 Asia/Taipei (0.9.2 — 損益試算賣出階梯列序反轉：由高而低)

- **Release**: Version 0.9.2 on `dev` branch (frontend only, no deployment yet).
- **Scope**: Single-line behaviour change: sell ladder row order reversed from ascending (−10% on top) to descending (+10% on top, highest price first). No schema changes, no Edge function changes, no migration required.
- **What changed**:
  1. **Row order reversed in `sellLadder()`** — `sources/src/components/StockDetail/whatIf.ts:116` final sort changed from `rows.sort((a, b) => a.price - b.price)` to `rows.sort((a, b) => b.price - a.price)`. JSDoc above function now states rows are ordered highest price first. No other logic touched: steps, break-even insertion, deduplication (keeps most specific `kind`), per-row `whatIf()` recomputation all unchanged.
  2. **Test expectations updated** — `whatIf.test.ts` and `WhatIfTab.test.tsx` adjusted for descending order (step price array, `rows[0].relative` is now +0.1, sorted-order assertion uses `b - a`).
- **Testing**: `npx vitest run` → 73 files, **1090 passed**, 0 failed. `npx tsc --noEmit` clean; `npx oxlint` 0 errors; `npm run build` ok.
- **Verification**: All tests green; visual intent: highest sell price reads first, matching user workflow and intuition about sale sequence.
- **Unfinished**: None — complete release.

