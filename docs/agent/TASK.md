# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-26 10:40:00 Asia/Taipei

---

## 📋 Active Tasks

### Task 16: 技術面 K 線與指標 (0.5.0-dev.1)
- **Status**: DONE（程式碼、驗證、兩區部署皆完成；**線上日線資料待觸發一次批次**）
- **Planner / Implementer**: Claude
- **Timestamp**: 2026-07-26 10:40:00 Asia/Taipei（狀態更新於 2026-07-26 23:04:00）
- **計畫檔**: ~~`~/.claude/plans/k-ai-toasty-pearl.md`~~ **已遺失**（2026-07-26 查核）；
  0.6.0 的殘存資訊見 PLAN.md §6 與本條「使用者定案的決定」

#### Objective
把 `TechnicalTab` 從佔位頁換成真實內容：日 K + 均線、成交量、KD、指標摘要。
這同時是 0.6.0 AI 助理的資料地基 —— 指標必須由程式算好，模型只負責解讀。

#### 使用者定案的決定
- 歷史股價存 **Storage 每檔一份 JSON**（非 `price_daily` 資料表）
- 分兩版交付：**0.5.0 先 K 線、0.6.0 再 AI**
- （0.6.0 用）AI 供應商自帶，介面須 provider-agnostic；直連與 Edge Function 代理**兩者都支援**

#### Scope / Allowed Changes
- 新增：`twDaily.ts(+test)`、`indicators.ts(+test)`、`technicalView.ts(+test)`、
  `dailyProxy.ts(+test)`、`reportsBucket.ts`、`CandleChart.tsx`、`MultiLineChart.tsx`、`chartPath.ts`
- 修改：`stock-report/index.ts`（`syncDaily`）、`TechnicalTab.tsx`、`StockDetailPage.tsx(+test)`、
  `chartFrame.tsx`（僅加選用的 `labelIndices`）、`BarSeriesChart.tsx`、`LineSeriesChart.tsx`、
  `reportProxy.ts`、`index.css`、版號三處、`docs/agent/*`、`README.md`、`supabase/README.md`

#### Acceptance Criteria
- [x] 指標以完整序列計算後才裁切（切「近 3 月」時 MA60 仍畫得出來）—— 純函式 + 測試 + 瀏覽器三重驗證
- [x] Yahoo 日期換算加 `gmtoffset`，並以 UTC+9 反例測試釘住
- [x] 五欄全 null 的假日格丟棄而非補 0
- [x] `schema >= MIN` 守門並以測試釘住（0.4.1 教訓）
- [x] `npm run test` 182 → 221 passed、`build` 通過、`lint` 維持 3 warning
- [x] 數字以獨立實作交叉驗證（MA/KD/RSI/量能比全部相符）
- [x] 1280 / 390px 無水平溢出
- [x] **Supabase 部署**：正式區 `stock-report` v5、測試區 v8（2026-07-26，使用者授權後執行）
- [ ] **線上驗證**：兩區 `daily/*.json` 截至 2026-07-26 23:04 仍不存在
      —— 上一次批次跑在 `syncDaily` 部署之前，需觸發一次 `generate-all`（使用者執行）

### Task 15: 個股分析獨立成頁（下拉切換）、移除服務狀態 (0.3.8-dev.1)
- **Status**: DONE
- **Planner**: User（指定兩項異動與版號）
- **Implementer**: Claude
- **Timestamp**: 2026-07-26 00:30:00 Asia/Taipei

#### Objective
(1) 服務狀態功能全部取消。(2) 個股分析從庫存總覽的下鑽檢視改為獨立導覽分頁，頁內以下拉選單切換持股。

#### 使用者定案的決定
- 庫存總覽的「分析」按鈕**完全移除**（不保留捷徑）
- 下拉選單**只列台股持股**
- 服務狀態頁的 **GitHub 連結搬到頁尾免責聲明下方**；專案簡介文案不保留

#### Scope / Allowed Changes
- 刪除：`components/ServiceStatus/`、`services/serviceHealth.ts(+test)`、`index.css` 的服務狀態區塊
- 新增：`components/StockDetail/AnalysisPage.tsx(+test)`、`utils/holdingRows.ts(+test)`
- 修改：`AppShell.tsx`、`DashboardPage.tsx`、`StockDetailPage.tsx(+test)`、`App.smoke.test.tsx`、
  `twMarketData.ts`、`priceProxy.ts`、`version.ts`、版號三處、`README.md`、`docs/agent/*`

#### Acceptance Criteria
- [x] `src/` 對服務狀態相關關鍵字零命中；`.status-*` / `.uptime-*` 樣式全數移除且未誤刪共用樣式
- [x] 頁尾含 GitHub 連結且位於免責聲明**下方**（smoke test 以 DOM 順序斷言）
- [x] 個股分析為獨立分頁；下拉只列台股；切換即換內容；無台股持股時有空狀態
- [x] 本機模式隱藏該分頁
- [x] 庫存總覽已無「個股分析」欄
- [x] `npm run test` 170 passed / build / lint（warning 由 4 降到 3）

#### 不需要動 Supabase
純前端呈現層改動，報告 JSON 結構與 Edge Function 完全不變。

---

### Task 16: 盤後批次分段執行 + 逐區塊資料時間 (0.4.0)
- **Status**: DONE
- **Planner**: User（提議「能更新的先更新，並標註更新時間」）
- **Implementer**: Claude
- **Timestamp**: 2026-07-26 02:10:00 Asia/Taipei

#### Objective
各資料源公布時間差 6 小時以上，改為分段執行讓早就緒的先上；並讓使用者看得出每塊資料各自多新。

#### 關鍵發現
- 「跑多次逐步補齊」**不需要新機制** —— `generate-all` 本來就冪等且自我補完。
- 「逐項更新時間」**資料早就存在** —— `chip_raw_cache.updated_at`。
- 但分段執行會把借券的既有坑從偶發變必然（端點無日期欄位、早班的錯資料會被後續班次沿用）。
  解法是改用自帶 `title` 日期的 rwd 端點，以資料自己宣告的日期為快取鍵。

#### Acceptance Criteria
- [x] cron 分三段（17:30 / 22:30 / 23:30 台北）
- [x] 報告 `sources` 逐項記錄資料日與抓取時間（schema 3）
- [x] 前端逐區塊顯示；融資融券未到的文案改為「尚未公布」而非「無回應」
- [x] 借券以自己宣告的日期為快取鍵（實測 `SBL_D` 存在 20260727 而非 20260724）
- [x] 舊格式（schema 2、無 sources）不會炸
- [x] test 170 → 182 passed / build / lint 無新增 warning

#### Outstanding
第一次三段式自動執行為 2026-07-27（週一）。預期 17:30 那班 `sources.margin` 為 null、稍晚補齊。

---

### Task 14: 移除基本面（EPS）、版號格式與徽章精簡 (0.3.7-dev.6)
- **Status**: DONE
- **Planner**: User（明確指示取消 EPS）
- **Implementer**: Claude
- **Timestamp**: 2026-07-25 23:10:00 Asia/Taipei

#### Objective
(1) 移除 EPS / 基本面全部實作。(2) 版號一律不帶 `v` 前綴。(3) 版本徽章不再顯示作者。

#### 執行摘要
- `git revert ec12206` 回退 Task 13（基本面）全部程式碼與文件，含 `schema.sql` 的第 7 段。
- **Supabase 端回退是必要而非選項**：部署中的函數回 schema 3，而回退後的前端只接受 `=== 2`，
  Storage-first 與即點即產兩條路都會被判為不支援 → 籌碼頁會整個壞掉。故一併：
  重新部署 `stock-report`、重跑 `generate-all` 覆寫 Storage 回 schema 2、
  `DROP TABLE stock_fundamentals`（1070 列公開資料）、清掉 `chip_raw_cache` 的
  `BWIBBU` / `STOCK_DAY_AVG` 兩筆。
- `CLAUDE.md §17` 改為「一律不帶 `v` 前綴」；`APP_AUTHOR` 常數整個移除；
  smoke test 加上「不以 v 開頭、不含作者」的斷言，讓規則有測試把關而非只寫在文件。

#### Acceptance Criteria
- [x] `src/` 與 `supabase/` 對 `EPS|fundamental|每股盈餘|本益比|BWIBBU` 零命中
- [x] dev 專案實測 2330 / 0050 皆回 `schema 2`、無 `fundamentals` 欄位；`stock_fundamentals` 已不存在
- [x] `chip_raw_cache` 只剩 `MI_MARGN, MI_MARGN_D, SBL, T86` 四個 dataset
- [x] 徽章只顯示 `0.3.7-dev.6`（不帶 `v`、不含作者）
- [x] `npm run test` 159 passed / build / lint 全過
- [x] 籌碼功能（7 日 history、走勢圖、逐日檢視、法人並排）未受影響

#### 備註：Task 13（基本面）已作廢
實作與文件全數回退，`PLAN.md` 的 §M–§Q（資料源實測結果）也隨之移除。
若日後要重做，端點清單、五張產業表的差異、2330 fixture 等實測資料都留在
**commit `ec12206`** 裡，`git show ec12206` 即可取回，不必重新推導。

---

### Task 12: 籌碼逐日檢視 + 法人並排比較 (v0.3.7-dev.4)
- **Status**: DONE
- **Planner / Implementer**: Claude（需求由使用者提出）
- **Timestamp**: 2026-07-25 16:45:00 Asia/Taipei
- **Target Version**: v0.3.7-dev.4

#### Objective
(1) 三大法人表格能回看 7 天中任一天的資料。(2) 買賣超圖能同時比較各法人，並在右側空白處以圖例標明顏色對應。

#### Scope / Allowed Changes
- `Charts/`：`BarSeriesChart.tsx`（多序列並排）、`ChartLegend.tsx`（新增）、`chartColors.ts`（類別色）
- `StockDetail/`：`ChipsTab.tsx`（日期鈕 + 並排模式 + 圖例）、`chipStreak.ts`（新增）、`chipFormat.ts`（`fmtUpdatedAt`）
- `StockDetailPage.tsx`（頁首不重複資料日期）、`index.css`、版號三處、`README.md`、`docs/agent/*`

#### Acceptance Criteria
- [x] 三大法人表格可切換 7 天中任一天，「連買連賣」隨所看日期重算
- [x] 「全部（並排）」模式：四個法人各一類別色，右側圖例標明對應並顯示最近交易日約當張數
- [x] 單一法人模式維持紅正綠負，圖例改為說明買超 / 賣超
- [x] 合計不與其組成並排（避免重複計算）
- [x] 配色以 `validate_palette.js` 實測通過淺底與深底（非憑感覺挑色）
- [x] `npm run test` 150 → 159 passed；build 通過；lint 無新增 warning

#### Verification
瀏覽器實測（Playwright，臨時 harness 驗完刪除）：7 個日期鈕、圖例 4 項、並排 7×4=28 根長條、
切單一法人後 7 根且圖例改語意、切日期後表格與連買連賣同步重算、多序列 tooltip 一次列出四個法人、
PDF 實跑成功（453KB）、390px 無水平溢出。

---

### Task 11: 盤後籌碼報告 v2 —— 個股分析頁 + 籌碼走勢圖 (v0.3.7-dev.3)
- **Status**: DONE
- **Planner / Implementer / Reviewer**: Claude
- **Timestamp**: 2026-07-25 15:20:00 Asia/Taipei
- **Target Version**: v0.3.7-dev.3
- **Plan**: `docs/agent/PLAN.md` §「盤後籌碼報告 v2」（架構決策 A–J）

#### Objective
三大法人與融資融券各自拆成 買進 / 賣出 / 買賣超 / 連買連賣，保留 7 天並附走勢圖；
版面由彈窗改為獨立「個股分析頁」（籌碼 / 技術面 / 我的持股 分頁籤）。

#### Scope / Allowed Changes
- `sources/supabase/functions/stock-report/`：`twChips.ts`（ChipLeg、`extractMarginDated`）、
  `report.ts`（ChipDay、schema 2、`computeStreak(s)`、`isWeekendYmd`）、`index.ts`（`loadSeries` 回補）、
  **刪除** `reportHtml.ts`
- `sources/src/services/reportProxy.ts`（結構化型別、schema 守門）、`reportPdf.ts`（`.report-surface` 切換）
- `sources/src/components/Charts/`（新增）、`sources/src/components/StockDetail/`（新增）
- `sources/src/components/AppShell.tsx`（detail 下鑽 state）、`Dashboard/DashboardPage.tsx`（`onOpenDetail`）、
  **刪除** `Dashboard/ReportModal.tsx`
- `sources/src/index.css`、版號三處、`README.md`、`sources/supabase/README.md`、`docs/agent/*`

#### Constraints
- 不引入圖表函式庫（自繪 SVG）；不新增任何 npm 依賴。
- 不主動部署或異動任何 Supabase 環境（CLAUDE.md §18）。
- 無 schema migration：新的 `MI_MARGN_D` dataset 沿用現有 `chip_raw_cache`，`RETAIN_DAYS = 7` 不變。

#### Acceptance Criteria
- [x] 三大法人 5 列 × 買進 / 賣出 / 買賣超 / 約當張數 / 連買連賣
- [x] 融資融券含 買進 / 賣出 / 償還 / 今日餘額 / 較前日 / 連增連減，並標示「賣出＝放空、買進＝回補」
- [x] 近 7 日買賣超長條圖（可切換法人）＋ 融資 / 融券餘額折線圖（不共用 Y 軸）
- [x] 伺服器不再回 HTML；前端遇 `schema !== 2` 走即點即產 fallback
- [x] 單次回補上限 5 天，不足時 `notes[]` 說明且圖照常出
- [x] 深色主題下載的 PDF 仍為淺色文件
- [x] `npm run test`（113 → 148 筆）/ `npm run build` / `npm run lint` 全過，無新增 lint warning

#### Verification
- 單元測試：T86 買進/賣出與自營商加總、`extractMarginDated` 位置索引（2330 實測列 fixture）、
  `computeStreak` 邊界（遇 0 / null 中斷）、`niceDomain` 跨零與全零、`fetchStoredReport` 舊格式視為未命中。
- 元件測試 `StockDetailPage.test.tsx`：分頁切換、圖表數量、法人切換重繪、PDF 按鈕僅籌碼頁、兩條資料路徑。
- 瀏覽器（Playwright，臨時 preview harness 驗完即刪）：1280px / 390px 無水平溢出、
  hover tooltip 內容與定位、`.report-surface` 淺色容器、實際跑一次 `generatePdfBlob` 成功（388KB）、
  本機模式回歸（分析入口隱藏、導覽切換無錯）。

#### Supabase 部署（已完成，使用者明確授權）
- [x] `supabase functions deploy stock-report --no-verify-jwt` → dev 專案 `wqetxuhncvfidqnklyew`
      version 1 → 2、`verify_jwt` true → false。正式區未觸碰。
- [x] 線上實測 2330 真實資料：schema 2、無 `html`、第一次 5 天 / 第二次 7 天（回補機制有效）、
      融資融券走新 `rwd` 端點、與 PLAN.md §C 的 fixture 交叉驗證一致。詳見 `PROGRESS.md`。
- [x] 實證無需 schema migration：`MI_MARGN_D` 正常寫入 `chip_raw_cache`。

- [x] **補上 dev.2 遺留缺口**：dev 專案原本沒有 `reports` bucket / `CRON_SECRET`（盤後自動產報從未啟用）。
      已設 `CRON_SECRET`、套用 schema.sql §6（只套 §6），驗證 bucket public、`pg_cron`/`pg_net` 已啟用、
      cron job `30 12 * * 1-5` active。
- [x] 手動觸發 `generate-all` → `generated 3/3`、`historyDays 7`；bucket 內 `manifest.json` +
      3 份約 5KB 的 schema 2 JSON（無 `html`、`holding: null`、7 天 history 齊全）。
- [x] **Storage-first 效能實測**：0.8 秒 vs 即點即產 8 秒（約 10 倍）。

#### Outstanding
- 夜間排程尚未經歷一次自動觸發（每週一~五 12:30 UTC / 台北 20:30）。
- 未在瀏覽器走完整 Supabase 登入流程（需帳密），改以 curl 打真實端點 + jsdom 元件測試涵蓋。

---

### 補記（無 Task 編號）: 盤後籌碼報告 v1 (v0.3.7-dev.1 / dev.2)
- **Status**: DONE（實作於 038cdd8 / 9d62546，當時未建 TASK 條目，此處補記）
- **Implementer**: Claude
- **Timestamp**: 2026-07-24（dev.1）、2026-07-25（dev.2）

#### 摘要
- **dev.1**：新增 Edge Function `stock-report`，抓 TWSE 盤後籌碼（三大法人買賣超、融資融券、借券），
  於庫存總覽台股列以彈窗（`ReportModal`）顯示 Edge Function 產生的 HTML，可下載 PDF。
  新增 `chip_raw_cache` 依交易日共用快取；Supabase 檔案集中至 `sources/supabase/`。
- **dev.2**：新增 `generate-all` 批次 + `pg_cron` 每交易日 20:30 產出共用報告存入 `reports` bucket，
  前端改 Storage-first，保留 7 天並清理舊檔。
- **已被 Task 11 取代的部分**：HTML 產生路線（`reportHtml.ts`）、`ReportModal`、前端 `applyHoldingOverlay` 疊加。

---

### Task 10: 庫存總攬面板縮小為主副層級式 (v0.3.6)
- **Status**: DONE
- **Planner**: Claude（縮小方式經使用者選定「主副層級式」）
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-22 15:40:00 Asia/Taipei
- **Target Version**: v0.3.6

#### Objective
v0.3.5 的台股/美股雙面板過大（三個 24px 大數字直向堆疊）。改為主副層級：持倉市值當主角（22px），投入總成本與未實現淨損益縮小（16px）並排成 `.metric-row` 左右兩欄，面板高度約砍至 190px。

#### Scope / Allowed Changes
- `sources/src/components/Dashboard/DashboardPage.tsx`（`.metric-hero` + `.metric-row` 容器結構，三態邏輯與文案不變）
- `sources/src/index.css`（`.market-panel` 系列；`.kpi` 系列不動）
- `sources/package.json`
- `sources/src/version.ts`

### Task 9: Dashboard 庫存總攬改版為台美股雙面板 (v0.3.5)
- **Status**: DONE
- **Planner**: User
- **Implementer**: Gemini
- **Timestamp**: 2026-07-22 15:20:00 Asia/Taipei
- **Target Version**: v0.3.5

#### Objective
將 Dashboard 庫存總覽的 4 張單一 KPI 卡片改版為「台股/美股」兩張並排玻璃面板，面板內部採直向堆疊指標：持倉市值、投入總成本（含未含費）、未實現淨損益（含未含費）。

#### Scope / Allowed Changes
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/index.css`
- `sources/package.json`
- `sources/src/version.ts`

### Task 8: Add a GitHub-Status-style 服務狀態 page and retire the floating version badge (v0.3.0)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 14:45:00 Asia/Taipei
- **Target Version**: v0.3.0

#### Objective
加入 ServiceStatusPage 以顯示系統運作狀態、API 健康檢測與快取資訊。同時移除過時的畫面浮動版本標章。

### Task 7: 年度明細下放手續費/交易稅拆分 (v0.2.8)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 15:30:00 Asia/Taipei
- **Target Version**: v0.2.8

#### Objective
將 v0.2.7 新增的 summary 層級交易稅估算下放到年度表格的各個層級（年度、個股、逐筆明細），並調整相關 KPI 標籤。

#### Scope / Allowed Changes
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/package.json`
- `sources/src/App.tsx`

### Task 6: 歷史累計手續費拆分 (v0.2.7)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 14:05:00 Asia/Taipei
- **Target Version**: v0.2.7

#### Objective
將年度收益頁面的歷史累計手續費 KPI，透過稅率預估反推，拆分為「手續費」與「交易稅」。

#### Scope / Allowed Changes
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/package.json`
- `sources/src/App.tsx`

### Task 1: 專案目錄結構與 GEMINI.md 記憶體調整
- **Status**: DONE
- **Allowed Changes**: `docs/`
- **Verification**: `docs/agent/` 目錄建立且包含完整紀錄檔，`docs/architecture/` 與 `docs/database/` 文件歸位。

### Task 2: GitHub Pages CI/CD 自動化建置
- **Status**: TODO
- **Allowed Changes**: `.github/workflows/`
- **Acceptance Criteria**: Commit 至 `main` 自動 trigger build 並產出靜態網站至 GitHub Pages。

### Task 3: Supabase 後端上線與 Edge Function 部署
- **Status**: TODO
- **Allowed Changes**: `sources/supabase/`
- **Acceptance Criteria**: 提供標準指令說明或輔助執行 Supabase 部署與 `.env.local` 綁定。

### Task 5: 年度收益頁面改版與明細展開 (v0.2.6)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 12:03:00 Asia/Taipei
- **Target Version**: v0.2.6

#### Objective
移除年度收益頁面的排序功能，加入第三層的逐筆賣出明細（移動平均成本口徑），並在 KPI 區塊顯示買/賣筆數拆分。

#### Scope / Allowed Changes
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/components/Common/HelpTh.tsx`
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/index.css`
- `sources/package.json`
- `docs/agent/SPEC.md`, `docs/agent/PROGRESS.md`, `docs/agent/TASK.md`

### Task 4: 交易紀錄搜尋欄位（代號 / 名稱快速過濾）
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: Gemini
- **Timestamp**: 2026-07-21 09:58:00 Asia/Taipei
- **Target Version**: v0.2.5

#### Objective

在「交易紀錄」頁工具列新增搜尋輸入框，輸入代號或名稱關鍵字即時過濾交易列表，
快速找到特定股票的交易資訊。

#### Scope / Allowed Changes

- `sources/src/components/Transactions/TransactionsPage.tsx` — 加入搜尋輸入框與過濾接線
- `sources/src/components/Transactions/txSearch.ts` — **新檔**：純函式過濾邏輯（可獨立單元測試）
- `sources/src/components/Transactions/txSearch.test.ts` — **新檔**：單元測試
- `sources/src/App.smoke.test.tsx` — 新增 UI 整合測試（或另建 `TransactionsPage.test.tsx`）
- `sources/src/index.css` — 若需要搜尋框樣式（沿用既有 `.btn` / toolbar 風格，盡量少改）
- `sources/package.json` — 版本號 bump 至 `0.2.5`
- **不得修改**：`dataProvider.ts`、`WorkspaceContext.tsx`、資料模型、Supabase 相關檔案；不得新增依賴套件

#### Functional Spec

1. **搜尋框位置**：工具列（`.section.toolbar`）內、「刪除選取」之後、`.spacer` 之前，
   placeholder：`搜尋代號或名稱`，附清除按鈕（X），輸入框需有 `aria-label="搜尋交易"`。
2. **比對規則**（純前端、即時過濾，不需 debounce——資料在記憶體中）：
   - 關鍵字先 `trim()`；空字串 = 不過濾（顯示全部）。
   - 代號：不分大小寫的**子字串**比對（`"233"` 命中 `2330`、`"aapl"` 命中 `AAPL`）。
   - 名稱：子字串比對，需同時比對**原始 `tx.name`** 與 **`displayStockName(market, ticker, name)`**
     ——美股顯示層是中文譯名（如 AAPL → 蘋果），使用者搜「蘋果」或「Apple」都要命中。
   - 單一關鍵字命中代號**或**名稱任一即顯示該列。
3. **過濾時機**：在既有 `sorted` useMemo 之前先過濾（filter → sort），排序功能照常作用於過濾後結果。
4. **筆數提示**：過濾中時顯示「顯示 X / Y 筆」（Y = 全部交易數）。
5. **與勾選 / 批次刪除的互動**：
   - 過濾改變時**保留**既有勾選狀態（不清空）。
   - 「全選」只作用於目前可見（過濾後）的列——既有 `toggleAll` 以 `sorted` 為準，行為天然正確。
   - 「刪除選取（n）」的 **n 與實際刪除範圍 = 勾選且目前可見**的交易
     （既有 `handleDeleteSelected` 已是 `sorted.filter(selected)`，但按鈕顯示的
     `selected.size` 需改為可見勾選數，避免數字與實際刪除筆數不一致）。
6. **無結果狀態**：有交易但搜尋無命中時，顯示「找不到符合「{關鍵字}」的交易」＋清除搜尋按鈕；
   與「尚無交易紀錄」空狀態區分，工具列維持顯示。
7. **CSV 匯出不受過濾影響**：維持匯出全部交易（既有行為，需在 code review 確認未被改動）。
8. **切換工作區時清空搜尋字串**（比照勾選清空的既有 useEffect）。

#### Non-Goals

- 不做多關鍵字 / 進階語法（AND、市場篩選、日期區間）。
- 不做遠端搜尋（`stockSearch.ts` 是新增交易用的股票查詢，與本功能無關，勿混用）。
- Dashboard / 年度收益頁不加搜尋（未來另開任務）。

#### Test Items（驗收必備）

**單元測試 `txSearch.test.ts`（純函式 `filterTransactions(txs, query)`）**

| # | 案例 | 預期 |
| - | ---- | ---- |
| U1 | 空字串 / 全空白關鍵字 | 回傳全部交易 |
| U2 | 代號部分比對 `"233"` | 命中 `2330` |
| U3 | 代號不分大小寫 `"aapl"` | 命中 `AAPL` |
| U4 | 名稱子字串 `"台積"` | 命中名稱「台積電」 |
| U5 | 美股中文譯名 `"蘋果"`（tx.name 為 `Apple Inc.`） | 透過 displayStockName 命中 AAPL |
| U6 | 美股原始名稱 `"apple"`（不分大小寫） | 命中 tx.name `Apple Inc.` |
| U7 | 無任何命中 `"9999"` | 回傳空陣列 |
| U8 | 關鍵字前後空白 `"  2330  "` | 與 `"2330"` 結果相同 |

**UI 整合測試（jsdom + testing-library，比照 App.smoke.test.tsx 的本機模式流程）**

| # | 案例 | 預期 |
| - | ---- | ---- |
| I1 | 建立 2330 台積電與 AAPL 兩筆交易後輸入「台積」 | 表格只剩台積電列，顯示「顯示 1 / 2 筆」 |
| I2 | 點清除按鈕 | 恢復顯示全部列，筆數提示消失 |
| I3 | 輸入無命中關鍵字 | 顯示「找不到符合…」訊息，且**不是**「尚無交易紀錄」空狀態 |
| I4 | 過濾中點「全選」 | 只勾選可見列；清除搜尋後另一筆未被勾選 |
| I5 | 勾選 2 筆後過濾到只剩 1 筆可見，點「刪除選取」 | 按鈕顯示（1）、只刪除可見那筆，另一筆仍存在 |
| I6 | 過濾中點「代號」排序 | 排序作用於過濾後結果，不出錯 |
| I7 | 切換 / 新建工作區 | 搜尋框自動清空 |

**回歸驗證**

- `npm test`（既有 68 筆測試全數通過 + 新增測試）
- `npm run lint`、`npm run build` 無錯誤
- 以 `/verify` skill（Playwright 本機模式）人工走一次 I1–I3 流程

#### Acceptance Criteria

- [x] 上表 U1–U8、I1–I7 測試全部撰寫並通過
- [x] 既有測試無任何退步
- [x] 過濾邏輯集中於 `txSearch.ts` 純函式，UI 層只負責接線
- [x] 未修改 Scope 以外的檔案、未新增依賴
- [x] `package.json` 版本 bump 至 0.2.5，commit message 格式：`feat(transactions): add search filter (v0.2.5)`
