# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.2 release recorded
- Status: **✅ RECORDED**
- Timestamp: 2026-08-20 10:55:00 Asia/Taipei

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

---

## 📅 Log: 2026-08-20 10:31:21 Asia/Taipei (0.9.1 — 損益試算分頁重構：賣出階梯與三欄對帳單，觀察股票卡片風格)

- **Release**: Version 0.9.1 on `main` branch (Pages publishes automatically on push).
- **Scope**: Layout restructuring of the 損益試算 ledger. No schema changes, no Edge function changes, no migration required.
- **What changed** (Task 118):
  1. **Ledger CSS grid rewrite** — `WhatIfTab.tsx` ledger renders as single CSS grid with three columns (項目 / 買進 · 假設 / 賣出 · 試算) and one shared row per line item (價格 / 股數 / 價金 / 費用 / 小計). Previously two side-by-side columns: left column's 股數 is input + 單位 select (~62px tall), right column's 股數 text-only (~26px). From 價金 downward the sides sat ~36px out of step. Grid layout ensures cells in same row are same height (Δtop = 0px, Δheight = 0px).
  2. **Accessibility preserved** — Per-input `<label>` elements removed; row-key cell names row and controls carry `aria-label` (`買進價格`, `股數`, `單位`, `賣出價格`). Test selectors unchanged.
  3. **Responsive without breakpoint** — `index.css` `.whatif-ledger` stays three columns at every width. Under 560px: padding, font-size and key-column width shrink instead of collapsing, preserving the alignment that motivated the change.
- **Testing**: `npx vitest run` → 73 files, **1090 passed** (0.9.1-dev.2 had 1089), 0 failed. `npx tsc --noEmit` clean; `npx oxlint` 0 errors; `npm run build` ok.
- **Browser verification** — `node scripts/verify-watchlist-e2e.cjs` against DEV: **10/10 passed**. Real-browser layout measurement (1280×900 and 390×844): all 6 ledger rows report Δtop = 0px and Δheight = 0px between 買進 and 賣出 cells, body horizontal overflow 0px (jsdom cannot measure this; the bug was invisible to unit tests).
- **Unfinished**: None — complete release. About to finalize as official `0.9.1` and merge to `main`; release/finalization commit is separate.
- **Task record**: Task 118 moved to `TASK_ARCHIVE.md`.

