# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 4 Code Review (v0.2.5)
- Status: APPROVED
- Timestamp: 2026-07-21 10:00:30 Asia/Taipei

---

## 📅 Log: 2026-07-21 09:32:30 Asia/Taipei

- **Agent**: Gemini
- **Action**: Align project structure & persistent memory with `GEMINI.md`
- **Status**: COMPLETED

### Completed Tasks
- [x] 建立 `docs/agent/` 資料夾與持久記憶檔 (`PLAN.md`, `SPEC.md`, `PROGRESS.md`, `TASK.md`, `BUG_FIX.md`, `FIXED_BUG.md`)。
- [x] 重構文件目錄架構，將系統設計移至 `docs/architecture/`，資料庫 Schema 移至 `docs/database/`。
- [x] 前端 React + TypeScript 主體建置完成並通過測試（7/7 測試檔案、68/68 測試全數通過，包含 PnL 計算、CSV 匯入匯出與 App 煙霧測試）。
- [x] Dashboard 新增投入成本欄位，並將投入成本移至平均買入成本之前 (v0.2.4)。

---

## 📅 Log: 2026-07-21 09:52:39 Asia/Taipei

- **Agent**: Claude
- **Action**: 規劃交易紀錄搜尋欄位功能（Task 4），含完整功能規格與測試項目
- **Status**: COMPLETED（規劃）；實作待 agy 執行，Claude 負責 review

### Notes
- 規格與測試項目詳見 `TASK.md` Task 4。
- 關鍵設計決策：純函式過濾（`txSearch.ts`）、名稱比對需含 `displayStockName` 中文譯名、
  「刪除選取」計數需改為「勾選且可見」、CSV 匯出不受過濾影響。

---

## 📅 Log: 2026-07-21 09:58:00 Asia/Taipei

- **Agent**: Gemini
- **Action**: 實作交易紀錄搜尋欄位與過濾功能 (v0.2.5)
- **Status**: COMPLETED

### Completed Tasks
- [x] 建立純函式過濾模組 `txSearch.ts`，支援代號子字串、原始名稱與美股中文譯名 (`displayStockName`) 即時過濾。
- [x] 撰寫單元測試 `txSearch.test.ts`（涵蓋 U1–U8 全部測試案例，全數通過）。
- [x] 整合 `TransactionsPage.tsx` 工具列：新增搜尋輸入框、清除按鈕、筆數提示（「顯示 X / Y 筆」）與無結果提示畫面。
- [x] 修正勾選與刪除選取邏輯：「全選」與「刪除選取（n）」僅作用於當前過濾可見之列，過濾條件改變時保留既有勾選狀態。
- [x] 撰寫 UI 整合測試 `TransactionsPage.test.tsx`（涵蓋 I1–I7 全部測試案例，全數通過）。
- [x] 更新版號與文件：Bump package.json 至 `0.2.5`、`App.tsx` 的 `APP_VERSION` 至 `v0.2.5`、更新 `README.md`。
- [x] 驗證：`npm run lint`（0 error）、`npm test`（9/9 檔案、83/83 測試全數通過）、`npm run build`（打包成功）。

---

## 📅 Log: 2026-07-21 10:00:30 Asia/Taipei

- **Agent**: Claude
- **Action**: Task 4 Code Review（交易紀錄搜尋欄位 v0.2.5）
- **Status**: APPROVED（可 commit）

### Review 結果
- 規格 1–8 全數符合：純函式 `txSearch.ts`、displayStockName 中文譯名比對、filter→sort、
  筆數提示、勾選保留、無結果狀態區分、CSV 匯出未受影響、切換工作區清空搜尋。
- 「刪除選取」計數與刪除範圍已統一為「勾選且可見」（`visibleSelectedCount`），
  且批次刪除後只移除已刪 id、保留隱藏勾選——優於原規格的清空做法。
- 驗證：`npm test` 9 檔 83/83 通過、`npm run lint` 僅既有 3 個 fast-refresh 警告、
  `npm run build` 成功。
- 輕微議題（不擋驗收，留待後續順手處理）：
  1. `TransactionsPage.test.tsx` I5 直接覆寫 `window.confirm` 未還原，建議改用
     `vi.spyOn(window, 'confirm')` + afterEach 還原，避免測試順序耦合。
  2. 無結果狀態存在兩個「清除搜尋」同名按鈕（輸入框 X 與空狀態按鈕），
     螢幕閱讀器辨識略有重複；可改為不同 aria-label。
  3. 空狀態按鈕使用 inline style `marginTop`，可移入 CSS class。
- Scope 備註：`App.tsx`（APP_VERSION）與 `README.md` 版本紀錄不在原 Allowed Changes 清單，
  但屬既有版本 bump 慣例，予以接受；未來規劃時應將此二檔納入清單。

---

## 📅 Log: 2026-07-21 12:03:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Action**: 實作年度收益頁面三項功能 (v0.2.6)
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx`: 移除表格排序，替換為純 HelpTh 表頭。
- [x] `DashboardPage.tsx`: 將 HelpTh 抽離至 `Common/HelpTh.tsx` 供共用。
- [x] `pnlEngine.ts`: 新增 `SellDetail` 介面，於 `YearTickerDetail` 紀錄逐筆賣出明細與超賣狀態。
- [x] `YearlyPage.tsx`: 實作第三層明細展開 (`expandedTickers`)，顯示逐筆賣出明細 (`.sell-row`)。
- [x] `pnlEngine.ts`: 於 `LedgerSummary` 新增 `buyCount` 與 `sellCount` 歷史累計買賣筆數。
- [x] `YearlyPage.tsx`: 於交易筆數 KPI 下方顯示買入/賣出拆分。
- [x] `pnlEngine.test.ts`: 新增 SellDetail 運算邏輯與買賣筆數測試驗證。
- [x] `package.json`: 版號更新至 0.2.6。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 12:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 年度收益視覺調整（使用者回饋，隨 v0.2.6 後續，commit 06b7be7）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx` + `index.css`: 三層縮排改固定 32px 一層（`.cell-tree` flex 排版），無展開鈕的列以 `.toggle-slot` 空槽補位，圖示/文字垂直對齊。
- [x] `index.css`: 年度表格加 `.table-scroll-y`（max-height 480px 垂直捲動 + sticky 表頭，底色 `--panel`）。
- [x] 逐筆賣出明細分隔符「@」改為「｜」。
- [x] Playwright 目測驗證對齊/捲動/釘選表頭，`npm run build` 與 85/85 測試通過，Pages 部署成功。

---

## 📅 Log: 2026-07-21 13:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 年度收益縮排再調整（使用者回饋：圖示排一直線、逐筆明細貼齊父層）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx`: 展開圖示改為全層級同一直欄（拿掉個股列的 32px 縮排），層級由列底色與字重呈現。
- [x] `YearlyPage.tsx`: 逐筆賣出文字縮排 96px → 32px，貼齊父層個股文字起點。
- [x] Playwright 驗證各層圖示/文字座標對齊，build 與 85/85 測試通過。

---

## 📅 Log: 2026-07-21 13:40:00 Asia/Taipei

- **Agent**: agy (delegated)，Claude 規劃/review/驗證
- **Action**: 年度收益展開圖示置中修正 + 分區「全部展開/全部收起」按鈕
- **Status**: COMPLETED

### Completed Tasks
- [x] `index.css`: `.year-toggle` 補 `padding: 0`（根因：全域 border-box 下瀏覽器預設按鈕 padding 擠壓 22px 盒，圖示偏移；修後 svg 與按鈕中心偏差 0px）。
- [x] `YearlyPage.tsx`: 各分區標題右側新增 `.btn btn-sm`「全部展開/全部收起」，一鍵開合該分區所有年度與逐筆賣出明細。
- [x] Playwright 驗證置中與開合行為，build 與 85/85 測試通過。

---

## 📅 Log: 2026-07-21 14:00:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 移除年度收益表格垂直捲動（使用者回饋：不要上下拉 bar）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx` / `index.css`: 移除 `.table-scroll-y`（480px 高度上限、sticky 表頭），表格恢復完整展開。
- [x] build 與 85/85 測試通過。

## 📅 Log: 2026-07-21 14:05:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: 歷史累計手續費拆分 (v0.2.7)
- **Status**: COMPLETED

### Completed Tasks
- [x] `pnlEngine.ts`: 於 `LedgerSummary` 新增 `feesBrokerage` 與 `feesTax`，並透過稅率反推估算手續費與交易稅。
- [x] `YearlyPage.tsx`: 將年度收益頁面的歷史累計手續費 KPI 拆分為手續費與交易稅雙行顯示。
- [x] `pnlEngine.test.ts`: 新增手續費與交易稅估算之測試案例驗證，確保拆分邏輯與總和不變。
- [x] `package.json` 與 `App.tsx`: 版號更新至 0.2.7。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 15:30:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: 年度明細下放手續費/交易稅拆分 (v0.2.8)
- **Status**: COMPLETED

### Completed Tasks
- [x] `pnlEngine.ts`: 於 `YearSummary`, `YearTickerDetail`, `SellDetail` 實作 `feesTax` 屬性與累加機制。
- [x] `YearlyPage.tsx`: 將年度、個股、逐筆賣出明細層級的手續費欄位，改用新增的 `FeeCell` 元件，顯示費稅拆分副行。
- [x] `YearlyPage.tsx`: 修正歷史累計手續費 KPI 與交易筆數 KPI 標籤（新增標註台美股合計）。
- [x] `pnlEngine.test.ts`: 擴展手續費測試，加入 invariants（年度總和 = 各個股總和）與各層級欄位斷言。
- [x] `package.json` 與 `App.tsx`: 版號更新至 0.2.8。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 🚧 Next Steps
1. 設定 GitHub Actions 自動部署流程 (Task 2)。
2. 配合使用者引導完成 Supabase 專案連結與 Edge Function `stock-price` 部署 (Task 3)。
