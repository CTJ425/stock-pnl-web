# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: Task analysis-picker-watch-group completed — 個股分析 stock picker lists watched stocks again (持股 / 觀察 groups with separator); reversal note appended to spec
- Status: **✅ RECORDED**
- Timestamp: 2026-08-24 13:33:13 Asia/Taipei

---

## 📅 Log: 2026-08-24 13:33:13 Asia/Taipei (Task completed: analysis-picker-watch-group — stock picker watchlist restored)

- **Task**: analysis-picker-watch-group — Restore watched stocks listing in 個股分析 stock picker dropdown.
- **Outcome**: The picker now displays watched stocks grouped under `觀察` below `持股`, separated with existing `.hmenu-head` / `.hmenu-sep` classes (no new CSS). Held tickers override watched duplicates, so no stock appears twice. Selection resolution order preserved: holdings win, then watchlist, then fallback.
- **Files changed**: `sources/src/components/StockDetail/AnalysisPage.tsx` (render holdings + watched groups), `sources/src/components/StockDetail/AnalysisPage.test.tsx` (new test case for grouped picker render).
- **Testing**: AnalysisPage 21 tests passed. Full suite: 77 files / 1147 tests passed, exit 0. `tsc --noEmit -p tsconfig.app.json` exit 0 — no regressions.
- **Review**: Skipped per policy — a previously failing test (picker without watched stocks) now passes, and changes touch no persistence, auth, API boundary, or calculation. Proof: git diff shows only selector logic and test assert, no fee/math/schema changes.
- **Lane**: 1 (bounded — selector reordering only).
- **Version**: NOT bumped, no commit made (bookkeeping only per Scribe role).
- **Spec revision**: `docs/agent/specs/watchlist-ux-overhaul.md` line 24 recorded "Stock picker: **holdings only.**" and line 49-50 repeated this constraint. Appended dated revision note stating the holdings-only picker decision was reversed by this task; watched stocks now appear in picker grouped as `觀察`, so a later agent does not restore the old behaviour. Original text unchanged, revision note added.
- **Records finalized**: This entry added to PROGRESS.md. New open task added to TASK.md for ETF constituents investigation. Spec revision note written. No entries moved this dispatch.
- **Unfinished**: None — analysis-picker-watch-group recorded complete.

---

## 📅 Log: 2026-08-24 11:37:39 Asia/Taipei (Release 0.9.9 — Dashboard watchlist redesign, design reversal recorded, Task 116 completed)

- **Release**: Version 0.9.9 finalizes watchlist feature (commit `3f25ed7`). Task 116 (watchlist UX redesign, 0.9.0 → 0.9.9) **complete and closed**. Design reversal tracked as implementation narrative: initial 0.9.0 placement (庫存總覽) rejected; revised to 個股分析 tab 4 (0.9.0 → 0.9.8); final placement on Dashboard WatchSection (0.9.9).
- **Feature**: New `WatchSection` block on Dashboard, below Active Holdings. Displays watchlist with 「N/30」 capacity badge. Two view modes — minimalist card grid (圖卡) and table list (條列) — toggled in toolbar; choice persists in localStorage. Each entry shows current price and % change, colour-coded up/down (紅漲綠跌). Add via 「加入觀察」 button (opens `AddWatchModal`), remove via × button. Clicking card/row navigates to 個股分析.
- **Design reversal headline**: `StockDetailPage.tsx` TABS removed 「觀察股票」 (was tab 4); now has 3 entries (分析內容 / 損益試算 / AI 分析). Watchlist entry point consolidated on Dashboard. Props `onSelectTicker` / `onWatchlistChanged` kept for API compatibility.
- **Cross-component wiring**: `AppShell.tsx` gains `analysisTicker` state; `DashboardPage` `onSelectTicker` callback sets it and switches view to `analysis`; `AnalysisPage` takes new `initialTicker` prop.
- **CSS**: ~117 new lines in `sources/src/index.css` — `.watchlist-card-grid` (auto-fill grid, min 230px), `.watchlist-card` (+hover lift), `.watchlist-card-head/-ticker/-name/-price/-change/-del`, `.view-toggle-group` / `.view-toggle-btn` (pill toggle, active state uses accent-strong).
- **Tests**: new `WatchSection.test.tsx`, 10 cases — empty state, N/30 badge, batch price fetch, card view render (price/% /colour), mode toggle + localStorage, card click fires `onSelectTicker`, table row click fires `onSelectTicker`, delete flow, capacity enforcement at 30/30, add button opens `AddWatchModal`. `StockDetailPage.test.tsx` adapted for 3-tab layout. Deleted `WatchTab.test.tsx` (13 cases). Total: 77 files / **1145 tests**, down from 77 / 1148 (net: +10 WatchSection − 13 WatchTab = −3).
- **Design docs added**: `docs/architecture/watchlist_dashboard_redesign.md` (+ .html) and `docs/architecture/watchlist_6_design_variants.md` (+ .html). Three richer card variants (Sparkline 7-day trend, Chips & PE institutional flows, Range Bar intraday high/low) documented as prepared design work for later versions — deferred by scope, not by defect.
- **Dead code cleanup**: `WatchTab.tsx` and `WatchTab.test.tsx` deleted (no production import remaining, only test file referenced it). Comment in `AnalysisPage.tsx:35` updated (`WatchTab` → `WatchSection`). No CSS impact (only used shared generic classes).
- **Verification**: `npx vitest run` — 77 files / 1145 tests, exit 0, no Errors line. `npx tsc --noEmit` — exit 0. `npm run typecheck:edge` — exit 0. `npm run build` — exit 0. `npx oxlint` — exit 0, 5 pre-existing warnings.
- **Deployment**: No `sources/supabase/functions/` file changed — **no Edge Function deploy needed**. Frontend only; `main` push deploys Pages.
- **Records finalized**: CHANGELOG.md gained 0.9.9 entry (Traditional Chinese, house style). TASK.md header updated to 0.9.9 / 1145 tests; Task 116 moved to TASK_ARCHIVE.md; new OPEN entry for deferred card variants. PROGRESS.md header updated; this entry added; oldest entry (0.9.7, 2026-08-20 20:45:00) rolled to PROGRESS_ARCHIVE.md.
- **Unfinished**: None — 0.9.9 recording complete. All tracking docs synchronized. No commit made per Scribe role (bookkeeping only).

---

