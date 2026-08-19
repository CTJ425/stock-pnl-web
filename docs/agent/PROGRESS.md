# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.0 release recording
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 14:04:06 Asia/Taipei

---

## 📅 Log: 2026-08-19 15:17:34 Asia/Taipei (0.9.0 release — watchlist UX overhaul, design revised)

- **Release**: Version 0.9.0 on `dev` branch (design revised after review), pending user approval to merge `dev` → `main` for PROD deployment.
- **Scope**: Frontend only. No schema changes, no Edge function changes, no migration required.
- **Design iteration**: Initial 0.9.0 placed watchlist on 庫存總覽; after user review, moved to 4th tab of 個股分析. Root cause: main session converted answer to status question ("跟持股平起平坐") into placement decision, wrote 庫存總覽 into spec. User approving spec ≠ choosing placement; that decision should have been explicit. Current version: watchlist on 個股分析 tab 4 (分析內容 / 損益試算 / AI 分析 / **觀察股票**), positioned at y≈207 (no scroll in 800px viewport); 庫存總覽 unchanged; stock picker holdings-only again.
- **What changed** (matches revised spec: `docs/agent/specs/watchlist-ux-overhaul.md`):
  1. **Watchlist moves to AnalysisPage 4th tab** — `Dashboard/WatchSection.tsx` → `StockDetail/WatchTab.tsx`. `DashboardPage.tsx` and `AppShell.tsx` reverted to pre-0.9.0 state (no `pendingAnalysisTicker`, no `onOpenAnalysis`).
  2. **Stock picker returns to holdings-only** — Group headers (持股 / 觀察) removed. Watched stocks reachable only from 觀察股票 tab. Two entry points deliberately separate.
  3. **Empty state self-sufficient** — `AnalysisPage` (no holdings AND no watched stocks) carries its own `＋ 加入觀察` button, so new users can add first watch without returning to 庫存總覽.
  4. **WhatIfTab rewritten** — 賣出價 now visible input defaulting to live quote, with `預設：現價 X` hint. Only 損益 and 報酬率 headline; cost / proceeds / fees / tax / break-even small-text detail line. Exit price was invisible, which is why "買 24.2 / 賣 24.2 / 虧 140" looked broken. Math unchanged: `calculateFee` / `breakEvenPrice`.
  5. **Unchanged from earlier 0.9.0 work**: `AddWatchModal`, rewritten `WhatIfTab` visible 賣出價 input, deleted `WatchlistPanel`, `whatIf.ts`.
- **Defects found and fixed during verification** (all had root-cause analysis):
  1. Stock added inside tab could not be selected — `AnalysisPage` read watchlist once on mount, resolved clicked row against copy; new additions fell through to first holding. **Fix**: hand `(ticker, name)` up from row. **Root cause**: real browser discovery, not caught by test (no click assertion).
  2. E2E assertion was vacuous — checked page text contained ticker, but watchlist itself prints it, so passed either way. Only tell: 損益試算 defaulting to wrong stock's price. **Fix**: now checks 切換個股 trigger's text. **Root cause**: weak verification scope in script.
  3. Stock both held and watched lost position data — `watch:` key path never consulted holdings, forced `holding=null`, qty/cost vanished. **Fix**: resolution matches holdings by ticker first, whatever key prefix. A stock you hold is a holding. **Root cause**: selection order not in written spec.
  4. Removing watched stock left it on screen indefinitely — `AnalysisPage` and `WatchTab` kept unsynchronized copies. **Fix**: `WatchTab` reports every successful add/remove upward; `AnalysisPage` re-reads and drops bridge entry. **Root cause**: copy sync protocol implicit.
  5. Bridge entry cleared when remove dispatched, not when it landed — unrelated second change could strip it while old copy still stale, remount user away from just-picked stock. **Fix**: clear only after fresh list in hand. **Root cause**: async gap unguarded. (BLOCKER on review; RISK re-review passed)
  6. Verification script quality: regex `加入 1101` also matched `1101B 台泥乙特` (anchored); script didn't delete test ticker before starting, prior crash made next run fail for unrelated reason (delete at start now).
- **Testing**: `npx vitest run` → 73 files, **1073 passed**, 0 failed. `npx tsc --noEmit` 0 errors; `npx tsc -p tsconfig.edge.json` 0 errors; `npx oxlint src supabase` 0 errors; `npm run build` ok. Browser E2E (`sources/scripts/verify-watchlist-e2e.cjs`, rewritten, **10/10** against DEV): 個股分析 → 觀察股票 tab → 加入對話框 (y≈59 in 800px viewport) → 加入 1101 → row shows `NT$24.05 -0.21%` → click row switches picker trigger to `1101 台泥` → 損益試算 defaults 賣出價 to 24.05 → raise to flip P&L to `+NT$4,649` → remove restores DEV data.
- **Reviewer verdict**: route:reviewer **FAIL** then **PASS** after fixes. Two BLOCKERs (defects 3, 4) and one RISK (defect 5) found during round-trip review, all closed before final commit. **Process lesson**: E2E script waited fixed 1200ms after typing; on cold `getTwStockList()` cache, failed first run, passed second. Now waits for result element (up to 25s); random failure is worse than no verification.
- **Unfinished**: PROD deploy — awaiting user go-ahead to merge to `main` and deploy Pages.
- **Commit**: Ready (awaiting merge approval).

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
