# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 4 Code Review (v0.2.5)
- Status: APPROVED
- Timestamp: 2026-07-21 10:00:30 Asia/Taipei

---

## 📅 Log: 2026-07-21 14:45:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: Implementation
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增服務狀態頁面 (`ServiceStatusPage.tsx`) 與檢測邏輯 (`serviceHealth.ts`)。
- [x] 移除畫面左下角固定版本標籤。
- [x] 更新 `AppShell.tsx` 分頁選項加入服務狀態。
- [x] 升級版本至 v0.3.0。

---

## 📅 Log: 2026-07-21 15:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 服務狀態頁 review 修復與視覺收尾 (v0.3.0)
- **Status**: COMPLETED

### 修復的缺陷（agy 交付版本無法執行）
- [x] **白屏（阻斷級）**：`ServiceStatusPage.tsx` 將純型別以一般 import 匯入，`verbatimModuleSyntax`
      下 Vite 執行期報 `does not provide an export named 'ComponentId'`，整個應用無法啟動。改用 `import type`。
- [x] **白屏（阻斷級）**：lucide-react 1.24 已移除品牌圖示 `Github`，改用 `Code2`。
- [x] **型別錯誤**：`serviceHealth.ts` 閉包內 `supabase` 的 non-null narrowing 失效，收斂至區域常數 `sb`。
- [x] `serviceHealth.test.ts` 同樣的 type-only import 問題（TS1484）。

### 驗收流程修正
- `npx tsc --noEmit` 與 `npm test` **均無法**攔截上述白屏：前者走的 tsconfig 不含 `verbatimModuleSyntax`，
  後者的 esbuild transform 會 tree-shake 未使用的 type import。實測反證確認唯有 **`npm run build`（`tsc -b`）** 會報 TS1484。
  往後驗收一律以 `npm run build` 為準。

### 視覺與一致性收尾
- [x] 版本字串 `v0.3.0` → `v0.3`（依需求），README 同步。
- [x] uptime 條說明由每個元件重複 8 次改為整頁一次；空格子改用 `--border-strong` 以免條狀圖看似只有半截。
- [x] 檢測時間改用 `zh-TW` 24 小時制，與 Dashboard「現價更新於」一致。
- [x] `lastSample?.results?.x` 防禦，避免歷史資料損毀時整頁崩潰。
- [x] `App.smoke.test.tsx` 新增服務狀態分頁斷言（本機模式後端為「未啟用」且整體仍為正常）。
- [x] 驗證：`npm run build` 通過、`npm test` 10 檔 90/90、Playwright 深淺兩主題與四個分頁零 pageerror。

## 📅 Log: 2026-07-21 15:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 頁首維持單行（使用者回饋：新增分頁後右側控制項被擠到第二行）
- **Status**: COMPLETED

### Completed Tasks
- [x] 量測確認換行門檻：1100px 時子元素合計 1143px 超出可用 1060px 約 83px。
- [x] `AppShell.tsx` / `index.css`: 頁首改為逐級讓步——1180px 起縮間距與 tab padding、
      1060px 起收起品牌文字、960px 起分頁只留圖示（名稱移至 title / aria-label）。
- [x] 手機版 (≤700px) 分頁改用短標籤（總覽／年度／紀錄／狀態）：四個分頁平分 390px 時
      四字標籤會折行成兩列。
- [x] 驗證：1280/1100/1000/820px 頁首皆為單行（高 63–70px，原本 112px），
      390px 分頁不再折行；`npm run build` 與 90/90 測試通過。

---

## 📅 Log: 2026-07-21 15:50:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 頁首換行修正補完 + 庫存總覽未實現損益加入未含費 (v0.3.1)
- **Status**: COMPLETED

### 頁首（使用者回報「還是一樣」）
- [x] 每 10px 密集掃描找出前次修正的缺口：**1080px 與 980px 仍換行**，
      原因是讓步門檻壓在 1060 / 960，恰好卡在需求曲線之上。
- [x] 門檻上移：品牌文字 1060 → 1120px、分頁文字 960 → 1020px；
      手機版斷點 700 → 720px 以接上 710px 的空隙。
- [x] 驗證：730–1600px 每 10px 掃描全部單行。版面左右維持原樣（使用者確認）。

### 庫存總覽未實現損益
- [x] `DashboardPage.tsx`: `HoldingRow` 新增 `rawUnrealized`（市值 − `rawCost`），
      與年度收益的 `rawRealized = sellGross − rawCostBasis` 同構。
- [x] 表格「未實現損益」欄改雙行，副行「未含費」；KPI 台股/美股各加「未含費」副行，
      台股原說明改為「主數字已預扣賣出手續費與證交稅」以區分兩個口徑。
- [x] 手算對帳：0050 買 100@120 費 50、現價 150 → 未含費 15000−12000=+3,000；
      含費扣手續費 21 與證交稅 15 後 +2,914。AAPL 買 10@100 費 5、現價 130 → +300 / +295。
- [x] `npm run build` 與 90/90 測試通過。

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

## 📅 Log: 2026-07-21 16:30:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: Fix header wrapping & clarify unrealized P&L gap in UI (v0.3.2)
- **Status**: COMPLETED

### Completed Tasks
- [x] `index.css`: Fixed header wrapping in Supabase mode by moving `.app-header-inner`, `.tab`, and `.user-email` rules out of `@media (max-width: 1180px)` into unconditional rules. Root cause: fixed 1180px container makes viewport media queries ineffective above that width; local mode masked it because its meta area is much narrower than Supabase mode's email+logout.
- [x] `index.css`: Bounded `.ws-select select` with `max-width: 180px` unconditionally to prevent long workspace names from pushing the row over.
- [x] `DashboardPage.tsx`: Clarified the unrealized P&L fee gap tooltip text in table cells, KPIs, and help icon, detailing the gap composition (buy fee + estimated sell fee/tax, and buy fee only for US stocks).
- [x] `package.json`: Bumped version to `0.3.2`.
- [x] Verified with `npm run build` and `npm test -- --run`.

### Claude review 補正
- [x] agy 的修正解決了寬螢幕（≥1220px）的換行，但 review 時實測發現
      **窄寬度 + Supabase 模式仍換行**（1024 / 800 / 730px）：email 截斷後仍佔 132px，
      而窄寬度斷點當初是照本機模式調的。補一條 `@media (max-width: 1220px) { .user-email { display: none } }`
      ——完整信箱本來就在登出鈕的 title，收起不會遺失資訊。
- [x] 註解修正：原本寫「先收間距」與「手機版 ≤700px」，與實際的無條件套用及 720px 斷點不符；
      並補記「調整斷點務必以 Supabase 模式驗證」的教訓。
- [x] 驗證：**兩種模式**各自 730–1920px 每 10px 掃描，全部單行；`npm run build` 與 90/90 測試通過。

### 教訓
- 本機模式的「本機模式」標籤比 Supabase 模式的 email + 登出鈕窄約 140px，
  只測本機模式會漏掉正式環境的版面問題。往後頁首相關變更一律以 Supabase 模式為準。

---

## 2026-07-21 15:58:00 Asia/Taipei — 版本徽章回歸左下角、未實現損益改稱「淨」(v0.3.3)

- **Agent**: Claude（小幅 UI 調整，未達委派 agy 的損益平衡點）
- **Action**: Relocate version stamp; rename unrealized P&L to 「淨損益」
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增 `src/version.ts` 作為版本資訊**單一來源**（`APP_VERSION` / `APP_AUTHOR`）。
      先前 v0.3.0 把版號硬編在 `ServiceStatusPage.tsx`，與 `package.json` 各走各的，已漂移成 `v0.3` vs `0.3.2`。
- [x] `App.tsx` + `index.css`：還原 v0.2.8 的 `.version-badge`（fixed、左下 14/12px、`pointer-events: none` 不擋點擊）。
- [x] `ServiceStatusPage.tsx`：移除「版本戳記」區塊；`runHealthCheck(APP_VERSION)` 改用共用常數，
      「應用程式」元件的檢測註記仍帶版號，功能不受影響。
- [x] `DashboardPage.tsx`：表格欄位與兩張 KPI 一律改名為「未實現淨損益」；
      欄位 `?` 說明改以「『淨』代表把交易成本都算進去」開頭，明列買入手續費 / 台股賣出手續費 + 證交稅。
- [x] `DashboardPage.tsx`：台股 KPI 的「主數字已預扣賣出手續費與證交稅」那行改收進卡片標題 `title` tooltip；
      美股 KPI 標題同步補 tooltip 說明「不預扣賣出費用」，避免「淨」字被誤讀為兩市場口徑相同。
- [x] `App.smoke.test.tsx`：新增 2 個測試鎖住上述行為（徽章存在且含版號、狀態頁無「版本戳記」、
      KPI 名稱與 tooltip、預扣說明不再單獨成行），並在既有流程補驗表頭為「未實現淨損益」。
- [x] `package.json` 版本 bump 至 `0.3.3`。
- [x] 驗證：`npm run build` 通過；`npm test -- --run` 92/92 通過（原 90 + 新增 2）。

### 教訓
- `/verify` skill 記載的 Playwright 走法**此環境已失效**（`~/.npm/_npx` 快取與 `~/.cache/ms-playwright` 皆已無 playwright，
  npx 快取本來就會被清）。這次改以既有的 `App.smoke.test.tsx`（jsdom + Testing Library）驗證 UI 文案與 DOM，
  比一次性的瀏覽器腳本更耐久，且變成回歸測試。往後 UI 文案 / 結構類驗證優先走 smoke test，
  真正需要像素或版面掃描（例如頁首換行）時才補裝 Playwright。

---

## 🚧 Next Steps
1. 設定 GitHub Actions 自動部署流程 (Task 2)。
2. 配合使用者引導完成 Supabase 專案連結與 Edge Function `stock-price` 部署 (Task 3)。
