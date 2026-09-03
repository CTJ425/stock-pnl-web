# Progress Log (PROGRESS.md)

- Agent: Claude Opus 5 (main session)
- Action: 0.9.28-dev.9 — 字級對齊正式區
- Status: **✅ RECORDED**
- Timestamp: 2026-09-03 14:51:14 Asia/Taipei

---

## 📅 Log: 2026-09-03 14:51:14 Asia/Taipei (0.9.28-dev.9 — 字級對齊正式區)

- **Status**: ✅ **COMPLETED** on `dev` (committed, not pushed)
- **Version**: `0.9.28-dev.8` → **`0.9.28-dev.9`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: dev.8 只對齊了字族（Outfit + Inter），使用者接著要求字級也與正式區一致。
- **先量再改**: 把 `main` 與 `dev` 的 `index.css` 各自解析成「選擇器 → font-size」對照表比對，並統計兩邊 `.tsx` 的內嵌 `fontSize`。結果比預期小得多：
  - `body` 基準字級兩邊都是 `14px`。
  - 內嵌 `fontSize` 幾乎相同（main 89 處 / dev 91 處，值分佈只差兩個 `fontSize: 11`）。
  - **共同選擇器中只有 4 條字級不同**，全部來自 0.9.28-dev.5「冷處理改版」與 dev.7。
  - 另有 7 條是 dev 新元件（`.exposure-key`、`.dir-long`、`.holding-group td` 等），正式區沒有對應規則，無法比對。
- **Work** (`index.css`，四條規則，使用者選定全部還原):
  1. `.section-title h2`：11px → **16px**
  2. `.section-title .hint`：11px → **12px**
  3. `.data-table th`：10.5px → **12px**
  4. `.market-panel .metric-hero .kpi-value`：30px → **22px**
- **一項查證後確認無需改動的地方**: `DashboardPage.tsx:553`／`561` 與 `YearlyPage.tsx:227` 的 `<h2 style={{ fontSize: 14 }}>` 會蓋過 `.section-title h2`。查 `main` 後確認這三處的內嵌值**與正式區完全相同**，本來就已對齊，因此不動。CSS 的 16px 只作用在沒有內嵌覆寫的區塊標題上。
- **Verify**:
  - 靜態：重跑同一份解析比對，共同選擇器字級差異由 4 條降為 **0 條**。
  - 動態：Playwright 以相同 viewport（1280×900）分別載入 `http://10.8.22.99:5173/` 與 `https://stock-pnl-web.pages.dev/`，統計所有可見文字節點的「字級|字重|字族」分佈，兩邊**完全相同**（20px/700/Outfit ×1、14px/400/Inter ×7、13px/400/Inter ×4、12.5px/500/Inter ×2、11px/400/Inter ×1 等）。
  - `npm run build` exit 0；`npx vitest run` exit 0，95 檔 1537 測試。
- **範圍限制（誠實記錄）**: 動態比對只涵蓋登入頁，因為量測沒有登入憑證。登入後的頁面靠上述靜態比對涵蓋，那份比對是整份 `index.css` 的全量對照，不是抽樣。

---

## 📅 Log: 2026-09-03 14:10:17 Asia/Taipei (0.9.28-dev.8 — 字體對齊 PROD、只有空單時的總覽與籌碼分析)

- **Status**: ✅ **COMPLETED** on `dev` (committed, not pushed)
- **Version**: `0.9.28-dev.7` → **`0.9.28-dev.8`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者回報三件事 —— 字體看起來沒變、只有空單時台股總覽跑不出東西、只有空單時點籌碼分析出現 `Edge Function returned a non-2xx status code`。
- **一項必須更正的先前陳述**: 0.9.28-dev.7 的 commit 訊息寫「字體**改回** Roboto（MUI 預設字族）」。**該句為誤。** git 歷史顯示初版 `58a1a42` 就是 Outfit + Inter，`2f09d87`（dev.5）才改成 Archivo + IBM Plex Mono。這個專案從未用過 Roboto，dev.7 是換上第三種新字體，不是還原。本次已改回 PROD 實際使用的 Outfit + Inter。
- **Work**:
  1. **字體完全對齊 PROD** (`index.html`、`index.css`): Playwright 同時量測 DEV 與 `https://stock-pnl-web.pages.dev/`，證實 PROD 是 `Inter`（body）+ `Outfit`（display）且**沒有 `--font-num`**。`index.html` 的 Google Fonts 連結還原成 `main` 的原字串；`--font-display` / `--font-body` 還原，`--font-num` 移除，10 處 `var(--font-num)` 改為 `var(--font-body)`。過程中誤把 `.pwr-kpi-name code`、`.pwr-sub-window`、`.pwr-time-chip`、`.watchlist-card-ticker` 四條規則一併改掉，已還原成 `main` 的 `var(--font-mono)` 原值。修改後 DEV 量測值與 PROD 完全相同（同樣載入 `inter/v20` 與 `outfit/v15`）。
  2. **只有空單時台股總覽整片變骨架條** (`DashboardPage.tsx`): 根因是 `sumOrNull` 對空陣列回傳 `null`，而 `null` 在 `MarketPanel` 裡的語意是「報價還沒到」。沒有多單時多方腿被當成「未知」而不是 0，`legsKnown` 為 false，主數字、曝險尺、投入總成本全部畫成骨架灰條。改為在來源處分開「零」與「未知」：`twLongRows.length === 0 ? 0 : sumOrNull(...)`，`twCost` / `twRawCost` 與美股三個同理。使用者選定「投入總成本只算多單，沒有多單就顯示 $0」。
  3. **只有空單時籌碼分析 403** (`batchTickers.ts`、`index.ts`): 白名單 `heldTwTickers()` 用 `net = 買進 − 賣出 > 0` 判定持有。融券先賣後買，淨額必為負，所以只有空單的代號永遠不在白名單，`generate` 回 403 `僅限持有或已加入觀察清單的台股代號`，夜間批次也不會產生檔案，前端 Storage-first 落空後直接失敗。把「什麼算未平倉」這條規則抽到 `batchTickers.ts`（該檔明文說純函式放這裡才能單元測試）成為 `netOpenTickers()`，判定改為 `net !== 0`。**刻意不讀 `tx_nature`**：PROD 還沒有那個欄位（BUG-044-P），select 一個不存在的欄位會讓查詢報錯、白名單整個變空、所有代號都 403。
- **三段證據鏈（用使用者短期授權的 access token 於 DEV 實測，token 已請使用者撤銷）**:
  - DEV 已部署的 `stock-report` v3 bundle 內含 `select('ticker, name, tx_type, qty')`、`filter(([, v]) => v.net > 0)` 與該 403 訊息。
  - DEV 資料：`8033` 淨額 −5000、`2303` 淨額 −1000，`in_whitelist` 皆為 false；同一查詢帶 `EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%zyebvayngwrqzoaicbwd%')` 回 true，驗明確實是 DEV。
  - 前端路徑：`StockDetailPage.tsx:142` 先 `fetchStoredReport`（無檔案）再 `generateReport` → 403 → supabase-js 轉成 `Edge Function returned a non-2xx status code`。
- **測試皆先證明為真**（移除修正後必定失敗，再加回）:
  - `T16`：移除修正後 `expected +0 to be -95000`。
  - `netOpenTickers` 融券兩例：規則改回 `net > 0` 後 `expected [] to deeply equal [{ ticker: '2303', name: '聯電' }]`。
- **Verify**: `npm run build` exit 0；`npm run typecheck:edge` exit 0；`npx vitest run` exit 0，95 檔 **1537** 測試（1532 → 1537，新增 T16 與 5 個 `netOpenTickers`）；`npx oxlint src` 0 errors。
- **未做，需使用者決定**:
  - `AnalysisPage.tsx:239` 對只有空單的標的送出 `{ qty: 0, avgCost: 0 }`（`pnlEngine` 在 `qty === 0` 時 `avgCost` 回 0），使 `StockDetailPage.tsx:353` 的 `heldQty` 為 0，影響損益試算。另一個缺陷，本次未修。
  - PROGRESS.md 缺 0.9.28-dev.6 與 dev.7 的紀錄，本次未回填。
- **DEV Edge 已於 2026-09-03 14:24:25 Asia/Taipei 部署**：`stock-report` v3 → **v4**，
  `ezbr_sha256` 由 `28350abe…c71cea4` 變為 `1d2ba453…266a794f23`，`verify_jwt` 維持 `false`
  （設成 true 會讓盤後批次全部 401）。以 `--project-ref` 部署，未動 `supabase link` 的全域狀態。
  部署自 commit `b73b8c6`，工作樹僅有一個與本函式無關的未追蹤檔。
  **雜湊只證明 bundle 有變，不證明變成什麼**，所以另外抓下線上 bundle 逐字確認：
  `netOpenTickers` 出現 5 次、`v.net !== 0` 出現 2 次、舊的 `v.net > 0` **0 次**；
  對照 v3 舊 bundle 為 `v.net > 0` 2 次、`netOpenTickers` 0 次。
