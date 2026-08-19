# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.8.0 release recording — 觀察清單、損益試算
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 11:01:43 Asia/Taipei

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

---

## 📅 Log: 2026-08-19 09:54:30 Asia/Taipei (0.7.26 release: ForeignTopSection 鉅額星號、筆數下拉、說明文字)

- **Release**: Version 0.7.26 official release, finalized.
- **Feature**: 外資買賣超 TOP 50 (總體經濟 > 台股) 區塊三項更新：(1) 鉅額標示改為名稱後綴星號（例 `長榮*`），不再出現「鉅額」標籤；(2) 表格上方新增「* 代表鉅額」說明文字（`hint` 樣式）放在 `.table-scroll` 外；(3) 新增筆數下拉選單（10 / 30 / 50，預設 10）同時套用買超賣超兩分頁。
- **Changes**:
  - `sources/src/components/Macro/ForeignTopSection.tsx` — 三個變更點：
    - 鉅額標示：移除 `block === true` 時渲染的 `<span className="chip">鉅額</span>`，改為在名稱後接 `*`（以 ternary operator 在 JSX 內拼接）。
    - 說明文字：新增 `<div className="hint">* 代表鉅額</div>` 置於 `.table-scroll` 之外。
    - 筆數下拉：新增 `select` 元素（`aria-label="顯示筆數"`），與現有 `rowCount` 狀態繫結，同時套用兩分頁；`.slice(0, rowCount)` 渲染既有列，資料不足時不補空列。
  - 未動：買超/賣超分頁邏輯、`資料更新於` 時間戳、空狀態、欄位標題、`fmtLots()` 格式。
- **Testing**: `sources/src/components/Macro/ForeignTopSection.test.tsx` 改寫 5 項失敗測試 + 新增 4 項案例，共 10 通過：
  - (新) 「鉅額改以名稱後綴星號標示，不再出現鉅額標籤」— 斷言星號在名稱後、無 chip 元素。
  - (新) 「表格上方說明星號代表鉅額」— 斷言 `* 代表鉅額` 文字存在、有 `hint` 樣式。
  - (新) 「預設只顯示 10 筆，可用下拉選單切換 30 / 50」— 初始 10 列，選擇 30 → 30 列，選擇 50 → 50 列（以 50 筆 fixture 驗證邊界）。
  - (新) 「資料少於選定筆數時只顯示既有列，不補空列」— fixture 15 筆時選擇 30，僅顯示 15 列。
  - (改) 既有買超/賣超分頁測試改以 `台積電*` 斷言，確保星號出現。
- **Verification**: `npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 10 passed, 0 failed (改動前 5 failed). `npx vitest run` (full suite) — 68 files, 1011 tests passed, 0 failed. `npx tsc --noEmit` — 0 errors. `npx oxlint src` — 0 errors (only pre-existing react/only-export-components warnings). `npm run build` — built ok.
- **Routing**: Lane 1. 主 session 寫失敗測試 → `route:builder` 實作 → 主 session 覆核 diff 並把說明文字移出 `.table-scroll`。Reviewer 未派遣，理由：純展示層變更，測試改動前失敗、改動後通過，不涉持久化、授權、對外介面契約、無聲計算或控制流。
