# 股票交易與庫存管理系統 (Web 版) 系統設計文件

本文件規劃將原本基於 Google Apps Script (GAS) 的股票管理工具，移植並升級為一個基於 **React (Vite + TypeScript)**、**Supabase (Database & Auth & Edge Functions)** 並部署於 **GitHub Pages** 的現代化單頁網頁應用程式 (SPA)。

> 📌 **2026-07-16 決策更新**：本文件已依討論結論修訂——前端採 **TypeScript**、現價改由 **Supabase Edge Function 代理**、**CSV 匯入/匯出**（含舊試算表資料搬遷）納入早期範圍、資料庫 Schema 加入 CHECK constraints 與 workspace 歸屬一致性驗證。

---

## 🏗️ 系統架構與技術可行性評估

### 1. 部署架構：GitHub Pages (前端靜態託管)
* **可行性**: **高**。GitHub Pages 提供免費且極速的靜態網頁託管服務。由於 React/Vite 專案經 build 後皆為靜態的 HTML, JS, CSS 檔案，非常適合部署於此。
* **開發環境與建置**: 使用 Vite 作為打包工具，配置 `base: './'` 或 `base: '/<repository-name>/'` 即可完美相容 GitHub Pages 的子路徑。
* **SPA 路由注意事項**: 因部署於子路徑且 GitHub Pages 不支援伺服器端 rewrite，前端路由採用 **HashRouter**（或單頁分頁切換、不使用 router），避免重新整理時 404。
* **Auth Redirect URL**: Supabase Auth 的 Site URL / Redirect URLs 需設定為 GitHub Pages 的正式網址，否則註冊確認信與 OAuth 轉址會失敗。

### 2. 後端與資料庫：Supabase (BaaS)
* **可行性**: **高**。Supabase 提供 PostgreSQL 資料庫、GoTrue 身份驗證 (Auth) 以及行級安全性 (Row Level Security, RLS)。
* **多使用者隔離**: 
  - 透過 Supabase Auth，使用者可以使用電子信箱與密碼進行註冊/登入。
  - 開啟 RLS 後，建立如下安全策略：每一筆交易紀錄與工作區 (Workspace) 都綁定 `user_id`，使用者只能讀寫符合 `auth.uid() = user_id` 的資料。這能 100% 確保資料的隱私與安全。
* **客戶端連接**: 前端直接使用 `@supabase/supabase-js` 進行 API 呼叫，不需額外編寫 Node.js 後端服務，非常契合 GitHub Pages 靜態網站。

### 3. 現價 API 取得方案 (Supabase Edge Function 現價代理)
瀏覽器前端受限於同源政策 (CORS)，且公用 CORS Proxy 不穩定又有隱私疑慮，因此**不依賴公用 Proxy**，改採以下策略：
* **主要策略：Supabase Edge Function 現價代理**
  - 在 Supabase 部署一支 Edge Function（`stock-price`），由伺服器端代為請求 Yahoo Finance（台股 `2330.TW` / `.TWO`、美股 `AAPL`）等來源，完全繞開 CORS。
  - 前端以 `supabase.functions.invoke('stock-price', { body: { tickers: [...] } })` **批次**查詢多檔現價，減少請求次數；免費額度對個人使用綽綽有餘。
  - 股票名稱模糊搜尋與代號反查（原 GAS 的 TWSE codeQuery、TPEx OpenAPI、Yahoo 搜尋）同樣經由 Edge Function 代理，並沿用原專案的快取策略。
* **台股備援：TWSE / TPEx OpenAPI 直連**：部分官方端點支援 CORS，可作為台股現價的直連備援路徑。
* **降級機制**: 當 API 連線失敗或部分代號查無現價時，顯示上次快取價（localStorage 暫存並標註時間）或將市值/未實現損益留空——**不誤顯示為全額虧損**（與原 GAS 專案行為同構）。
* **非同步更新設計**: 進入網頁後在背景非同步（Async）載入現價，載入完成前顯示骨架屏 (Skeleton) 或上次暫存價，載入後自動更新未實現損益。

---

## 🗄️ 資料庫綱要設計 (Supabase Database Schema)

我們需要在 Supabase 中建立三個主要資料表，並啟用 RLS (Row Level Security)。

設計重點（2026-07-16 決策）：
* `tx_type` 資料庫層儲存 `'BUY'` / `'SELL'`（加 CHECK constraint），顯示層再轉「買入 / 賣出」——對 TypeScript 型別與未來擴充較乾淨；CSV 匯入舊資料時由匯入器轉換。
* 數值欄位加上 CHECK constraints（`qty > 0`、`price >= 0`、`fee_tax >= 0`），與前端驗證同構。
* `transactions` 以**複合外鍵** `(workspace_id, user_id) REFERENCES workspaces(id, user_id)` 保證交易所屬的工作區確實屬於同一使用者（搭配 workspaces 的 `UNIQUE (id, user_id)`）。
* `market` 維持 TEXT 不加 CHECK，保留未來擴充其它市場（日股、港股）的彈性。

```sql
-- 1. 工作區資料表 (workspaces)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 供 transactions 複合外鍵引用，確保 workspace 歸屬一致性
    UNIQUE (id, user_id)
);

-- 啟用 RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- RLS 策略：使用者只能操作自己的工作區
CREATE POLICY "Users can manage their own workspaces"
ON workspaces FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 2. 交易紀錄資料表 (transactions)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tx_date DATE NOT NULL,
    market TEXT NOT NULL,         -- 'TPE' (台股) 或 'US' (美股)，TEXT 保留擴充彈性
    ticker TEXT NOT NULL,         -- 股票代號 (例如 '2330', 'AAPL')，不含 'TPE:' 前綴
    name TEXT NOT NULL,           -- 股票名稱
    tx_type TEXT NOT NULL CHECK (tx_type IN ('BUY', 'SELL')), -- 顯示層轉「買入/賣出」
    price NUMERIC NOT NULL CHECK (price >= 0),        -- 交易單價
    qty NUMERIC NOT NULL CHECK (qty > 0),             -- 交易股數
    fee_tax NUMERIC NOT NULL DEFAULT 0 CHECK (fee_tax >= 0), -- 手續費/稅金
    -- 複合外鍵：保證交易所屬的工作區屬於同一使用者
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspaces(id, user_id) ON DELETE CASCADE
);

-- 建立索引加速查詢
CREATE INDEX idx_tx_workspace ON transactions(workspace_id);
CREATE INDEX idx_tx_user ON transactions(user_id);
CREATE INDEX idx_tx_date ON transactions(tx_date ASC);

-- 啟用 RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS 策略：使用者只能操作自己的交易紀錄
CREATE POLICY "Users can manage their own transactions"
ON transactions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 3. 使用者設定資料表 (user_settings)
CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    default_fee_rate NUMERIC NOT NULL DEFAULT 0.001425,
    theme TEXT NOT NULL DEFAULT 'dark'
);

-- 啟用 RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "Users can manage their own settings"
ON user_settings FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

---

## 📂 專案程式碼結構規劃 (`sources/`)

專案將採用以下 React + Vite + **TypeScript** 結構（以 `react-ts` 範本初始化），所有程式碼都放置於 `sources/` 資料夾下：

```
sources/
├── public/                 # 靜態資源 (Icon 等)
├── src/
│   ├── assets/             # 圖片與全局樣式
│   ├── components/         # 共享組件
│   │   ├── Common/         # 按鈕、輸入框、Modal、Loading
│   │   ├── Auth/           # 登入與註冊頁面 (Glassmorphism 樣式)
│   │   ├── Dashboard/      # 庫存總覽看板 (卡片、表格、圓餅圖)
│   │   ├── YearlyReport/   # 年度收益報表 (折疊明細、KPI 卡片)
│   │   └── Transactions/   # 交易紀錄表格與輸入表單 (側邊欄/浮動窗)
│   ├── context/            # 全局狀態管理
│   │   ├── AuthContext.tsx       # 登入狀態、使用者資訊
│   │   └── WorkspaceContext.tsx  # 當前工作區、交易資料載入、計算後帳簿
│   ├── hooks/              # 自訂 React Hooks
│   │   └── useStockPrices.ts     # 背景非同步拉取股票現價
│   ├── services/           # 外部服務 API
│   │   ├── supabase.ts           # Supabase 客戶端初始化
│   │   ├── priceProxy.ts         # 呼叫 stock-price Edge Function 取得現價
│   │   └── stockSearch.ts        # 台美股搜尋與代號反查 (經 Edge Function)
│   ├── types/              # 共用型別定義
│   │   ├── database.types.ts     # Supabase CLI 由 schema 產生的資料庫型別
│   │   └── models.ts             # Transaction / Holding / YearlySummary 等介面
│   ├── utils/              # 工具函式
│   │   ├── pnlEngine.ts          # 移植自 GAS 的移動平均成本損益計算引擎
│   │   ├── csv.ts                # CSV 匯入/匯出 (含舊資料 TPE: 前綴與中文交易類型轉換)
│   │   └── formatters.ts         # 金額格式化 (TWD整數, USD小數)
│   ├── App.tsx             # 主路由與應用入口
│   ├── index.css           # 全域 CSS 變數與主題設計系統
│   └── main.tsx
├── supabase/
│   └── functions/
│       └── stock-price/    # Edge Function：現價/搜尋代理 (繞開 CORS)
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## ⚡ 核心邏輯移轉策略 (GAS ➡️ TypeScript)

1. **核心計算引擎 (pnlEngine.ts)**:
   * 原 GAS 中的 `computeLedger_` 邏輯是基於陣列的線性掃描，我們將其改寫為**純 TypeScript 函數**，並以 `Transaction`、`Holding`、`YearlySummary` 等介面（`types/models.ts`）明確定義輸入輸出。
   * 輸入: 某個工作區的所有交易陣列 (已按日期與建立時間排序)。
   * 輸出:
     - `holdings`: 目前持有股數 > 0 的個股列表 (含均價、市值、未實現損益、已實現損益、報酬率)。
     - `yearly`: 按年度統計的已實現損益、手續費、交易筆數以及個股明細。
     - `summary`: 台美股歷史累計數據。
   * **幣別判斷改由 `market` 欄位決定**（`'TPE'` → TWD、`'US'` → USD），不再依賴原 GAS 版 ticker 的 `TPE:` 前綴；資料庫中的 `ticker` 一律儲存乾淨代號（如 `2330`、`AAPL`）。
   * **優勢**: 每次交易異動或切換工作區時，前端在毫秒內即可重算完畢，不需要在後端資料庫做複雜的 trigger 或維護冗餘狀態。

2. **CSV 匯入/匯出 (csv.ts)** — 舊資料搬遷的關鍵路徑:
   * **匯入**: 支援由舊 Google 試算表「個股交易紀錄」分頁匯出的 CSV。匯入器需處理：
     - `TPE:2330` → `market='TPE'` + `ticker='2330'` 的前綴拆解（無前綴者視為美股）。
     - 交易類型「買入 / 賣出」→ `'BUY' / 'SELL'`。
     - 日期格式（`2026/07/15`、`2026-07-15`）解析，與原 GAS `parseTxDate_` 同構。
     - 匯入前提供預覽與逐列驗證錯誤提示，確認後批次寫入 Supabase。
   * **匯出**: 將當前工作區交易匯出為 CSV 備份。

3. **精算同構對齊 (台股四捨五入與稅費捨去)**:
   * 保留原 GAS 修改後的精算邏輯：
     - 台股手續費與證交稅在預估時以 `Math.floor()` 無條件捨去。
     - 最外層以 `Math.round(..., 0)` 收整浮點數。
     - 美股維持小數計算。
   * 在 `formatters.ts` 中實現分區段格式化：台股損益顯示為整數，現價/均價保留兩位小數；美股全面保留兩位小數。

---

## 🎨 介面與視覺設計 (Premium UX)

為了提供使用者極致的視覺饗宴 (WOW factor)，我們將採用**暗黑玻璃擬物風 (Glassmorphism & Neon Dark Mode)**：
1. **配色系統**: 深邃的灰黑背景 (`#0b0f19`) 搭配半透明磨砂玻璃卡片，使用霓虹漸層色作為主要視覺強調（台股漲幅使用霓虹紅 `#ff4a5a`，跌幅使用霓虹綠 `#00e676`，注意：符合台灣看盤習慣）。
2. **字型選用**: 引入 Google Fonts - **Inter** 與 **Outfit**，呈現現代科技感。
3. **微互動與動畫**: 使用 CSS Transitions 與鍵影幀動畫 (Keyframes)，在 Hover 按鈕、切換 Tab、展開年度明細時提供絲滑的過渡動畫。

---

## 🛠️ 階段建置與驗證計畫 (Implementation Phases)

> 各階段依序推進、完成即驗證；不預估天數（原估時為人工開發參考值，已移除）。

### 階段一：基礎設施與環境架設
* **工作內容**:
  1. 在 `sources/` 以 Vite **`react-ts`** 範本初始化 React + TypeScript 專案，設定 `.gitignore` 與 `.env.example`。
  2. 在 Supabase Console 建立專案、執行 SQL DDL 建立資料表（含 CHECK constraints 與複合外鍵），並設定 RLS 規則。
  3. 安裝 `@supabase/supabase-js`, `lucide-react` 等套件；以 Supabase CLI 產生 `database.types.ts` 資料庫型別。
* **驗證方式**:
  - 確認專案能成功啟動本地伺服器 (`npm run dev`) 且 `tsc` 型別檢查通過。
  - 使用 Supabase 測試連線，手動在後端寫入測試帳號。

### 階段二：使用者認證與工作區切換
* **工作內容**:
  1. 實作 `AuthContext` 處理註冊、登入、登出與登入狀態保持。
  2. 建立精美的 Login/Register Glassmorphism 頁面。
  3. 實作工作區管理 (新增工作區、切換當前工作區)。
* **驗證方式**:
  - 測試兩人分別註冊，確認登入後在下拉選單只能看到自己的工作區。
  - 確認重新整理網頁後登入狀態不會丟失。

### 階段三：核心引擎移植、交易紀錄管理與 CSV 匯入
* **工作內容**:
  1. 將 GAS 移動平均成本計算邏輯移轉為 `pnlEngine.ts`（幣別改由 `market` 欄位判斷），並撰寫單元測試。
  2. 實作交易表單與側邊欄 UI，支援輸入與即時估算手續費（台股 `Math.floor` 捨去、賣出加計證交稅、ETF 0.1% 判斷）。
  3. 實作模糊搜尋 (台美股代號反查與名稱對應)。
  4. 實作 **CSV 匯入/匯出 (`csv.ts`)**：優先完成匯入（含 `TPE:` 前綴拆解與「買入/賣出」→ `BUY/SELL` 轉換、匯入預覽與驗證），將使用者舊試算表的真實交易資料完整搬遷進 Supabase。
* **驗證方式**:
  - 提供一組已知的交易測試資料 (包含買入、賣出、拆分與清倉情況)，驗證 `pnlEngine.ts` 算出的持倉股數、均價與損益，是否與 template 專案算出的結果 100% 一致。
  - 以使用者舊試算表匯出的真實 CSV 進行匯入，核對筆數與各股票持倉、已實現損益與原試算表一致。

### 階段四：Dashboard、年度收益報表與現價整合
* **工作內容**:
  1. 建立 Dashboard 頁面（大字報、Active持股表格、手續費統計）。
  2. 建立年度收益總覽頁面，實作折疊分組（年度總計展開後顯示個股明細）。
  3. 部署 `stock-price` Edge Function 並整合非同步股票現價（`useStockPrices` + `priceProxy.ts`，含快取價降級機制）。
* **驗證方式**:
  - 確認當新增/刪除交易紀錄時，Dashboard 與年度報表能在一瞬間同步更新（靜默更新）。
  - 確認點擊年度展開按鈕時有平滑動畫，且排版整齊。
  - 模擬現價 API 失敗（離線/擋掉請求），確認 UI 降級顯示快取價或留空、不顯示為全額虧損。

### 階段五：自檢 code review 與部署
* **工作內容**:
  1. 自檢程式碼安全，確認無敏感資訊 (API Key, password) 外洩，確認 Supabase RLS 安全。
  2. 配置 GitHub Actions 完成自動打包並部署至 GitHub Pages（`vite.config.ts` 設定 `base` 子路徑）。
  3. 設定 Supabase Auth 的 Site URL / Redirect URLs 為 GitHub Pages 網址；確認前端路由（HashRouter 或單頁切換）重新整理不 404。
* **驗證方式**:
  - 開啟無痕視窗訪問 GitHub Pages 網址，測試完整註冊、登入、記帳、CSV 匯入與報表流程。
