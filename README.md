# 📈 股票交易與庫存管理系統 (Stock PnL Web)

> **目前版本：0.7.10-dev.1**（版本號顯示於畫面左下角徽章）

本專案是一個現代化、獨立的網頁應用程式 (Standalone Web App)，旨在幫助使用者管理個人股票交易紀錄、計算移動平均成本，並提供即時庫存總覽與年度收益報表。本專案由原 Google Apps Script (GAS) 「試算表股票小幫手」移植並升級而來。

## 📖 目錄
- [專案目的](#-專案目的)
- [功能特色](#-功能特色)
- [環境架構](#-環境架構)
- [使用版本](#-使用版本)
- [使用方式](#-使用方式)
- [測試](#-測試)
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

### 個股分析（僅 Supabase 模式）
- **單頁到底**：我的持股 → 籌碼 → 基本面 → 技術面，各一張卡片；頁內以下拉選單切換台股持股。
- **籌碼**：三大法人、融資融券、借券，可回看 7 個交易日並附近 7 日走勢圖（自繪 SVG，未引入圖表函式庫）。
- **技術面**：日 K 線 + MA5 / MA20 / MA60、成交量、KD，另有 RSI(14)、MACD 柱等指標摘要。
- **基本面**：本益比 / 殖利率 / 股價淨值比、近 12 個月月營收與走勢圖、按季獲利能力（毛利率、營益率、稅前 / 稅後純益率）。
- **AI 分析**：需按下按鈕才會呼叫模型；資料為程式算好的指標與籌碼摘要（不含持股、成本與損益），產生後可繼續追問，對話嚴格框在該檔股票的數據內。
- **下載 PDF**：匯出籌碼＋基本面＋技術面，不含持股數字。

### 外幣匯率與總體經濟
- **外幣匯率**：以台幣為本位的 8 種外幣即時中價（最多延遲 10 分鐘），走勢圖可切 3 個月 / 6 個月 / 1 年並同時顯示兩個方向。⚠️ 為市場中價，非銀行牌告匯率。
- **總體經濟**：核心 CPI、核心 PPI、核心 PCE、非農就業、消費者信心，資料來自美國聖路易聯準銀行 FRED，每日排程更新（有新數字或官方修正舊數字時才會變動）。

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
   - 樣式: `Vanilla CSS` + 全域設計系統（CSS 變數驅動，深 / 淺主題共用一套元件）。
   - 狀態管理: React Context (`AuthContext`, `WorkspaceContext`)。
   - 計算引擎: `pnlEngine.ts`（移動平均成本法、精算同構對齊台股手續費/證交稅元以下無條件捨去、ETF 0.1% 優惠與 Dashboard 預扣賣出稅費、浮點誤差防護）。
2. **後端與服務 (Back-end & BaaS)**:
   - `Supabase`:
     - **PostgreSQL Database**：儲存 Workspaces、Transactions、User Settings 與全站共用的 AI 設定 `app_settings`；共用快取 `price_cache`（現價）、`stock_names`（代號↔名稱）、`chip_raw_cache`（盤後原始檔）；批次可觀測性 `batch_run_log`、`source_probe_log`。
     - **GoTrue Auth**：處理帳號註冊與登入驗證。
     - **Row Level Security (RLS)**：透過 SQL Policy 確保使用者只能讀寫自己的資料；共用快取表唯讀（僅 service role 可寫），`app_settings` 僅 `app_metadata.role = 'admin'` 的帳號可寫。
     - **Edge Functions (Deno)**：`stock-price` 批次查詢台美股現價（台股走證交所 MIS 即時行情、失敗退 Yahoo；美股走 Yahoo）、模糊搜尋與外幣即時中價；`stock-report` 產出盤後籌碼、技術面、基本面、新聞、匯率與總經資料。兩者皆繞過瀏覽器 CORS 限制。
     - **Storage（`reports` bucket）**：盤後批次預產的 JSON（籌碼 / 日線 / 基本面 / `fx/twd.json` / `macro/us.json`），前端直接下載。
     - **pg_cron 排程**：盤後每 15 分鐘輪詢批次、資料源探針、`macro-daily`、`fx-daily`。
   - **AI 端點（使用者自備）**：AI 分析由瀏覽器直連 Google Gemini 或 OpenAI 相容端點（Ollama / vLLM 等），專案不內建金鑰、不代付費用。

### 系統架構圖 (System Architecture)

![stock-pnl-web 系統架構圖](docs/architecture/system-architecture.svg)

> 圖檔為手繪 SVG（原始檔 [`docs/architecture/system-architecture.svg`](docs/architecture/system-architecture.svg)），
> 無外部依賴，並依瀏覽器的深／淺色偏好自動切換配色。

專案目錄結構：
```
stock-pnl-web/
├── CLAUDE.md             # Agent 操作規則（角色、流程、版本與部署規範）
├── .github/workflows/    # GitHub Actions 自動部署（deploy.yml）
├── .claude/skills/       # 本專案的 Claude Code skill（verify：UI 驗證流程）
├── docs/
│   ├── agent/            # Agent 持久化狀態：PLAN / SPEC / PROGRESS / TASK / BUG_FIX / FIXED_BUG
│   ├── architecture/     # 系統設計、移轉計畫、UI 比稿與系統架構圖 (system-architecture.svg)
│   └── sql_cli.md        # 維運用 Supabase SQL 常用查詢
├── sources/              # 前端網頁應用程式原始碼 (Vite React TS)
│   ├── src/
│   │   ├── components/   # AppShell, Auth, Dashboard, YearlyReport, Transactions,
│   │   │                 # StockDetail（個股分析／AI 分析）, Fx（匯率）, Macro（總經）,
│   │   │                 # Charts（自繪 SVG 圖表）, Common（共用 UI）
│   │   ├── context/      # AuthContext, WorkspaceContext
│   │   ├── hooks/        # useStockPrices
│   │   ├── services/     # supabase client, dataProvider（雙模式儲存實作）,
│   │   │                 # priceProxy（現價＋TTL 快取）, stockSearch, twMarketData,
│   │   │                 # usStockNames（美股 zh-TW 譯名對照）,
│   │   │                 # reportProxy / reportsBucket / warmStock（盤後報告）,
│   │   │                 # dailyProxy, fundamentalProxy, newsProxy, macroProxy,
│   │   │                 # fxProxy / fxQuoteProxy（匯率）,
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
Agent 技能：`.claude/skills/testing/SKILL.md`（選層、跑閘門）、`.claude/skills/verify/SKILL.md`（瀏覽器驗證）

| 層級 | 內容 | 怎麼跑 |
| ---- | ---- | ---- |
| **Unit + Integration** | Vitest：純邏輯、Edge 純模組、jsdom UI 煙霧（本機模式，不受 `.env.local` 影響） | `cd sources && npm test` |
| **E2E（選用）** | Playwright 真瀏覽器／版面；無獨立 CI 套件 | 見 `docs/UnitTests/E2E.md`、skill `verify` |

```bash
cd sources
npm test                              # 完整閘門（必跑）
npx vitest run src/utils/pnlEngine.test.ts   # 單一檔
npm run dev                           # 本機模式 UI，供手動或 Playwright
```

上線前請確認 `npm test` 全綠。改 Edge 配線後，除單元測試外建議在 **DEV** 再跑一次盤後 `generate-all` 煙霧（見 `supabase-ops` skill）。

---

## 📦 部署方式

### 1. 前端部署 (GitHub Pages)
前端已在 `sources/vite.config.ts` 設定 `base: './'` 以相容子目錄，push 到 `main` 即由 GitHub Actions 自動打包部署（詳見下一節）。

### 2. 後端部署 (Supabase)
1. **建立專案**：在 [Supabase Console](https://supabase.com) 註冊並新建專案。
2. **執行 SQL 初始化**：進入專案的 SQL Editor，複製並執行 `sources/supabase/schema.sql`，這會建立所需的資料表（含 `price_cache`、`stock_names`、`chip_raw_cache` 共用快取，`app_settings`、`batch_run_log`、`source_probe_log`）、RLS 行級安全策略、`reports` bucket 與 pg_cron 排程。
3. **部署 Edge Functions**（`stock-price` 現價代理、`stock-report` 盤後報告；二擇一）：
   - **Dashboard**：Edge Functions → Create a function。`stock-price` 需 `index.ts` 與 `misParse.ts`；`stock-report` 需逐一新增 `sources/supabase/functions/stock-report/` 下的所有 `.ts` 檔（`*.test.ts` 不用上傳）。檔案數量較多，建議改用下方 CLI。**只有 `stock-report` 要關閉 Verify JWT**（見下方說明）。
   - **CLI**：在本地安裝 Supabase CLI 並登入後，於 `sources/` 目錄執行：
     ```bash
     supabase functions deploy stock-price                # 保持 verify_jwt=true（前端帶 anon JWT 呼叫）
     supabase functions deploy stock-report --no-verify-jwt
     ```
   - ⚠️ **`stock-report` 一定要帶 `--no-verify-jwt`**：pg_cron 是帶 `CRON_SECRET` 呼叫、不帶 JWT，被重設成 `true` 的話盤後批次會全數 401。`stock-price` 反之要維持預設的 `verify_jwt=true`，否則就成了誰都能呼叫的公開端點（Edge Function 額度濫用風險）。
   - 詳細步驟、驗證方式與常見問題見 [`sources/supabase/README.md`](sources/supabase/README.md)。
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
