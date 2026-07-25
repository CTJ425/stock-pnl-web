# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修正夜間排程的 pg_net 逾時 (0.3.8-dev.2)
- Status: COMPLETED（兩區 cron 皆已修正並實測）
- Timestamp: 2026-07-26 09:20:00 Asia/Taipei

---

## 📅 Log: 2026-07-26 09:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正夜間排程的 pg_net 逾時 (0.3.8-dev.2)
- **Status**: COMPLETED
- **起因**: 使用者要求分析「免費 Supabase + GitHub Pages 的隱藏問題」，盤點時實測發現此問題

### 問題
`schema.sql` §6c 的 `net.http_post` 沒指定 `timeout_milliseconds`，而 pg_net 的**預設值是 5000ms**
（實測 `pg_get_function_arguments`：`timeout_milliseconds integer DEFAULT 5000`）。
但 `generate-all` **每天第一次執行要 10–13 秒**（抓當天的 T86 與融資融券大檔），
第二次因快取全命中只要約 2 秒 —— 也就是說**每天唯一有意義的那一次必定逾時**。

### 實測（dev，以 `timeout_milliseconds := 1000` 強制重現）
| 觀察點 | 結果 |
| --- | --- |
| `net._http_response` | `error_msg = "Timeout of 1000 ms reached"`、`status_code = null` |
| Storage `manifest.generatedAt` | 16:02:25 → **16:03:37（前進）** |

**結論：批次本身沒壞** —— 客戶端逾時後 Edge Function 仍在伺服器端跑完、報告正常寫入。
真正的損失是**可觀測性**：每晚都記成失敗，導致「逾時但成功」與「真的失敗」無法區分，
而這是唯一的伺服器端訊號（服務狀態頁已於 dev.1 移除）。

### 修正
`schema.sql` 的 cron 補上 `timeout_milliseconds := 60000` 並加註原因，
兩區的 `cron.job` 皆以相同 SQL 重新排定（保留原有的 `CRON_SECRET`，從既有 command 取出）。

驗證：dev 直接執行修正後的 cron 指令 → `net._http_response` 記錄
`status_code = 200`、`error_msg = null`、含完整回應內容 `{"ok":true,...,"historyDays":7}`。
兩區皆確認 `command like '%timeout_milliseconds := 60000%'` 且 `active = true`。

### 同時盤點到、但**未**在本輪處理的免費方案議題
- **`stock-report` 的 `generate` 是完全公開端點**：實測不帶任何 key 也回 200
  （函數以 `--no-verify-jwt` 部署，且專案 URL 就在 GitHub Pages 的公開 bundle 裡）。
  `generate-all` 有 `CRON_SECRET` 保護，只有 `generate` 是開的。
- **可觀測性**：dev.1 移除服務狀態後，排程失敗不會有任何地方顯示（症狀只是開頁變慢）。
- **免費方案**：每組織 2 個 active 專案（**已用滿**）、7 天無活動自動暫停、無 PITR/備份保障
  （`transactions` 是唯一不可重建的資料，建議定期 CSV 匯出）。
- **實測後確認不是問題**：dev 全庫 13MB、`chip_raw_cache` 含 TOAST 僅 1.68MB
  （22 筆、原始 JSON 3.99MB 壓到 1.45MB，遠低於 PLAN 當初估的 15–25MB）；
  前端 bundle 508KB + 動態載入的 PDF 函式庫，對 Pages 頻寬無感；
  Storage bucket 匿名無法列舉（400），但直接猜路徑可探測「全體持有哪些代號」（無股數、無個資）。

---

## 📅 Log: 2026-07-26 00:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 個股分析改為獨立導覽分頁（下拉切換持股）、服務狀態功能整個移除 (0.3.8-dev.1)
- **Status**: COMPLETED
- **Task**: `TASK.md` Task 15；計畫檔 `~/.claude/plans/nested-sauteeing-boole.md`

### 1. 移除服務狀態
- 刪除 `components/ServiceStatus/`（整個目錄）、`services/serviceHealth.ts`、`serviceHealth.test.ts`
- `AppShell`：移除 `Activity` import、`ServiceStatusPage` import、`Tab` 的 `'status'`、TABS 項、渲染條件
- `index.css`：刪除服務狀態專用的 75 行（20 個 `.status-*` / `.uptime-*` class，全庫僅該頁使用）。
  刪除前以程式斷言確認未含 `.spin` / `.section-title` 等共用樣式
- 連帶清掉 dead code：`twMarketData.ts` 的 `readTwListCacheMeta`（唯一呼叫者是 serviceHealth）；
  `priceProxy.ts` 的 `readPriceCache` 保留（內部仍在用），只修註解
- **GitHub 連結改置於頁尾**免責聲明下方（依使用者指示）；專案簡介文案不保留（README 仍有）

### 2. 個股分析獨立成頁
- 新增 `components/StockDetail/AnalysisPage.tsx`（容器）：`useWorkspace` + `useStockPrices` + `getFeeRate`，
  過濾台股後作為下拉選單來源；`selectedKey` state，選中的代號因交易異動而消失時自動回退第一檔
- 下拉沿用既有 `.ws-select` 樣式（後代選擇器，無需新 class）
- `StockDetailPage` 的 `onBack` 改為 **`selector?: ReactNode`** —— 已無下鑽，頁首左側改放下拉選單。
  以 `key={holding.key}` 強制換股時重置整組 state，避免看到上一檔的殘留
- `AppShell`：移除 `detail` state 與 `goTab`，新增 `analysis` 分頁；
  **未設定 Supabase 時該分頁隱藏**（`isReportConfigured` 閘門，與盤後報告入口規則一致）
- `DashboardPage`：移除「個股分析」欄、`onOpenDetail` / `openDetail` 與相關 import

### 3. 共用計算：`utils/holdingRows.ts`
`buildRows` / `HoldingRow` 原本是 `DashboardPage` 的 module-local。分析頁需要同一份
「每檔的 price / unrealized / roi」（含台股零股最低手續費、預扣賣出費稅），**抽成共用模組**而非複製。
`DashboardPage` 改 import，行為不變。

### Verification
- `npm run test` 159 → **170 passed**（刪 serviceHealth 4 筆、改 smoke 2 筆並新增 2 筆、
  新增 holdingRows 6 筆 + AnalysisPage 7 筆）
- `npm run build` 通過；`npm run lint` warning 由 4 降到 **3**（ServiceStatusPage 那筆隨檔案消失）
- 瀏覽器實測（Playwright，本機模式）：
  - 導覽列 `庫存總覽 / 年度收益 / 交易紀錄`（服務狀態已無、個股分析在本機模式正確隱藏）
  - 庫存總覽表頭已無「個股分析」欄
  - 頁尾：免責聲明 + 其下的 GitHub 連結，`href` 正確
  - 分析頁（臨時 harness 掛 AuthProvider + WorkspaceProvider）：下拉只列 `1802 / 2330 / 2609`
    （美股 AAPL 不在內）、切換後標題與內容同步更換、「我的持股」數字由 ledger 正確帶入、
    390px 無水平溢出、無 console error
- **不需要動 Supabase**：純前端呈現層改動，報告 JSON 結構與 Edge Function 完全不變

### 踩到的小坑
- `tsc` 抓到我新寫的 `holdingRows.test.ts` fixture 少了 `PriceQuote` 的 `asOf` / `source`
  —— vitest 不做型別檢查所以測試先過了，`npm run build` 才擋下來。這正是 PLAN 一直寫
  「`build` 不可略過」的理由。
- 臨時 harness 這次**一律用絕對路徑刪除**，未再發生前兩輪 cwd 被重置導致 `rm -f` 靜默失敗的情況。

---

## 📅 Log: 2026-07-25 23:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.3.7 定版、併入 `main`、正式區（`kxnxadaghidwumqsqneu`）後端部署
- **Status**: COMPLETED

### 版號定稿（CLAUDE.md §17.3）
`0.3.7-dev.6` → **`0.3.7`**（三處同步）。README 版本紀錄把 dev.1–dev.6 **併成一則 0.3.7 正式紀錄**：
從 `main` 的角度 EPS 從未存在（dev.5 已回退），故不列入；dev.6 只留「版號格式與徽章」這兩項淨效果。

### ⚠️ 正式區原本停在 v0.3.6 的狀態
盤點結果：只有 `stock-price`(v6)、**沒有 `stock-report`**、**沒有 `chip_raw_cache`**、
沒有 `reports` bucket、沒有 `pg_cron`/`pg_net`、沒有 `CRON_SECRET`。有 126 筆真實交易。

與 v0.3.6 的 schema 差異只有第 5、6 段（第 1–4 段未變動），故**只套這兩段**，不在有真實資料的庫上重跑既有表。

### 部署順序刻意先後端、後 git
`.github/workflows/deploy.yml` 是 **push 到 `main` 就觸發 Pages 部署**。若先合併，
線上會有一段「分析」按鈕點了就失敗的空窗（前端已上線但正式區沒有 `stock-report`）。
故順序為：正式區後端就緒 → 驗證 → 才合併推 main。

### 正式區執行內容
1. schema 第 5 段 → 建 `chip_raw_cache`
2. `functions deploy stock-report --no-verify-jwt`
3. `secrets set CRON_SECRET=<token_urlsafe(32)>`
4. schema 第 6 段（代入實際 project ref 與 secret）→ `reports` bucket(public)、`pg_cron`/`pg_net`、
   cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`
5. 手動觸發 `generate-all` 兩次：首次 5 檔 / 5 天（回補上限，13.3 秒），第二次補滿 **7 天**（12.3 秒）
6. 驗證 5 份報告（0050、00685L、009816、1802、2609）皆 `schema 2`、`history` 7 天且
   融資融券 7 天齊全、`holding: null`（共用報告不含個資）、`notes` 空

### ⚠️ 踩到的陷阱：Supabase CLI 的 link 是**依 cwd 解析**
從 repo 根目錄執行 `--linked` 指向 **dev**，從 `sources/` 執行才指向**正式區**
（link 檔在 `sources/supabase/.temp/project-ref`）。一開始從根目錄查，`projects list` 回報
正式區 `linked=False`，與使用者所述不符 —— 換到 `sources/` 才對得上。
**對策**：函數部署一律明確帶 `--project-ref`；每次寫入 DB 前先斷言 linked 專案是預期的那個。

### Verification
- `npm run test` 159 passed / `build` / `lint` 全過（版號改動不影響邏輯）
- 正式區與測試區後端狀態一致（皆有 `chip_raw_cache`、`stock-report`(no-verify-jwt)、
  `reports` bucket、每交易日 20:30 排程）

### Outstanding
- 兩區的夜間排程都尚未經歷一次自動觸發（每週一~五 12:30 UTC / 台北 20:30，最快下週一）。
- `TechnicalTab` 仍為佔位頁（需 `price_daily` 與約 400 天保留期，見 PLAN §G / §L）。

---

## 📅 Log: 2026-07-25 23:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 依使用者指示移除基本面（EPS）全部實作；版號格式改為不帶 `v`；徽章不再顯示作者 (0.3.7-dev.6)
- **Status**: COMPLETED

### 1. 移除 EPS（dev.5 全數回退）
- `git revert ec12206`（乾淨套用，無衝突）→ 刪除 `twFundamentals.ts(+test)`、`FundamentalsTab.tsx(+test)`、
  `fundamentalFormat.ts(+test)`；`report.ts` 回到 `REPORT_SCHEMA = 2`；`index.ts` 移除
  `syncFundamentals` / `BWIBBU` / `STOCK_DAY_AVG`；`StockDetailPage` 回到三個分頁籤；
  `reportProxy.ts` schema 守門回到 `=== 2`。實測 `grep -rl "EPS|fundamental|每股盈餘|本益比|BWIBBU"` 於
  `src/` 與 `supabase/` **零命中**。
- **Supabase 端必須跟著回退，不是選項**：部署中的函數回 schema 3，而回退後的前端只接受 `=== 2`，
  Storage-first 與即點即產兩條路都會被判為不支援 → 籌碼頁會整個壞掉。故：
  - 重新部署 `stock-report`（回 schema 2）
  - 重跑 `generate-all` 把 Storage 內 3 份 schema 3 JSON 覆寫回 schema 2（實測 1802/2609/0050 皆已無 `fundamentals` 欄位）
  - `DROP TABLE stock_fundamentals`（1070 列，全為公開 TWSE 資料、無使用者資料、可一道指令重抓）
  - 刪除 `chip_raw_cache` 的 `BWIBBU` / `STOCK_DAY_AVG` 兩筆（否則會閒置 7 天才被 prune）
  - 驗證後 `chip_raw_cache` 只剩 `MI_MARGN, MI_MARGN_D, SBL, T86` 四個 dataset
- `schema.sql` 的第 7 段（`stock_fundamentals`）已隨 revert 移除，檔案回到 6 段。

### 2. 版號格式（CLAUDE.md §17 已更新）
- **一律不帶 `v` 前綴**，只有 `x.x.x`（正式）或 `x.x.x-dev.x`（測試）兩種形式。
- `version.ts` 的 `APP_VERSION` 由 `'v0.3.7-dev.4'` 改為 `'0.3.7-dev.6'`；
  README 第 3 行與「開發中」標題同步去掉 `v`。
- README **歷史版本標題保留原樣**（`### v0.2.5` 等）—— 使用者說的是「以後」，那些是既成紀錄，
  改了只是製造 diff 噪音。

### 3. 徽章不再顯示作者
- `APP_AUTHOR` 常數與其 export **整個移除**（不只是不顯示）；`App.tsx` 的徽章由
  `{APP_VERSION} | {APP_AUTHOR}` 改為 `{APP_VERSION}`。
- `App.smoke.test.tsx` 的斷言改為 `toBe(APP_VERSION)` 並加驗「不以 v 開頭」「不含 Ivan」，
  讓格式規則有測試把關而非只寫在文件。

### 版號選擇說明
本輪進到 **dev.6 而非重用 dev.5**：dev.5 已被 EPS 用掉並推上 remote，重用會讓同一版號指向兩份不同內容。

### Verification
- `npm run test` **159 passed**（回到 dev.4 的基準；EPS 的 40 筆測試隨功能一併移除）
- `npm run build` 通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- dev Supabase：2330 / 0050 實測皆回 `schema 2`、無 `fundamentals` 欄位、`history` 7 天完好
- 籌碼功能未受影響（history、走勢圖、逐日檢視、法人並排全部保留）

---

## 📅 Log: 2026-07-25 16:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 籌碼逐日檢視 + 法人並排比較 (v0.3.7-dev.4)
- **Status**: COMPLETED
- **使用者需求**: (1) 三大法人表格能 review 1~7 天的資料 (2) 買賣超圖在右側空白處顯示圖例

### Completed Tasks
- [x] **三大法人表格可切換 7 天中任一天**：日期鈕列於區塊標題旁，預設最新交易日。
- [x] **連買連賣改為前端計算**（`chipStreak.ts` 的 `streakAt`）：伺服器的 `report.streaks` 只有最新日，
      表格能回看任一天就必須算「到那一天為止」的連續天數。UI 一律走前端這條路（含融資融券），
      不混用兩種來源。行為必須與 Edge Function 的 `computeStreak` 一致，兩邊各有測試。
- [x] **`BarSeriesChart` 支援多序列並排**（grouped bars），同組內留 2px 間隙。
- [x] **新增「全部（並排）」模式**：四個法人同時比較，各一類別色 + 右側 `ChartLegend`。
      hover 一次列出當日四個法人的數字。
- [x] **新增 `chartColors.ts` 的 `CATEGORICAL_COLORS`**（見下方配色決策）。
- [x] **報告表頭加上「報告更新時間」**（`fmtUpdatedAt`），且表頭移進 PDF 擷取範圍內。

### 配色決策（依 dataviz 指引，非憑感覺挑色）
- **顏色一次只能做一件事**：單一序列時顏色表達極性（紅正綠負）；多序列並排時顏色表達身分，
  正負改由長條在零軸上下的方向表達。兩者不可疊在同一組標記上。
- 類別色取自參考配色的固定順序 slot 1–4，**依序指派不循環**。
- **選 dark steps 而非 light steps**：本專案圖表色必須是單一組字面值（html2canvas 限制），
  需同時服務深色主題、淺色主題與淺底 PDF。以 `validate_palette.js` 實測：
  light steps 在深底 **FAIL 亮度帶**；dark steps `#3987e5,#d95926,#199e70,#c98500`
  在淺底 `#fcfcfb` 與深底 `#131a2b` **全部 PASS**（淺底 contrast 2.99 為 WARN，
  需「可見標籤或表格檢視」作緩解 —— 本頁同時有圖例文字與完整數字表格，成立）。
- **合計不與其組成並排**：三大法人合計＝四項之和，一起畫等於同一筆量重複計算。

### Verification
- `npm run test` 150 → **159 passed**（新增 `chipStreak` 6、`StockDetailPage` 3）
- `npm run build` 通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- 瀏覽器實測（Playwright + 臨時 harness，驗完刪除）：7 個日期鈕、圖例 4 項、
  並排長條 7×4=28 根、切單一法人後 7 根且圖例改為買超/賣超、切日期後表格與連買連賣同步重算、
  多序列 tooltip 一次列出四個法人、PDF 實跑成功（453KB）、390px 無水平溢出（日期鈕換行、圖例移至圖下）

### 已知限制（資料本質，非缺陷）
- 並排模式下若某法人量級遠大於其他（例如外資 990 萬 vs 外資自營商 2.2 萬），
  小的那幾根會接近看不見。這是共用同一縱軸的必然結果；要細看請切到單一法人（各自獨立縱軸），
  或看上方表格的數字。**刻意不做雙縱軸** —— 那會讓兩個量級的高低變得無法比較。

---

## 📅 Log: 2026-07-25 15:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v2 —— 個股分析頁 + 籌碼走勢圖 (v0.3.7-dev.3)
- **Status**: COMPLETED
- **Task**: `docs/agent/TASK.md` Task 11；架構決策見 `docs/agent/PLAN.md` §A–J

### Completed Tasks
- [x] **版號規範改版**：CLAUDE.md §17 改為 main `x.x.x`（依序遞增，除非大版本異動）／dev `x.x.x-dev.x`（點號）。
      全庫由 `0.3.7-dev-2` 遷移為 `0.3.7-dev.2`，本次進版至 `0.3.7-dev.3`。
- [x] **`twChips.ts`**：新增 `ChipLeg`（buy/sell/net）；`InstitutionalChip` 五項全部改為 leg
      （自營商買進/賣出由「自行買賣」+「避險」相加，買賣超取官方欄位；三大法人買進/賣出由五個 leg 加總）；
      `MarginChip` 擴充買進/賣出/償還並加 `source` 欄；新增 `marginDatedUrl` / `extractMarginDated`（**位置索引**）
      / `marginDatedOk`（欄序防護）。
- [x] **`report.ts`**：新增 `ChipDay`、`REPORT_SCHEMA = 2`、`history`、`ChipStreaks`；
      純函式 `computeStreak` / `computeStreaks` / `isWeekendYmd`。`buildReport` 改吃 history。
- [x] **`index.ts`**：`loadDaySources` → `loadSeries`（回推 14 日曆日、跳過週六日、快取優先、
      併發上限 3、單次回補上限 5 天、滿 7 個交易日即停）；每日大檔抽成 per-ticker 切片後即釋放，
      避免同時持有數十 MB；移除 html 產生與上傳。**刪除 `reportHtml.ts`**。
- [x] **`reportProxy.ts`**：以結構化型別取代 `data: unknown`；`isSupportedReport` 守門，
      `schema !== 2` 視為未命中；刪除 `applyHoldingOverlay` / `renderHoldingSection`（與 `reportHtml.ts` 重複的手抄複本）。
- [x] **`components/Charts/`（新增）**：`chartScale.ts`（`niceDomain` / `domainTicks` / `tickStep` / `scaleY` /
      `fmtAxisNumber`，純函式有測試）、`chartColors.ts`、`chartFrame.tsx`（軸線、命中區、tooltip）、
      `BarSeriesChart.tsx`、`LineSeriesChart.tsx`。
- [x] **`components/StockDetail/`（新增）**：`StockDetailPage.tsx`（三分頁籤 + PDF）、`ChipsTab.tsx`、
      `HoldingTab.tsx`、`TechnicalTab.tsx`（佔位）、`chipFormat.ts`。
- [x] **`AppShell.tsx`**：新增 `detail` state 作為下鑽檢視，`goTab()` 點導覽分頁即清空；
      `DashboardPage` 改吃 `onOpenDetail`，**刪除 `ReportModal.tsx`**。
- [x] **`reportPdf.ts`**：擷取前後動態掛上／移除 `.report-surface`，深色主題也輸出淺色文件 PDF。
- [x] **`index.css`**：新增個股分析頁、二級分頁籤、圖表、持股卡片與 `.report-surface` 樣式。
- [x] 文件：`README.md`（dev.3 版本紀錄）、`sources/supabase/README.md`（schema 2 結構、
      `MI_MARGN_D` dataset、回補行為、新增症狀對照）、`TASK.md`（補 v1 摘要 + Task 11）、`SPEC.md`（新增章節）。

### Verification
- `npm run test`：**148 passed**（基準 113；新增 twChips 6、report 12、chartScale 12、reportProxy 4、StockDetailPage 9）
- `npm run build`（`tsc -b && vite build`）通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- 瀏覽器（Playwright + 臨時 preview harness，驗完刪除）：
  1280px / 390px 皆無水平溢出（寬表格在自身 `.table-scroll` 內滾動）、hover tooltip 內容與定位正確、
  `.report-surface` 淺色容器正確、`generatePdfBlob` 實跑成功（388KB PDF）、
  本機模式回歸（分析入口正確隱藏、四個導覽分頁切換無 console error）。
- **圖表兩個實測修正**：軸標籤原本隨 viewBox 等比縮放（寬螢幕變兩倍大 / 手機太小），改為量測容器寬度以 1:1 繪製；
  `fmtAxisNumber` 加入 step 參數，修正融資餘額 31,100–31,928 這種序列相鄰刻度全標成「3.1 萬」的問題。

### Supabase 部署（使用者於同一 session 明確授權後執行）

- **只動 dev 專案** `wqetxuhncvfidqnklyew`（Stock-Pnl-Web-Dev）；正式區 `kxnxadaghidwumqsqneu` 未觸碰、CLI 亦未 link。
- `supabase functions deploy stock-report --no-verify-jwt` → **version 1 → 2、`verify_jwt` true → false**。
  `stock-price` 未動（本次無變更），仍為 version 1 / `verify_jwt: true`。
  順帶修掉一個既有問題：舊部署是 `verify_jwt: true`，但 schema.sql §6c 的 cron 只帶 `x-cron-secret`
  不帶 Authorization，代表夜間批次本來就會被 gateway 擋 401。
- **無需 schema migration**（實證）：`chip_raw_cache.dataset` 無 CHECK 約束，
  新的 `MI_MARGN_D` 已正常寫入 9 筆（20260714–20260724），與既有 `T86` / `MI_MARGN` / `SBL` 並存。

### 線上實測（真實 TWSE 資料，2330）

| 項目 | 結果 |
| --- | --- |
| HTTP / 耗時 | 200、約 8 秒（Edge Function wall-clock 內） |
| `schema` / `html` | `2`；回應已無 `html` 欄位 |
| 第一次呼叫 | `history` **5 天**（= `MAX_BACKFILL_DAYS`），`notes` 正確說明「歷史資料回補中」 |
| 第二次呼叫 | `history` **7 天**（07/16、17、20、21、22、23、24 —— 正確跳過 07/18–19 週末），`notes` 清空 |
| 三大法人 | 五項 buy/sell/net 皆有值（外資 buy 8,879,341 / sell 18,515,947 / net −9,636,606） |
| 融資融券 | `source: 'rwd'`（新端點成功），買進 797 / 賣出 454 / 償還 360 / 今日餘額 31,915 張 |
| 交叉驗證 | 2026-07-22 融資餘額 **31,928 張**，與 PLAN.md §C 當初手動實測的 2330 fixture 完全一致 |
| 借券 | `availableVolume: 11,853,736` |
| history 完整性 | 7 天皆 `institutional` 與 `margin` 有值 → 走勢圖資料齊全 |

**回補機制實證有效**：第二次呼叫命中前次快取，額度得以用在剩下 2 天，如 README 所述。

### schema.sql §6 套用（dev.2 遺留缺口，本次一併補上）

dev 專案原本沒有 `reports` bucket、沒有 `CRON_SECRET`，代表 dev.2 的「盤後自動產報」從來沒真的啟用過。
使用者授權後補齊（**只套 §6，前 5 段既有表未重跑**）：

- `supabase secrets set CRON_SECRET=<token_urlsafe(32)>` → 已確認出現在 secrets 清單。
  值同時存在 Edge Function secrets 與 `cron.job.command`；需要取回時查
  `select command from cron.job where jobname='stock-report-nightly'`。
- `supabase db query -f`（§6 代入實際 `<PROJECT_REF>` / `<CRON_SECRET>`）→ 驗證結果：
  `reports` bucket 存在且 public、`pg_cron` / `pg_net` 已啟用、
  cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`。

### 批次與 Storage-first 線上實測

- 手動觸發 `generate-all`（**只帶 `x-cron-secret`、不帶 Authorization**）→
  `{"ok":true,"ymd":"20260724","generated":3,"total":3,"historyDays":7}`，4 秒完成（raw 檔已在快取內）。
  這同時證明 `--no-verify-jwt` 生效 —— 修好前，夜間 cron 會被 gateway 擋 401。
- Bucket 內容：`manifest.json`（0.1KB）+ `20260724/{0050,1802,2609}.json`（各約 5KB，與估算一致）。
- 報告 JSON 檢查（0050）：`schema: 2`、**上下層都無 `html` 欄位**、`history` 7 天且每日 `institutional`
  與 `margin` 皆有值、`holding: null`（共用報告不含個資）、`notes` 空、`margin.source: 'rwd'`。
- Anon 讀取權限：`manifest.json` / 存在的代號 → 200；不存在的代號 → 400（前端據此 fallback 即點即產）。
- **效能**：Storage-first 兩次下載共 **0.8 秒**，對比即點即產 **8 秒** —— 約 10 倍差距，
  這就是套用 §6 的實際價值。

### Outstanding

- **未在瀏覽器走完整登入流程驗證**：dev 為 Supabase 模式需帳密登入，改以 curl 打真實端點 +
  jsdom 元件測試涵蓋。UI 版面另以 fixture 在瀏覽器實測（見上）。
- 夜間排程的首次自動執行時間：**每週一~五 12:30 UTC（台北 20:30）**，尚未經歷一次自動觸發。

---

## 📅 Log: 2026-07-25 12:27:06 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v2 架構規劃與資料源實測（PLAN.md）
- **Status**: COMPLETED（規劃）

### Completed Tasks
- [x] 實測確認帶 `date` 的 rwd 融資融券端點欄位（16 欄、名稱重複需位置索引），記下 2330 實測列當 fixture。
- [x] 確認 T86 同一份回應已含各法人買進 / 賣出（19 欄），拆項無需新資料源。
- [x] 決定移除 HTML 產生路線、改由 React 繪製；`PLAN.md` 寫入架構決策 A–J 與風險。

---

## 📅 Log: 2026-07-25 (dev.2) Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告自動產生 + Storage 快取 (v0.3.7-dev.2，commit 9d62546)
- **Status**: COMPLETED

### Completed Tasks
- [x] `stock-report` 新增 `generate-all` 批次動作，由 `pg_cron` 每交易日 20:30（台北）觸發，
      產出全體持有台股的共用報告存入公開 `reports` bucket；新增 `CRON_SECRET` 驗證。
- [x] 前端改 Storage-first（先讀預產報告，查無再即點即產），個人持股概況由前端疊加。
- [x] 只保留 7 天：同批次清理舊報告與 `chip_raw_cache`。

---

## 📅 Log: 2026-07-24 (dev.1) Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v1 (v0.3.7-dev.1，commit 038cdd8)
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增 Edge Function `stock-report`：抓 TWSE 三大法人買賣超、融資融券、借券，產生報告 HTML。
- [x] 庫存總覽台股列新增「報告」按鈕與彈窗，可下載 PDF（`jspdf` / `html2canvas` 動態載入）。
- [x] 新增 `chip_raw_cache` 依交易日共用快取；Supabase 檔案集中至 `sources/supabase/`。

---

## 📅 Log: 2026-07-22 15:40:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner / Reviewer**: Claude
- **Action**: 庫存總攬面板縮小為主副層級式 (v0.3.6)
- **Status**: COMPLETED

### Completed Tasks
- [x] `DashboardPage.tsx`: 每張面板改為 `.metric.metric-hero`（持倉市值）+ `.metric-row` 兩欄（投入總成本、未實現淨損益）；縮小欄位 skeleton 寬度 120 → 90。三態顯示、格式化參數、tooltip 文案不變。
- [x] `index.css`: `.market-panel` padding 縮小；`.kpi-value` 24px → 16px、新增 `.metric-hero .kpi-value` 22px（小螢幕 20px）；新增 `.metric-row` 兩欄網格（上邊線 + 欄間左分隔線）；刪除舊的直向 `.metric + .metric` 分隔規則；`.kpi-sub` 11.5px → 11px。
- [x] 版本號升至 0.3.6 / v0.3.6。
- [x] Claude 親自 review diff 並重跑 `npm run build` 通過。

---

## 📅 Log: 2026-07-22 15:20:00 Asia/Taipei

- **Agent**: Gemini
- **Action**: Dashboard 庫存總攬改版為台美股雙面板 (v0.3.5)
- **Status**: COMPLETED

### Completed Tasks
- [x] `DashboardPage.tsx`: 新增 `twCost` / `twRawCost` / `usCost` / `usRawCost` 4 個成本聚合運算。
- [x] `DashboardPage.tsx`: 將 4 張卡片改版為 `.market-grid` 下的 2 張 `.market-panel`（🇹🇼 台股 TWD / 🇺🇸 美股 USD）。
- [x] `DashboardPage.tsx`: 調整指標順序為：1. 持倉市值 2. 投入總成本 3. 未實現淨損益。
- [x] `index.css`: 新增 `.market-grid` / `.market-panel` 相關樣式與小螢幕 media query 覆寫，維持 `.kpi-grid` / `.kpi` 既有樣式不動。
- [x] `package.json` 與 `version.ts`: 版本號同步升級至 0.3.5 / v0.3.5。
- [x] 執行 `npm run build` 通過驗證。

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

## 2026-07-21 16:05:00 Asia/Taipei — 全站說明文案改寫為白話短句 (v0.3.4)

- **Agent**: Claude（文案判斷密集，不適合委派）
- **Action**: Rewrite all user-facing help text for stock novices
- **Status**: COMPLETED

### 背景
使用者回報既有說明「太長太攏統」，且**目標讀者是不熟股票的人**。
原文案的問題不是資訊錯誤，而是把公式（`市值 − 未含費成本`）、
交叉引用（「與年度收益頁的口徑一致」）、次要但書（「各券商收費結構差異大」）
全塞進同一段 tooltip，novice 讀不完也讀不懂。

### 改寫原則（後續新增文案請沿用）
1. **短句白話**，一則說明以 1–2 句為限。
2. **不放公式**：講「這些股票現在值多少錢」，不講「現價 × 持有股數」。
3. **去除內行黑話**：拿掉「移動平均成本法」「同口徑」「純價差」「反推」等詞。
4. **砍掉次要但書與交叉引用**，只保留使用者當下做決定需要知道的事。
5. 保留關鍵事實：費用是否計入、資料是否延遲、數字涵蓋範圍。

### Completed Tasks
- [x] `DashboardPage.tsx`：10 條欄位說明 + 8 個 inline tooltip 全面改寫。
      最長的 `unrealized` 由 5 句/約 130 字縮到 2 句。
- [x] `YearlyReport/columnHelp.ts`：6 條年度欄位說明改寫。
- [x] `YearlyPage.tsx`：超賣 badge、只買未賣、交易稅估算 3 個 tooltip 與空狀態文案。
- [x] `ServiceStatusPage.tsx`：「關於本專案」由技術規格（Edge Function、localStorage 降級）
      改為使用者視角的一句話；uptime 條說明白話化。
- [x] `AppShell.tsx` / `RecalcFeesModal.tsx` / `TransactionForm.tsx` / `TransactionsPage.tsx`：
      費率、最低手續費、證交稅、批次重算等 field-hint 與按鈕 tooltip 白話化。
- [x] `utils/csv.ts`：多工作區匯出檔的拒絕訊息改寫（原文用「成本互相污染」）。
- [x] `App.smoke.test.tsx`：同步更新被鎖住的 tooltip 斷言。
- [x] `package.json` + `src/version.ts` bump 至 `0.3.4`。
- [x] 驗證：`npm run build` 通過；`npm test -- --run` 92/92 通過。

### 未更動（刻意）
- 程式碼註解（`/** */`、`//`）維持技術寫法——那是寫給後續 Agent 與開發者看的，
  與畫面上的說明文字是兩個不同的讀者群，不可一起「簡化」。
- 欄位名稱本身未動，只動說明。

---

## 🚧 Next Steps
1. 設定 GitHub Actions 自動部署流程 (Task 2)。
2. 配合使用者引導完成 Supabase 專案連結與 Edge Function `stock-price` 部署 (Task 3)。
