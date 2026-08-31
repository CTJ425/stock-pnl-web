# 📈 股票交易與庫存管理系統 (Stock PnL Web)

> **目前版本：0.9.24-dev.1**（版本號顯示於畫面左下角徽章）

本專案是一個現代化、獨立的網頁應用程式 (Standalone Web App)，旨在幫助使用者管理個人股票交易紀錄、計算移動平均成本，並提供即時庫存總覽、年度收益報表、籌碼與基本面分析以及盤後資料自動化排程。本專案由原 Google Apps Script (GAS) 「試算表股票小幫手」移植並深度升級而來。

## 📖 目錄
- [專案目的](#-專案目的)
- [功能特色](#-功能特色)
- [環境架構](#-環境架構)
- [使用版本](#-使用版本)
- [使用方式](#-使用方式)
- [測試](#-測試)
- [初始化與部署](#-初始化與部署)
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

### 個股分析（僅 Supabase 模式）
- **單頁到底**：我的持股 → 籌碼 → 基本面 → 技術面，各一張卡片；頁內以下拉選單切換台股持股。
- **垂直矩陣化數據呈現 (`inst-matrix`)**：
  - **籌碼面**：三大法人買賣超、融資融券、借券賣出 3 張獨立垂直矩陣表格，含相對熱度色彩階調 (`heatStyle`)、表尾合計/均量與自繪 SVG `SparkCell` 迷你走勢折線圖。
  - **基本面**：
    - **月營收矩陣**：當月營收、MoM、YoY、累計 YoY，表尾 12 個月總額（自動換算 兆/億/千元）、年增連續月份動態徽章與 4 條 SVG 趨勢折線。
    - **季報獲利矩陣**：單季營收、YoY、EPS、四率（毛利率、營益率、稅前純益率、稅後純益率），表尾提供 TTM 近 4 季滾動 EPS、各項利潤率均值與 7 條對齊多線圖色彩之 SVG 走勢線。
  - **技術面**：日 K 線 + MA5 / MA20 / MA60、**每日成交量矩陣**（成交量、量比、收盤價、漲跌幅，表尾 N 日均量、連 N 日增量/縮量徽章與 4 條 SVG 走勢線）、KD(9,3,3)、RSI(14)、MACD 指標摘要。
- **AI 分析**：需按下按鈕才會呼叫模型；資料為程式算好的指標與籌碼摘要（不含持股、成本與損益），產生後可繼續追問，對話嚴格框在該檔股票的數據內。
- **下載 PDF**：匯出籌碼＋基本面＋技術面，不含持股數字。

### 外幣匯率與總體經濟
- **外幣匯率**：以台幣為本位的 8 種外幣即時中價（最多延遲 10 分鐘），走勢圖可切 3 個月 / 6 個月 / 1 年並同時顯示兩個方向。⚠️ 為市場中價，非銀行牌告匯率。
- **總體經濟**：核心 CPI、核心 PPI、核心 PCE、非農就業、失業率、消費者信心、通膨預期等，資料來自美國聖路易聯準銀行 FRED。具備與官方 BLS/BEA 發布行事曆聯動之智能掃描閘門（`decideMacroScan`），該期未發布或已抓取則當日 0 外部請求。

### 管理員後台與盤後戰情室 (Admin Status & Probe War Room)
- **⚡ 盤後探針命中戰情室**：即時呈現 8 大資料源（BFI82U, T86, BWIBBU, TWT38U, MARGIN, BORROW, MOPS 營收/獲利）之幾點命中、命中次數與目標進度、是否退休收工以及歷次命中時間晶片。
- **機制圖解與排程狀態**：視覺化呈現全市場量能、法人覆蓋天數、匯率與檔案涵蓋完整度。
- **系統維運工具**：AI 端點連線檢測、全量手動重跑批次與 AI Prompt 提示詞線上編輯。

### 其他
- **每工作區手續費率**：工作區列的 `%` 按鈕可直接設定（支援 `0.0004275` 等折扣費率位數），新增交易與損益估算自動帶入。
- **主題切換**：跟隨系統 / 深色 / 淺色，選擇記憶於本機。
- **手機支援**：分頁列、表單、表格皆針對小螢幕最佳化；輸入字級 16px 避免 iOS 聚焦縮放。
- **版本標籤**：版本號顯示於畫面左下角固定徽章，方便回報問題時確認版本。

---

## 🏗️ 環境架構
專案主要包含以下兩個核心部分：
1. **前端 (Front-end)**:
   - 框架: `React` + `TypeScript` + `Vite` (SPA 單頁應用程式)。
   - 樣式: `Vanilla CSS` + 全域設計系統（CSS 變數驅動，深 / 淺主題共用一套元件，包含 Inst-Matrix 垂直矩陣與 Glassmorphism）。
   - 狀態管理: React Context (`AuthContext`, `WorkspaceContext`)。
   - 計算引擎: `pnlEngine.ts`（移動平均成本法、精算同構對齊台股手續費/證交稅元以下無條件捨去、ETF 0.1% 優惠與 Dashboard 預扣賣出稅費、浮點誤差防護）。
2. **後端與服務 (Back-end & BaaS)**:
   - `Supabase`:
     - **PostgreSQL Database**：儲存 Workspaces、Transactions、User Settings 與全站共用的 AI 設定 `app_settings`；共用快取 `price_cache`（現價）、`stock_names`（代號↔名稱）、`chip_raw_cache`（盤後原始檔）；批次可觀測性 `batch_run_log`、`source_probe_log`。
     - **GoTrue Auth**：處理帳號註冊與登入驗證。
     - **Row Level Security (RLS)**：透過 SQL Policy 確保使用者只能讀寫自己的資料；共用快取表唯讀（僅 service role 可寫），`app_settings` 僅 `app_metadata.role = 'admin'` 的帳號可寫。
     - **Edge Functions (Deno)**：`stock-price` 批次查詢台美股現價（台股走證交所 MIS 即時行情、失敗退 Yahoo；美股走 Yahoo）、模糊搜尋與外幣即時中價；`stock-report` 產出盤後籌碼、技術面、基本面、新聞、匯率與總經資料。兩者皆繞過瀏覽器 CORS 限制。
     - **Storage（`reports` bucket）**：盤後批次預產的 JSON（籌碼 / 日線 / 基本面 / `fx/twd.json` / `macro/us.json`），前端直接下載。
     - **精簡 5 大 pg_cron 排程與主動探針巡邏**：
       - `source-probe`：每 5 分鐘主動巡邏 8 大資料源，命中即抓，3 次穩定到位自動退休收工（MOPS 1 次到位收工）。
       - 精準時窗優化：`BWIBBU` 估值探針縮窄至 `17:00–18:30`；`BFI82U` 支援雙時窗（`15:00–16:30` 與 `19:30–20:15` 盤後鉅額與綜合帳戶結算）；`BORROW` 借券探針調至 `21:00–23:30`。
       - `macro-daily`、`fx-daily`、`market-data-daily`、`history-daily` 定時維護非日頻數據與歷程。
   - **AI 端點（使用者自備）**：AI 分析由瀏覽器直連 Google Gemini 或 OpenAI 相容端點（Ollama / vLLM 等），專案不內建金鑰、不代付費用。

### 系統架構圖 (System Architecture)

![stock-pnl-web 系統架構圖](docs/architecture/system-architecture.svg)

> 圖檔為手繪 SVG（原始檔 [`docs/architecture/system-architecture.svg`](docs/architecture/system-architecture.svg)），
> 無外部依賴，並依瀏覽器的深／淺色偏好自動切換配色。

專案目錄結構：
```
stock-pnl-web/
├── GEMINI.md / CLAUDE.md # Agent 操作規則（角色、流程、版本與部署規範）
├── .github/workflows/    # release.yml（CHANGELOG 同步至 GitHub Releases）
├── .gemini/ / .claude/   # 專案技能（testing, verify, supabase-ops, versioning 等）
├── docs/
│   ├── agent/            # Agent 持久化狀態：PROGRESS / TASK / BUG_FIX / FIXED_BUG
│   ├── architecture/     # 系統設計、移轉計畫、UI 比稿與系統架構圖 (system-architecture.svg)
│   ├── UnitTests/        # 測試設計、策略與覆蓋率說明
│   └── sql_cli.md        # 維運用 Supabase SQL 常用查詢
├── sources/              # 前端網頁應用程式原始碼 (Vite React TS)
│   ├── src/
│   │   ├── components/   # AppShell, Auth, Dashboard, YearlyReport, Transactions,
│   │   │                 # StockDetail（個股分析／AI 分析）, Fx（匯率）, Macro（總經）,
│   │   │                 # Admin（後台狀態與戰情室）, Charts（自繪 SVG 圖表）, Common（共用 UI）
│   │   ├── context/      # AuthContext, WorkspaceContext
│   │   ├── hooks/        # useStockPrices
│   │   ├── services/     # supabase client, dataProvider（雙模式儲存實作）,
│   │   │                 # priceProxy（現價＋TTL 快取）, stockSearch, twMarketData,
│   │   │                 # usStockNames（美股 zh-TW 譯名對照）,
│   │   │                 # reportProxy / reportsBucket / warmStock（盤後報告）,
│   │   │                 # dailyProxy, fundamentalProxy, newsProxy, macroProxy,
│   │   │                 # fxProxy / fxQuoteProxy（匯率）, adminStatus,
│   │   │                 # aiClient / aiSettings / aiChatStore（AI 分析）, reportPdf
│   │   ├── types/        # models.ts
│   │   └── utils/        # pnlEngine.ts, holdingRows.ts, indicators.ts,
│   │                     # csv.ts, fees.ts, formatters.ts, settings.ts
│   ├── supabase/         # Supabase 後端：schema.sql（資料庫綱要、RLS、pg_cron 排程）
│   │                     # + functions/（stock-price, stock-report）
│   └── package.json      # 版本號來源
└── README.md             # 本說明文件 (專案根目錄)
```

---

## 🏷️ 使用版本
- **React**: `^19.2.7`
- **React DOM**: `^19.2.7`
- **Vite**: `^8.1.1`
- **TypeScript**: `~6.0.2`
- **Supabase JS Client**: `^2.110.7`
- **lucide-react** (圖示): `^1.24.0`
- **jsPDF** / **html2canvas** (報告匯出 PDF): `^3.0.4` / `^1.4.1`
- **Vitest** (測試框架): `^4.1.10`
- **oxlint** (Lint): `^1.71.0`
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
4. 執行測試（見下方 [測試](#-測試)）：
   ```bash
   npm test
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

## 🧪 測試

完整策略與慣例（Unit / Integration / E2E）：**[`docs/UnitTests/README.md`](docs/UnitTests/README.md)**  
目前測試套件規模：**85 個測試檔案、1345 項單元與整合測試（100% PASS）**。

| 層級 | 內容 | 怎麼跑 |
| ---- | ---- | ---- |
| **Unit + Integration** | Vitest：純邏輯算力 (pnlEngine)、Edge 純模組、jsdom UI 煙霧（本機模式，不受 `.env.local` 影響） | `cd sources && npm test` |
| **Edge Typecheck** | TypeScript 對 Edge Functions 獨立嚴格型別檢查 | `cd sources && npm run typecheck:edge` |
| **E2E（選用）** | Playwright 真瀏覽器／多斷點響應式版面驗證 | 見 `docs/UnitTests/E2E.md`、skill `verify` |

```bash
cd sources
npm test                              # 完整單元測試閘門（85 檔 / 1345 tests，必跑）
npm run typecheck:edge                # Edge Functions 型別檢查
npx vitest run src/utils/pnlEngine.test.ts   # 執行單一測試檔
npm run dev                           # 本機模式 UI，供手動或 Playwright 驗證
```

上線前請確認 `npm test` 全綠。改 Edge 配線後，除單元測試外建議在 **DEV** 再跑一次盤後 `generate-all` 煙霧（見 `supabase-ops` skill）。

---

## 📦 初始化與部署

> 本章是**從零開始**的完整步驟。DEV 與 PROD 各做一次，兩者互不影響。
> 每一步都提供 **WebUI（Supabase Dashboard）** 與 **CLI** 兩種做法，擇一即可。
> 後端的深入說明（資料來源、報告結構、排程設計）見 [`sources/supabase/README.md`](sources/supabase/README.md)。

### 前置需求

| 項目 | 版本 | 必要性 |
|---|---|---|
| Node.js | 24 以上 | 必要 |
| Supabase 專案 | Free 方案即可 | Supabase 模式必要；本機模式不需要 |
| Supabase CLI | 2.x | 選用 — 走 WebUI 可略過 |

---

### 步驟 0：取得原始碼

```bash
git clone https://github.com/CTJ425/stock-pnl-web.git
cd stock-pnl-web/sources
npm install
```

此時**不設定任何環境變數**就可以先跑起來：

```bash
npm run dev
```

系統會以**本機模式**啟動，資料存在瀏覽器 `localStorage`，免登入。
若你只想試用，到這裡就結束了。要多人使用或要盤後自動排程，才需要繼續下面的步驟。

---

### 步驟 1：建立 Supabase 專案

**WebUI**：登入 [Supabase Console](https://supabase.com) → **New project**。

建好後取得三個值，後面每一步都會用到：

| 值 | 位置 | 用途 |
|---|---|---|
| Project Reference ID | Settings → General | 替換 SQL 佔位符、CLI 綁定 |
| Project URL | Settings → API | 前端 `.env.local` |
| anon / publishable key | Settings → API | 前端 `.env.local` |

> `service_role key` 也在同一頁。**它只能留在後端**，絕不可放進前端、Git 或任何公開位置。

---

### 步驟 2：產生批次密鑰 `CRON_SECRET`

盤後排程以這把密鑰呼叫 Edge Function。自己產生一組長隨機字串：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

**先把它記在安全的地方。** 步驟 3 與步驟 4 要填入**同一個值**，兩邊不一致排程就會全數 401。

---

### 步驟 3：套用資料庫綱要

`sources/supabase/schema.sql` 會建立全部資料表、RLS 政策、兩個 Storage bucket、`pg_cron` 與 `pg_net` 擴充，以及 6 個排程。

⚠️ **執行前必須替換兩個佔位符，共 18 處：**

| 佔位符 | 出現次數 | 換成 |
|---|---|---|
| `<PROJECT_REF>` | 8 | 步驟 1 的 Project Reference ID |
| `<CRON_SECRET>` | 10 | 步驟 2 產生的密鑰 |

⚠️ **`cron.schedule` 對沒替換的佔位符照單全收。「SQL 執行成功」不等於「值填對了」。** 正式區就曾因此整段時間排程從未真正執行（BUG-002）。步驟 6 的覆驗查詢是唯一能證明填對的方法。

#### 做法 A：WebUI

1. 用編輯器打開 `sources/supabase/schema.sql`，全域取代兩個佔位符，另存為暫存檔。
2. Supabase Dashboard → **SQL Editor** → **New query**。
3. 貼上替換後的全文 → **Run**。
4. 刪除該暫存檔，它含有明文密鑰。

#### 做法 B：CLI

```bash
cd sources

# 1. 產生替換後的暫存檔（不要覆蓋原檔，也不要 commit）
sed -e 's/<PROJECT_REF>/你的ref/g' -e 's/<CRON_SECRET>/你的密鑰/g' \
    supabase/schema.sql > /tmp/schema.applied.sql

# 2. 套用（連線字串見 Dashboard → Settings → Database）
psql "<你的資料庫連線字串>" -f /tmp/schema.applied.sql

# 3. 用完立刻刪除，它含有明文密鑰
rm /tmp/schema.applied.sql
```

> ⚠️ `schema.sql` **不是冪等的**。重跑會把排程的 command 重設回佔位符。
> 已上線後若只想改排程時間，請用 `cron.alter_job` — 它保留原本的 command，密鑰碰都不用碰。

---

### 步驟 4：設定 Edge Function 密鑰

`SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 自動注入，**不用設**。只需手動設一個。

**WebUI**：Dashboard → Edge Functions → **Secrets** → 新增 `CRON_SECRET`，值同步驟 2。

**CLI**：

```bash
cd sources
supabase link --project-ref <你的-project-ref>
supabase secrets set CRON_SECRET=<步驟 2 的密鑰>
```

---

### 步驟 5：部署三支 Edge Functions

⚠️ **三支的 JWT 設定各不相同，設錯會出事：**

| 函數 | JWT 驗證 | CLI 旗標 | 設錯的後果 |
|---|---|---|---|
| `stock-price` | **開啟**（預設） | 不加旗標 | 關掉 → 變成任何人都能呼叫的公開端點，Edge 額度遭濫用 |
| `stock-report` | **關閉** | `--no-verify-jwt` | 沒關 → 盤後排程全數 401 |
| `backup-transactions` | **關閉** | `--no-verify-jwt` | 沒關 → 每日備份全數 401 |

`stock-report` 與 `backup-transactions` 不靠 JWT，它們驗的是 `x-cron-secret` 標頭。

#### 做法 A：WebUI

Dashboard → Edge Functions → **Create a function**。名稱必須與資料夾**完全相同**（前端以函數名呼叫，改名就對不上），然後把該資料夾下的 `.ts` 檔逐一貼上。

- `*.test.ts` 是單元測試，**不要上傳**。
- `stock-report` 有 10 個 `.ts` 檔，逐檔貼很容易漏。**多檔函數建議改用 CLI。**

#### 做法 B：CLI（推薦）

```bash
cd sources
supabase functions deploy stock-price                          # 維持 verify_jwt=true
supabase functions deploy stock-report --no-verify-jwt
supabase functions deploy backup-transactions --no-verify-jwt
```

CLI 會自動打包整個資料夾，不必逐檔貼。

---

### 步驟 6：覆驗排程（不可略過）

確認佔位符真的被換掉：

```sql
SELECT jobname, schedule, active,
       command LIKE '%<PROJECT_REF>%' AS ref_not_replaced,
       command LIKE '%<CRON_SECRET>%' AS secret_not_replaced
FROM cron.job ORDER BY jobname;
```

兩個布林欄位**都必須是 `false`**。任一為 `true`，代表該排程永遠不會成功。

⚠️ **不要 SELECT `command` 欄位本身** — 它含有明文 `x-cron-secret`，印出來等於外洩。

應出現的 6 個排程：

| jobname | schedule | 用途 |
|---|---|---|
| `market-data-daily` | `0 10,14 * * 1-5` | 盤後估值資料 |
| `history-daily` | `30 4,13 * * 1-5` | 月營收歷史回補 |
| `source-probe` | `*/5 * * * *` | 資料源輪詢 |
| `macro-daily` | `*/30 12-18 * * *` | 美國總經 |
| `fx-daily` | `0 3,9 * * *` | 匯率 |
| `backup-daily` | `0 18 * * *` | 每日備份（台北 02:00） |

再手動觸發一次，確認密鑰與 JWT 設定正確：

```bash
curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report' \
  -H 'Content-Type: application/json' \
  -H 'x-cron-secret: <你的密鑰>' \
  -d '{"action":"sync-fx"}'
```

回 `401` 代表密鑰兩邊不一致，或 `stock-report` 沒關 JWT 驗證。

---

### 步驟 7：設定 Auth

**WebUI**：Dashboard → Authentication → **URL Configuration** → 把 Site URL 與 Redirect URLs 設為前端實際網址。

> **建議關閉信箱驗證。** Supabase 內建郵件服務每小時僅約 2 封，只夠開發測試。
> 於 Authentication → Sign In / Providers → Email 關閉 **Confirm email**；
> 或於 Authentication → Users 手動建立帳號並勾選 **Auto Confirm User**。

---

### 步驟 8：建立第一個帳號並升級為管理員

管理員後台（抓取狀況、戰情室、備份管理）需要 `admin` 角色。

1. 先從前端註冊，或在 Dashboard → Authentication → Users 建立帳號。
2. 於 SQL Editor 執行：

```sql
UPDATE auth.users
SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
WHERE email = '你的信箱';
```

3. **必須重新登入。** 角色寫在 JWT 內，舊的 token 不會自動更新。

---

### 步驟 9：設定前端並建置

在 `sources/` 建立 `.env.local`：

```env
VITE_SUPABASE_URL=https://<你的-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<你的 anon key>
```

```bash
cd sources
npm run dev      # 開發：畫面應改為登入／註冊介面
npm run build    # 產出靜態檔於 sources/dist/
```

`vite.config.ts` 已設 `base: './'`，`dist/` 可放在任何靜態主機的任何子路徑下。
**PROD 部署目標目前尚未設定** — 本專案不再使用自動部署 workflow。

> `.env.local` 已列入 `.gitignore`，不會進版控。

---

### 步驟 10：驗收清單

| # | 檢查 | 通過條件 |
|---|---|---|
| 1 | 前端啟動 | 出現登入／註冊介面，不是本機模式 |
| 2 | 註冊並登入 | 進得了 Dashboard |
| 3 | 新增一筆台股交易 | 庫存出現該筆，且抓得到現價 → `stock-price` 正常 |
| 4 | 個股「分析」→ 籌碼分頁 | 有內容 → `stock-report` 正常 |
| 5 | 管理員後台 | 使用者選單看得到入口 → `admin` 角色生效 |
| 6 | `cron.job` 覆驗查詢 | 6 個排程，兩個布林欄位皆 `false` |
| 7 | Storage | 出現 `reports`（公開）與 `backups`（私有）兩個 bucket |

---

### 常見初始化錯誤

| 症狀 | 原因 |
|---|---|
| 畫面沒有登入介面 | `.env.local` 未建立或值填錯，系統退回本機模式 |
| `relation ... does not exist` | `schema.sql` 尚未執行 |
| 排程從不執行、`reports` 是空的 | 佔位符沒替換 — 跑步驟 6 的覆驗查詢 |
| 盤後批次全數 401 | `stock-report` 沒帶 `--no-verify-jwt`，或 `CRON_SECRET` 兩邊不一致 |
| 每日備份全數 401 | `backup-transactions` 沒帶 `--no-verify-jwt` |
| 前端呼叫 `stock-price` 回 401 | 未登入就呼叫；Supabase 模式須登入後使用 |
| 管理員後台看不到 | 升級 SQL 執行後沒有重新登入 |
| 部署時 import `./xxx.ts` 失敗 | WebUI 逐檔貼時漏檔 — 改用 CLI 部署 |

## 🗒️ 版本紀錄

完整版本紀錄請見 [docs/agent/CHANGELOG.md](docs/agent/CHANGELOG.md)。

---

## ⚠️ 注意事項
1. **CORS 跨來源限制**：
   台灣證交所（TWSE/TPEx）與 Yahoo Finance 皆不支援瀏覽器直接跨網域請求。正式環境**必須**部署 Supabase Edge Function `stock-price`，它以單一端點提供四種 action：`prices`（現價）、`search`（模糊搜尋）、`twlist`（台股全清單，中文名反查的資料來源）、`fx`（外幣即時中價）。本地開發則由 Vite dev proxy 代勞，因此「本地正常、線上失效」的問題多半出在 Edge Function 未部署或版本過舊。
2. **本機模式限制**：
   若使用本機模式，美股現價與美股模糊搜尋會無法使用（因無後端 Edge Function 代理），需手動輸入股票代號與名稱。台股現價則退回 TWSE / TPEx OpenAPI 的**每日收盤均價清單**——不是即時價，MIS 即時行情僅在部署 Edge Function 的 Supabase 模式下生效。
3. **資安守則**：
   請勿將 `.env.local` 或任何含有 Supabase 金鑰/密碼的檔案提交到 Git 庫中（已加入 `.gitignore`）。共用快取表（`price_cache`、`stock_names`）刻意不開放一般使用者寫入。
4. **精算同構原則**：
   台股在計算手續費/證交稅時有特定的整數向下取整限制 (`Math.floor`)。若使用 CSV 匯入舊資料，請確保金額與原試算表核對一致。
5. **報價延遲**：
   提供的報價並非來自所有市場的即時報價（美股來源最長可能延遲 20 分鐘），加上快取 TTL（台股 60 秒 / 美股 10 分鐘）僅供參考，不宜做為買賣依據或諮詢之用。台股即時行情在成交清淡時可能無最新成交價，此時顯示的是買一價。
