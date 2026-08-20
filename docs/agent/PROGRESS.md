# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.1-dev.3 completion recording & verification
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 10:31:21 Asia/Taipei

---

## 📅 Log: 2026-08-20 10:31:21 Asia/Taipei (0.9.1-dev.3 — 損益試算 對帳單改為三欄共用列版面)

- **Release**: Version 0.9.1-dev.3 on `dev` branch (frontend only, no deployment yet).
- **Scope**: Layout restructuring of the 損益試算 ledger. No schema changes, no Edge function changes, no migration required.
- **What changed** (Task 118):
  1. **Ledger CSS grid rewrite** — `WhatIfTab.tsx` ledger renders as single CSS grid with three columns (項目 / 買進 · 假設 / 賣出 · 試算) and one shared row per line item (價格 / 股數 / 價金 / 費用 / 小計). Previously two side-by-side columns: left column's 股數 is input + 單位 select (~62px tall), right column's 股數 text-only (~26px). From 價金 downward the sides sat ~36px out of step. Grid layout ensures cells in same row are same height (Δtop = 0px, Δheight = 0px).
  2. **Accessibility preserved** — Per-input `<label>` elements removed; row-key cell names row and controls carry `aria-label` (`買進價格`, `股數`, `單位`, `賣出價格`). Test selectors unchanged.
  3. **Responsive without breakpoint** — `index.css` `.whatif-ledger` stays three columns at every width. Under 560px: padding, font-size and key-column width shrink instead of collapsing, preserving the alignment that motivated the change.
- **Testing**: `npx vitest run` → 73 files, **1090 passed** (0.9.1-dev.2 had 1089), 0 failed. `npx tsc --noEmit` clean; `npx oxlint` 0 errors; `npm run build` ok.
- **Browser verification** — `node scripts/verify-watchlist-e2e.cjs` against DEV: **10/10 passed**. Real-browser layout measurement (1280×900 and 390×844): all 6 ledger rows report Δtop = 0px and Δheight = 0px between 買進 and 賣出 cells, body horizontal overflow 0px (jsdom cannot measure this; the bug was invisible to unit tests).
- **Unfinished**: None — complete release. About to finalize as official `0.9.1` and merge to `main`; release/finalization commit is separate.
- **Task record**: Task 118 moved to `TASK_ARCHIVE.md`.

---

## 📅 Log: 2026-08-20 10:12:46 Asia/Taipei (0.9.1-dev.2 — sell ladder + editable-price ledger)

- **Release**: Version 0.9.1-dev.2 on `dev` branch (frontend only, no deployment yet).
- **Scope**: Extension of 0.9.1-dev.1: replaces 損益試算 tab's sentence-style form with a two-part layout (ladder on top, ledger below). No schema changes, no Edge function changes, no migration required.
- **What changed** (matches spec: `docs/agent/specs/117-whatif-ladder-ledger.md`):
  1. **New pure function `sellLadder()`** in `sources/src/components/StockDetail/whatIf.ts` — Nine steps at ±10% / 2.5% apart (prices: -10%, -7.5%, -5%, -2.5%, 0%, +2.5%, +5%, +7.5%, +10%) anchored on the live quote, never the user's sell-price input. Break-even price inserted at sorted position when it falls in window. Every row computes fresh `pnl` / `roi` / `proceeds` / `sellFeeTax` via `whatIf()` call, no interpolation. Duplicate prices collapse (same 2-decimal anchor ±2.5% rounds together for small anchors <NT$0.40); kind precedence: `current` > `breakEven` > `step`.
  2. **WhatIfTab.tsx rebuilt** — Ladder table on top (columns: 賣出價 / 相對現價 / 損益 / 報酬率 / 實收), scrollable with `.table-scroll` / `.data-table whatif-ladder`. Clicking a row writes price to 賣出價 input; ladder stays anchored to live quote. Current row tagged 現價, break-even row tagged 回本. Two-column 對帳單 (ledger) below: 買進 section (price / qty / amount / fee / cost), 賣出 section (price / qty / amount / fee+tax / proceeds), 結算 row (pnl / roi / break-even price).
  3. **CSS in `index.css`** — `.whatif-ladder` / `.whatif-ledger` reuse existing `.data-table` / `.table-scroll` system and custom properties; ledger collapses to one column under 720px. Clickable rows have `cursor: pointer` and hover state. No new colour literals, no bars or heat maps.
  4. **Spec compliance** — Preserved: `whatIf()` signature and maths, tab sandbox (no storage/Supabase), workspace-scoped fee rates. Non-goal: did not fix double-counted buy fee for held stocks (pre-existing, separate decision, now visible in 對帳單).
- **Testing**: `npx vitest run` → 73 files, **1089 passed** (0.9.1-dev.1 had 1073), 0 failed. `npx tsc --noEmit` clean; `npm run build` clean; `npx oxlint` 0 errors (4 pre-existing warnings).
- **Reviewer verdict**: route:reviewer **PASS**. One real RISK found and fixed (duplicate ladder prices / React keys on sub-NT$0.40 anchors), one missing test added, one miscount dismissed.
- **Process note**: Subagent added `@astryxdesign/core` + `@astryxdesign/theme-neutral` to `package.json` and 50 lines of jsdom polyfills to `sources/src/test/setup.ts`, none requested or imported. All reverted before commit; version bump only.
- **Unfinished**: None — complete release. Deployment: on `dev` branch, not deployed anywhere yet.
- **Commit**: Ready for Scribe recording.

