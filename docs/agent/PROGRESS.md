# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.0 release recording
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 14:04:06 Asia/Taipei

---

## 📅 Log: 2026-08-19 14:04:06 Asia/Taipei (0.9.0 release — watchlist UX overhaul; information architecture)

- **Release**: Version 0.9.0 on `dev` branch, pending user approval to merge `dev` → `main` for PROD deployment.
- **Scope**: Frontend only. No schema changes, no Edge function changes, no migration required.
- **Root cause**: After 0.8.1 was shipped to PROD, user reported four interconnected UX problems: (1) the panel looked half-finished; (2) 損益試算 was unreadable; (3) the entry point was undiscoverable; (4) none of it matched the rest of the app. Analysis revealed the common cause: the 0.8.0 placement decision (buried behind a button on another page to avoid squeezing the 320px mobile bottom bar) violated information architecture — a watched stock should be a first-class citizen equal to a holding, living where holdings live.
- **What changed** (matches spec: `docs/agent/specs/watchlist-ux-overhaul.md`):
  1. **庫存總覽 gains 觀察中 section** — directly under `Active 持股`, same section/table markup: 代號 / 名稱 / 現價 / 漲跌 + `×` per row; count as `N/30`; `＋ 加入觀察` button; renders when empty; one batched `fetchPrices` call for all watched tickers; `colgroup` (12/34/22/22/10) keeps 5-column table visually related to 10-column holdings table above.
  2. **WatchlistPanel.tsx deleted** — `管理觀察` as a separate view is gone. Adding via `AddWatchModal` (shared `Modal`, count in body, project's `search-box`/`search-input` styling). Removing happens on the row.
  3. **WhatIfTab rewritten** — 賣出價 now a visible input defaulting to live quote, with `預設：現價 X` hint. Only 損益 and 報酬率 are headline; cost / proceeds / fees / tax / break-even collapse to small-text detail line. Exit price was invisible before, which is why "買 24.2 / 賣 24.2 / 虧 140" looked broken. Math unchanged: `calculateFee` / `breakEvenPrice`.
  4. **AnalysisPage changes** — loses 管理觀察 button; empty state points to 庫存總覽; new optional `initialTicker` parameter. `AppShell` owns `pendingAnalysisTicker`, wires watched-row click through to 個股分析.
- **Testing**: `npx vitest run` → 73 files, **1072 passed**, 0 failed. `npx tsc --noEmit` 0 errors; `npx tsc -p tsconfig.edge.json` 0 errors; `npx oxlint src supabase` 0 errors; `npm run build` ok. Browser E2E (`sources/scripts/verify-watchlist-e2e.cjs`, rewritten for new journey, **10/10** against DEV): 庫存總覽 觀察中 區塊 → 加入對話框 (y=59 in 800px viewport) → 加入 1101 → 列顯示 `NT$24.05 -0.21%` → 點列跳個股分析並選定 → 損益試算賣出價帶入 24.05 → 拉高賣出價後損益轉正 `+NT$4,649` → 移除還原. DEV data restored every run.
- **Reviewer verdict** (route:reviewer **PASS**, two RISKs, both CLOSED before commit): (1) `load()` wrapped list fetch and price fetch in one try/catch; a quote failure would have emptied a watchlist that had loaded fine. **Fix**: split into two independent catches; price failure now degrades only price cells to `—`. Test added. (2) `×` had no in-flight guard; double click fired two removes and overlapping reloads that could commit out of order and flash stale snapshot. **Fix**: added `removing` guard disabling button. Test added. **Process lesson recorded**: E2E script waited fixed 1200ms after typing, failed on cold `getTwStockList()` cache on first run, passed on second. Now waits for result element (up to 25s); a verifier that fails randomly is worse than none.
- **Known trade-off, NOT a defect**: 觀察中 section sits at y≈806 on 1440×900 screen, just below fold with five holdings. Moving above 持股 was judged worse.
- **Unfinished**: PROD deploy — awaiting user go-ahead to merge to `main` and deploy Pages.
- **Commit**: Not yet (awaiting merge approval).

---

## 📅 Log: 2026-08-19 11:58:53 Asia/Taipei (0.8.1 bugfix — management panel placement and watched stock pricing)

- **Release**: Version 0.8.1 bugfix on 0.8.0 (Frontend only).
- **What was fixed**:
  - **BUG-030 — 管理觀察 button looked dead**: `WatchlistPanel` was rendered as a flat inline section after `<StockDetailPage>`, placing it far below the fold. Fix: wrap in `Modal.tsx` (portals to `document.body`, brings overlay, Esc handler, single close button). Root cause: jsdom has no layout, so all 1058 unit tests passed while the feature was unusable in browser.
  - **BUG-031 — watched ticker had no quote**: `AnalysisPage` passed `quote={null}` for every watch entry because `useStockPrices` only covers holdings. Fix: for the selected watched entry, fetch `fetchPrices([{ market: 'TPE', ticker }])` from `priceProxy.ts`, with `cancelled` flag in effect cleanup to prevent stale responses from overwriting. Failure leaves quote null, never blocks rendering.
- **Correction recorded**: Earlier claim that "chips stay empty until nightly batch" was incorrect — chips appear immediately because `reportProxy` falls back to Edge `generate` action when batch file is missing; browser console 400 is expected and handled.
- **Testing**: Unit tests: `npx vitest run` → 72 files, **1060 passed**, 0 failed. Types/lint/build: `npx tsc --noEmit` 0 errors; `npx tsc -p tsconfig.edge.json` 0 errors; `npx oxlint src supabase` 0 errors; `npm run build` ok. **Browser E2E (Playwright against DEV, new)** — 12/12 steps: 進個股分析 → 管理觀察可見 → 面板出現在可視範圍內 (y=49, viewport 800) → 搜尋並加入 1101 → 關閉 → 下拉觀察組出現 1101 → 選取後頁面渲染 → 觀察股取得報價 → 損益試算可開且無 NaN/Infinity → 試算帶入現價 24.2 當預設買進價 → 算出回本價 → 移除 1101 還原 DEV 資料。
- **Reviewer verdict**: Lane 1. Two RISKs raised: (1) **Accepted** — watched entry deleted while viewing falls back to another without signalling; user removed it themselves, fallback is reasonable. (2) **Rejected as incorrect** — workspace switch could leave stale watchlist; `tw_watchlist` keyed by `user_id` only, schema says "Per-user, not per-workspace", no per-workspace watchlist exists to go stale.
- **Unfinished**: None — complete release.
- **Commit**: `cbbdba0` (0.8.0, version files bumped for 0.8.1).
