# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.1-dev.1 completion recording
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 16:22:00 Asia/Taipei

---

## 📅 Log: 2026-08-19 16:22:00 Asia/Taipei (0.9.1-dev.1 — simplify 損益試算 and style 觀察股票 card)

- **Release**: Version 0.9.1-dev.1 on `dev` branch (frontend only, no deployment yet).
- **Scope**: Two cosmetic and UX clarity changes in the 個股分析 tab strip. No schema changes, no Edge function changes, no migration required.
- **What changed** (matches spec: `docs/agent/specs/whatif-simplify-and-watch-card.md`):
  1. **觀察股票 tab now has glass card wrapping** — `StockDetailPage.tsx:391` was mounting `<WatchTab/>` bare while 損益試算 and AI 分析 siblings had `<div className="glass detail-body">` wrapper. Added same wrapper. `WatchTab.tsx:72-76` replaced dashboard-legacy heading pattern (`.section` / `.section-title` / `<h2>`) with StockDetail pattern (`.rpt-section` / `.rpt-section-head` / `<h3>`). Visual consistency achieved; no button changes.
  2. **損益試算 reduced to four numbers** — Removed 成本 / 賣出可得 / 手續費拆項 / 回本價 detail rows. Screen now shows: 損益 and 報酬率 (headline size), followed by `含手續費與證交稅 -X` (small line). Calculation unchanged (`whatIf.ts`, `utils/fees.ts`, `utils/pnlEngine.ts` untouched); `cost`, `proceeds`, `breakEven` still returned, just not rendered.
  3. **Default values and unit selector** — `WhatIfTab` new props `avgCost` / `heldQty`. Held stock defaults: 買進價格 = fee-inclusive `avgCost` (matches 庫存總覽 未實現損益, not raw trade price), qty = held shares (張 if divisible by 1000, else 股). Watched stock defaults: 買進價格 = live quote, qty = 1 張. 賣出價格 always defaults to live quote. New張/股 unit selector; does not rewrite typed buy price in place, only updates share count.
  4. **Decision record** — Net P&L includes brokerage and tax, with fee total shown on small line (user decision). Held stock's default buy price is fee-inclusive `avgCost` so result reconciles with 庫存總覽 (user decision).
- **Testing**: `npx vitest run` → 73 files, **1073 passed** (0.9.0 had 1073), 0 failed. `WhatIfTab.test.tsx` rewritten to 14 tests. `npx tsc --noEmit` 0 errors; `npx oxlint src` 0 errors; `npm run build` ok.
- **Reviewer verdict**: route:reviewer **PASS**, no findings.
- **Verification gap**: Browser E2E not run — `AppShell.tsx:103` filters 個股分析 out of local mode as Supabase-only tab, so local Playwright cannot reach either 觀察股票 or 損益試算 tabs. DEV login not available. Gap recorded as open task 117.
- **Unfinished**: Browser verification (Task 117, open).
- **Commit**: (Not created by Scribe; main session handling.)

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

