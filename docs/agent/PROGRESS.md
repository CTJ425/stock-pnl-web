# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.29-dev.2 — MIS 即時產業別資料流、個股行情產業標籤與收盤無成交價格修復 (BUG-045, BUG-046)
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-03 17:50:00 Asia/Taipei

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

---

## 📅 Log: 2026-09-03 16:58:30 Asia/Taipei (0.9.29-dev.1 — 觀察股票緊湊型小卡與自適應產業分類標籤)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.28` → **`0.9.29-dev.1`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者要求依照建議的「方案 A（緊湊型小卡 Mini Card）」改版首頁庫存總覽觀察股票（WatchSection），並自適應判斷股票類型與官方 33 類產業分類，以微型徽章展示。
- **Work**:
  1. **Mini Card 緊湊型佈局（方案 A）** (`WatchSection.tsx`, `index.css`):
     - 卡片網格改為 `repeat(auto-fill, minmax(165px, 1fr))`，gap 10px。
     - 卡片內距優化為 `10px 10px`，最小高度降至 72px（垂直佔位大幅減少 35%~40%）。
     - 雙行佈局：
       - 第 1 行：股票代號（13px mono bold）、名稱（13px 保留 min-width: 2.2em 避免長字名被壓至 0px 隱形）、微型分類徽章（10px subtle badge，max-width: 64px 支援優雅省略，在條列檢視下不受限）、右上角緊湊型移除按鈕（20px）。
       - 第 2 行：現價（18px tabular nums, 保留紅綠漲跌色）與漲跌幅百分比（12px tabular nums, 保留紅綠色）。
     - 條列檢視（Table View）同步在名稱旁展示微型分類徽章。
  2. **台股類型與產業即時判定** (`src/utils/stockCategory.ts`):
     - 0ms 純函數即時推導，無任何外部網路開銷。
     - 規則式類型：`00...B` 債券 ETF、`00...L` 槓桿 ETF、`00...R` 反向 ETF、`00...` 股票型 ETF、`02...` ETN、`91...` TDR、`01...` REITs。
     - 特別股精準比對：嚴格限定 4 位數字代號加英文字母（如 `2881A`），徹底排除權證（如 `03001P`、`08321B`）之誤判。
     - 官方產業分類：擴充包含上櫃指標龍頭（3293 鈊象、5483 中美晶、3680 家登、6187 萬潤、3105 穩懋、3363 上詮等）之官方產業別，並納入 TPEx「文化創意」、「居家生活」類別。
     - 啟發式後備比對：支援遊戲/文創、生技/醫材/藥、能源/綠能、軟體/資訊等更完整的關鍵字後備推導。
  3. **單元測試** (`stockCategory.test.ts`, `WatchSection.test.tsx`):
     - `stockCategory.test.ts` 新增 17 個測試（包含權證排除、上櫃指標股、新產業別與擴充後備規則）。
     - `WatchSection.test.tsx` 擴增至 12 個測試（新增超長名稱與 TPEx 類別渲染測試）。
- **Verify**:
  - `npx vitest run src/utils/stockCategory.test.ts`: 17/17 tests passed.
  - `npx vitest run src/components/Dashboard/WatchSection.test.tsx`: 12/12 tests passed.
  - 全專案測試：`npm test` 96 檔測試檔、1556 個測試全數 PASS。
  - 編譯與型別：`npm run build`（`tsc -b && vite build`）exit 0。
  - 代碼檢查：`npx oxlint src` 0 error。