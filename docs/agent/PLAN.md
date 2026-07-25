# Development Plan (PLAN.md)

- Agent: Claude
- Status: IN_PROGRESS
- Timestamp: 2026-07-25 12:27:06 Asia/Taipei

---

## 🎯 Short-term Goals (短期目標)

1. **GitHub Pages 自動化部署**
   - 設定 GitHub Actions workflow，讓 `main` / `dev` 分支 commit 自動 build 並部署至 GitHub Pages。
2. **Supabase 後端環境連結與部署**
   - 執行 SQL Schema 於 Supabase SQL Editor。
   - 部署 Edge Function `stock-price` 用於台/美股即時報價與搜尋代理。
   - 配置 Auth 重導向與 `.env.local` 密鑰。
3. **線上環境整合驗證**
   - 端到端測試註冊、登入、交易紀錄 CRUD、CSV 匯入匯出與年度損益統計。
4. **盤後籌碼報告 v2**（規劃完成、尚未實作）
   - 三大法人與融資融券拆成 買進 / 賣出 / 買賣超 / 連買連賣，保留 7 天並附走勢圖。
   - 詳見下方「🚧 進行中：盤後籌碼報告 v2」。

---

## 🗺️ Long-term Goals (長期目標)

1. **使用者設定同步 (User Settings Sync)**
   - 將前端手續費折扣率與偏好接上 Supabase `user_settings` 資料表。
2. **自動型別產生**
   - 使用 Supabase CLI 自動產生 `database.types.ts`。
3. **離線/連線雙模切換優化**
   - 強化本機模式 (localStorage) 與 Supabase 雲端資料同步機制。

---

## 🚧 進行中：盤後籌碼報告 v2

- Agent: Claude
- Action: 架構規劃與資料源實測驗證（**尚未實作任何程式碼**）
- Status: PLANNED — 待使用者指示後開始實作
- Timestamp: 2026-07-25 12:27:06 Asia/Taipei

基準版本：`v0.3.7-dev-2`（功能 v1 實作於 038cdd8 / 9d62546）。

### A. 需求與已確認方向

**需求**：三大法人買賣超與融資融券餘額，各自拆成 **買進 / 賣出 / 買賣超 / 連買連賣**；資料最多保留 7 天；並提供走勢圖。未來要再加入日線 / 週線 / 季線。

**已與使用者確認的方向**：

1. 版面改成獨立的「**個股分析頁**」，內含 `籌碼 / 技術面 / 我的持股` 分頁籤（不再用彈出視窗）。
2. 走勢圖**自繪 SVG**，先做 7 日，**不引入圖表函式庫**。
3. 歷史資料**回補最近 7 個交易日**，不等自然累積。

**待確認**：是否保留一個精簡摘要彈窗當快速入口。目前傾向不保留 —— 分析頁讀的是同一份 Storage JSON，開啟速度相同；先開摘要再點進去是多餘步驟，且會多出一份需同步維護的 markup。

### B. 架構決策 1 —— 伺服器只回結構化資料，畫面全部由 React 繪製

**現況**：Edge Function 產出整段 HTML 字串，前端以 `dangerouslySetInnerHTML` 注入 760px 的 `Modal`。

**問題**：字串模板做不出 hover tooltip、切換法人等互動圖表。把彈窗加寬解決不了根本問題 —— 瓶頸是渲染方式，不是版面尺寸。

**決定**：移除 `reportHtml.ts` 的 HTML 產生路線，Storage JSON 不再存 `html` 欄位；改由 React 元件從結構化 `data` 渲染。

**附帶效益**：清掉既有的重複隱患 —— `sources/src/services/reportProxy.ts:120-130` 的 `renderHoldingSection` 是 `reportHtml.ts:83-95` `holdingSection` 的手抄複本，連 `fmtInt / fmtPrice / fmtSignedMoney / fmtPct / sc` 五個格式化函式都兩邊各有一份。Storage 檔案體積也會減半（原本 `data` 與 `html` 是兩份等價內容）。

**待處理的副作用**：`reportPdf.ts` 用 `html2canvas` 擷取 DOM，原本擷取的是自帶淺色 scoped style 的 `.rpt` 區塊，PDF 才會像一份文件；改由 App 內渲染後，深色主題會輸出深色 PDF。
→ 對策：新增 `.report-surface` class，在該容器內把 `--surface / --ink / --border` 等 token 覆寫為淺色，PDF 擷取範圍即此容器。
（html2canvas 1.4 可處理 inline `<svg>`，這也是選擇自繪 SVG 而非 canvas / WebGL 圖表庫的理由之一。）

### C. 架構決策 2 —— 融資融券改用帶 date 的 rwd 端點

**現況**：`https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN` **沒有 date 參數**，只能取得最新一個交易日 —— 這正是目前做不出融資融券走勢圖的根本原因。

**改用**：

```text
https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=YYYYMMDD&selectType=ALL&response=json
```

**已實測驗證（以 2026-07-22 資料）**：`tables[1]`（判定條件 `fields[0] === '代號'`）為逐股彙總，共 16 欄。**欄位名稱重複**（「買進」「賣出」各出現兩次），因此**必須以位置索引取值，不可用名稱比對**：

| idx | 欄位 | idx | 欄位 |
| --- | --- | --- | --- |
| 0 | 代號 | 8 | 融券買進（回補） |
| 1 | 名稱 | 9 | 融券賣出（放空） |
| 2 | 融資買進 | 10 | 融券現券償還 |
| 3 | 融資賣出 | 11 | 融券前日餘額 |
| 4 | 融資現金償還 | 12 | 融券今日餘額 |
| 5 | 融資前日餘額 | 13 | 融券次一營業日限額 |
| 6 | 融資今日餘額 | 14 | 資券互抵 |
| 7 | 融資次一營業日限額 | 15 | 註記 |

2330 實測列（可直接當單元測試 fixture）：

```json
["2330","台積電","855","662","88","31,823","31,928","6,483,092","4","5","0","98","99","6,483,092","3"," "]
```

這個端點額外提供了買進 / 賣出 / 現金償還，正好就是要拆出來的欄位。保留舊的 OpenAPI 解析器作為當日 fallback（rwd 失敗時仍有今日餘額，只是缺買進 / 賣出）。

**順帶記錄一個既有 bug**：TWSE 融資融券數字的單位是**交易單位（張）**，但 `reportHtml.ts:128` 標示為「資券互抵：N 股」，是錯的。T86 的數字則是**股數** —— 兩個區塊單位不同，新 UI 必須各自標示清楚（依 `SPEC.md` 的 UI 文案準則，必須說明數字涵蓋什麼）。

### D. 架構決策 3 —— 三大法人的買進 / 賣出資料早就在手上

T86 端點（`https://www.twse.com.tw/rwd/zh/fund/T86?date=YYYYMMDD&selectType=ALLBUT0999&response=json`）同一份回應就含各法人的買進 / 賣出 / 買賣超，**實測共 19 欄**：

```text
 0 證券代號                          10 投信買賣超股數
 1 證券名稱                          11 自營商買賣超股數
 2 外陸資買進股數(不含外資自營商)      12 自營商買進股數(自行買賣)
 3 外陸資賣出股數(不含外資自營商)      13 自營商賣出股數(自行買賣)
 4 外陸資買賣超股數(不含外資自營商)    14 自營商買賣超股數(自行買賣)
 5 外資自營商買進股數                 15 自營商買進股數(避險)
 6 外資自營商賣出股數                 16 自營商賣出股數(避險)
 7 外資自營商買賣超股數               17 自營商買賣超股數(避險)
 8 投信買進股數                       18 三大法人買賣超股數
 9 投信賣出股數
```

`twChips.ts` 的 `extractInstitutional` 目前只取 4 / 7 / 10 / 11 / 18 這五個買賣超欄位，其餘全部丟棄。
**結論：拆買進 / 賣出不需要新資料源，只需停止丟棄現有回應中的欄位。**

注意事項：

- T86 **沒有**「三大法人買進 / 賣出」欄位，需由五個 leg 加總；買賣超合計仍取官方的 idx 18。
- 自營商的買進 / 賣出只有「自行買賣」與「避險」兩組拆項，需相加才等於 idx 11 對應的自營商合計。

### E. 架構決策 4 —— 7 日序列由 Edge Function 組好內嵌於報告

報告 JSON 內嵌 `history: ChipDay[]`（由舊到新，最多 7 筆），前端直接畫。

不採「前端抓 7 個 `{ymd}/{ticker}.json`」的理由：需要 7 次 Storage 往返，且舊日檔只涵蓋當時的持股清單（`heldTwTickers()` 每天重算），會有缺洞。

**回補策略與逾時控制**（Edge Function 有 wall-clock 上限，T86 單檔約 1–2MB）：

- 候選日往回推 14 個日曆日，逐一 `readCache`；命中則不發網路請求。
- 未命中者以**併發上限 3** 併行抓取，收集滿 7 個交易日即停。
- **單次呼叫最多回補 5 個缺漏日**；不足的部分照常出圖，並在 `notes[]` 說明「歷史資料回補中」，隔日排程會補齊。
- 首次執行約 10–14 次外部請求；之後每天只有 1 天未命中。

`chip_raw_cache` 體積推估：7 天 × 2 dataset × 約 1–2MB JSONB ≈ 15–25MB（TOAST 壓縮後更少）。

**無需 schema migration** —— 現有 PK `(ymd, dataset)` 可直接容納新的 `MI_MARGN_D` dataset；`RETAIN_DAYS = 7` 與 `pruneStorage` / `pruneChipCache` 維持不變。

### F. 預定的檔案異動範圍

| 檔案 | 動作 |
| --- | --- |
| `sources/supabase/functions/stock-report/twChips.ts` | 新增 `ChipLeg`；`InstitutionalChip` 各項改為 leg；`MarginChip` 擴充；新增 `marginDatedUrl` / `extractMarginDated` |
| `sources/supabase/functions/stock-report/report.ts` | 新增 `ChipDay`、`schema: 2`、`history`；純函式 `computeStreak` / `computeStreaks` |
| `sources/supabase/functions/stock-report/index.ts` | `loadDaySources` → `loadSeries`（含回補與併發上限）；移除 html 產生與上傳 |
| `sources/supabase/functions/stock-report/reportHtml.ts` | **刪除** |
| `sources/src/services/reportProxy.ts` | 以結構化型別取代 `data: unknown`；`schema !== 2` 視為 miss 走 fallback；刪除 `applyHoldingOverlay` / `renderHoldingSection` |
| `sources/src/components/Charts/`（新增） | `chartScale.ts`（純函式、有測試）、`BarSeriesChart.tsx`、`LineSeriesChart.tsx` |
| `sources/src/components/StockDetail/`（新增） | `StockDetailPage.tsx` / `ChipsTab.tsx` / `HoldingTab.tsx` / `TechnicalTab.tsx`（技術面為佔位） |
| `sources/src/components/AppShell.tsx` | 專案無 router，分頁是 `useState<Tab>`；新增 `detail` state 作為下鑽檢視，點導覽分頁即清空 |
| `sources/src/components/Dashboard/DashboardPage.tsx` | `onReport` → `onOpenDetail`（現於 381-385、399-416） |
| `sources/src/components/Dashboard/ReportModal.tsx` | **刪除** |
| `sources/src/index.css` | 新增 `.report-surface` 淺色容器（PDF 擷取範圍） |

**圖表配色**：沿用台股慣例**紅正綠負**（現有 token `.up #d21f3c` / `.down #12864e`），不套用通用 dataviz 色階。

**籌碼頁預定內容**：三大法人表格（列＝外資 / 外資自營商 / 投信 / 自營商 / 三大法人合計；欄＝買進 / 賣出 / 買賣超 / 約當張數 / 連買連賣）＋ 7 日買賣超長條圖（可切換法人）＋ 融資融券表格（融資：買進 / 賣出 / 現金償還 / 今日餘額 / 較前日 / 連增連減；融券同構，標示「賣出＝放空、買進＝回補」）＋ 融資、融券餘額 7 日折線圖（兩者量級差距大，不共用 Y 軸）＋ 借券 ＋ `notes[]` ＋ 免責聲明。

### G. 未來擴充：日線 / 週線 / 季線

兩個會影響現在決策的事實，先記錄下來：

1. **現有 7 天保留期無法支撐季線。** 季線需 ≥60 個交易日的收盤價，`chip_raw_cache` 的 7 天 prune 會吃掉它。技術面資料**必須另立儲存**，例如 `price_daily(ticker, date, open, high, low, close, volume)` 搭配獨立的保留期（約 400 天）。
2. **資料源已在專案內。** `sources/supabase/functions/stock-price/index.ts` 已經在呼叫 Yahoo `chart` 端點，但只讀 `result[0].meta` 取現價，把 `timestamp` / `indicators.quote` 陣列丟掉 —— 只要放寬 `range` / `interval` 就有完整 OHLC。備案是 TWSE `exchangeReport/STOCK_DAY?date=&stockNo=`（逐股月檔）。

本輪先交付 `TechnicalTab` 佔位頁，之後接上時不必再動版面。

### H. 實作時的驗證方式

1. `npm run test`（基準 113 passed）—— 新增測試：T86 買進/賣出抽取與自營商加總、`extractMarginDated` 位置索引（用 §C 的 2330 實測列當 fixture）、`computeStreak` 邊界（遇 0 / 遇 `null` 中斷）、`niceDomain` 跨零與全零。
2. `npm run build`（`tsc -b && vite build`）—— **不可略過**，`tsc --noEmit` 與 vitest 抓不到白屏等級的錯誤。
3. `npm run lint`（oxlint）。
4. UI 驗證：`/verify` skill 走本機模式，但本機模式無 Supabase、報告入口是隱藏的，需用臨時 `.env.test.local` 指向 dev 專案（`wqetxuhncvfidqnklyew`）繞過。檢查項：分頁籤切換、圖表在窄視窗不撐破版面、hover tooltip、PDF 在深色主題下仍輸出淺色文件、舊格式 JSON 觸發 `generate` fallback。
5. 端對端（**需使用者明確授權**，見 CLAUDE.md §18）：部署 `stock-report` 到 dev 專案、以 `x-cron-secret` 手動觸發 `generate-all`、確認 bucket 內 JSON 含 7 筆 `history`。

### I. 風險

- **回補逾時**：首次 `generate-all` 需抓 10–14 個大檔。若實測仍逾時，降低單次回補上限至 3 天，讓排程分幾天補齊（`notes[]` 已會說明資料不完整）。
- **rwd 端點欄位順序變動**：以 `fields[0] === '代號'` ＋ 欄數 ≥15 檢查防護；不符即回退 OpenAPI fallback 並在 `notes[]` 標示。
- **部署過渡期**：新前端遇到 bucket 內的舊格式 JSON 會走即點即產 fallback（較慢但可用），排程跑過一輪後恢復。

### J. 文件債（實作時一併補）

- `TASK.md` 停在 Task 10 (v0.3.6)，**盤後籌碼報告 v1 根本沒有 TASK 條目** —— 需補 v1 摘要 ＋ 本次 Task 11。
- `PROGRESS.md` 停在 v0.3.6，缺 v0.3.7-dev-1 / dev-2 兩筆。
- `SPEC.md` 無盤後籌碼報告章節，且仍引用已搬移的 `docs/database/supabase_schema.sql`（現為 `sources/supabase/schema.sql`）。
- 版號依 CLAUDE.md §17.2 由 `0.3.7-dev-2` 進到 `0.3.7-dev-3`，三處同步（`sources/src/version.ts` / `sources/package.json` / `README.md`）。
- `sources/supabase/README.md` 需更新報告 JSON 結構（已無 `html`）、新的 `MI_MARGN_D` dataset、回補行為說明。
