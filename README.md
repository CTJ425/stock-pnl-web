# 📈 股票交易與庫存管理系統 (Stock PnL Web)

> **目前版本：v0.2.4**（版本號固定顯示於應用畫面左下角，如 `v0.2.4 | Ivan Chen`）

本專案是一個現代化、獨立的網頁應用程式 (Standalone Web App)，旨在幫助使用者管理個人股票交易紀錄、計算移動平均成本，並提供即時庫存總覽與年度收益報表。本專案由原 Google Apps Script (GAS) 「試算表股票小幫手」移植並升級而來。

## 📖 目錄
- [專案目的](#-專案目的)
- [功能特色](#-功能特色)
- [環境架構](#-環境架構)
- [使用版本](#-使用版本)
- [使用方式](#-使用方式)
- [部署方式](#-部署方式)
- [GitHub Actions 自動部署](#-github-actions-自動部署)
- [版本紀錄](#-版本紀錄)
- [注意事項](#-注意事項)

---

## 🎯 專案目的
將原基於 Google 試算表與 GAS 的股票小幫手完整移植為獨立的 Web 應用，擺脫對 Google 生態系的強依賴，並提供：
1. **跨平台體驗**：玻璃擬物風 (Glassmorphism) 設計，支援深色 / 淺色 / 跟隨系統三種主題，桌機與手機皆完整支援 (RWD)。
2. **多工作區 (Workspace) 管理**：支援使用者建立、命名與切換多個獨立的投資組合（例如「玉山證券」、「元大證券」），各工作區可各自設定預設手續費率。
3. **無縫舊資料搬遷**：支援直接匯入舊 GAS 試算表導出的 CSV，自動相容 `TPE:2330` 前綴、中文交易類型「買入/賣出」轉換。
4. **雙模式運行**：
   - **本機模式**：無須註冊與登入，資料儲存在瀏覽器 `localStorage`，立即可用。
   - **Supabase 雲端模式**：提供雲端儲存、Email 帳密註冊登入與多裝置同步，資料受 RLS (Row Level Security) 行級安全策略保護。

---

## ✨ 功能特色

### 交易與報表
- **交易紀錄**：新增（全域浮動按鈕，任何分頁可用）、單筆 / 勾選多筆刪除、依日期或代號排序、CSV 匯入 / 匯出。
- **庫存總覽 Dashboard**：現價、市值、未實現損益與未實現報酬率（僅計算當前持有部位、與券商 APP 同口徑；台股預扣賣出手續費與證交稅）。歷史已實現績效於「年度收益」頁查看。
- **年度收益**：台股 / 美股分區年度已實現損益，各欄位皆可排序，年度列可展開個股明細（含當年只買進、尚未賣出者）。金額採「含費 / 未含費」雙行顯示，並提供「賣出成本」欄，使每列成立 `已實現損益 = 賣出收入 − 賣出成本`。
- **欄位說明**：庫存總覽與年度收益的每個欄位表頭都有「?」圖示，滑鼠移入（或鍵盤聚焦、手機點擊）即顯示該欄的定義與計算方式。

### 股票搜尋與名稱
- **中文正反查**：輸入代號自動帶出中文名稱（台股來自 TWSE / TPEx 官方清單；常見美股內建 zh-TW 譯名對照表，如 `AAPL` → 蘋果）；輸入中文（台積、特斯拉）可模糊搜尋反查代號。
- **搜尋排名**：正股優先，權證 / 牛熊證自動排除。

### 現價與快取（三層架構）
1. **L1 – 瀏覽器 localStorage**：台股 60 秒 / 美股 10 分鐘 TTL，重整 / 重新登入不重打 API。
2. **L2 – Supabase `price_cache` 資料表**：全站共用，同一支股票在 TTL 內全體使用者只向外部 API 請求一次；`stock_names` 資料表快取查詢過的代號↔名稱（不設過期）。
3. **L3 – 外部行情源**：僅在 L2 過期時由 Edge Function 伺服器端請求。台股走**證交所 MIS 即時行情**（秒級延遲），失敗時退 Yahoo Finance；美股走 Yahoo Finance。

`price_cache.updated_at` 記錄的是「報價實際取得時間」並回傳給前端，因此 L1 與 L2 的 TTL 不會疊加（同一份報價最舊即為取得時間 + 該市場 TTL）。前端另有每 60 秒背景輪詢與分頁切回前景補抓，TTL 內的代號直接命中 L1、不會真的發出請求。

共用快取表僅能由 Edge Function（service role）寫入，一般使用者唯讀，防止資料污染。

### 其他
- **每工作區手續費率**：工作區列的 `%` 按鈕可直接設定（支援 `0.0004275` 等折扣費率位數），新增交易與損益估算自動帶入。
- **主題切換**：跟隨系統 / 深色 / 淺色，選擇記憶於本機。
- **手機支援**：分頁列、表單、表格皆針對小螢幕最佳化；輸入字級 16px 避免 iOS 聚焦縮放。
- **版本標籤**：畫面左下角固定顯示目前版本與作者（`v0.2.1 | Ivan Chen`），方便回報問題時確認版本。

---

## 🏗️ 環境架構
專案主要包含以下兩個核心部分：
1. **前端 (Front-end)**:
   - 框架: `React` + `TypeScript` + `Vite` (SPA 單頁應用程式)。
   - 樣式: `Vanilla CSS` + 全域設計系統（CSS 變數驅動，深 / 淺主題共用一套元件）。
   - 狀態管理: React Context (`AuthContext`, `WorkspaceContext`)。
   - 計算引擎: `pnlEngine.ts`（移動平均成本法、精算同構對齊台股手續費/證交稅元以下無條件捨去、ETF 0.1% 優惠與 Dashboard 預扣賣出稅費、浮點誤差防護）。
2. **後端與服務 (Back-end & BaaS)**:
   - `Supabase`:
     - **PostgreSQL Database**：儲存 Workspaces、Transactions、User Settings，以及共用快取 `price_cache`（現價）與 `stock_names`（代號↔名稱）。
     - **GoTrue Auth**：處理帳號註冊與登入驗證。
     - **Row Level Security (RLS)**：透過 SQL Policy 確保使用者只能讀寫自己的資料；共用快取表唯讀。
     - **Edge Functions (Deno)**：伺服器端部署 `stock-price` 函數，批次查詢台美股現價（台股走證交所 MIS 即時行情、失敗退 Yahoo；美股走 Yahoo）與提供模糊搜尋 API，繞過瀏覽器 CORS 限制。

### 系統架構圖 (System Architecture)

```mermaid
graph TD
    User([使用者瀏覽器]) <-->|操作與查看| FE[React 前端 SPA]
    
    subgraph Frontend [React SPA (Vite + TS)]
        FE <--> Components[UI 組件 / 頁面]
        Components <--> Context[React Context 狀態管理]
        Context <--> DP[DataProvider 雙模式資料層]
    end
    
    subgraph LocalStorage [本機儲存 (本機模式)]
        DP <-->|讀寫交易與設定| LS[(瀏覽器 LocalStorage)]
    end

    subgraph Supabase [Supabase 雲端服務 (Supabase 模式)]
        DP <-->|身份驗證| Auth[Supabase Auth]
        DP <-->|PostgreSQL API| DB[(PostgreSQL Database)]
        DP <-->|呼叫函式| EF[Edge Functions: stock-price]
        
        subgraph Database_Tables [資料庫資料表]
            DB --- Workspaces[(workspaces)]
            DB --- Transactions[(transactions)]
            DB --- Settings[(user_settings)]
        end
    end

    subgraph External [外部服務]
        EF <-->|台股即時現價| MIS[TWSE MIS 即時行情]
        EF <-->|美股現價/搜尋（台股備援）| Yahoo[Yahoo Finance API]
    end

    classDef local fill:#ffe0b2,stroke:#fb8c00,stroke-width:2px;
    classDef cloud fill:#e3f2fd,stroke:#1e88e5,stroke-width:2px;
    classDef ext fill:#f5f5f5,stroke:#9e9e9e,stroke-width:2px;
    
    class LS local;
    class Auth,DB,EF,Workspaces,Transactions,Settings cloud;
    class Yahoo,MIS ext;
```

專案目錄結構：
```
stock-pnl-web/
├── .github/workflows/    # GitHub Actions 自動部署（deploy.yml）
├── build-docs/           # 系統設計、專案進度與資料庫 SQL 綱要（supabase_schema.sql）
├── docs/                 # 維運文件（Supabase SQL 常用查詢 sql_cli.md）
├── sources/              # 前端網頁應用程式原始碼 (Vite React TS)
│   ├── src/
│   │   ├── components/   # Auth, Dashboard, YearlyReport, Transactions, Common UI
│   │   ├── context/      # AuthContext, WorkspaceContext
│   │   ├── hooks/        # useStockPrices
│   │   ├── services/     # supabase client, dataProvider (雙模式儲存實作),
│   │   │                 # priceProxy（現價＋TTL 快取）, stockSearch, twMarketData,
│   │   │                 # usStockNames（美股 zh-TW 譯名對照）
│   │   ├── types/        # models.ts
│   │   └── utils/        # pnlEngine.ts, csv.ts, fees.ts, formatters.ts, settings.ts
│   ├── supabase/         # Supabase Edge Functions 程式碼（stock-price）
│   └── package.json
└── README.md             # 本說明文件 (專案根目錄)
```

---

## 🏷️ 使用版本
- **React**: `^19.2.7`
- **React DOM**: `^19.2.7`
- **Vite**: `^8.1.1`
- **TypeScript**: `~6.0.2`
- **Supabase JS Client**: `^2.110.7`
- **Vitest** (測試框架): `^4.1.10`
- **Deno** (Edge Functions 執行環境): 最新 Supabase Edge Runtime

---

## 🚀 使用方式

### 本地開發 (Vite)
1. 進入 `sources/` 目錄：
   ```bash
   cd sources
   ```
2. 安裝套件：
   ```bash
   npm install
   ```
3. 啟動開發伺服器：
   ```bash
   npm run dev
   ```
   伺服器預設會運行在 `http://localhost:5173`。
4. 執行測試（單元測試 + UI 煙霧測試；測試固定以本機模式執行，不受 `.env.local` 影響）：
   ```bash
   npm run test
   ```
5. 進行靜態編譯打包：
   ```bash
   npm run build
   ```

### 雙模式切換
- **本機模式 (預設)**: 只要沒有設定環境變數，系統會自動在前端啟動本機模式，將資料存在 `localStorage`。此時免登入，但美股無即時現價。
- **Supabase 雲端模式**:
  1. 在 `sources/` 目錄下建立 `.env.local` 檔案。
  2. 填入您的 Supabase 專案 URL 與 Anon Key：
     ```env
     VITE_SUPABASE_URL=你的Supabase專案網址
     VITE_SUPABASE_ANON_KEY=你的Supabase金鑰
     ```
  3. 重新啟動服務 (`npm run dev`)，系統會自動轉換為登入/註冊介面。

---

## 📦 部署方式

### 1. 前端部署 (GitHub Pages)
前端已在 `sources/vite.config.ts` 設定 `base: './'` 以相容子目錄，push 到 `main` 即由 GitHub Actions 自動打包部署（詳見下一節）。

### 2. 後端部署 (Supabase)
1. **建立專案**：在 [Supabase Console](https://supabase.com) 註冊並新建專案。
2. **執行 SQL 初始化**：進入專案的 SQL Editor，複製並執行 `build-docs/supabase_schema.sql`，這會建立所需的資料表（含 `price_cache`、`stock_names` 共用快取）與 RLS 行級安全策略。
3. **部署 Edge Functions**（二擇一）：
   - **Dashboard**：Edge Functions → 建立 / 開啟 `stock-price` → 貼上 `sources/supabase/functions/stock-price/index.ts` 完整內容 → Deploy，並於設定中**關閉 Verify JWT**。
   - **CLI**：在本地安裝 Supabase CLI 並登入後，於 `sources/` 目錄執行：
     ```bash
     supabase functions deploy stock-price --no-verify-jwt
     ```
4. **設定身份驗證 Redirect URL**：
   在 Supabase 控制台的 Auth -> URL Configuration 中，將 Site URL 和 Redirect URLs 設定為您 GitHub Pages 的部署網址，確保登入/註冊重導正常運作。
5. **（建議）關閉信箱驗證或設定自訂 SMTP**：
   Supabase 內建郵件服務每小時僅能寄出約 2 封驗證信，僅供開發測試。小規模自用可於 Auth → Sign In / Providers → Email 關閉 Confirm email，或改由 Console → Authentication → Users 手動建立帳號（勾選 Auto Confirm User）。

---

## ⚙️ GitHub Actions 自動部署

workflow 定義於 `.github/workflows/deploy.yml`，流程如下：

```
push 到 main
   └─> actions/checkout 取出原始碼
   └─> actions/setup-node（Node 24，npm 快取鎖定 sources/package-lock.json）
   └─> npm ci（於 sources/ 安裝依賴）
   └─> npm run build（tsc 型別檢查 + vite build，注入 Supabase 環境變數）
   └─> actions/upload-pages-artifact（打包 sources/dist）
   └─> actions/deploy-pages（發佈到 GitHub Pages）
```

### 環境變數與 Secrets

Supabase 連線資訊**不進版本控制**，由 GitHub Secrets 於建置階段注入：

| Secret 名稱 | 內容 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 專案 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |

設定位置：GitHub Repo → Settings → Secrets and variables → Actions，或使用 CLI：

```bash
gh secret set VITE_SUPABASE_URL --body "https://xxxx.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY --body "sb_publishable_xxxx"
```

> 補充：anon key 本來就會隨前端 bundle 公開（Supabase 的設計即是如此，安全性由 RLS 保障）；使用 Secrets 的目的是讓原始碼庫保持乾淨、換 key 時不需改動程式碼。**service role key 絕不可放入前端或任何 Secrets 以外的位置。**

### 初次啟用 Pages

Repo → Settings → Pages → Build and deployment → Source 選擇 **GitHub Actions**，之後每次 push 到 `main` 即自動部署。

---

## 🗒️ 版本紀錄

### v0.2.4（2026-07-20）
- **庫存總覽新增「投入成本」欄**：目前持股當初投入的金額（平均買入成本 × 持有股數，含買進手續費），也就是「現在還壓在裡面」的錢；已賣出的部分不計入。欄位順序為「持有股數 → 投入成本 → 平均買入成本」，先看總額再看單價。金額同樣採「含費 / 未含費」雙行。
- 計算引擎未變動：數字取自既有的持股部位成本（`cost` / `rawCost`）。
- **CI**：GitHub Actions 的 Pages actions 升版（checkout / setup-node v7、upload-pages-artifact / deploy-pages v5），build 用的 Node 由 20 升至 24，解除 Node 20 runtime 淘汰警告。

### v0.2.3（2026-07-20）
- **台股現價改用證交所 MIS 即時行情**：原本台股報價來自 Yahoo Finance（本身延遲 15–20 分鐘），改為直接取用證交所 MIS 即時行情，Yahoo 降為失敗時的備援；美股維持 Yahoo。
- **修正快取 TTL 疊加**：Edge Function 的資料庫快取回傳的報價可能已存在近 10 分鐘，但前端收到後一律當成「剛取得」再快取 10 分鐘，兩層疊加後畫面上的價格最舊可達約 30 分鐘。現在 Edge Function 會回傳報價的**實際取得時間**，前端據此判斷新鮮度，兩層 TTL 不再疊加。
- **現價自動更新**：以往頁面開著不動就不會再更新現價（需手動按重新整理）。現在每 60 秒背景輪詢一次，分頁從背景切回前景時也會補抓；TTL 內的代號直接命中本機快取，不會真的發出請求。
- 快取 TTL 依市場區分：台股 60 秒、美股 10 分鐘。綜合以上，台股現價延遲由最壞約 30 分鐘壓縮至約 1 分鐘。
- **年度收益移除「買進總支出」欄**：該欄包含當年買進但尚未賣出的部位，與同一列的賣出成本 / 賣出收入 / 已實現損益不是同一批股票，並列容易讓人誤以為可以互相加減。移除後每一列自洽：`已實現損益 = 賣出收入 − 賣出成本`。「僅買進」個股的賣出三欄改顯示「—」而非整排 0（該列仍保留，其手續費與筆數需計入年度合計）。
- 計算引擎完全未變動，既有損益公式與數字不受影響（`buyAmt` / `buyGross` 仍保留於引擎，僅停止顯示）。
- ⚠️ 本次含 Edge Function 變更，需重新部署才會生效：`supabase functions deploy stock-price --no-verify-jwt`（資料庫 schema 無需異動）。

### v0.2.2（2026-07-18）
- **年度收益新增「賣出成本」欄**：顯示當年賣出部位的取得成本（賣出當下的移動平均成本 × 賣出股數），讓每一列成立 `已實現損益 = 賣出收入 − 賣出成本`，數字可自行驗算。
- **金額改「含費 / 未含費」雙行顯示**（與庫存總覽的平均成本同構）：主數字為實際付出與收到的錢（含手續費與證交稅），副行為單純成交價金。以台股常見情境為例，未含費的帳面價差會明顯高於實際落袋金額——證交稅 0.3%（ETF 0.1%）通常才是吃掉獲利的大宗。
- **個股明細補齊只買未賣的股票**：當年只有買進、尚未賣出的個股以往不會出現在展開明細（但年度列的買進金額已包含它），現在會列出並標示「僅買進」。明細列也改為與年度列同表格，欄位確實對齊。
- **欄位說明「?」提示**：庫存總覽與年度收益的每個欄位都可查看定義；其中「現價」明確說明時間差——報價來源最長延遲 20 分鐘，加上系統 10 分鐘快取，畫面上的價格最舊可能是約 30 分鐘前的成交價。
- 計算引擎僅新增欄位，既有損益公式與數字完全不變。

### v0.2.1（2026-07-18）
- **移除「全部工作區（總覽）」功能**：經評估後整個下架跨工作區彙總檢視（彙總模組、選單選項、唯讀模式與相關欄位全數移除），單一工作區的既有功能、邏輯與損益計算公式完全不受影響（45/45 單元測試 + 端到端驗證通過）。
- **保留防護**：CSV 匯入時若偵測到含「工作區」欄且包含多個工作區的備份檔（v0.2 期間由總覽匯出），仍會整批拒絕，避免不同券商的交易混入同一工作區污染移動平均成本。
- 舊版曾切到總覽的使用者，重新載入會自動回到第一個工作區。

### v0.2（2026-07-18）
- 畫面左下角新增固定版本標籤（`版本 | 作者`），登入頁亦顯示。
- 交易紀錄表格自適應寬度：一般桌面視窗（≥1024px）不再出現橫向捲軸；過長股票名稱以「…」截斷（滑鼠停留顯示完整名稱）。
- 修復：刪除交易失敗時不再誤顯示成功通知；切換工作區時清空勾選狀態；同代號重複查價去重。

---

## ⚠️ 注意事項
1. **CORS 跨來源限制**：
   台灣證交所（TWSE/TPEx）與 Yahoo Finance 皆不支援瀏覽器直接跨網域請求。正式環境**必須**部署 Supabase Edge Function：`prices` 代理現價、`search` 代理模糊搜尋、`twlist` 代理台股全清單（中文名反查的資料來源）。本地開發則由 Vite dev proxy 代勞，因此「本地正常、線上失效」的問題多半出在 Edge Function 未部署或版本過舊。
2. **本機模式限制**：
   若使用本機模式，美股現價與美股模糊搜尋會無法使用（因無後端 Edge Function 代理），需手動輸入股票代號與名稱。台股現價則退回 TWSE / TPEx OpenAPI 的**每日收盤均價清單**——不是即時價，MIS 即時行情僅在部署 Edge Function 的 Supabase 模式下生效。
3. **資安守則**：
   請勿將 `.env.local` 或任何含有 Supabase 金鑰/密碼的檔案提交到 Git 庫中（已加入 `.gitignore`）。共用快取表（`price_cache`、`stock_names`）刻意不開放一般使用者寫入。
4. **精算同構原則**：
   台股在計算手續費/證交稅時有特定的整數向下取整限制 (`Math.floor`)。若使用 CSV 匯入舊資料，請確保金額與原試算表核對一致。
5. **報價延遲**：
   提供的報價並非來自所有市場的即時報價（美股來源最長可能延遲 20 分鐘），加上快取 TTL（台股 60 秒 / 美股 10 分鐘）僅供參考，不宜做為買賣依據或諮詢之用。台股即時行情在成交清淡時可能無最新成交價，此時顯示的是買一價。
