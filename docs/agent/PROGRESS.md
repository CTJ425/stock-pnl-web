# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.29-dev.3 — 觀察股票同產業自動群組聚合、膠囊篩選與分析頁選單分組
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-03 19:15:00 Asia/Taipei

---

## 📅 Log: 2026-09-03 19:15:00 Asia/Taipei (0.9.29-dev.3 — 觀察股票同產業自動群組聚合、膠囊篩選與分析頁選單分組)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.29-dev.2` → **`0.9.29-dev.3`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者需求「讓相同產業的股票變成一個group，例如一開始只有長榮，但後來又觀察陽明這時候會自行形成一個group，方便使用者依照產業別選擇個股資訊」。
- **Work**:
  1. **核心自動分組邏輯 (`stockGrouping.ts`)**:
     - `groupWatchItems`：依據 `getStockCategory` 解析出的官方/推導產業別進行計數；當同產業標的數 $\ge 2$ 時，自動聚合成獨立產業族群（如「航運業 (2)」）；單一標的、未分類者以及官方「其他」類別個股自然歸入「其他」，徹底杜絕「其他業 (2)」與「其他 (1)」雙重重複分組。若無任何族群 $\ge 2$，不觸發分組。
     - `getGroupCategoryName`：建立 `CANONICAL_INDUSTRY_MAP`，完整涵蓋 33 大官方產業標準與常見異構別名（電腦週邊／電腦及週邊設備業、化學／化學工業、建材營造、觀光餐旅等），保證報價載入前後產業名稱完全一致，防止族群分裂。ETF/ETN/特別股等資產類型保留原有名稱。
  2. **庫存總覽分組檢視與快速篩選膠囊 (`WatchSection.tsx`, `index.css`)**:
     - 膠囊列（Filter Chips）：當存在 $\ge 2$ 群組時，在頂部動態渲染「全部 (N)」、「產業 (M)」、「其他 (K)」切換按鈕，點選後即時過濾卡片/表格列。
     - 圖卡模式：依群組顯示分組標題與計數標籤（`watchlist-group-title`）。
     - 條列模式：以分組標題列（`watchlist-group-row`）清晰劃分各產業。
     - 狀態持久與自適應解構：切換圖卡/條列模式保留當前篩選狀態；標的移除致產業數量 $< 2$ 時自動解構回復扁平檢視。
     - 篩選崩潰防護：在「其他」篩選狀態下若刪除最後一檔其他標的，`activeFilter` 安全退階為「全部 (N)」並自動同步重設 `filter` state，徹底消除畫面全空之 Fatal Bug。
  3. **個股分析頂部切換選單產業分組 (`AnalysisPage.tsx`)**:
     - 頂部「切換個股」下拉選單（`HeaderMenu`）中的觀察股票區塊，依據相同產業自動分組顯示（如「觀察 ── 航運業」、「觀察 ── 電腦及週邊設備業」、「觀察 ── 其他」），且不同標的切換時群組穩定不跳躍。
  4. **單元測試 (`stockGrouping.test.ts`, `WatchSection.test.tsx`, `AnalysisPage.test.tsx`)**:
     - `stockGrouping.test.ts`：13 個測試覆蓋空清單、單一股票不分組、多檔不同產業不分組、$\ge 2$ 檔自動聚合、多產業與其他群組、即時報價產業別支援、規範化別名對齊、官方「其他」類別防護、30 檔混合多元資產邊界。
     - `WatchSection.test.tsx`：新增 7 個測試覆蓋單一股票不觸發分組、2 檔同產業聚合與膠囊、多產業篩選切換、條列模式分組列與模式切換保留狀態、刪除股票後自動解構、刪除最後一檔其他標的退階防護、跨資料來源電腦週邊聚合。
     - `AnalysisPage.test.tsx`：新增 5 個測試覆蓋單一股票維持「觀察」標題、$\ge 2$ 檔聚合為「觀察 ── 產業名」、多產業聚合與其他分組、分組選單切換個股、異構報價電腦週邊選單聚合。
- **Verify**:
  - `npm test`：97 檔測試檔、**1599** 個測試全數 PASS（0 失敗）。
  - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
  - `npm run build`：tsc -b && vite build exit 0。
  - `npx oxlint src`：0 errors。

---

## 📅 Log: 2026-09-03 17:50:00 Asia/Taipei (0.9.29-dev.2 — MIS 即時產業別資料流、個股行情產業標籤與收盤無成交價格修復)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.29-dev.1` → **`0.9.29-dev.2`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者同意將產業資訊直接從 MIS 即時行情資料流帶出，並要求在個股分析「行情」區塊補上產業別顯示，同時解決收盤無成交價格異常（BUG-045）與字典誤植（BUG-046）。
- **Work**:
  1. **Edge Function `stock-price` (`misParse.ts`, `index.ts`)**:
     - 在 `misParse.ts` 中解析 MIS 原始欄位 `row.i`（官方產業代碼，如 `15` 航運、`16` 觀光餐旅、`24` 半導體），透過 33 大官方產業字典對照表映射成中文產業名稱。
     - `MisQuote` 與 `Quote` 介面新增 `industry: string | null`，`fetchYahooPrice` 及 DB cache 讀取回傳 `industry: null`。
     - **修復 BUG-045**：收盤時（`t >= '13:30:00'`）若 `z === '-'`（無當盤撮合成交），`pickPrice` 絕不可退階取 `b[0]`（買一委買價），直接回傳 `null`，使 Edge Function 自然切換至 Yahoo Finance 後備線路接管，精確取得 5701 劍湖山真實收盤價 4.30 元（避免鎖入委買價 4.19 元並被收盤鎖定）。
  2. **前端型別與行情介面 (`priceProxy.ts`, `QuoteTab.tsx`, `WatchSection.tsx`, `stockCategory.ts`, `index.css`)**:
     - `priceProxy.ts`：`PriceQuote` 與 `EdgeQuote` 介面新增 `industry?: string | null`，`fetchFromEdge` 解析文字帶入。
     - `QuoteTab.tsx`：行情頂部抬頭（`.m-quote-head`）新增 `.quote-badge` 產業微型徽章，優先取 `quote.industry`，未抵達時自動由 `getStockCategory(ticker, name)` 提供後備。
     - `index.css`：新增 `.quote-badge` 樣式（取消 64px 截斷限制、置中對齊）。
     - `WatchSection.tsx` 與 `stockCategory.ts`：
       - `getStockCategory` 函式簽章擴充第 3 參數 `industry?: string | null` 並優先採用。
       - 觀察股票卡片與條列檢視優先傳入 `quote?.industry`。
       - 修正 `COMMON_STOCK_INDUSTRIES` 靜態字典：將 2208 台船從汽車修正為「航運業」、新增 5701 劍湖山為「觀光餐旅」。
  3. **單元測試 (`misParse.test.ts`, `stockCategory.test.ts`, `QuoteTab.test.tsx`, `WatchSection.test.tsx`)**:
     - `misParse.test.ts`：新增官方產業代碼對照、`toIndustry` 型別與邊界轉換、收盤無成交回傳空陣列（BUG-045，含 `t` 與 `ot` 雙重守衛）、盤中仍退階買一價測試（24/24 通過）。
     - `stockCategory.test.ts`：新增 2208 台船修正測試、5701 劍湖山測試、即時 `industry` 參數優先級、空代號防護、`'-'`/`'--'` 佔位符過濾與空白修剪測試（23/23 通過）。
     - `QuoteTab.test.tsx`：新增即時 `quote.industry` 徽章渲染測試與無報價後備推導測試（26/26 通過）。
     - `WatchSection.test.tsx`：新增優先採用 `quote.industry` 測試（13/13 通過）。
- **Verify**:
  - `npm test`：96 檔測試檔、**1574** 個測試全數 PASS（0 失敗）。
  - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
  - `npm run build`：tsc -b && vite build exit 0。
  - `npx oxlint src`：0 errors。
- **連帶關閉**: Task 143、BUG-045、BUG-046。