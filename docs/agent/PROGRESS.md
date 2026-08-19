# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.8.0 release recording — 觀察清單、損益試算
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 11:01:43 Asia/Taipei

---

## 📅 Log: 2026-08-19 11:29:34 Asia/Taipei (0.8.0 post-release deployment — watchlist and P&L simulator)

- **Deployment**: Version 0.8.0 schema and Edge functions deployed to DEV and PROD; merged `dev` → `main`.
- **What was deployed**:
  - Schema: `tw_watchlist` max cap 5 → 30, trigger renamed `tw_watchlist_max5` → `tw_watchlist_max30` with compatible dual drop.
  - Edge (`stock-report`): Whitelist logic expanded from "held only" to "held ∪ watched"; new functions `watchedTwTickers()`, `allowedTwTickers()`; `batchTwTickers()` returns union; 403 message updated to "僅限持有或已加入觀察清單的台股代號".
- **Deployment sequence**:
  1. **DEV schema migration** — Applied via `docker exec stock-pnl-web-dev-db-1 psql`. Before: `tw_watchlist_max5`, cap 5, 2 rows. After: `tw_watchlist_max30`, cap 30, 2 rows preserved. DEV identity confirmed: `batch_run_log = 142`.
  2. **DEV Edge deploy** — Volume copy `index.ts` + `batchTickers.ts` into `/root/container/supabase/stock-pnl-web-dev/volumes/functions/stock-report/`, then `docker compose up -d --force-recreate functions`. Confirmed in container: `allowedTwTickers` appears 5 times, new 403 guard string appears twice.
  3. **DEV end-to-end verification** — Called `generate` action (signed-in user):
     - Ticker `2327` (on watchlist, held by nobody): **HTTP 200**, produced report `20260818_2327_…`. Pre-0.8.0 code returned 403 for this path.
     - Ticker `1101` (neither held nor watched): **HTTP 403** with new message, confirming whitelist widened without becoming open.
     - Ticker `2059` (held): **HTTP 200**, no regression on existing path.
     - Unauthenticated call: **401**, confirming `assertUser` still runs before whitelist check.
  4. **PROD schema migration** — Applied via Supabase Management API with explicit project ref `kxnxadaghidwumqsqneu`. Before: `tw_watchlist_max5`, cap 5, 0 rows. After: `tw_watchlist_max30`, cap 30, 0 rows. PROD identity confirmed: `batch_run_log = 441`.
  5. **PROD Edge deploy** — `supabase functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt` from `sources/`. Version 53 → **54**; `ezbr_sha256` changed; `verify_jwt` remains **false** (unchanged, correct for after-hours cron). PROD unauthenticated call returned 401, confirming function is live.
  6. **Merge to main** — Fast-forward `ab03d9d..cbbdba0`, pushed. Both `dev` and `main` now at `cbbdba0`; Pages deploys 0.8.0.
- **What was NOT proven on PROD**: The watched-ticker allow path verified end-to-end on DEV (identical bundle), but not re-exercised on PROD because `tw_watchlist` is empty and requires a signed-in browser session. First real PROD exercise happens when a user adds a watched ticker.
- **Expected behavior**: Watched ticker's chips remain empty until the nightly batch runs — this is expected, not a fault.
- **Commit**: `cbbdba0` (0.8.0).

---

## 📅 Log: 2026-08-19 11:01:43 Asia/Taipei (0.8.0 release: 觀察清單與損益試算)

- **Release**: Version 0.8.0 official release, finalized.
- **Feature**: 觀察清單 — 分析非持股個股。使用者可以把沒有持股的台股加入觀察清單（每人上限 5 → 30 檔），在「個股分析」頁照常看報價、籌碼、基本面、技術面，並新增「損益試算」分頁。
- **Changes**:
  - `sources/supabase/schema.sql` — `tw_watchlist` 每人上限 5 → 30；trigger 更名 `tw_watchlist_max5` → `tw_watchlist_max30`，建立前同時 drop 兩個名字以相容既有資料庫；欄位、RLS、CHECK 未動；該表自 0.7.0 起休眠，此版重啟。
  - `sources/supabase/functions/stock-report/` — 白名單由「有人持有」放寬為「持有 ∪ 觀察清單」；新增 `watchedTwTickers()`、`allowedTwTickers()`；`batchTwTickers()` 改回聯集；新增 `allowsTicker()` 純函式；403 訊息改為「僅限持有或已加入觀察清單的台股代號」。
  - `sources/src/services/watchlistService.ts` — 新檔；`WATCHLIST_MAX = 30`、`WatchItem`、`listWatchlist()` / `addWatch()` / `removeWatch()`；trigger 擋下時翻成中文；刻意不併入 `DataProvider` 介面（本機模式不支援）。
  - `sources/src/components/StockDetail/WatchlistPanel.tsx` — 新檔；管理觀察面板，列出、移除、搜尋加入；滿 30 檔時停用搜尋、不渲染加入鈕。
  - `sources/src/components/StockDetail/AnalysisPage.tsx` — 個股下拉分成「持股」「觀察」兩組；觀察項以 `watch:${ticker}` 為鍵；空狀態改為兩者皆空時才顯示；就地提供「管理觀察」入口。
  - `sources/src/components/StockDetail/whatIf.ts` + `WhatIfTab.tsx` + `StockDetailPage.tsx` — 新增損益試算分頁（第三籤，排在分析內容與 AI 分析之間）；計算複用 `fees.ts`；輸入不儲存。
- **Testing**: `batchTickers.test.ts`（+5）、`watchlistService.test.ts`（新，8）、`WatchlistPanel.test.tsx`（新，13）、`whatIf.test.ts`（新，8）、`WhatIfTab.test.tsx`（新，4）、`AnalysisPage.test.tsx`（+7）、`StockDetailPage.test.tsx`（分頁籤斷言改為三個）。
- **Verification**: `npx vitest run` → 1056 passed, 0 failed（0.7.26 時為 1011）。`npx tsc --noEmit` 0 errors。`npx tsc -p tsconfig.edge.json` 0 errors。`npx oxlint src supabase` 0 errors。`npm run build` ok。
- **Routing**: Lane 2. 主 session 寫規格與全部失敗測試；`route:builder` 實作；`route:reviewer` 派遣三次。Edge 白名單 PASS（可讀性風險修正）；`watchlistService` **FAIL** → `reorderWatch` 整個刪除（upsert 走 INSERT ... ON CONFLICT，Postgres 每列先觸發 BEFORE INSERT trigger，滿 30 檔時每次排序都會被上限擋下；本來就沒有排序 UI；同時補 trigger 錯誤翻譯）；UI 與試算 PASS（四個風險全關）。
- **Unfinished**: (1) DEV / PROD schema migration（DDL 已就緒）；(2) DEV / PROD Edge 部署；(3) 端對端驗證（加未持有股票、確認守衛放行、確認隔夜批次產出報告）。
