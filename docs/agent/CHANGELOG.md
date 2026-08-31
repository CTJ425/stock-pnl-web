# 版本紀錄

_此檔案為 README.md 版本紀錄區塊的完整搬移，內容與格式保持原樣，不做任何改寫。_

### 0.9.22（2026-08-31）— 全新代號自動補齊三大法人資料

> 過去新增一檔從未記錄過的股票後，三大法人／融資券／借券資料要等隔天夜間 `generate-all` 排程才會出現；加入觀察股更是完全不觸發任何抓取。本版讓兩條新增路徑都即時補齊最近 7 個交易日的籌碼資料。關鍵在於 `chip_raw_cache` 存的是未過濾的全市場原始回應，因此快取命中時對外呼叫次數為零。

- 🆕 **`warm` 動作新增 `phase: 'chips'`**（`stock-report/index.ts`）— 接受單一代號，重用 `loadSeries([ticker], ...)` 產出最近 7 個交易日的 `reports/{ymd}/{ticker}.json`。冪等閘門先檢查最新交易日的報表檔是否已存在，存在則回傳 `skipped: 'already-present'` 且不做任何後續呼叫。此路徑不寫 `manifest.json`（manifest 只記日期、不記代號清單，新增代號的報表檔不需要更新它）。
- ⏱️ **`loadSeries` 新增 `maxUpstreamDays` 上限** — 使用者觸發的路徑壓在 2 天，避免新增股票變成打 TWSE 的槓桿。快取冷時寫得到多少算多少，其餘交回夜間排程完成。呼叫端省略此參數時行為與先前完全一致，夜間 `generate-chips` 不受影響。
- 🔌 **`warmStockChips()`**（`services/warmStock.ts`）— 新增 client 端封裝，含 session 內同代號去重封印，`resetWarmState()` 一併清除。Edge 回傳的 `skipped: 'already-present'` 對應為布林值，且視為 `ok: true` 而非失敗；invoke 出錯時回傳失敗值而不丟出例外。
- 🛒 **買進路徑追加觸發**（`services/prefetchStockData.ts`）— 籌碼補齊與基本面補齊互相獨立。基本面已足夠的代號仍會補籌碼，因為兩者的缺漏條件不同。
- 👀 **觀察股路徑首次觸發**（`services/watchlistService.ts`）— `addWatch()` 在寫入成功後才呼叫 `prefetchStockData()`。容量上限擋下、寫入失敗、代號格式不合法三條路徑均不觸發。prefetch 失敗不會讓 `addWatch()` 失敗。
- ⚠️ **已知並接受的 RISK-003** — 籌碼補齊寫出的 6 個非最新日報表檔，其 `incomplete` 旗標為 true，會嵌入「歷史資料回補中」註記且永不清除（夜間排程只重寫當日檔）。目前無消費端會讀取指定過去日期的報表（`reportProxy.ts` 只讀 `manifest.ymd`），故無使用者可見影響。語意上該註記亦屬正確——7 天前那份報表的歷史視窗確實只有 1 天資料。
- 🧪 **測試** — 新增 10 個測試（實作前確認紅燈 exit 1）。全套 **85 檔 / 1345 測試通過**，exit 0；`npm run lint`、`npm run typecheck:edge`、`npx tsc --noEmit` 均 exit 0。Reviewer PASS。
- 🔬 **DEV 實測（2026-08-31）** — 以真實使用者 JWT 對自架 DEV 驗證：首次補齊回 `{daysWritten: 7, daysFetchedUpstream: 1}`、1.17 秒，寫出 `20260820`–`20260828` 共 7 個報表檔；第二次同樣呼叫回 `skipped: "already-present"`、0 次抓取、17 毫秒。對外抓取 1 次未觸及上限 2。`manifest.json` 的 `updated_at` 全程未變。產出檔案與排程產生的同日檔案結構一致（schema 3、外資買賣超、融資券、借券齊全）。測試用資料已還原。
- 🔎 **權限閘門的既有行為** — `warm` 沿用 `allowedTwTickers()`（持股 ∪ 觀察清單）。`heldTwTickers()` 只認 `net > 0`，因此已清倉的代號會回 403，需加入觀察清單才可補齊。此為 0.8.0（`cbbdba0`）既有行為，非本版變更。買進路徑順序正確：`WorkspaceContext.tsx` 先 `await addTransactions()` 才 `void prefetchStockData()`，閘門查詢時新部位已存在。
- 📋 **覆蓋缺口** — 本 repo 無 `stock-report/index.ts` action dispatch 的測試骨架，Edge 端 `phase: 'chips'` handler 與 `maxUpstreamDays` 上限僅由 `typecheck:edge` 覆蓋，需手動 DEV 驗證。
- 🚀 **需要 Edge 部署** — 改動含 `sources/supabase/functions/stock-report/index.ts`；`main` 的 push 只部署前端，Edge 必須另外部署，且 `stock-report` 一律帶 `--no-verify-jwt`（該函式以 `CRON_SECRET` 供 pg_cron 呼叫，不走 JWT）。

### 0.9.21（2026-08-27）— 當日大盤面板完善：重新整理按鈕、日期徽章、三大法人側欄、與六項缺陷修復

> 0.9.20 版將統計帶移至走勢圖上方；0.9.21 版針對該面板深度打磨。新增面板專屬重新整理按鈕、日期徽章、法人買賣超側欄，並於審查過程中發現並修正六項缺陷：徽章在五日區間誤讀最舊日期、請求競態覆蓋新資料、失敗請求讓加載狀態卡住、無側欄時仍預留 300px 欄寬、面板重新整理不會更新側欄資料、自營商只到一條腿就當 0 求和。測試全數通過，無 Edge 部署。

- 📅 **加權指數徽章讀取末端日期** — 當日徽章原先取分時序列首點，在五日區間時會誤讀五天前的日期。改為末點（序列遞增、末點最新），無資料時退回純文字「當日」且 `sessionDate` 為 null（避免杜撰交易日）。
- 🔄 **面板重新整理按鈕與請求去重** — 新增頂部重新整理按鈕，以 request ID ref 防護：按鈕觸發的請求更新後會因區間變更被新請求覆蓋。改用 ref 判別該響應是否為最新，只有最新請求允許呼叫 setState，舊響應被靜默忽略。
- 🐛 **失敗請求不再留加載懸浮** — 原先無拒絕處理，按鈕失敗後 `loading` 永遠卡在 true，按鈕禁用且圖示持續轉動。新增 `.catch` 同時運用請求去重，清除加載狀態；刻意不清序列資料，保留上一次成功的數據。
- 🎨 **圖表寬度只在有側欄時保留** — `.tw-index-chart-layout` 預設單欄，只在 `has-aside` 時預留 300px 側欄欄寬。原先無條件保留，導致無法人數據的日子出現 300px 空白柱。
- 👥 **三大法人側欄與聯動重新整理** — 面板新增側欄展示法人買賣超，使用父層 `market.json` 資料。重新整理按鈕改為聯動刷新分時序列與父層市場資料，透過新增 `onRefresh` prop 串接；下方按鈕新增 `aria-label="重新整理台股市場歷史資料"`，兩按鈕可用無障礙工具區分。
- 🤝 **自營商求和條件**（`TwMarketSection.tsx`）— 原先只要 `dealerSelfTwd`、`dealerHedgeTwd` 其中一條腿到位就相加（缺的那腿當 0），違反專案「`—` 代表未出現的值、不猜零」規則。改為兩腿皆到位才求和，否則為 null 並顯示 `—`。
- 🧹 **樣式清理** — 面板根層重複的 inline `padding` 刪除，改由 `.tw-index-today` CSS 規則供給；`TwMarketSection` 的移位圖表區塊重新縮排（空白異動）；區段標題改為「台股市場歷史走勢與成交量」。
- ✅ **審查與測試** — 第一輪 Reviewer FAIL（缺失 `.catch` 與自營商求和風險），重送 builder 修正後第二輪 PASS（唯一提點為新失敗測試的判定應比對統計值而非單純檢查儲存格存在，已修緊）。全套測試 **85 檔 / 1330 測試通過**，exit 0；`npm run lint`（12 個既有警告無新增）、`npm run typecheck:edge`、`npm run build` 均 exit 0。
- 🚀 **不需要 Edge 部署** — 純前端改動，Edge 資料契約完全未變。

### 0.9.20（2026-08-27）— 當日大盤面板版面調整與市場指標整併

> 當日大盤面板版面重構：統計帶從分時走勢圖下方移至上方，刪除重複的區間按鈕，並將市場指標 4 張 KPI 卡片整併進統計帶第二列。統計帶分兩列各自標明數據來源（當日即時 vs. 收盤統計），外資及法人額度於日期不同時標註日期副標籤。相依順序已解除，測試全數通過。

- 🎨 **版面調整**（`TwIndexToday.tsx`）— 統計帶（開盤／最高／最低／昨收／漲跌點數／漲跌幅）從分時走勢圖下方移至上方，調整閱讀順序為標題與當日徽章 → 指數大數字與漲跌 → 統計帶 → 走勢圖，更符合視覺層級。
- 🔘 **刪除重複的區間按鈕** — `TwIndexToday` 原本自繪「1日／5日」區間切換，`IntradayChart` 內部亦有相同功能，0.9.19 上線後同一卡片出現兩排按鈕。移除面板自有按鈕，保留圖表內置區間控制。
- 📊 **市場指標整併進統計帶**（`TwMarketSection.tsx`）— 原下方 4 張 KPI 卡片（成交金額、三大法人買賣超、外資、投信）予以刪除，`.kpi-grid` 整塊移除。加權指數保留為面板上方大數字，成交金額／三大法人買賣超／其中外資三格併入統計帶第二列，沿用既有 `.kpi-label` / `.kpi-value` / `.kpi-sub` 樣式。
- 📅 **區分時間尺度並標示來源** — 統計帶分為上、下兩列，各自明確標示數據來源。第一列「當日」為盤中即時資料（`market/quote.json`），第二列「收盤統計」為最近完整交易日的彙整（`market/daily.json`）。`market/daily.json` 的當日列自收盤後約 90 分鐘始落地，盤中兩者本屬不同天；成交金額格標「`{date}（最近交易日）`」，法人格標「`{instDate} 全市場合計`」——法人金額約 15:00 始補齊，`instDate` 可能比 `date` 早一天。缺法人金額時顯示「尚未補到法人金額」，不印 0。
- 🏷️ **其中外資格標註日期** — 審查指出 `.tw-index-stats` 在 560px 以下降為兩欄，「其中外資」格會換行至獨立一列、失去旁邊法人格的日期脈絡。改進方案：當 `instDate` 與 `date` 不同時，該格副標題改為「`{instDate}・投信 X 億`」，相同時維持原貌不添雜訊。
- 🔗 **解除循環相依**（`utils/formatters.ts`）— `toBillion` / `fmtBillionSigned` / `fmtBillion` 函式從 `TwMarketSection.tsx` 移至通用 `utils/formatters.ts`。原先 `TwIndexToday` 反向 import `TwMarketSection` 形成循環，雖當下能運作，但模組初始化順序是那種「測試通過、換打包路徑才壞、且壞時無聲」的隱患。現移至公共位置解除。
- ✅ **審查與測試** — Reviewer PASS，一個 RISK 於提交前修掉（其中外資格缺日期）。全套測試 **85 檔 / 1319 測試通過**，exit 0；`npm run lint`、`npm run typecheck:edge`、`npm run build` 均 exit 0。
- 🚀 **不需要 Edge 部署** — 純前端改動，`intradayParse.ts` 與 Edge 資料契約完全未變。

### 0.9.19（2026-08-26）— 總體經濟 > 台股 新增「當日大盤」走勢與統計

> 總體經濟 > 台股 頁籤最上方新增「當日大盤」區塊，展示加權指數現價大數字與漲跌、分時走勢圖（1日／5日），以及開盤／最高／最低／昨收／漲跌點數／漲跌幅六格統計。既有的市場指標 KPI、日 K、成交金額圖與兩張表全部維持原狀，排在其下。

- 📊 **當日大盤區塊新增**（`TwIndexToday.tsx`）— 頁籤最上方新增「當日大盤」區塊：加權指數大數字與漲跌、分時走勢圖（1日／5日，複用 `IntradayChart`），以及開盤／最高／最低／昨收／漲跌點數／漲跌幅六格統計。既有的市場指標 KPI、日 K、成交金額圖與兩張表全部維持原狀，排在其下。
- 🔢 **開高低要新增欄位而不是在畫面上算** — 這是整個功能的核心。以 2026-08-26 的真實 `^TWII` 回應實測：用收盤價序列推出的當日最低是 44979.04，Yahoo 自己的 `regularMarketDayLow` 是 44925.84，**差 53.2 點**；第一個收盤價 45044.20 也不是當日開盤 45157.64。因此 `parseYahooChart` 改讀 `quote.open/high/low` 陣列並輸出 `dayOpen/dayHigh/dayLow`，刻意不採用 `meta`。
- 📈 **走勢圖關掉量能副圖** — `IntradayChart` 新增 `showVolume`（預設 true）。Yahoo 對指數完全不給成交量：`meta.regularMarketVolume` 為 0，271 根 bar 每一根都是 0，1d/1m 與 5d/5m 皆然。留著就是一條死帶，所以大盤傳 false。個股報價頁籤不受影響。
- 🏷️ **當日格刻意不放成交金額** — Yahoo 對指數不提供。該數字留在下方 KPI 區並標明是「最近交易日」。這個區分有意義：今天的日線列要收盤後約 90 分鐘才落地（2026-08-26 實測 `asOf` 15:00，收盤 13:30）。
- 🏛️ **Edge 幾乎不用改** — 指數 symbol 本來就通：`SymbolItem.market` 在執行期從未被驗證，`yahooSymbols()` 對非 `TPE` 的 market 原樣回傳 ticker，所以 `^TWII` 一直都能正確送到 Yahoo。這次只把型別聯集與註解擴為 `'IDX'`，執行期零改動。
- ✅ **審查與測試** — Reviewer PASS，一個 RISK 於提交前修掉（漲跌幅格的顏色取自 `pnlClass(change)` 而非 `pnlClass(changePct)`）。全套測試 **85 檔 / 1313 測試通過**，exit 0；`npm run lint`、`npm run typecheck:edge`、`npm run build` 均 exit 0。
- 🚀 **部署** — DEV Edge `stock-price` 已以 volume copy 更新並重建容器，實測確認 `dayLow` 低於序列中每一個收盤價（證明讀的是 OHLC 陣列），且個股路徑 `2330.TW` 的 points/prevClose/interval 與 point 欄位 `t/c/v` 完全未變。

### 0.9.18（2026-08-25）— 庫存總覽持股點選直達個股分析

> 庫存總覽功能優化：使用者可直接在台股持股列表點選任一檔持股列，無縫跳轉進入該檔標的之「個股分析」頁面，省去手動切換頁籤與下拉選單的繁瑣步驟。

- ⚡ **庫存總覽點擊直達**（`DashboardPage.tsx` / `AppShell.tsx`）— 將 `onSelectTicker` 回呼串接至台股持股表（`HoldingsTable`），在滑鼠懸停時提供 `cursor: pointer` 與「點擊查看個股分析」提示文字。
- 🛡️ **美股與離線安全防護** — 美股持股列因個股分析目前專精於台股籌碼與基本面，維持不可點擊狀態避免空資料；本機/離線模式下優雅降級不觸發跳轉。
- 🧪 **單元測試**（`DashboardPage.test.tsx`）— 新增台股點選跳轉、美股隔離、離線防護及空狀態測試，全套測試 **84 檔 / 1295 測試** 100% 通過。

### 0.9.17（2026-08-25）— 個股分析重構：分時走勢圖、Yahoo 頂部報價橫幅、近 2 日法人字卡與面向分頁

> 個股分析頁面全面升級：整合即時分時走勢圖（1日/5日）、Yahoo 頂部報價橫幅、近 2 交易日三大法人動向字卡，並將過往垂直堆疊之 4 張大卡片重構為「行情置頂 + 籌碼/基本/技術 3 面向頁籤」模式，完全移除舊有 PDF 匯出功能。

- 📈 **分時走勢圖與 Yahoo 頂部橫幅**（`QuoteTab.tsx` / `IntradayChart.tsx`）— 新增 Yahoo Finance v8 即時分時資料流（1日 1 分鐘線 / 5日 5 分鐘線，含均價線與即時單量）。股票標題與大價格橫跨頂部 `.quote-top-banner`，下方 8 格統計（開高低、昨收、成交量、均價、振幅）與右欄「我的持股概況」於同一水平基準線頂部對齊。
- 👥 **三大法人買賣超近 2 日動向字卡**（`QuoteTab.tsx`）— 於走勢圖下方新增近 2 交易日法人動向卡片，清晰標示各日合計買賣超張數與「外資／投信／自營商」3 格微型數據，遵循台股紅漲綠跌習慣，並具備 RWD 單欄自動折疊。
- 📑 **面向頁籤化切換**（`StockDetailPage.tsx`）— 行情卡永遠置頂常駐，下方提供 `[籌碼分析] | [基本面] | [技術面]` 頁籤，點選後單獨掛載對應面向內容，大幅縮短頁面長度並降低 DOM 節點負擔。
- 🧹 **完全拔除 PDF 匯出功能** — 徹底清理 `StockDetailPage.tsx` 中下載 PDF 按鈕、狀態與 Promise 綁定，估值指標乾淨收斂至「基本面」面向。
- 🧪 **測試與審查** — 單元與整合測試全數通過（**83 檔 / 1291 測試** 100% PASS）；雙 Reviewer Subagent 代碼審查通過（PASS）。

### 0.9.16（2026-08-25）— 觀察清單搜尋：28,272 筆裡有 27,043 筆是權證

> 兩個症狀同一個根因。台股清單有 28,272 列，其中 6 碼權證 27,043 列、真正的 4 碼上市櫃股票只有 1,094 列，而 `AddWatchModal` 既不排序也不限筆數，直接沿用資料源順序（照代號數字排）。

- 🐛 **輸入代號沒反應** — 打 `2330` 一定會經過只有 `2` 的那一刻，該瞬間命中 **8,115 筆**，`results.map` 要一次產生 8,115 個 `<li>` + `<button>`（約 4 萬個 DOM 節點）且每個按鍵全部重建，瀏覽器卡住並吃掉後續按鍵。名稱搜尋因為第一個字就把範圍砍掉才撐得住。
- 🐛 **權證排在股票前面** — 資料源照代號排，`03xxx` 天生排在 `2454` 前面：搜「聯發科」命中 231 筆，2454 在第 230 位（最後一筆）；搜「台積」命中 960 筆，2330 在第 959 位。
- 🔧 **修法：排序 + 上限**（`AddWatchModal.tsx`）— 比對規則一字未改，改的是命中之後。排序鍵依序為證券種類（`^\d{4}$` → 0；5 碼或 6 碼且 `00` 開頭 → 1；其餘 → 2）、比對品質（代號全等 → 0、代號前綴 → 1、名稱全等 → 2、名稱前綴 → 3、名稱內含 → 4）、代號。權證排最後但仍搜得到。渲染上限 50 筆，超出時在清單下方顯示「還有 N 筆，請輸入更完整的關鍵字」（新樣式 `.watch-results-more`）。
- ✅ **修正後** — 搜「聯發科」第一筆是 2454，搜「台積」第一筆是 2330，打單一數字 `2` 只渲染 50 個節點。
- 🧪 **測試** — `AddWatchModal.test.tsx` 測試夾具改為含 03xxx 權證與 00878 ETF 的 7 列，新增 3 條（權證排序、代號全等優先、50 筆上限與剩餘提示），其中 2 條先紅後綠。全套 `npm test` **81 檔 / 1247 測試** exit 0；`npx tsc --noEmit` exit 0；`npm run build` exit 0。

### 0.9.15（2026-08-25）— 借券從來沒有到位過，因為兩條判準差了一天

> `borrow` 在 PROD 從 2026-08-11 到 08-24 累積 **373 次 tick、126 次命中、0 次到位**。探針每天都正確量到 22:15–22:30 的翻日、每次都觸發 `generate-chips`，然後每次都記下「資料未到位，下輪重試」，把 21:00–23:30 整個時窗打好打滿。原因不在探針，也不在端點：**同一個問題被兩條差一天的判準回答**。快取用 `ymd >= 交易日` 判斷新不新鮮，落地判準 `borrowHit` 要的卻是 `> 交易日`。

- 🐛 **根因**（`index.ts` 的 `readBorrowCacheFrom`）— 借券端點沒有日期參數，永遠回「最新的那份」：盤中自報**當日**額度，收盤後才翻成下一個交易日。當天稍早的一輪 `generate-chips`（由 t86／融資／外資買賣超命中觸發）會把盤中那份以 `ymd=今天` 寫進 `chip_raw_cache`。翻日之後探針命中、再次觸發 `generate-chips`，但 `loadBorrow(todayYmd)` 的 `.gte('ymd', minYmd)` 認定那筆盤中快取仍然新鮮，**端點再也不會被打**，報告的 `sources.borrow.date` 永遠停在今天，`sourceLanded('borrow')` 因此恆為 false。
- 🔍 **證據**（PROD `chip_raw_cache`，dataset `SBL_D`）— 最新一列是 `ymd=20260824`，寫入時間 **08-24 11:00**（更早幾天分別是 09:17／11:00／16:30／16:05／14:30，全部在盤中）。而**沒有任何一列是 `20260825`** —— 翻日後的 payload 從來沒有被抓回來過，連快取都不存在。
- 🔧 **修法：一條規則，不是兩條**（`sourceProbePlan.ts`）— 新增 `borrowCacheUsable(cachedYmd, tradeYmd)`，其實作就是 `borrowHit`，刻意不重寫第二個比較式。`readBorrowCacheFrom` 拿掉 `.gte()`，改成撈最新一列再交給它判斷，快取問題與落地問題從此不可能各自漂移。
- 📉 **順帶省下的請求** — 修好之後借券會在翻日第一輪就到位，再兩輪穩定即退休：今晚那 13 輪重複的 `generate-chips` 會變成 3 輪。
- ⚠️ **殘餘風險** — `index.ts` 是 Deno-only、**沒有任何 vitest 覆蓋**，這一半只有 `typecheck:edge` 與 review 兩道關。純函式那一半有新測試鎖住（含 `borrowCacheUsable` 與 `borrowHit` 的等價表）。
- 🧪 **測試** — 新增 1 條（BUG-037 正案例 + 等價表）。全套 `npm test` **81 檔 / 1244 測試** exit 0；`npm run typecheck:edge` exit 0。reviewer PASS，零 finding。

### 0.9.14（2026-08-25）— MOPS 探針一命中就收工，六個槽點只用掉第一個

> 排程表上寫得清清楚楚：月營收與季報彙整每個平日有 12:00、12:05、17:15、17:20、21:00、21:05 六個槽點。實際上 PROD 的 `mops_profit` 每天只有 **12:00 一筆** tick。原因不在排程，在退休條件：`REQUIRED_LANDED_COUNTS` 給 MOPS 的值是 1，而 MOPS 的到位判準 `atLeast`（檔案期別 ≥ 上游期別）只要檔案已經有那一期就成立 —— 於是當天第一槽必定判定到位並收工，剩下五槽永遠不會跑。而 MOPS 彙整表整天會隨申報家數重出，第一次出表根本不是當天最後一版。

- 🔁 **MOPS 兩源永不退休**（`sourceProbePlan.ts`）— `REQUIRED_LANDED_COUNTS.mops_revenue` 與 `.mops_profit` 改為 `Number.POSITIVE_INFINITY`。`retiredSources()` 比較的是 `counts[id] >= required[id]`，無限大永遠比不過，六個 `MOPS_SLOTS` 因此每個平日全跑。`retiredSources()` 本身、`trailingRun()`、`summariseLandedTicks()`、`sourceLanded()` 一行未動。
- ✅ **六個每日來源維持原規則** — `bfi82u` / `t86` / `bwibbu` / `twt38u` / `margin` / `borrow` 仍是 3：命中 1 次 + 連續 2 次指紋無異動才退休，中途任何一次內容變動就歸零重算。PROD 2026-08-24 實測相符：`t86` 6 ticks / 3 到位、`bwibbu` 6/3、`margin` 7/3、`twt38u` 3/3、`bfi82u` 8/6（雙時段各 3）。
- 📊 **證據**（PROD `source_probe_tick` 2026-08-13～08-24）— `mops_profit` 在 08-17、08-19、08-20、08-21、08-24 都只有 12:00 一筆；08-14 與 08-18 有 3 筆（前兩次命中但未到位才會續探）；08-13 是 4 筆 / 0 到位。DEV 完全一致。
- 🖥️ **戰情室不再謊報收工**（`ProbeWarRoom.tsx`）— MOPS 卡片的分子改成「今日已跑的槽數」、分母 6，狀態只有 `⏳ 待機中` / `🟢 探測中 (n/6 槽)` / `✅ 六槽跑完`，永不出現「退休」「收工」。抬頭統計由「已退休 N 源」改為「收工 N 源」，一個詞同時涵蓋退休與六槽跑完。
- 📖 **機制說明表同步**（`MechanismGuide.tsx`）— MOPS 兩列的退休條件由「1 次到位 (期別 ≥ 上游)」改為「不退休 (六槽全跑)」。
- ⚖️ **刻意接受的代價** — 公布日一次命中會在六個槽點各觸發一次 `generate-history`，而不是只有一次。這在既有量級之內：`borrow` 在 PROD 一天觸發 `generate-chips` 13 次，`bfi82u` 觸發 `sync-market` 6 次。
- 🧪 **測試** — 新增／改寫 6 條（`sourceProbePlan` 3、`ProbeWarRoom` 3、`MechanismGuide` 1）。全套 `npm test` **81 檔 / 1243 測試** exit 0；`npx tsc --noEmit` exit 0；`npx tsc --noEmit -p tsconfig.edge.json` exit 0；`npm run lint` 5 個既有警告，無新增。reviewer PASS，零 finding。

### 0.9.13（2026-08-25）— 一次 401 就讓整天的備份消失

> 每日備份跑到某個帳號時失敗，`backup_run_log` 只留下一行 `[object Object]`。查 `edge_logs` 才看到真正原因：同一個 `Promise.all` 同一毫秒發出的三個請求裡，`GET /rest/v1/workspaces` 被回 **401**，另外兩個都是 200。不是資料問題、不是權限問題，是閘道認證層的一次性拒絕 —— 而程式沒有任何重試，一個請求失敗就讓那個帳號整天沒有備份。

- 🔁 **失敗的帳號會重試**（`backup-transactions/index.ts`）— 整個帳號最多嘗試 3 次，間隔 500ms／1000ms。只有 `status='error'` 才重試；只是清理舊檔失敗（`status='ok'`）不重試，因為檔案已經上傳，重跑也修不好清理。最後仍失敗時，訊息會標注 `(failed N attempts)`。
- 🐛 **錯誤訊息不再是 `[object Object]`**（`backupPlan.ts` 的 `describeError`）— PostgREST 的錯誤是**純物件**不是 `Error`，原本的 `err instanceof Error ? err.message : String(err)` 對它一律產出 `[object Object]`。也就是說，唯一該說明失敗原因的欄位，剛好在最常見的那一類錯誤上必然無效。現在會取出 `message`／`code`／`details`／`hint`，取不到才退回 JSON。
- 👀 **清理舊檔的錯誤不再被畫面吃掉**（`BackupsSection.tsx` 的 `statusLabel`）— 清理失敗是刻意保留 `status='ok'` 的（備份本身已成功），但 `error` 有寫入；而畫面只在 `status==='error'` 時顯示訊息，等於把那段錯誤丟掉。現在 `ok` 帶 `error` 會顯示成「成功（清理舊檔失敗：…）」。
- 🧾 **`backup_run_log` 寫入失敗至少留在函式日誌** — 原本 `insert(row)` 的回傳完全沒檢查，log 掉了會讓那個帳號看起來像「從沒被執行」，方向會被誤導成排程問題。
- ✅ **測試** — 新增 6 條（`describeError` 4、`BackupsSection` 1、既有狀態測試補強）。全套 `npm test` **81 檔 / 1239 測試** exit 0；`npx tsc --noEmit` exit 0；`npx tsc --noEmit -p tsconfig.edge.json` exit 0；`npm run build` exit 0；`npx oxlint` 5 個既有警告，無新增。

### 0.9.12（2026-08-24）— 後台一鍵還原：只補回缺少的資料

> 承 0.9.11 的備份與下載，補上讀備份檔的那一端。管理員在「備份」頁點任一備份檔的「還原」，先看到逐表的預覽（檔案幾筆／已存在幾筆／將新增幾筆），確認後才寫入。

- 🔒 **還原是純新增，永不刪除或覆蓋** — 三張表各自以自己的主鍵（`workspaces`／`transactions` 用 `id`，`user_settings` 用 `user_id`）做 `upsert(..., { ignoreDuplicates: true })`。備份之後才編輯過的資料列會原封不動保留；整條路徑沒有任何 DELETE 或 UPDATE。
- 🛡️ **跨帳號寫入在解析階段就被擋死**（`backupAdmin.ts` 的 `parseBackupDocument`）— 比對的基準 `user_id` 取自**已驗證的物件路徑**，不是取自備份檔本身（取自檔案的話這個檢查會變成循環論證、形同虛設）。文件層的 `user_id` 不符、或**任何一列**的 `user_id` 不符，都在讀寫任何一張表之前中止。
- 👀 **預覽與寫入是兩次呼叫** — `apply !== true` 的分支在碰到任何 insert 之前就回傳；畫面上第一次點「還原」只會預覽，只有「確認還原」會寫入。沒有缺漏時直接說明資料完整並停用確認鈕。
- 🔗 **先父後子** — `workspaces` → `transactions` → `user_settings`。`transactions` 對 `workspaces` 有複合外鍵 `(workspace_id, user_id)`，順序反了會失敗。
- 🧾 **半途失敗要說實話**（`restoreFailureMessage`）— 三張表是三次獨立寫入、之間沒有交易保護，所以可能寫到一半才失敗。原本只回傳一句原始的 Postgres 錯誤，管理員會誤以為什麼都沒發生。現在改回傳「已寫入 workspaces 2 筆、transactions 51 筆，請重新預覽確認目前狀態」。還原本身冪等，重跑即可補完。
- ✅ **測試** — 新增 26 條（`backupAdmin` 12＋4、`adminBackups` 6、`BackupsSection` 8）。全套 `npm test` **81 檔 / 1234 測試** exit 0；`npx tsc --noEmit` exit 0；`npx tsc --noEmit -p tsconfig.edge.json` exit 0；`npx oxlint` 5 個既有警告，無新增。
- 🔬 **DEV 災難演練**（真實刪除後還原）— 刪掉 3 筆指定交易後，預覽準確回報「檔案 62／現存 59／將補回 3」且**未寫入任何資料**（仍 59 筆）；執行還原後回到 62 筆，且**整表 checksum 與刪除前完全相同**（逐欄位一致，不只是筆數對）。重跑預覽回報 0 缺漏（冪等）。竄改測試：改掉文件 `user_id` → `備份檔的帳號與路徑不符`；只改**單一列**的 `user_id` → `備份檔內有不屬於該帳號的資料列`；兩者皆未寫入任何資料，事後確認無汙染列。
- 🚀 **部署** — DEV 與 PROD 皆已部署驗證（2026-08-24）。本版**無 schema 異動**，PROD 只需 `supabase functions deploy stock-report --no-verify-jwt` 一步；`stock-report` 由 v56 → v57、`ezbr_sha256` 確認更換，`verify_jwt` 維持 `false`，`stock-price` 與 `backup-transactions` 雜湊完全未動。PROD 驗證：`admin-backup-restore` 無授權／垃圾憑證皆 401；五種畸形路徑（非 uuid 前綴、單位數月份、第二副檔名、多層目錄、純檔名）全部回 `備份路徑格式不正確`；兩個帳號的唯讀預覽皆回報 `applied=false` 且無缺漏（53/53/0、57/57/0），事後確認 PROD 資料列數未變（110 筆交易、5 個工作區）。**PROD 上未執行任何實際還原。**

### 0.9.11（2026-08-24）— 交易紀錄每日自動備份，與管理者專屬的備份後台

> 兩階段一次交付。第一階段：每日台北時間 02:00，逐一帳號將資料匯出成 JSON 存入**私有** Storage bucket，每個帳號最多保留最近 7 份。第二階段：管理後台新增「備份」頁，列出每個帳號的備份狀況，並提供**只有管理員**能取得的短效下載連結。一般使用者無法下載自己的備份。

#### 第一階段 — 每日備份

- 🗄️ **私有 bucket `backups`**（`sources/supabase/schema.sql` 第 12 節）— 以 `public = false` 建立，且 `ON CONFLICT` 時強制寫回 `false`。**刻意不共用既有 `reports` bucket**：後者是 `public = true` 的公開盤後報表桶，交易紀錄放進去等同對外公開。
- ⏱️ **排程 `backup-daily`** — pg_cron `0 18 * * *`（UTC 18:00 ＝ 台北 02:00），經 `net.http_post` 帶 `x-cron-secret` 呼叫 Edge Function；避開既有盤後報表排程（最晚 21:45）的資源競爭。
- 🧩 **Edge Function `backup-transactions`** — `index.ts` 負責 I/O（cron secret 驗證 → service_role → `listUsers` → 逐帳號查詢／上傳／裁切／寫 log），純邏輯抽到 `backupPlan.ts` 以便單元測試，與 `stock-report` 的模組切分方式一致。
- 📦 **備份內容與路徑** — `backups/{user_id}/{YYYY-MM-DD}.json`，含該帳號的 `workspaces`、`transactions`、`user_settings` **全欄位**（`id`、`created_at` 一併保留，確保能原樣寫回資料庫）。上傳使用 `upsert: true`，同日重跑覆蓋而非報錯。排序固定（交易依 `tx_date` → `id`），使每日檔案可直接 diff。
- 🔁 **保留策略是「留最新 7 份」，不是「刪 7 天前」** — 若排程連續數日失效，後者會把僅存的舊備份一併清光；前者保證任何情況下帳號手上都還有可用備份。`list()` 明確帶 `{ limit: 1000 }`，避免 Storage 預設 100 筆分頁導致裁切永久卡住。
- 📋 **`backup_run_log`** — 每帳號每次執行寫一列（筆數、位元組、物件路徑、裁切數、狀態、錯誤訊息）。啟用 RLS 且**只有** `app_metadata.role = 'admin'` 可 SELECT，無 INSERT policy（僅 service_role 寫入），沿用 `app_settings` 既有的管理者判定式。
- 🛡️ **單一帳號失敗不中斷整批** — 該帳號記為 `status = 'error'` 後繼續下一個，回應仍為 200 並附 `failed` 計數；裁切失敗只記入該列 `error`，不影響已成功的備份本身。

#### 第二階段 — 管理者備份後台

- 🧭 **推翻 Task 130 的「新建一支 Edge Function」設計** — 本專案所有管理功能一律走既有 `stock-report` 的 `body.action`，由該函式內的 `assertAdmin` 把關（`adminStatus.ts`、`adminUsers.ts` 皆然）。另開一支函式等於多一個 PROD 部署目標，其 `verify_jwt` 設定會各自漂移，卻換不到任何好處。改為新增 `admin-backups`、`admin-backup-url` 兩個 action。
- 🔐 **路徑驗證就是防穿越的閘門**（`sources/supabase/functions/stock-report/backupAdmin.ts`）— `createSignedUrl` 會對送進去的任何路徑簽名，所以未驗證的路徑等同任意物件讀取。`isValidBackupPath` 只放行 `<uuid>/<YYYY-MM-DD>.json` 的完整比對，`..`、絕對路徑、多層目錄、第二副檔名、尾端換行一律拒絕，且在碰到 Storage **之前**就擋下。
- 🖥️ **管理後台第六頁「備份」**（`sources/src/components/Admin/BackupsSection.tsx`）— 每個帳號一列，顯示備份份數、最新備份日、總大小與最近一次執行狀態（失敗時直接帶出錯誤訊息）；展開該列列出所有備份檔，各自有下載按鈕。沒有備份的帳號一樣列出，不會捏造日期。**未新增任何 CSS**，全部沿用既有 `adm-*` / `data-table` 樣式。
- ⏳ **下載連結是 60 秒短效簽名網址** — 不在瀏覽器暴露 service role，也不產生永久公開網址；bucket 維持私有，未新增任何 Storage RLS policy。畫面明寫連結短效且僅管理員可取得。
- 🌐 **簽名網址改回傳相對路徑** — Edge Function 的 client 建立自**容器內部**的 `SUPABASE_URL`，自架環境下 `createSignedUrl` 會吐出 `http://kong:8000/...` 這種瀏覽器無法解析的主機名。改由後端回傳 root-relative 路徑，前端用它已知的公開網址組合。此問題單元測試抓不到，是 DEV 實機驗證時才浮現。

#### 一併修正

- ⏲️ **RISK-001：探針迴圈補上預算檢查**（`sources/supabase/functions/stock-report/probeRound.ts`）— 原本只有抓取迴圈有預算判斷，探測迴圈完全沒有；三個時窗在 17:00 重疊、四個來源排在 17:15/17:20，每次抓取各帶 10 秒逾時，最壞情況會讓函式在迴圈中間被 60 秒上限砍掉，後面的來源**無聲消失**。新增選填的 `probeDeadline`（`PROBE_BUDGET_MS = 30_000`）與 `deferred` 結果欄位：預算用完就不再開新來源，已開始的那一支絕不中斷。`deferred`（沒輪到）與 `skipped`（今天已收工）語意分開；不給 `probeDeadline` 時行為完全不變。此修正**不採用**當初被否決的替代方案（把 `twt38u` 移出探針）。

#### 驗證

- ✅ **測試** — 新增四個測試檔：`backupPlan.test.ts` 17 條、`backupAdmin.test.ts` 13 條、`adminBackups.test.ts` 12 條、`BackupsSection.test.tsx` 9 條，另於 `probeRound.test.ts` 增補 5 條（該檔 13 → 18）。全套 `npm test` 由 0.9.10 的 77 檔 / 1147 測試成長為 **81 檔 / 1204 測試**，exit 0、無 Errors 行；`npx tsc --noEmit` exit 0；`npx tsc --noEmit -p tsconfig.edge.json` exit 0；`npx oxlint` 5 個既有 only-export-components 警告，無新增。
- 🔬 **DEV 實機驗證**（自架環境）— 認證四路徑（無密鑰 401／錯密鑰 401／GET 405／正確 POST 200）；實跑回 `{"accounts":1,"ok":1,"failed":0}`，log 記錄的 62 交易／2 工作區與資料表完全相符，記錄的位元組數與 Storage 物件大小一致；保留裁切以 8 個假舊檔加 1 個誘餌實測，留最新 7、刪最舊 2、誘餌未被碰、當日檔 upsert 不重複；管理端以真實 admin JWT 取得清單，五種惡意路徑全部 400，簽名網址下載回 200 / 20510 bytes 且竄改簽名回 400；RLS 實證：anon 讀 `backup_run_log` 回 `[]`、公開 URL 取備份檔回 400、anon 列舉 bucket 回 `[]`。
- ⚠️ **已知限制**（皆為刻意取捨，非缺陷）— `listUsers` 上限 1000 帳號，沿用 `stock-report/index.ts` 既有做法，超過須改分頁；`backup_run_log` 寫入失敗不重試；本版不含還原流程，備份檔格式保證可原樣寫回，但沒有自動還原的介面。

#### 部署

- 🚀 **DEV 與 PROD 皆已部署並驗證完畢**（2026-08-24）。PROD（`kxnxadaghidwumqsqneu`）執行內容：schema 第 12 節（`backups` bucket `public=false`、`backup_run_log` + admin-only RLS、`run_date` 索引、`backup-daily` cron `0 18 * * *`）、`supabase functions deploy backup-transactions --no-verify-jwt`、`supabase functions deploy stock-report --no-verify-jwt`。兩支函式的 `verify_jwt` 皆確認為 `false`，`ezbr_sha256` 亦確認為新雜湊（版本號本身不算證據）；`stock-price` 未受影響，維持 `verify_jwt=true`。
- 🔑 **cron 的 `x-cron-secret` 由資料庫端自既有 job 抽出後直接組進新指令**，明文未經過任何用戶端，也未寫入任何檔案。
- 🔬 **PROD 實機驗證** — 認證路徑：無密鑰 401／錯密鑰 401／GET 405；`admin-backups`、`admin-backup-url` 無授權皆 401。由資料庫端觸發一次實跑後，兩個帳號皆 `status = ok`，記錄的 57 + 53 = **110 筆交易**、4 + 1 = **5 個工作區**，與部署前盤點的資料表計數完全相符；Storage 兩個物件路徑格式正確、`application/json`、大小與 log 記錄的位元組數一致。存取控制實證：公開 URL 取備份檔回 **400**，anon 讀 `backup_run_log` 回 `[]`、anon 列舉 bucket 回 `[]`，而 `transactions` 端點仍正常回 200（RLS 未誤傷正常功能）。
- 📅 **首次自動排程** — `backup-daily` 於每日台北 02:00 執行。

### 0.9.10（2026-08-24）— 個股分析選單重新納入觀察股票：持股／觀察分組

> 推翻 `watchlist-ux-overhaul` spec 的「選單只列持股」決定。0.9.0 起觀察中的股票只能從「觀察股票」籤標進入，0.9.9 移除該籤標後改由儀表板 WatchSection 導航，但「切換個股」選單始終看不到觀察標的。本版把觀察分組加回選單。

- 🔁 **推翻既有設計決定**（`docs/agent/specs/watchlist-ux-overhaul.md`）— 該 spec 明文記載「Stock picker: holdings only，觀察分組自下拉移除」，並於 `f106f43` 實作。本版依使用者要求反轉，spec 已附加 Revision 段落註明不得回退，避免後續依舊 spec 再次移除。
- 🎯 **選單分組**（`sources/src/components/StockDetail/AnalysisPage.tsx`）— 「切換個股」下拉改為 `持股` 與 `觀察` 兩段，各自帶標題、之間一條分隔線；任一組為空則整組（含標題）不渲染。樣式沿用既有 `.hmenu-head` / `.hmenu-sep` 通用類別，**CSS 零新增**。
- ♻️ **資料流本來就齊備，只補渲染** — `listWatchlist()` 載入與重載、`Entry` union 的 `kind: 'watch'`、觀察股單檔報價 `fetchPrices([{ market: 'TPE', ticker }])`、選取解析與 fallback 鏈皆已存在，唯一缺口是選單只映射 `holdingEntries`。本版新增 `watchEntries` 一份清單，同時供選單、`watchByTicker()` 與 fallback 使用，並移除重複的 `firstWatchEntry` 建構。
- 🔒 **去重語意不變** — 同一檔同時在持股與觀察名單時只出現一次，且走持股路徑（帶股數、成本、`useStockPrices` 報價）；`heldTickers` / `availableWatch` 邏輯未動。選單維持台股 only（TWSE 盤後籌碼只涵蓋上市台股）。
- 📊 **測試** — `AnalysisPage.test.tsx` 改寫「下拉只列持股，不再有觀察分組」為「下拉分組列出持股與觀察，持股在前」，並新增兩測案：持股與觀察重複時選單只出現一次且算持股、從選單點觀察股後不帶持股且顯示單檔報價。其中 2 條先紅後綠。
- ✅ **測試驗證** — `npx vitest run` 77 檔 / **1147 測試** exit 0、無 Errors 行；`npx tsc --noEmit` exit 0；`npm run typecheck:edge` exit 0；`npm run build` ok；`npx oxlint` 5 個既有 only-export-components 警告，無新增。
- 🔍 **調查併記：證交所沒有 ETF 成分股 API**（Task 129，本版不實作）— `openapi.twse.com.tw/v1` 全站僅兩支 ETF 端點：`/opendata/t187ap47_L`（基金基本資料彙總表）與 `/ETFReport/ETFRank`（定期定額戶數月報），皆無持股明細；每日 PCF 依規定由各投信自行公布，證交所 ETF 專區只導向發行人網站。候選來源與代價已記於 `TASK.md`。
- 🚀 **部署** — 本版無 `sources/supabase/functions/` 異動，**不需部署 Edge Function**；前端部署已停用。

### 0.9.9（2026-08-24）— 觀察清單重新配置到儀表板：雙視圖、容量追蹤、個股導航

> 設計翻轉：承 0.9.0 在個股分析第四籤置放觀察清單後，本版將其移回儀表板（庫存總覽下方新增 WatchSection），移除個股分析的「觀察股票」籤標。新增卡片/列表雙視圖切換（localStorage 記憶切換狀態），容量徽章 N/30，實時股價與漲跌百分比（色碼紅綠），加入按鈕開啟新增觀察對話框，各條目點擊導航至個股分析。

- 📍 **設計決策**（Task 116 完稿）— 觀察清單初稿置於庫存總覽（0.9.0 開發期間遭駁回）、改置個股分析第四籤（0.9.0 發布版本）、今移至儀表板 WatchSection（0.9.9）。本版確認最終配置：儀表板為主要進入點，個股分析專注三核心籤標（分析內容 / 損益試算 / AI 分析），「觀察股票」籤標予以移除。
- 🎨 **儀表板 WatchSection 實現**（新檔 `WatchSection.tsx`）— 自動排版卡片網格（最小 230px，auto-fill）；卡片顯示股代 / 股名 / 現價 / 漲跌%（紅漲綠跌色碼）；容量徽章 N/30；點擊卡片導至個股分析；× 按鈕快速移除；卡片 hover 時柔和提升。圖卡/條列雙視圖可在工具列切換；CSS 新增三個類別（`.watchlist-card-grid`、`.watchlist-card`、`.view-toggle-group`），合計~117 行新增於 `sources/src/index.css`。
- 🔄 **雙視圖切換與持久化**（localStorage）— 工具列新增「圖卡/條列」切換按鈕（Material pill 樣式，active 狀態用 accent-strong）；使用者選擇在 localStorage 記憶，下次造訪恢復上次選項；無新元件庫、CSS 自寫。
- 🔌 **組件連接**（`AppShell.tsx` 新增 `analysisTicker` 狀態）— `DashboardPage` 的 `onSelectTicker` 回呼設定 `analysisTicker` 並切換檢視至 analysis；`AnalysisPage` 新增 `initialTicker` prop 接收初值；`StockDetailPage` 保留 `onSelectTicker` / `onWatchlistChanged` props 為 API 相容性（籤標已移除，prop 呼叫端不變）。
- 🧹 **籤標移除後清除死碼** — 0.9.0 把 `WatchSection.tsx` 移至 `StockDetail/WatchTab.tsx`，0.9.9 移除該籤標但未刪檔案。`WatchTab.tsx` 與 `WatchTab.test.tsx`（13 測案）已刪除，`AnalysisPage.tsx:35` 的過時註解已更新。CSS 純粹用既有通用類別，無新增。
- 📊 **測試涵蓋**（`WatchSection.test.tsx`）— 10 測案：空列表、容量徽章、批量股價取得、卡片預設渲染（價格/% /色碼）、視圖模式切換 + localStorage 記憶、卡片點擊觸發 `onSelectTicker`、列表列點擊觸發 `onSelectTicker`、刪除流程（`removeWatch` + 重載 + `onChanged`）、容量已滿 30/30（新增按鈕禁用 + 提示）、新增按鈕開啟 `AddWatchModal`。`StockDetailPage.test.tsx` 適配三籤版面。
- 📐 **設計文件**（已備妥）— `docs/architecture/watchlist_dashboard_redesign.md` (含 .html) 與 `docs/architecture/watchlist_6_design_variants.md` (含 .html) 記錄設計過程與三個未實現變體（Sparkline 7 日趨勢、機構籌碼晶片、日內高低區間條）。本版發運基礎卡片（股代 / 股名 / 價格 / % 變化）；三個進階變體保留為後續版本設計成果。
- ✅ **測試驗證** — `npx vitest run` 77 檔 / **1145 測試** exit 0、無 Errors 行（0.9.8 為 77 檔 / 1148）；`npx tsc --noEmit` exit 0；`npm run typecheck:edge` exit 0；`npm run build` ok；`npx oxlint` exit 0（5 個既有 only-export-components 警告）。
- 🚀 **部署** — 本版無 `sources/supabase/functions/` 異動，**不需部署 Edge Function**；前端部署已停用。

### 0.9.8（2026-08-24）— 全專案體檢：測試閘門轉綠、網路等待全面設上限

> 本次為專案完整體檢：測試閘門修復（exit 0）、Edge Function 與前端 service 呼叫逾時全面設上限、非同步 effect 錯誤處理補齊，及損益、效能、建置三個面向的修正。

- 🧪 **測試閘門修復（P0）** — `npx vitest run` exit 1 但摘要顯示「1136 passed」。根本原因：`AnalysisPage.whatif.test.tsx` 的 `warmStockCore` 與 `warmStockHistory` mock 回傳 `undefined` 而非 `WarmResult`；`StockDetailPage.tsx:233` 讀 `core.ok` 在無 catch 的 async IIFE 內拋錯，逸出成 unhandled rejection（vitest 另計在 `Errors` 行）。修正後 77 檔 / 1148 測試 exit 0、無 unhandled rejection。
- 🕐 **Edge Function 抓取逾時（P1）** — 11 個 fetch 中 5 個無上限，含 `twChips.ts` 的共用 `fetchJson`（夜間籌碼批次與所有探針 follow-up 都走這條）。補上 `AbortSignal.timeout`（`fetchJson` 15 秒、`stock-price` 四處各 10 秒）。`fetchJson` 的 10 個呼叫端本來就都在 try/catch 內把例外當「來源不可用」降級，因此無新例外傳播、只是等待不再無上限。收斂 RISK-001 的觸發面。
- 🌐 **前端 Edge 呼叫逾時（P2）** — `supabase.functions.invoke` 無預設逾時，Edge Function 卡住時畫面無限轉圈。10 個呼叫點全補 `timeout`，數值對齊伺服器自身預算（warm 45 秒對 `WARM_BUDGET_MS` 30 秒、adminRun 150 秒對 `GENERATE_ALL_BUDGET_MS` 110 秒）。新增契約測試掃描所有 service，缺一即失敗。
- ⚡ **非同步 effect 錯誤處理（P2）** — `StockDetailPage`、`AiTab`、`useDailySeries` 共四個 useEffect 內的 async IIFE 無 catch，拒絕會讓載入狀態卡死。已補上；屬防禦縱深——現況各 service 都自行吞錯回傳 sentinel，尚無法觸發。
- 💰 **損益與效能（P3）** — `breakEvenPrice` 無解時改回傳 `0` 哨兵值；`FeeInput` 補 SELL 契約說明（須提供 `taxRate` 或 `ticker`，否則靜默套用 0.3% 一般股稅率）；`WorkspaceContext` 交易時不再重複計算整份 ledger；`pnlEngine` 交易排序改用字串比較取代 `localeCompare`；`timeline.ts` 七處 `+ 8` 時區換算抽成具名常數。
- 🔧 **建置修正** — 契約測試原本使用 `node:fs`，但 `tsconfig.app.json` 只帶 `vite/client` 型別，讓 `tsc -b` 失敗（vitest 因 esbuild 不做型別檢查而照樣通過）。改用 Vite 的 `import.meta.glob` raw 匯入。
- ✅ **測試驗證** — `npx vitest run` 77 檔 / 1148 測試 exit 0；`npx tsc --noEmit` 與 `npm run typecheck:edge` 乾淨；`npm run build` 通過。
- 🚀 **部署** — 本版的 Edge Function 修正（`stock-price`、`stock-report/twChips`）需另行部署 Edge Function 才會生效；前端部署已停用。

### 0.9.7（2026-08-20）— 外資買賣超指紋改為雜湊

> 承 0.9.6 的「已知但未修」。`twt38u`（外資及陸資買賣超）的內容指紋回傳的是整份表接起來的**原文**
> 而非雜湊，實測約 10KB／列。這一欄會被寫進兩個地方，所以成本是雙份的。

- 🗜️ **`foreignTopFingerprint()` 改為回傳雜湊** — 原本把 buyTop／sellTop 每一格用 U+001F 接成一長串後直接回傳。該值同時寫入 `source_probe_tick.fingerprint`（每一輪探測一列）與 Storage 的 `market/foreign_top50.json`（當作該檔的冪等鍵），因此原文形式是雙倍成本，也與其他所有來源的 `<長度>:<djb2>` 短格式不一致。改為在 join 之後過 `pollPlan.ts` 的 `fingerprint()`。U+001F 分隔仍在 join 階段生效，AUDIT-04 的黏合碰撞不會復活。
- 🧪 **測試改為行為驗證** — 舊測試直接斷言指紋字串「含有 U+001F」，雜湊化之後分隔符不再看得見。改成斷言 `['12','3']` 與 `['1','23']` 兩筆必須得到不同指紋（真正要守的性質），並新增一項斷言指紋為短雜湊格式。`npx vitest run supabase/functions/stock-report/` 366 項全通；`npm test` 75 檔 1136 項全通；`npx tsc --noEmit` 與 `npm run typecheck:edge` 乾淨。
- ♻️ **一次性副作用（預期內）** — 格式改變會讓 `market/foreign_top50.json` 既有的舊格式指紋在部署後第一次比對時判為「已變動」，因而多上傳一次。之後自癒。`source_probe_tick` 只在當日視窗內比對，隔日重新開始，不受影響。
- 🚀 **部署** — DEV Edge 與 **PROD Edge 皆已部署**。PROD 以 `supabase functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt` 自 `main` @ `9db87d3` 推送，`ezbr_sha256` 由 `420050a1…` 變為 `f776a7a0…`（依 `supabase-ops` 規則以雜湊為證，不看版號），`verify_jwt` 維持 `false`。

### 0.9.6（2026-08-20）— 探針退休判準修正：融資指紋失效、判準改為尾端連續

> **這一版修的是「探針太早收工」**。盤後探針每 5 分鐘問一次上游，滿足退休條件後當天就不再問。
> 兩個缺陷讓它比預期更早關門：融資融券的內容指紋是一個常數，等於完全沒有把關；而通用判準
> 只讀最後兩筆指紋，把中間每一次改版的證據都丟掉。兩項皆已斷根。

- 🔧 **融資融券指紋恆為常數（BUG-033）** — `probeSource` 的 `margin` 分支讀 `(resp as { data?: unknown[] }).data`，但 `MarginDatedResponse` 沒有頂層 `data`，列在 `tables[]` 底下。`fingerprint(undefined)` 因此每一輪都回傳空字串的指紋 `0:45h`（DEV 20260818、20260819 全部的 margin 列都是這個值）。後果：內容穩定度判準拿 `0:45h` 比對 `0:45h`，恆為「已穩定」，等同沒有把關；`rows` 也永遠是 null。修法為在 `twChips.ts` 新增 `marginDatedFingerprint()`，建立在既有的 `marginTable()` 與 `pollPlan.ts` 的 `rowsFingerprint` 之上，因此列序變動不算改版、大盤合計表 `tables[0]` 不影響結果；`index.ts` 改用它，`rows` 改報真實的逐股列數。
- 📊 **退休判準改為「尾端連續相同指紋」** — 舊判準是「到位總次數 ≥ `REQUIRED_LANDED_COUNTS[id]` 且（該來源不要求內容穩定，或最後兩筆指紋相同）」，有兩個洞：`A → B → B` 就退休，但 `A → B` 剛剛才證明上游還在改；而 `contentSettled` 只讀最後兩筆，更早的改版證據完全不看。新判準把 `counts[id]` 改成**尾端連續相同指紋的長度**（新增 `trailingRun`），`retiredSources` 只需比對 `counts[id] >= required[id]`——任何一次內容變動都把計數歸零重新累積。`REQUIRE_SETTLED_CONTENT` 與 `contentSettled` 一併刪除：MOPS 兩源只需連續 1 次，天生滿足，舊的「一到位就退休」行為原樣保留。
- 📈 **次數維持 3（每日來源）／ 1（MOPS），這是實測後的決定** — 原本考慮把每日來源從 3 提到 4，實測後放棄。DEV `batch_run_log` 2026-08-12～08-19 顯示 T86 **一天最多改版一次**，且改版落在 17:00–20:45 之間，在 t86 探針視窗（16:00–17:00）**之外**——提高次數攔不到它，只會多打無效請求。這同時推翻了原始碼註解宣稱的「T86 每 15 分鐘改一次」。那次改版實際上由後續其他來源的 follow-up 接住：每一次 chips 執行都會重抓 T86 並經 `nextT86State` 重設 `t86_frozen`（`index.ts:2911`），而 `decideSkip` 要到借券翻日（約 22:15）才會短路。
- ✅ **測試** — `npx vitest run supabase/functions/stock-report/` 365 項全通；`npm test` 75 檔 1135 項全通；`npx tsc --noEmit` 與 `npm run typecheck:edge` 皆乾淨。`AnalysisPage.whatif.test.tsx` 有 2 項既有的 unhandled rejection（`warmStockCore` mock 回傳 undefined），與本次變更的檔案無關。
- 🚀 **部署** — DEV Edge 以 volume copy 部署並重建 functions 容器，`diff -rq` 無差異；**PROD Edge 已隨 0.9.7 一併部署**（同一份 bundle，`ezbr_sha256` `f776a7a0…`）。前端部署已停用；Edge Function 部署為獨立的動作。
- ✅ **DEV 端對端驗證（2026-08-20 20:45–21:00）** — `margin` 於 20:45／20:50／20:55 連續三輪到位且指紋皆為 `174457:1s4vqtw`，21:00 那輪不再出現 margin 列，即退休生效。同時證明 BUG-033 已修：指紋是真雜湊而非 `0:45h`，`rows` 回報 1295 而非 null。
- ⚠️ **已知但未修** — `twt38u` 的 `fingerprint` 存的是整份表的原文而非雜湊（約 10KB／列），與其他來源不一致，會撐大 `source_probe_tick`。本次未動，已於 **0.9.7** 修正。
- ⚙️ **未改動** — `REQUIRED_LANDED_COUNTS` 的值、`DAILY_WINDOWS`、`MOPS_SLOTS`、`PROBE_FOLLOW_UP`、`sourceLanded`、`probeRound.ts`；前端完全未動。

### 0.9.5（2026-08-20）— 損益試算成本基數精確度修正：舍入、費用、透明標籤

> **精確性修正**：損益試算分頁對比庫存總覽真實台股部位發現三項缺陷，皆已修正。買進價舍入達到經紀商級精度（104.225 → 104.23）；買進費用不再由工作區設定重算；帳單標籤明確標示成本基數與實付手續費。

- 💰 **買進價舍入精確度** — `0.9.4` 時庫存總覽用 `fmtPrice`（Intl, 四捨五入）舍入為 104.23，損益試算用 `.toFixed(2)` 得 104.22；源因：`416900 / 4000 = 104.225` 其二進制值為 `104.224999999999994`。新增 `roundPrice()` 輔助函式（`sources/src/utils/formatters.ts`，`Math.round((value + Number.EPSILON) * 100) / 100`），供種子與階梯共用；`sellLadder()` 內之舊 `snap` 函式已改用 `roundPrice`。測試覆蓋 0.145 / 1.005 / 104.225 / 8888.885 / 12345.675 等二進制陷阱值。
- 🔧 **買進費用不再重新計算** — `0.9.4` 雖改用無費均價種子，但 `whatIf()` 仍以工作區設定費率重算手續費，導致實測玉山 0050 部位相差 NT$2（真實 592 vs 試算 594）。`whatIf()` 新增選填 `buyFee` 覆寫；`WhatIfTab` 供入實付手續費（`(avgCost - rawAvgCost) * shares`），使投入成本與損益完全與庫存總覽同步（−3,298 元精度相等）。編輯買進價時回到工作區費率；觸發條件已加嚴（`buyFee` 不為正數時作 0）。
- 📊 **帳單標籤與透明性** — 買進側現標示「成交均價（未含費）」與「實付手續費」，hint 說明來源；賣出側顯示「現價」；用戶清楚知道每個數字來自何處。
- ✅ **測試** — `npx vitest run` 75 檔 / **1127 項全通**；`npx tsc --noEmit` 0 errors；`npx oxlint src` 0 errors（5 個既有 only-export-components 警告）；`npm run build` ok。新測試檔 `sources/src/utils/formatters.test.ts`；`whatIf.test.ts` 與 `WhatIfTab.test.tsx` 新增舍入、費用覆寫、投入成本對等、編輯後費率、標籤等測案。
- 🔗 **損益試算鏈路測試** — `AnalysisPage.test.tsx` 原本把 `StockDetailPage` 整個 mock 掉，損益試算 props 鏈（持股 → `StockDetailPage` → `WhatIfTab`）完全沒有覆蓋。新增 `sources/src/components/StockDetail/AnalysisPage.whatif.test.tsx` (jsdom)，以真實持股（4,000 shares @ 104.3730 avgCost, quote 103.80）對比規格位置，驗證 買進價格 104.23 / 投入成本 417,492 / 損益 −3,298。
- 🌐 **損益試算瀏覽器驗證** — 新增 `sources/scripts/verify-whatif-e2e.cjs` (Playwright)，以瀏覽器交叉比對損益試算分頁與庫存總覽（賣出價 = 現價時，投入成本與損益必須相等），不寫死數字，帳密只從環境變數讀取。用法見 `docs/UnitTests/E2E.md`。
- 📝 **規格與評審** — Task 124、`docs/agent/specs/124-whatif-real-cost-basis.md`。`route:reviewer` **PASS**，三項 RISK 已修（snap 改用 `roundPrice`、workspace 切換重種、`buyFee` 嚴格非正數檢查）；規格 `roundPrice` 公式已更正（舊公式對 0.145 返回 0.14，誤）。
- ⚙️ **未改動** — `pnlEngine.ts`、`fees.ts`、庫存總覽、年度報告、Edge；前端專用。

### 0.9.4（2026-08-20）— BUG-032 修正：買進費用重複計算

> **缺陷修正**：損益試算分頁持股預設買進價改用未含手續費的成交均價，手續費改為僅計算一次，使投入成本與回本列座標精確。

- 🔧 **費用計算修正** — `WhatIfTab` 持股預設買進價從費含平均成本（`avgCost`）改為費用獨立平均成本（`rawAvgCost`，計為 `pos.rawCost / pos.qty`，其中 `pos.rawCost` 僅累計 `tx.price × tx.qty`，未含手續費）；`whatIf()` 函式由此只計算一次手續費，解除重複計算（原先虛高 ~0.14%，實測 NT$3M 2330 持股多計 NT$4,276）。`WhatIfTab.tsx` 入參重新命名為 `rawAvgCost: number | null`；`StockDetailPage.tsx` 與 `AnalysisPage.tsx` 經由新入參轉發；測試新增兩組（驗證費用精確度與提示文字）。
- ✅ **測試** — `npx vitest run` 73 檔 / **1113 項全通**；`npx tsc --noEmit` 0 errors；`npx oxlint src` 0 errors（5 個既有 only-export-components 警告）；`npm run build` ok。複審：`route:reviewer` **PASS**，零缺陷。
- 📝 **規格** — Task 123、`docs/agent/specs/123-bug032-raw-avg-cost.md`。
- ⚙️ **未改動** — `whatIf()` 簽名及演算法、庫存總覽、`pnlEngine.ts`、`fees.ts`、報告 Edge payload 型別；純前端修正。

### 0.9.3（2026-08-20）— 賣出階梯均價錨點與現價聚簇：損益試算分頁 UI 精化完稿

> **功能擴張**：賣出階梯以持有均價為錨點（±10% 九檔 2.5%），現價偏離時另成聚簇（±2.5%/±5%/±7.5%）；兩簇間分隔列隔開；階梯上方摘要列（現價/均價/回本）可點擊帶入賣出價。觀察股票加入對話框改為 Material 風格，自寫 CSS 無新元件庫。中途試驗「聯集窗口 + 漂亮價格格線」因使用者回報版面不穩而移除，改用固定窗口搭現價簇。

- 📍 **賣出階梯均價錨點**（Task 119）— `sellLadder()` 新增可選 `marks` 參數（`{ currentPrice?, avgCost? }`），所有九檔改為 `kind: 'step'`；現價/回本/均價標記列動態插入（視窗內才出現）；新增 `LadderKind: 'avgCost'`；優先級 `current:3 > avgCost:2 > breakEven:1 > step:0`；所有標記價格舍入至 0.01 格點。`WhatIfTab` 錨點改為持有均價（設定且 > 0），標題與相對欄隨之切換；`LADDER_TAG` 新增 `avgCost: '均價'`。
- 💹 **階梯二分群與聚簇設計**（Task 122）— 主階梯固定「持有均價 ±10%」；現價超出時另成聚簇（±2.5% / ±5% / ±7.5% 共七列），落回主窗口者丟棄；兩簇間插 `whatif-ladder-gap` 分隔列（非價格、非可點、`colSpan={5}`）。`LadderRow` 新增 `group: 'anchor' | 'quote'`。標題回到「賣出階梯 · 持有均價 ±10%」或「賣出階梯 · 現價 ±10%」；摘要列（現價／均價／回本）各顯示價格、相對均價 %、該價賣出的損益，可點擊帶入賣出價。觀察股（無持股）行為與 0.9.1 完全相同。
- 🎨 **加入觀察股票 Modal 改為 Material 觀感**（Task 120）— `.watch-results` / `.watch-result-item` / `.watch-result-symbol` / `.watch-result-name` 新類別，沿用 `.suggestion-item` 視覺語言；48px 觸控高度、focus 重點色底線、modal 疊層陰影（`var(--shadow-card)`），僅用既有 custom property（`--accent`、`--accent-strong`、`--ink-secondary`、`--border`、`--shadow-card`），無新色彩字面值。刻意省略市場標籤（本表每列皆台股）。
- 🔧 **設計迭代與取捨記錄** — 中途試驗「聯集窗口 + 漂亮價格格線」（dev.2，Task 121）：動態窗口涵蓋均價與現價、級距改為 1/2/2.5/5/10 × 10^k、摘要列新增價格/相對%/損益。Reviewer 發現兩項 FAIL 皆在提交前修正（標記舍入為 0.01、標題由實際渲染推導）。使用者回報均價與現價差太多時版面跑掉，故全段移除聯集窗與漂亮格線，改為固定窗口搭現價簇（dev.3 消除 `stepSize`、`STEP_MULTIPLIERS` 等死碼）。此取捨說明了最終方案為何選了固定窗加現價簇而非動態設計。
- ✅ **測試** — `npx vitest run` 73 檔 / **1111 項全通**；`npx tsc --noEmit` 0 errors；`npx oxlint src` 0 errors (5 個既有 only-export-components 警告)；`npm run build` ok。
- ⚠️ **已知議題（保留 OPEN bug）** — 均價為含費平均成本，而 `whatIf()` 又加一次手續費（重複計算），致回本列坐標高 ~0.14%；錨點改為均價後更顯著；需用戶決策（改用原價或不加手續費），非本次範圍。
- 📝 **參考規格** — Task 119、Task 120、Task 121、Task 122、`docs/agent/specs/119-ladder-anchor-avgcost.md`、`121-ladder-union-window.md`、`122-ladder-quote-cluster.md`。
- ⚙️ **未改動** — 無 schema、無 Edge、無 migration。前端專用。

### 0.9.2（2026-08-20）— 損益試算賣出階梯列序反轉：由高而低

> **視覺直觀性**：賣出階梯前按升序排列（−10% 置頂），現改為降序（+10% 置頂），依現價由高至低排列，讀序更直觀。無算法變更；純前端排序反轉。

- 📍 **階梯列序反轉為降序**：`sources/src/components/StockDetail/whatIf.ts:116` `sellLadder()` 終局排序改為 `rows.sort((a, b) => b.price - a.price)`；JSDoc 更新說明列序為高價優先。
- 🔄 **測試調適**：`whatIf.test.ts` 與 `WhatIfTab.test.tsx` 預期值與排序斷言反轉對應。
- ✅ **測試** — `npx vitest run` 73 檔 / **1090 項全通**；`npx tsc --noEmit` 0 errors；`npx oxlint src` 0 errors；`npm run build` ok。


### 0.9.1（2026-08-20）— 損益試算分頁重構：賣出階梯與三欄對帳單，觀察股票卡片風格

> **功能擴張與視覺一致**：0.9.0 後經試算 UX 一輪迭代，先簡化至四數字（損益/報酬率）與卡片風格，復以賣出階梯與對帳單擴張詳情，最後修正對帳單版面對齊。成果：損益試算分頁為卡片化籤頁，含可點選賣出階梯（-10%~+10% 九檔 + 自動回本價）與三欄共用列對帳單（買進/賣出/結算）；觀察股票籤頁同格卡片化。

- 📍 **觀察股票籤頁卡片化** — `StockDetailPage.tsx:391` 補 `<div className="glass detail-body">` 包裹，與損益試算及 AI 分析籤同格；`WatchTab.tsx:72-76` 改用 `.rpt-section` / `.rpt-section-head` / `<h3>` 格式（脫離 Dashboard 遺構）。
- 💹 **新增 `sellLadder()` 純函式** — `sources/src/components/StockDetail/whatIf.ts` 九檔階梯：現價 ±10% / ±7.5% / ±5% / ±2.5% / 0%，自動求出回本價（如果落在窗口內），按賣出價排序，去除重複價格（2 位小數舍入、NT$0.40 以下小錨點會重合）。每列重新計算 `whatIf()` 無插值；`kind` 優先度：`current` > `breakEven` > `step`。
- 📊 **損益試算分頁重構為階梯 + 對帳單** — 上部階梯表（欄位 賣出價 / 相對現價 / 損益 / 報酬率 / 實收）可點選寫入賣出價；現價列標記「現價」、回本列標記「回本」。下部對帳單（二欄布局，買進假設 / 賣出試算 / 結算列）恢復詳細數字（投入成本、實收、回本價），計算原法不變（`whatIf()` / `fees.ts` / `pnlEngine.ts` 未動）。
- 🎨 **樣式與版面** — `.whatif-ladder` 與 `.whatif-ledger` 復用既有 `.data-table` / `.table-scroll` 系統及自訂屬性；對帳單在 720px 以下收縮為單欄；行可點選需有互動視覺（`cursor: pointer` + hover）。對帳單改為單一 CSS grid 共用列結構（項目 / 買進 · 假設 / 賣出 · 試算），確保同列高度相等（Δtop = 0px、Δheight = 0px）；560px 以下縮小內距、字級、列鍵寬，毋須崩潰至單欄。無新色彩字面值、無條形圖。
- 🎯 **預設值與單位選擇器** — `WhatIfTab` 新增 `avgCost` / `heldQty` props；持股預設買進價為費費內 `avgCost`、數量為持有張數或股數；觀察股預設買進價為現價、數量為 1 張；賣出價皆預設現價。新增張/股單位切換器，不改寫已輸入值，僅更新衍生股數。
- ♿ **無障礙保留** — 列標題名列、input 攜 `aria-label`（`買進價格`、`股數`、`單位`、`賣出價格`），既有測試 selector 不變。
- 🔍 **決策記錄** — 損益淨額包含手續費與證交稅，以小行列示總費用（使用者決策）；持股預設買進價為費費內 `avgCost`，使試算與庫存總覽的未實現損益相容（使用者決策）。
- ✅ **測試** — `npx vitest run` 73 檔 / **1090 項全通**；`npx tsc --noEmit` 0 errors；`npx oxlint src` 0 errors；`npm run build` ok；**瀏覽器 E2E `scripts/verify-watchlist-e2e.cjs` 10/10**；實測佈局（1280×900 / 390×844）：全 6 列 Δtop = 0px、Δheight = 0px、body 水平溢位 0px。複審：`route:reviewer` **PASS**，真實 RISK 一項（sub-NT$0.40 小錨點重複價格造成 React key 重複）已修、缺失測試已補、誤算已駁回。
- 📝 **參考規格** — Task 118、`docs/agent/specs/117-whatif-ladder-ledger.md`。
- ⚙️ **未改動** — `whatIf()` 簽名及計費演算法、工作區手續費率、沙盒限制（不動 localStorage 與 Supabase）；無 schema 變更、無 Edge 部署、無 migration；完全前端。
- ⚠️ **已知議題（記為 OPEN bug）** — 持股預設購入價為含費平均成本，而 `whatIf()` 又加一次手續費（重複計算），導致投入成本虛高 ~0.14%；該表唯一新增了這兩個欄，故現在可見，但非本任務範圍（需要分開決策：改用原價或不加手續費）。


### 0.9.0（2026-08-19）— 觀察清單 UX 重構：個股分析第四籤頁面 + 設計決策透明化

> **設計迭代**：初版 0.9.0（已棄）置觀察清單於庫存總覽；經使用者審查後改為第四籤頁面。根本原因：主 session 就狀態「跟持股平起平坐」提問時，將該狀態答覆誤讀為位置決策，寫入規格為庫存總覽。使用者核可規格不等同於使用者選擇位置；該判斷應明確提問、取得共識，而非無聲轉化為需求。現版本：觀察清單為個股分析第四籤（分析內容 / 損益試算 / AI 分析 / **觀察股票**），容置於 y≈207（800px viewport，無滾動）；庫存總覽回復初狀；持股選擇器純持股（無分組）。

- 📍 **觀察股票籤頁**：個股分析新增第四籤，列出使用者觀察股票；`Dashboard/WatchSection.tsx` 遷至 `StockDetail/WatchTab.tsx`；`DashboardPage.tsx` 與 `AppShell.tsx` 回復 0.9.0 前狀態（移除 `pendingAnalysisTicker`、`onOpenAnalysis`）。
- 📊 **個股選擇器回復持股視圖**：持股 / 觀察分組取消；觀察股只能經觀察股票籤進入，不出現於持股選擇器；持股與觀察入口刻意分離——以使用者為主。
- 💰 **空狀態自有加入入口**：`AnalysisPage` 空狀態（既無持股、亦無觀察股）自帶 `＋ 加入觀察` 按鈕，全新使用者不必折返庫存總覽始能新增第一檔。
- 💹 **損益試算分頁重寫**：賣出價改為可見輸入框、預設帶入現價、提示「預設：現價 X」；僅損益與報酬率為標題大小，成本 / 賣出所得 / 手續費 / 證交稅 / 回本價縮成小字明細行。前版出場價隱形（「買 24.2 / 賣 24.2 / 虧 140」讀起來故障），現已明確。算法不變：仍用 `calculateFee` / `breakEvenPrice`。
- 🔧 **缺陷記錄（驗證期發現與修復，根本原因）**：
  1. 籤頁內新增股票無法選取。`AnalysisPage` 掛載時讀清單一次，點選列時解析該副本；新增後列卸出視野。修法：列向上傳 `(ticker, name)`。**根本原因**：實機發現（非測試發現）、UI 測試無點擊驗證。
  2. E2E 斷言內容；檢驗點虛設。原始斷言檢查頁面文字含代號——但清單本身就印代號，任何狀態下皆過。唯一訊號為損益試算預設價格異常（14095 vs 24.05）。修法：改查 `切換個股` trigger 文字。**根本原因**：驗證腳本斷言覆蓋不全。
  3. 同時持有又觀察的股票喪失持倉數據。`watch:` 鍵路徑未查持股表，`holding` 被迫 null、qty 與 cost 消失。修法：解析順序匹配持股優先（按 ticker），任何鍵前綴皆不改變本質——持有就是持倉。**根本原因**：選擇順序非明文規格。
  4. 刪除中檢視的觀察股後無法消息、留在畫面。`AnalysisPage` 與 `WatchTab` 副本不同步。修法：`WatchTab` 每次新增/移除完成後向上報，`AnalysisPage` 重讀清單、摘除橋接項。**根本原因**：副本管理無顯明協議。
  5. 橋接項在摘除指令發時清空，而非清空時清空，中間無聲斷點會以舊副本重掛使用者至已刪的股。修法：等清單新副本落地才清空橋接項。**根本原因**：非同步流程間隙無防護。
  6. **驗證腳本質量**：搜尋正規式 `加入 1101` 誤中 `1101B 台泥乙特`（改為 anchor）；測試代號未先刪除，先前崩潰遺留物致新回合因無關原因失敗（改為起始前刪除）。
- 🧪 **測試**：`npx vitest run` 73 檔 / **1073 項全通**；`npx tsc --noEmit` 0 errors；`npx tsc -p tsconfig.edge.json` 0 errors；`npx oxlint src supabase` 0 errors；`npm run build` ok；**瀏覽器 E2E（Playwright 對 DEV、重寫）10/10**：個股分析 → 觀察股票籤 → 加入對話框（y≈59, 800px viewport）→ 加入 1101 → 列顯示 `NT$24.05 -0.21%` → 點列選定 → 損益試算賣出價帶入 24.05 → 拉高賣出價後損益轉正 `+NT$4,649` → 移除還原。DEV 資料每執行還原。
- 📝 **稽核**：派遣 reviewer，**PASS**；兩項 BLOCKER 回環中發現與修正（見缺陷 3、4）、一項 RISK 同步清單延遲（缺陷 5）均於審查前結案。流程課題：E2E 腳本等固定 1200ms 打字後，冷 `getTwStockList()` 快取時首跑失敗、二跑過→改等結果元素（至多 25s），隨機失敗驗證器比無驗證還差。
- ⚙️ **未改動**：無 schema 變更、無 Edge 部署、無 migration。
- 📋 **參考規格**：`docs/agent/specs/watchlist-ux-overhaul.md`（第 1 節載選擇解析順序）。

### 0.8.1（2026-08-19）— 管理觀察面板置入模態框；觀察股報價即時取得

- 🐛 **BUG-030 管理觀察面板位置失效**：`WatchlistPanel` 原為平面 `<section className="glass section">` 置於 `<StockDetailPage>` 之後，因為 StockDetailPage 是全長報告頁，開啟面板時會附加在折線以下，按鈕顯得無反應。修法：將面板封裝入既有共享元件 `sources/src/components/Common/Modal.tsx`，使用其傳送至 `document.body` 的入口、overlay、Esc 關閉與單一關閉按鈕（`aria-label="關閉"`）；移除面板自身的標題與重複關閉鈕。根本原因：jsdom 無版面資訊，1058 個單元測試全數通過而功能不可用；新增迴歸測試斷言面板應為 `role="dialog"` 並傳送至 DOM 外（`container.contains(dialog) === false`、`document.body.contains(dialog) === true`），並於瀏覽器檢查對話框邊界在可視範圍內。
- 🐛 **BUG-031 觀察股無報價**：`AnalysisPage` 對每檔觀察項傳入 `quote={null}`，原因為 `useStockPrices` 僅涵蓋持股。結果分析頁呈現「行情尚未取得／目前抓不到這檔股票的報價」，新增的損益試算籤無法工作，即本功能存在之因——分析非持股。修法：對選定的觀察項單獨呼叫 `fetchPrices([{ market: 'TPE', ticker }])` 自 `services/priceProxy.ts`，以選定觀察股為鍵，effect 清理時設置 `cancelled` 旗標防止舊項回應覆蓋新選項。失敗時報價留 null，不阻擋渲染。持股報價路徑不變。
- ✅ **驗證**：`npx vitest run` 72 檔 / **1060 項全通**；`npx tsc --noEmit` 0 errors；`npx tsc -p tsconfig.edge.json` 0 errors；`npx oxlint src supabase` 0 errors；`npm run build` ok；**瀏覽器 E2E（Playwright 對 DEV，新增）** 12/12 步驟通過：進個股分析 → 管理觀察可見 → 面板出現在可視範圍內（y=49, viewport 800）→ 搜尋並加入 1101 → 關閉 → 下拉觀察組出現 1101 → 選取後頁面渲染 → 觀察股取得報價 → 損益試算可開且無 NaN/Infinity → 試算帶入現價 24.2 當預設買進價 → 算出回本價 → 移除 1101 還原 DEV 資料。
- 📝 **稽核**：派遣 reviewer，2 項 RISK 提出；已接納「選中觀察項後刪除時，檢視回落至他項無訊號」（使用者自刪，回落合理）；**已駁回「工作區切換留下舊工作區觀察清單」**（`tw_watchlist` 僅按 `user_id` 鍵入無 `workspace_id`，schema 備註明言「Per-user, not per-workspace」，故無工作區觀察清單可留下）。

### 0.8.0（2026-08-19）— 觀察清單：分析非持股個股與損益試算

- 📋 **觀察清單上限提升**：`tw_watchlist` 每人上限由 5 檔提升至 30 檔；`sources/supabase/schema.sql` 內 trigger 更名 `tw_watchlist_max5` → `tw_watchlist_max30`，並於建立前同時 drop 兩個名字以相容既有資料庫；欄位、RLS、CHECK 機制未動。該表自 0.7.0 起休眠，此版本重新啟用。
- 🔐 **Edge Function 白名單放寬**：`stock-report` 的 `generate` 與 `warm` 兩項守衛由「有人持有」放寬為「持有 ∪ 任何人的觀察清單」；新增 `watchedTwTickers()`（service role 掃全站 `tw_watchlist`，只選 ticker、name，錯誤時回 `[]`）、`allowedTwTickers()`（= `mergeTwTickerLists(held, watched)`，持股優先名稱）；`batchTwTickers()` 改回聯集，使觀察股進入夜間批次；新增純函式 `allowsTicker()`；403 訊息改為「僅限持有或已加入觀察清單的台股代號」。
- 🛠️ **觀察清單服務元件**：新增 `sources/src/services/watchlistService.ts`（`WATCHLIST_MAX = 30`、`WatchItem`、`listWatchlist()` / `addWatch()` / `removeWatch()`）；刻意不併入 `DataProvider` 介面（本機模式不支援）；trigger 擋下時將 Postgres 原文翻成中文，不外洩錯誤。
- 📱 **觀察清單管理面板**：新增 `sources/src/components/StockDetail/WatchlistPanel.tsx`；「管理觀察」面板列出、移除、以 `getTwStockList()` 搜尋加入（代號前綴不分大小寫、名稱內含）；已加入者不再出現；滿 30 檔時停用搜尋、不渲染加入鈕。
- 📊 **個股下拉分組**：`sources/src/components/StockDetail/AnalysisPage.tsx` 個股下拉分成「持股」「觀察」兩組（空組不渲染標題），觀察項以 `watch:${ticker}` 為鍵，選中時 `holding` 與 `quote` 皆為 null；同時持有又觀察的代號只出現一次、留在持股組；空狀態改為兩者皆空時才顯示，就地提供「管理觀察」入口。
- 💰 **損益試算分頁**：新增 `sources/src/components/StockDetail/whatIf.ts` + `WhatIfTab.tsx` + `StockDetailPage.tsx` 修正；第三分頁籤（排在分析內容與 AI 分析之間）；計算複用 `fees.ts` 的 `calculateFee` 與 `breakEvenPrice`，不自寫費用/稅算法；輸入不儲存；費率與最低手續費按目前工作區取用。
- 🧪 **測試**：`batchTickers.test.ts`（+5）、`watchlistService.test.ts`（新，8）、`WatchlistPanel.test.tsx`（新，13）、`whatIf.test.ts`（新，8）、`WhatIfTab.test.tsx`（新，4）、`AnalysisPage.test.tsx`（+7）、`StockDetailPage.test.tsx`（分頁籤斷言改為三個）。
- ✅ **驗證**：`npx vitest run` → 1056 passed, 0 failed（0.7.26 時為 1011）；`npx tsc --noEmit` 0 errors；`npx tsc -p tsconfig.edge.json` 0 errors；`npx oxlint src supabase` 0 errors；`npm run build` ok。
- 📝 **稽核**：Lane 2。主 session 寫規格與全部失敗測試；`route:builder` 實作；`route:reviewer` 派遣三次。Edge 白名單 PASS（兩個可讀性風險已修）；`watchlistService` **FAIL** → `reorderWatch` 整個刪除（upsert 走 INSERT ... ON CONFLICT，Postgres 每列先觸發 BEFORE INSERT trigger，清單滿 30 檔時每次排序都會被上限擋下；本來就沒有排序 UI；同時補 trigger 錯誤翻譯成中文）；UI 與試算 PASS（四個風險全部關閉）。
- ⚠️ **待執行項**：(1) 主從 schema migration（DDL 於 `schema.sql` 已就緒，待 DEV / PROD 執行）；(2) DEV / PROD Edge 部署；(3) 端對端驗證（加一檔未持有股票，確認守衛放行、隔夜批次產出報告）。
- 🔍 **開放 RISK**：**RISK-002 夜間批次成本** — 批次範圍由「全站淨持股」變為「全站淨持股 ∪ 全站觀察股」，每檔約 6 次外部請求，成本隨「使用者數 × 觀察檔數」線性成長；30 檔上限是唯一煞車；上線後應觀察一週批次時長，必要時改為「只有被開啟過的觀察股才進批次」。

### 0.7.26（2026-08-19）— 外資買賣超 TOP 50 區塊新增鉅額星號標示與筆數下拉選單

- ⭐ **鉅額標示改為名稱後綴星號**：原本 `block === true` 的列多掛 `<span className="chip">鉅額</span>` 標籤，改成名稱直接接 `*`（例：`長榮*`），畫面上不再出現「鉅額」字樣。
- 📝 **表格上方說明文字**：新增「* 代表鉅額」說明文字，沿用既有 `hint` 樣式，放在 `.table-scroll` 之外，避免窄螢幕橫向捲動時說明跟著捲走。
- 📊 **顯示筆數下拉選單**：新增下拉選單（`aria-label="顯示筆數"`），選項 10 / 30 / 50，預設 10。選定筆數同時套用於買超與賣超兩個分頁；資料筆數少於選定值時只渲染既有列，不補空列。
- 💾 **未變動**：買超/賣超分頁、資料更新時間戳、空狀態、欄位標題、`fmtLots()` 張數格式。
- 🧪 **測試**：`ForeignTopSection.test.tsx` 新增／改寫案例：「鉅額改以名稱後綴星號標示，不再出現鉅額標籤」、「表格上方說明星號代表鉅額」、「預設只顯示 10 筆，可用下拉選單切換 30 / 50」、「資料少於選定筆數時只顯示既有列，不補空列」；既有的分頁測試改以 `台積電*` 斷言。共 10 項通過（改動前 5 項失敗）。
- ✅ **驗證**：`npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 10 passed, 0 failed；`npx vitest run`（全套）— 68 檔 / 1011 項通過；`npx tsc --noEmit` — 0 errors；`npx oxlint src` — 0 errors（僅無新違規）；`npm run build` — built ok。
- 📝 **稽核**：未派遣。誠實記錄：純展示層變更，測試改動前失敗、改動後通過，不涉持久化、授權、對外介面契約、無聲計算或控制流。

### 0.7.25（2026-08-19）— 修正 `computeLedger()` 的股票名稱覆蓋問題

- 🔧 **名稱守衛**：`computeLedger()` 在更新 `ledger.positions[key].name` 與 `ledger.yearly[year].tickers[key].name` 時加上守衛 `if (tx.name && tx.name !== tx.ticker)`，防止只帶代號（佔位值）的交易覆蓋已知中文名（如「元大台灣50」被覆蓋為「0050」）。
- 📌 **初始化邏輯保留**：初始化時使用 `name: tx.name || tx.ticker` 確保所有交易都有名稱；若所有交易皆只有代號，名稱如常維持代號。
- 🧪 **測試新增「股票名稱：代號佔位名不得覆蓋已知名稱」**：3 個案例——(1) 先中文名、後代號佔位值不覆蓋、(2) 先代號、後補上中文名時會被補上（升級路徑）、(3) 全代號時名稱維持代號。前置條件：改動前測試失敗，改動後通過。
- ✅ **驗證**：`npx vitest run src/utils/pnlEngine.test.ts` — 17 passed, 0 failed；`npx vitest run`（全套）— 68 檔 / 1008 項通過；`npx tsc --noEmit` — 0 errors；`npx oxlint src` — 0 errors（僅無新違規）；`npm run build` — built ok。
- 📝 **稽核**：Lane 2、派遣 reviewer 審閱，判定 **PASS** 惟一 RISK——升級路徑（先佔位名後補中文名）無測試覆蓋——已於提交前補上測試案例 (2) 而結案；無他項待結。

### 0.7.24（2026-08-19）— 外資買賣超 TOP 50 數量一律以張顯示，移除張/股切換

- 📊 **數量單位統一為張**：總體經濟 > 台股 的「外資買賣超 TOP 50」區塊三個數量欄位（買賣超 / 買進 / 賣出）一律以「張」顯示（1 張 = 1,000 股），無使用者切換選項。
- 🗑️ **移除單位切換 UI**：刪除 `Unit` 型別、`unit` 狀態、`inst-metric-seg` 按鈕組（張 / 股），簡化元件邏輯。
- 🧹 **移除 `fmtShares()` 輔助函式**：該函式已無他處使用，改為統一使用 `fmtLots()`（原值 / 1000，一位小數）。
- 🏷️ **欄位標題更新**：買賣超欄位標題改為「買賣超(張)」，明確標示單位。
- 📝 **元件文檔更新**：`ForeignTopSection.tsx` 頂部註解闡明數量恆以張顯示。
- 🧪 **測試**：`ForeignTopSection.test.tsx` 移除舊的「單位切換」測試案例，新增「數量一律以張顯示，沒有張股切換」案例（驗證 1,234.0 與 3,000.0 渲染，1,234,000 原始值不出現，無張/股按鈕），並新增「買賣超欄位標題標示單位為張」案例；共 7 項通過。
- ✅ **驗證**：`npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 7 passed, 0 failed；`npx vitest run`（全套）— 68 檔 / 1007 項通過；`npx tsc --noEmit` — 0 errors；`npx oxlint src` — 0 errors（僅無新 linting 違規）。
- 📝 **稽核**：未派遣。誠實記錄：純展示層變更，無涉金錢、身份認證、資料持久化、API 契約、背景工作；測試於改動前失敗、改動後通過。

### 0.7.23（2026-08-18）— 外資買賣超 TOP 50 區塊新增資料更新時間戳

- 🔤 **資料更新時間戳**：總體經濟 > 台股 的「外資買賣超 TOP 50」區塊頂部新增「資料更新於 YYYY-MM-DD HH:mm」時間戳。
- ♻️ **複用既有設計**：沿用 `TwMarketSection.tsx` 與 `MacroPage.tsx` 已採用的 `source-tag section-stamp` 樣式與 `fmtUpdatedAt` 時間格式化工具，確保措辭、配置、時區顯示一致；無新 CSS、無新格式化函式。
- 📊 **資料來源**：使用 `ForeignTopData.asOf` 欄位（由 `foreignTopProxy.ts` 已公開），無需異動後端、Edge Function 或儲存檔案。
- 🕐 **空態隱藏**：無快照時時間戳隱藏，防止出現「資料更新於 —」。
- 🧪 **測試**：`ForeignTopSection.test.tsx` 新增 2 個測試案例（含時間戳及其 `section-stamp` 樣式類別之斷言、空態時時間戳缺失之斷言）；時間戳斷言依格式比對而非固定時刻，因 `fmtUpdatedAt` 按檢視者時區渲染。前置條件：改動前該時間戳斷言失敗，改動後通過。
- ✅ **驗證**：`npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 6 passed, 0 failed；`npx tsc --noEmit` — 0 errors；`npx oxlint src` — 0 errors。
- 📝 **稽核**：未派遣。誠實記錄：純展示層變更，有測試於改動前失敗、改動後通過；不涉金錢、身份認證、資料持久化、API 契約、背景工作或控制流。

### 0.7.22（2026-08-18）— BUG-029：修復 TWT38U 探針自 0.7.19 來從未執行

> 目前狀態：0.7.22 DEV Edge 已於 2026-08-18 21:28 Asia/Taipei 部署（commit 0f8612b），方式為 volume copy + `docker compose up -d --force-recreate functions`。驗證：`source-probe` cron 於 21:45 及 21:50 均回 HTTP 200 並寫入新碼的 `source_probe_tick` 列，無他源迴歸。
> Bug 足跡確認於部署前：`SELECT count(*) FROM source_probe_tick WHERE source='twt38u'` 全史 0 列；今日 17:00–18:00 窗僅 `bwibbu`（加 17:15/17:20 的 `mops_revenue`）。twt38u 分支因 `handleProbe()` 讀實時鐘無時間覆蓋，迄未端對端驗證；預期首次驗證 2026-08-19 17:00 Asia/Taipei。
> 部署後 21:30／21:35 兩輪超逾時原因：診斷期間併行手動探測呼叫，非本更動；21:45／21:50 恢復 200；同類超時已於部署前 21:00 出現；與開放 RISK-001 相關。

- 🐞 **BUG-029**：外資買賣超（TWT38U）於 0.7.19 新增為第 8 個探針來源（視窗 17:00–18:00），但在 PROD 與 DEV 上從未執行過任何一次。原因為調度路徑上的兩個獨立缺口：
  1. `sourceProbePlan.ts` 的 `sourcesForTaipeiTime()` 使用硬寫列表 `['bfi82u','t86','bwibbu','margin','borrow']` 漏掉 `'twt38u'`，即便 `DAILY_WINDOWS.twt38u` 已定義、落地目標 3 次已設定、指紋規則已接線、到位判準已實作，調度器仍因列表缺漏而從不發出該源。
  2. `index.ts` 的 `probeSource()` 無 `twt38u` 分支，致使即使調度器發出該源，每 5 分鐘也會落到 `fail('unknown source')` 永不命中永不退休。
- ✅ **修法**：`sourceProbePlan.ts` 改為從 `Object.keys(DAILY_WINDOWS)` 動態衍生日頻來源列表（避免硬寫列表漏項）；`index.ts` 新增 `twt38u` 分支（抓取、解析、到位判定、指紋計算）；`sourceProbePlan.test.ts` 更新窗口斷言並增加新的邊界測試。
- 🧪 **驗證**：`npx vitest run supabase/functions/stock-report/` 15 檔 / 352 項全通；`npm run typecheck:edge` 0 errors；`npx oxlint supabase/functions/stock-report/` 0 errors；稽核員二輪（第一輪發現缺口 2，修正後）**PASS**。
- ⚠️ **接受的風險**：`probeRound.ts:95–98` 無逐源預算檢查。17:00 時三個視窗重疊（`t86` 至 17:00 含、`bwibbu` 與 `twt38u` 始於 17:00），17:15/17:20 四源並排。各抓取 10s 超時，最壞情況逼近 60s Edge Function 限制，已評估認可。
- ✅ **PROD 已部署**：
  - `main` 合併並推送於 commit `5480f05`（`dev` 與 `main` 同步於同一 commit）。
  - PROD Edge `stock-report` 已部署：version 52 → **53**，`ezbr_sha256` 由 `6b3812f15827bc992c380f60849ae9e2af3b6b5fd182a215b2b7c261c8494436` 變為 `98bb077688b1011ef62fe040e9b67b6ceea04f99d50ae03a507ba4867bdce94d`，`verify_jwt` 維持 `false`。部署來源為乾淨工作區的 `main` @ `5480f05`。
  - 仍待觀察：PROD 首次 TWT38U 探針預期於 **2026-08-19 17:00 Asia/Taipei**，屆時 `source_probe_tick` 應出現 `source='twt38u'` 的列。

### 0.7.21（2026-08-18）— 盤後探針退休條件加上「內容已停止變動」，接線改為可測純函式

- 🎯 **探針退休判定新增內容穩定度檢查**（Task 114）：
  - 原本以落地次數判定退休，計數只能證明「量過 N 次」，無法證明「上游不再修訂」。T86 是反例，每日 16:00 之後每 15 分鐘修訂一次，因此有 `nextT86State` 存在。源退休當天再無機制會讀它，提早退休會無聲凍結當日資料。
  - 新規則：達成落地計數 **且** 內容已停止變動（最後兩次落地 tick 帶同一非空指紋）才退休。
  - 新增 `REQUIRE_SETTLED_CONTENT` 表：六大日頻來源（`bfi82u`、`t86`、`bwibbu`、`twt38u`、`margin`、`borrow`）設為 true，MOPS 例外設 false（落地判準已是期間比對，目標單次落地，指紋規則只能讓 1 變 2 無益）。
  - `contentSettled()` 純函式：少於兩筆記錄、或最後兩筆任一為 null/undefined/empty 回傳 false，沒有證據絕不算穩定。
  - `retiredSources` 新增第三參數 `settled`，默認 `{}`，無穩定證據的日頻源**不會退休**——失敗模式從提早收工變成多探一輪。
- 📊 **PROD `source_probe_tick` 實測驗證**（2026-08-01 以降）：
  - 每源每次命中都寫非空指紋，無來源會因穩定度規則挨餓。
  - 單日內每源指紋高度一致（恰好 1 種），實務上無額外探測成本。
  - 模擬套用新規則於 19 個真實日：退休時機與舊規則**完全相同**，新規則只在上游真的修訂時才有用。
- 🧪 **接線改為可測純函式**（Task 114b，Reviewer RISK 結案）：
  - Reviewer 指出 `readDoneSourcesToday` 內部接線（分組、排序、套用時窗、計算穩定度）完全無測試覆蓋，兩個破壞模式就住在那裡：穩定度永遠假讓每日源探整窗、永遠真讓源提早退休凍結。
  - 提取為 `summariseLandedTicks(ticks, slotMinutes) -> { counts, settled }` 獨立純函式，7 個新單元測試含 `bfi82u` 雙時段情境（15:00–16:30／19:30–20:15）、輸入順序無關、null 時間戳等。`readDoneSourcesToday` 只負責查詢與委派。
  - 對比 19 個真實日：**完全無行為差異**。
- 📝 **檔案異動**：`sourceProbePlan.ts`、`sourceProbePlan.test.ts`（13 個新單元測試，測試先行）、`index.ts`。
- 🧪 **驗證**：`npx vitest run` 68 檔 / **1001 項全通**（原 987）；`npx tsc -p tsconfig.edge.json` exit 0、`tsc --noEmit` exit 0、`npm run build` ok、`npx oxlint src supabase` 0 errors。稽核員對 Task 114 判定 **PASS**，唯一 RISK 已由 114b 結案。

### 0.7.20（2026-08-18）— 修復 BWIBBU 帶日期端點在尚未發布時快取中毒，導致當日基本面檔案被跳過

- 🐞 **BUG-028**：帶日期的 BWIBBU 端點（`BWIBBU_d`）在未發布時回傳 HTTP 200 含 `{"stat":"很抱歉，沒有符合條件的資料!"}` 無 `data` 欄位（發布時間約 17:15 台北）。`readLatest` 對任何不拋錯的回應都進行快取，導致當天首次 `generate-market-data` 於 17:15 前執行時，將該空負載寫入該交易日的 BWIBBU_D 快取鍵；之後每輪都讀回空結果，`normaliseBwibbuDated` 回傳 null、`freshValuationDay` 為 null、`valuationCurrent` 因此永遠為真，**當天所有基本面檔案命中 `skipped++; continue` 分支**。
- 📊 **實測影響（PROD 雲端）**：`source_probe_tick` for `bwibbu` 2026-08-14 有 42 ticks / 17 hits / **0 landed**；2026-08-17 有 19 ticks / 15 hits / **0 landed**。Storage 47 個 `fundamental/*.json` 中**40 個最後寫入時間為 2026-08-10**，估值資料已無聲地過期 6 個交易日；`fundamental/2609.json` 於 2026-08-17 17:08 被寫入時仍攜帶 `valuation: null`。
- ✅ **修法**：`readLatest` 新增可選的有效性判準參數；快取寫入時若判準回傳假值則跳過寫入，但仍回傳抓取值。BWIBBU 呼叫端傳入新的 `bwibbuDatedUsable`（出自 `twFundamental.ts`，定義與 `normaliseBwibbuDated` 相同避免飄移），與既有的 `loadT86` 用 `t86Ok` 進行快取寫入防護一致。其他三個 `readLatest` 呼叫端（MI_MARGN、T187AP05_L、T187AP17_L）不傳判準，行為不變。
- ⚠️ **接受的風險**：平日若無法使用當日 BWIBBU_D（如市場假日），`readLatest` 改為每輪重抓而非快取一次，約當天增加 30 次對 twse.com.tw 的請求，無退避；已評估認可：替代方案為整日無聲過期估值，等於 bug 本身。
- 🧪 **驗證**：`npx vitest run` 68 files / **987 tests passed**（前 984）；`npx tsc -p tsconfig.edge.json` 0 errors、`npm run build` ok、`npx oxlint src supabase` 0 errors。稽核員判定 **PASS**。四份實際回應測試：`bwibbuDatedUsable` 對 `normaliseBwibbuDated` 一致（2 個已發布日回傳真、1 個未發布日與 1 個週日回傳假）。

### 0.7.19（2026-08-18）— 外資買賣超 TOP 50 快照與探針第 8 來源 twt38u

- 新增 TWSE `TWT38U`（外資及陸資買賣超彙總表）解析，於 `generate-chips` 階段產出 `market/foreign_top50.json`（外資買賣超 TOP 50 買超／賣超快照）。
- 總體經濟 > 台股 新增「外資買賣超 TOP 50」區塊，含買超／賣超分頁與張／股單位切換，鉅額交易標記。
- 不新增 Edge action（TWT38U 後續抓取沿用既有 `generate-chips` 階段）、不改 cron；**探針則新增第 8 個來源 `twt38u`，視窗 17:00–18:00、每 5 分鐘、3 次穩定到位退休**。
- 選用 TWT38U 而非既有 T86 快取衍生：實測 16 個交易日兩者數值完全相同，但 `selectType=ALLBUT0999` 排除權證，4 天的 TOP 50 名次因此不同；TWT38U 146 KB 亦小於 T86 194 KB。
- ⏰ **探針到位判準新增 `LandingEvidence.foreignTopDate`**：取自 `market/foreign_top50.json` 的 `rawDate` 欄位；`sourceLanded('twt38u')` 透過 `normaliseYmd` 與今日比對，同時接受 `YYYYMMDD` 與 `YYYY-MM-DD` 兩種格式。
- 🖥️ **管理後台「盤後探針命中戰情室」與「資料源探針運作週期」同步更新為 8 大來源**；`README.md`、`schema.sql` 相關註解與十處硬寫「7 大 / 七個」計數亦一併更新。
- ⚠️ **稽核狀態**：本次未執行 Reviewer（正式政策外的偏差，已實錄）；探針與控制流相關變更按既往慣例應經稽核。無稽核結論聲明。
- 🧪 **測試**：68 檔 / **984 項全數通過**（原 66 / 963）；`npx tsc -p tsconfig.edge.json` exit 0、`npm run build` ok、`npx oxlint src supabase` 0 errors。

### 0.7.18（2026-08-17）— 個股三大法人（T86）探針時窗調整至 16:00–17:00

- ⏰ **個股三大法人（`t86`）探針時窗精準收攏**：
  - 由原本的 `15:30 – 17:30` 收攏為 **`16:00 – 17:00`**（每 5 分鐘一次，命中 3 次收工退休）。
  - 根據實測紀錄證交所個股三大法人固定於 16:00–16:30 首次出表，移除 15:30–16:00 無效探測區間，每日節省 6 次無效 probe 請求。
- 🖥️ **管理後台與戰情室文案同步更新**：
  - 更新後台「盤後探針命中戰情室」（`ProbeWarRoom`）與「機制導覽」（`MechanismGuide`）中關於 T86 的時窗說明為 `16:00–17:00`。
  - 同步更新相關單元測試與註解說明。

### 0.7.17（2026-08-14）— 盤後探針命中戰情室上線與探針週期最佳化（bwibbu / bfi82u）

- 🚀 **盤後探針命中戰情室上線取代舊版警示橫幅（Task 110）**：
  - 以視覺化卡片呈現 7 大資料源（`BFI82U`、`T86`、`BWIBBU`、`MARGIN`、`BORROW`、`MOPS_REV`、`MOPS_PROFIT`）之即時探測狀態、到位進度圓點與命中時間戳（如 `15:05 最新` / `15:15 退休`）。
  - 修正日頻來源退休判定：嚴格依各來源到位目標門檻（如 3 次）判斷退休狀態，防止因單一 tick 附註「資料已到位」而於第 1~2 次提早誤判為已退休。

- ⏰ **個股估值探針（`bwibbu`）時間視窗精準收攏（Task 109）**：
  - 由原本寬鬆的 `15:00 – 22:00` 收攏為 **`17:00 – 18:30`**（每 5 分鐘一次，命中 3 次收工退休）。
  - 根據實測紀錄官方固定於 17:15–17:20 出表，前緣留 15 分鐘餘裕從 17:00 開探，每日省下 15:00–17:00 約 24 次無效 probe。

- ⏰ **大盤法人買賣超探針（`bfi82u`）新增第二時段並移除 15:40 凍結門檻（Task 109）**：
  - 調整為雙時段探針機制：**`15:00 – 16:30`**（盤後初版）與 **`19:30 – 20:15`**（盤後完整版，涵蓋 19:40 綜合帳戶與鉅額交易結算）。
  - 取消原本大於 15:40 才判定 landed 的限制，各時段獨立以「命中且資料到位 3 次」自動退休收工。
  - `syncMarket` 於晚間時段（`>= 19:30`）主動重新抓取當日 BFI82U 完整版並覆蓋更新 `market/daily.json`。

- 🖥️ **管理員後台機制說明同步更新**：
  - 更新後台「探針與排程機制運作總覽」（`MechanismGuide`）與「排程同步狀態」中關於 `bfi82u` 雙時段與 `bwibbu` 新視窗之說明文案。

### 0.7.16（2026-08-14）— 總體經濟、個股籌碼、基本面與技術面全表格 inst-matrix 矩陣重構

- 📐 **個股分析・技術面「每日成交量」表格升級為 inst-matrix 矩陣風格（Task 108）**：
  - **表格結構收斂**：5 欄垂直矩陣佈局（`日期`、`成交量`、`量比`、`收盤價`、`漲跌幅`）。
  - **熱力著色與漲跌識別**：成交量依區間最大量套用熱力底色；量比相較基準 1.0 倍著色，大於 1.5 倍加粗；收盤與漲跌幅套用漲紅跌綠與振幅熱力底色。
  - **頁尾統計與 4 條走勢圖**：`tfoot` 統計欄呈現日均量與「連 N 日增量 / 縮量」徽章、最新量比與「量能狀態」、最新價與高低點區間、累計淨報酬與「連 N 日上漲 / 下跌」徽章，並包含 4 條 SVG `SparkCell` 波折圖。

- 📐 **個股分析・基本面「月營收」與「獲利能力」表格風格比照矩陣重構（Task 107）**：
  - **月營收矩陣**：5 欄佈局（`月份`、`當月營收`、`月增 MoM`、`年增 YoY`、`累計年增`），12 個月倒序排列，套用熱力底色與頁尾 12 個月累計營收、連 N 月增減徽章及 4 條走勢圖。
  - **季報獲利能力矩陣**：8 欄佈局（`季別`、`單季營收`、`營收年增 YoY`、`EPS`、`毛利率`、`營益率`、`稅前純益率`、`稅後純益率`），顯示 2024~2026 季別（保留 2023 作為同季 YoY 計算基準），全欄位套用漲紅跌綠與熱力底色，頁尾包含近 4 季累計營收、YoY 成長、TTM EPS 與四大獲利率走勢共 7 條 `SparkCell`。

- 📐 **個股分析・籌碼「融資融券」表格風格重構（Task 106）**：
  - 收斂為 5 欄佈局（`日期`、`融資增減`、`融券增減`、`券資比`、`融資使用率`），頁尾呈現 7 日累計增減、連增減標籤與 4 條走勢圖。

- 📐 **個股分析・籌碼「三大法人買賣超」表格風格重構（Task 104）**：
  - 移除右側 rowspan 走勢欄，收斂為 6 欄佈局（`日期`、`外資`、`外資自營`、`投信`、`自營商`、`三大法人合計`），頁尾呈現累計買賣超、連買賣標籤與 5 條走勢圖。

- 📐 **總體經濟・「每日成交量」表格風格比照三大法人重構（Task 102）**：
  - 移除右側走勢欄，收斂為 6 欄佈局（`日期`、`成交金額`、`成交股數`、`成交筆數`、`加權指數`、`指數漲跌`），各欄套用相較前一交易日增減熱力著色，頁尾呈現 7 日日均、連增減標籤與 5 條走勢圖。

- ⏰ **調整 MOPS 營收與季報探針時段至 17:15 與 17:20（Task 105）**：
  - 將 MOPS 下午探針槽次調整為 `17:15` 與 `17:20`，更早捕捉傍晚公告之營收與財報資料。

### 0.7.15（2026-08-14）— 總體經濟與個股三大法人直向排版重構＋修復大盤法人過早凍結與探針退休防護機制

- 📐 **總體經濟與個股分析表格直向排版重構**：
  - **總體經濟・每日成交量**：重構為單一表格，左欄為交易日期（由新至舊排列，支援 Sticky 凍結）、頂部表頭為 5 項指標與單位、最右側欄位為近 15 日走勢，底部 `tfoot` 統計欄呈現 7 日日均與累計漲跌及綜合 Sparkline 折線圖。
  - **總體經濟・三大法人買賣超**：重構為直向排版表格，左欄為交易日期（近 7 個交易日）、頂部表頭為 6 個法人單位與合計、底部 `tfoot` 呈現 7 日累計數據、連續買賣超標籤（如 `連 3 買` / `連 2 賣`）以及 15 日 SVG 走勢波折圖。
  - **個股分析・籌碼三大法人買賣超**：同步改為左欄交易日期、頂部表頭為各法人約當張數、最右側欄位為走勢、底部呈現 N 日累計。
- 🐞 **修復大盤三大法人 BFI82U 過早凍結與探針退休防護機制（Task 101）**：
  - **根本原因**：證交所 `BFI82U` 於 15:00~15:10 首次釋出初版（未計入盤後鉅額交易與 15:30 匯率），15:35~16:30 釋出最終結算版。原系統 15:10 初版一命中即標記 `data_landed = true` 退休且 `isMarketSessionReady` 短路，導致歷史資料凍結在初版。
  - **三道防線**：
    1. `sourceLanded` 與 `isMarketSessionReady` 加入 15:40 時間門檻：15:10 初版即時上架供前端瀏覽，但 15:40 前不提早退休，允許 15:35 鉅額交易結算自動覆寫。
    2. `REQUIRED_LANDED_COUNTS` & `retiredSources`：日頻來源（`bfi82u`, `t86`, `margin`, `borrow`, `bwibbu`）需確認 3 次穩定到位再予退休收工；MOPS 靜態文件維持 1 次到位即收工。
    3. `signature` 金額簽章修正：將法人真實金額納入比對，上游數值修正必觸發 Storage 覆寫。
- 📊 **歷史資料對帳修復**：透過 `reconcile-market-daily.cjs` 將 8/5 ~ 8/13 的 `market/daily.json` 法人歷史數據全數校正為證交所最終結算官方數據。
- 🔢 **版號**：`version.ts`／`package.json`／`package-lock.json`／`README.md` 徽章同步至 `0.7.15`。

### 0.7.14（2026-08-12）— App icon 改為手寫 SVG 元件＋修掉 scribe 中斷會吃掉紀錄的問題

> 目前狀態：正式 release commit `3f0eaea`（`0.7.14`），`dev`／`main` 都在 `3f0eaea`——本次 fast-forward，
> 兩支天生同版。GitHub Release `0.7.14` 已建立（本政策下首個 Release）。
> 正式站煙霧測試通過：首頁引用 `./favicon.svg`（200, 890B），`favicon.svg` 本身 200、1207B、含字面色 `#6366f1`。
> 無 Supabase／Edge Function 變更。

- 🎨 **App icon 換成手寫 SVG，一份圖形兩種載體**：新增 `sources/src/components/BrandMark.tsx`（30×30、`viewBox="0 0 96 96"`、`role="img"`），取代 `AppShell` 與 `AuthPage` 裡的 lucide `TrendingUp` 與外層的 `.brand-mark` 漸層方塊（該 CSS 規則已孤兒化並移除）。favicon 另存 `sources/public/favicon.svg`，`index.html` 改為 `type="image/svg+xml"`。**兩份是刻意的**：favicon 在隔離環境算繪，讀不到 App 的 CSS 變數，所以元件保留 `var()` 跟著主題走，favicon 寫死深色主題字面值（`#6366f1`／`#22d3ee`／`#ff4a5a`／`rgba(99, 102, 241, 0.16)`）。
- 🎨 **四個新的主題 token**：`--svg-main-1`／`--svg-accent`／`--stock-up-bright`／`--svg-bg-glow` 以 `var()` 別名映射到既有的 `--accent-strong`／`--accent-2`／`--up`／`--bg-glow-a`，只在深色 `:root` 定義一次即自動跟隨所有主題。
- ✅ **瀏覽器實測**：React 19.2.7 的 `useId()` 在 SVG `url(#…)` 內安全——實際跑 Playwright 確認 id 產生為 `_r_0_-p1/-p2/-p3`（純 ASCII），三個漸層全部解析成功，stop 色回傳當下主題的值。舊的兩張 PNG 資產（`favicon.png`、`brand-mark.png`）與 `src/assets/` 目錄一併刪除。
- 🐞 **BUG-028：`scribe` 撞到 `maxTurns` 會靜默吃掉紀錄**。派工回傳一句看似正常的半句話（「Now let me verify…」），主 session 分不出截斷與完成。實測 7 次派工中，達到 15–17 次 tool call 的 5 次全部截斷，5–8 次的 2 次全部完成。**已造成實際損失**：Task 91 與 Task 92 的 `PROGRESS.md` 紀錄被毀——都是從熱檔剪掉後、還沒寫進 `PROGRESS_ARCHIVE.md` 就被中斷；91 靠 `git show HEAD` 救回，92 從未 commit 只能重建。修法三項（皆在 `.claude/agents/scribe.md`）：`maxTurns` 15 → 30；新增「先寫目的地再刪來源」的搬移順序規則，讓被中斷的最壞結果從「靜默刪除」變成「可見的重複」；新增強制結尾回報區塊（`RECORDED`／`MOVED`／`VERIFY`／`UNFINISHED`），讓截斷變成可偵測。
- 📊 **成本歸因更正**：先前記錄「主 session 成本被讀進 context 的大圖推高」是錯的。實測八張圖合計 16,069 tokens ＝ **$0.88，佔整場 $20.87 的 4.2%**。main 的 $17.51 其實是三等分：output $5.80（33.1%）、cache read $5.85（33.4%）、cache write $5.86（33.5%）。cache write 高的真正原因是每轉都要寫入新內容（585,535 tokens ÷ 138 轉 ≈ 每轉 4,243）以及本場使用 1 小時 cache TTL（寫入 2× 而非 1.25×）。新結論：**output 佔三分之一且大部分是 thinking，`effort` 是這個專案從未調校過的成本槓桿**。
- 🔢 **版號**：`version.ts`／`package.json`／`package-lock.json`／`README.md` 徽章皆已同步至 `0.7.14`。

### 0.7.13（2026-08-12）— 借券翻日死在半路（BUG-026）＋到位判準抽樣未排序（BUG-027）

> 目前狀態：正式 release commit `33c1bd7`（`0.7.13`），`dev`／`main` 已同步推送；GitHub
> 前端部署 Actions run `31562082598` 已成功，兩區 Edge 也已部署（PROD `stock-report` v46，
> `verify_jwt=false`）。DEV 的 cron 移除是資料庫層操作，PROD cron 仍維持原本 7 支（見下）。

- 🐞 **BUG-026**：`decideSkip` 完全沒有借券項，只看 `t86Today && t86Frozen && marginToday`。借券翻到下一個
  交易日要等收盤結算後——實測 DEV／PROD 都在 **22:15**，比其他任何一項都晚——所以從約 21:00 起閘門就答
  `complete`，之後每一輪都在 `loadBorrow` 之前被短路。2026-08-11 借券的 7 次探測命中（22:15–22:45）全部
  被吞掉，整天沒有落地。修法：`decideSkip` 新增 `borrowLanded`，用既有的 `borrowHit` 判準比對
  `batch_run_log.borrow_data_date`，並讓這個日期改成**沿用上一輪**而不是每輪清成 `null`——否則被跳過的
  那一輪會把剛剛才成立的日期洗掉，閘門就會一輪跳過一輪不跳過地擺盪。
- 🐞 **BUG-027**：`readFundamentalSnapshot` 只抽樣 `batchTwTickers()` 的前 20 檔，而它來源的
  `heldTwTickers` 查 `transactions` **沒有 `ORDER BY`**——抽到哪 20 檔全憑 Postgres 當下的列序，卻用這個
  抽樣的 `max` 決定 `bwibbu`／`mops_revenue`／`mops_profit` 三個來源收工與否。PROD 持有 26 檔會被這個上限
  咬到，DEV 只有 5 檔永遠咬不到——這正是 `ac3177e` 記下的懸案（`mops_profit` 同一份 v45 在 PROD 答
  `landed=false`、DEV 答 `true`）的成因：21:00 當時的實際列序沒有留存，屬於高度支持但非重播的結論，但無論
  哪種列序，改成讀取**全部持股**都能拿掉這個失敗模式。
- 🔍 **診斷筆記補齊**：`summariseFollowUp` 對 `generate-chips` 原本無論發生什麼都壓縮成「產出 N 檔」，讓
  BUG-026 那七輪一模一樣的「產出 0 檔」看起來像正常運作，只能靠回頭比對 `batch_run_log` 才找到閘門被短路。
  現在改成三段式：`跳過（原因）`／`無變動`／`產出 N 檔`。
- ⏰ **`borrow` 探測窗收窄＋延後**：15:00–22:45 → **21:00–23:30**。前緣從實測的 22:15 往前留 75 分鐘餘裕
  （只有一天樣本，不貼著量到的時間收）；後緣則**延長**，這半邊比省請求次數更重要——舊窗 22:45 關，最後一班
  固定排程跑在 21:45，翻日只要晚於 22:45 當天就沒有任何機制會再撿它。`t86`／`margin`／`bwibbu`／MOPS 的窗
  刻意不動：前三者一天樣本不足以收窄，`bwibbu` 當天的探測記錄來自 0.7.11 之前被取代的 `BWIBBU_ALL` 路徑，
  不能代表現在的行為。
- 🧹 **拿掉兩支多餘的 cron（先做 DEV）**：`stock-report-nightly`（generate-chips）與 `market-daily`
  （sync-market）。設計本意是「探針量到出表就自己觸發抓取」，一支固定班表去做探針已經會觸發的動作，等於一個
  沒人追蹤的第二觸發源。這兩支從來不是設計裡刻意留下的——0.7.3 停用它們（探針實驗期），0.7.7 因為那個年代
  的探針只會寫 tick、不會真的抓取而緊急恢復，0.7.8 讓探針自己會抓取之後，這兩支就一直沒人再撤掉。
  `stock-report-nightly` 跑在 21:30／21:45，**比它該接住的 22:15 借券翻日還早**，而且兩輪都被跟探針一樣的
  閘門判定跳過——「最外層重試」這個理由沒有通過實測。`macro-daily`／`fx-daily` 保留：巨集與匯率完全沒有探針
  來源可以觸發，拿掉就是讓那兩塊資料整個停擺。`market-data-daily`／`history-daily` 暫緩：分別要等一整天
  `bwibbu` 新窗的觀測，以及 MOPS 探測槽從四個放寬之後才能安全撤掉。
- 🧪 992/992 vitest（`decideSkip` 借券情境 2 例 + 探測窗邊界 6 例）、`typecheck:edge` 0 error、`tsc -b`
  clean、`oxlint` clean。
- ⚠️ **維運事項**：檢查 `cron.job.command` 時，遮罩用的正規表示式沒對上實際的表頭格式
  （`'x-cron-secret', 'VALUE'`，逗號分隔，不是 JSON 冒號語法），導致 **DEV 的 `CRON_SECRET` 被印進了對話
  紀錄**（PROD 的沒有外露）。建議輪替 DEV 的 `CRON_SECRET`；以後查 `cron.job.command` 只用結構性條件
  （如 `command LIKE '%x-cron-secret%'`）或用窄的 `regexp_match` 只取出 action/url，絕不要整段選出 command
  文字，遮罩過也不要。

### 0.7.12（2026-08-11）— 七個來源的判準對齊成同一條標準

- 🎯 **一條標準**：命中＝上游今天出表了；收工＝**上游剛出的那一份，出現在前端讀的那個檔案裡**。
  沒有任何來源是靠「抓取函式有沒有出錯」或「這輪有沒有做事」判定的。

  | 來源 | 命中怎麼問 | 收工看哪個成品 |
  | --- | --- | --- |
  | `bfi82u` | 帶日期請求 | `market/daily.json` 當日場次已齊 |
  | `t86`／`margin` | 帶日期請求 | 籌碼報告該來源的 stamp ＝今天 |
  | `borrow` | title 日期走過今天 | 同一份報告的 borrow stamp（同一條判準） |
  | `bwibbu` | 帶日期請求（0.7.11） | `fundamental/*.json` 的 `valuation.dataDate` ＝今天 |
  | `mops_*` | 出表日期＝今天 | 同一份檔案的最新一期 **≥ 上游剛發布的那一期** |

- 🔁 **MOPS 由相對改絕對**：0.7.11 用「這一輪有沒有往前走」，那回答的是「有沒有變動」而不是
  「該有的那一期在不在」——資料早就補齊時會永遠答不出到位。改成由探針順手帶出
  `資料年月`／`年度+季別`（`mopsRevenuePeriod` / `mopsProfitPeriod`），判準變成 `檔案 >= 上游剛發布`。
  用 `>=` 是因為 backfill 可能早就補到更新的一期（實測：OpenAPI 快照停在六月，畫面已有七月）。
- 🧹 因為判準都變成絕對值，**抓取前的基準相片（`readBaseline`）整個拿掉**，`readEvidence` 也不再需要
  抓取回傳的 body——少一個 hook、少一組狀態。
- 🔗 **合併重複的 tick 型別**：`index.ts` 的 `ProbeTickResult` 與 `probeRound.ts` 的 `ProbeTick` 是同一個
  東西的兩份定義，正是它讓 `period` 欄位漏接。現在只有一份。
- 🧪 **對齊本身變成可檢查的**：新增稽核測試——每個來源都必須有抓取、有收工判準，
  且**空證據一律不收工**；再餵一組混入抓取端欄位名（`ok`/`synced`/`generated`/`reason`）的雜訊證據，
  七個來源必須全部答「沒到位」。未來新增來源時，這條線不會被悄悄跨過。
- 🔬 **DEV 今晚兩個獨立來源各自跑完整條鏈路**：
  `bwibbu` 20:40 命中→抓取→`資料已到位`；`margin` 20:50 命中→`generate-chips` 產出 5 檔→`資料已到位`；
  兩者在下一輪都進入 `skipped`。

### 0.7.11（2026-08-11）— 修好排程：探針觸發抓取，資料真的上畫面才收工

- 🐞 **BUG-024：估值每天存的都是前一個交易日**（`chip_raw_cache` 連續四天無一例外）。三個原因同向疊加：
  1. `BWIBBU_ALL` 沒有日期參數，實測永遠落後一個交易日；
  2. `readLatest` 以「要建的交易日」為快取鍵，當天第一次抓到什麼就凍結一整天；
  3. `generate-market-data` **沒有 cron**，沒有任何東西會再跑一次。
- ✅ **探針與抓取都改用帶日期的 `BWIBBU_d`**，用**表頭文字**定位欄位（TWSE 不保證欄序，估值錯了畫面上
  不會有任何跡象）。當天沒出表就回 null，不退回舊快照——`buildFundamentalFile` 保留既有估值與它自己的
  真實日期，讓「還沒出」保持誠實。快取換新 dataset 名，被污染的舊列永不再讀。
- 🔓 **拆掉第二道封印**：`existing.dataDate >= targetDate` 的意思是「這份是為哪個交易日建的」，不是
  「裡面的估值多新」。早上用舊快照建過的檔案因此被封一整天——現在還要求裡面的估值日等於這一輪真正抓到的。
- 🖥️ **收工判準改成「使用者看得到」**：`bwibbu` 比對前端讀的 `fundamental/*.json` 的
  `valuation.dataDate`；`mops_*` 比對該檔最新一期在這一輪有沒有往前走（需要抓取前先照一張基準相片，
  故新增 `readBaseline`）。問抓取函式「你做了什麼」只能證明我們抓了，不能證明畫面換了。
- ⏰ **補上缺的班表**：`market-data-daily`（台北 18:00／22:00）與 `history-daily`（台北 12:30／21:30，
  各在 MOPS 探測槽後半小時）。兩區都建好，用 clone 既有 job 的 command 的方式帶過 CRON_SECRET。
  探針仍是主要且更早的觸發，班表是**最外層重試**。
- 🔭 `bwibbu` 探測窗由 17:30 提前到 **15:00**——舊的起點是配合「鏡像幾點追上」而訂，那已經不是問題。
- 🧯 **Edge Functions 從來沒被型別檢查過**：根 `tsconfig` 只含 `src`，所以 `supabase/functions/` 少一個
  import 也能通過 `tsc` 與 `oxlint`，只會在伺服器上炸。今天就真的漏了一個 `rocDate` 並進了 DEV 容器。
  新增 `npm run typecheck:edge`（`tsconfig.edge.json` + 最小的 `Deno` 宣告），現在 0 error；
  它當場就抓到另一個真實型別錯誤（`ProbeTick.note` 少了 `| null`）。
- 🔬 **DEV 實測全鏈路**：20:35 命中→觸發→`data_landed=false`「資料未到位，下輪重試」；
  20:40 命中→觸發→`data_landed=true`「資料已到位」；下一輪 `bwibbu` 進入 `skipped`。

### 0.7.10（2026-08-11）— 讓探針的「命中→抓取」那段接線可以被測試

- 🧪 **問題**：0.7.8／0.7.9 最容易錯的地方不是那些純函式（都測了），是**它們之間的接線**——
  命中之後有沒有真的去叫抓取、抓完有沒有拿正確的來源去驗證、`data_landed` 有沒有寫回**那一列**。
  而 `index.ts` 是 145KB 的 Deno 模組，模組層就建好 `db` client、底部直接 `Deno.serve`，
  vitest 匯入不了，**整支一行測試都沒有**。等 TWSE 上架才能驗證，等於這段永遠沒有回歸保護。
- 🔌 **改法**：把一輪的編排抽成 `probeRound.ts` 的 `runProbeRound(planned, todayYmd, deps)`，
  I/O（探測、寫 tick、跑抓取、讀成品、寫回）全部改成注入的相依；`handleProbe` 退化成只負責
  「算時間、接真實 DB／網路／時鐘」的轉接層。**行為完全不變**。
- ✅ 新增 9 個測試，涵蓋以前只能靠等待才驗得到的分支：命中觸發對應抓取、
  **抓取成功但資料沒進來→不算收工**、抓取拋錯→不算收工、三個籌碼來源命中但 `generate-chips` 只跑一次
  且三筆各自判定、預算用完留給固定班表、**tick 一律先落地才輪到抓取**（順序是正確性而非風格）、
  已收工的來源完全不探、窗外連 DB 都不查。
- 🔬 用 mutation check 驗過這些測試有咬合力：把判準改回 0.7.8 的「只看抓取有沒有拋錯」，
  其中 2 個測試立刻失敗。

### 0.7.9（2026-08-11）— 收工的判準改成「資料真的到位」

- 🎯 **問題**：0.7.8 用「抓取函式有沒有拋錯」當作收工判準，但**抓取可以完全不出錯卻什麼都沒帶回來**——
  `syncMarket` 上游空手時回 `reason:'empty'`、`generate-chips` 在 T86 還沒上架時照樣產得出一份
  用昨天資料做的報告。把那種情況記成收工，等於用一個假答案關掉當天剩下所有重試機會。
- ✅ **改法**：抓完之後**回頭讀成品**，比對它自報的日期，判準寫成純函式 `sourceLanded`：
  - `bfi82u` → `market/daily.json` 當日場次已齊（量值＋三大法人，沿用 `isMarketSessionReady`）
  - `t86`／`margin` → 籌碼報告裡該來源自報的日期＝今天（`ReportSources` 的 stamp，不是「報告產出來了沒」）
  - `borrow` → 沿用命中時的同一條判準 `borrowHit`：日期要**走過**今天（盤中自帶當日額度）
  - `bwibbu` → 估值檔自報的民國日期＝今天
  - `mops_*` → 這輪確實補進了資料。**唯一一個看「有沒有做事」而非「資料在不在」的來源**，
    因為月營收／季報散在各檔個股的歷史檔裡，沒有便宜的單點可問；代價有界（一天只探四槽）。
- 🏷️ 欄位改名 `follow_up_ok` → **`data_landed`**，名字要說出它的意思——「follow-up 成功」現在會是謊話。
- 🧾 tick 備註改成三段式：`當日 BFI82U 含買進 · 已觸發 sync-market：updated，法人補 1 天 · 資料已到位`，
  沒到位則寫 `資料未到位，下輪重試`。回應新增 `landed` 欄位。

### 0.7.8（2026-08-11）— 探針命中就直接把資料抓回來

- 🎯 **命中即抓取**：探針原本是純觀測，只寫 `source_probe_tick`，抓資料完全交給固定班表——
  代表「量到上游已經上架，卻要再等下一個班次才去拿」（今天 BFI82U 15:10 就綠了，班表 15:15 才動），
  而班表被停用的那段期間更是永遠不會動。現在命中會在同一次呼叫裡把對應的抓取叫起來。
- 🔗 對應關係是「誰消費這個來源」，寫成 `PROBE_FOLLOW_UP`（`sourceProbePlan.ts`）：
  `bfi82u`→`sync-market`；`t86`／`margin`／`borrow`→`generate-chips`（三者都是個股籌碼的欄位，
  一輪只跑一次）；`bwibbu`→`generate-market-data`；`mops_*`→`generate-history`。
- ⏱️ **45 秒預算**，刻意低於 cron 給的 60 秒 `timeout_milliseconds`：超時會被記成「探針失敗」，
  連量到的讀數一起賠掉。放不進預算的抓取留給固定班表，`note` 寫明「預算不足」。
  同一輪多支要跑時**便宜的先跑**，長的被擋下也不會拖累短的。
- 🔁 **抓取失敗的源不算完成**：`source_probe_tick` 新增 `follow_up_ok` 欄位，
  `pendingSources` 的判斷從「命中」改為「命中 **且** 抓取成功」。失敗、逾時、寫回失敗都留在待探清單裡，
  下一輪重試——否則當天就再也沒有第二次機會，變成「量到了、卻沒拿回來」。
  固定班表維持開啟，作為最外層的重試。
- 🧾 抓取結果寫回該筆 tick 的 `note`（`已觸發 sync-market：updated，法人補 1 天`），
  後台探針記錄本來就在印 `note`，「命中 → 抓了什麼」因此落在同一行、同一個人已經在看的地方。
- ⚠️ **需要 DDL**：部署 Edge 前要先跑
  `ALTER TABLE source_probe_tick ADD COLUMN IF NOT EXISTS follow_up_ok BOOLEAN;`（已寫進 `schema.sql`）。
  欄位不存在時查詢會失敗而退回「全部照探」，不會靜音，但每輪都會重跑抓取。

### 0.7.7（2026-08-11）— 個股籌碼矩陣、移除長條圖、探針命中即收工

#### 一、探針命中後當天就不再探該來源

- ⏭️ **命中即收工**：探針只回答「這個源今天幾點上架」，答案拿到就不會再變。
  改版前命中之後仍每 5 分鐘重問到窗口關閉——今天 BFI82U 在 15:10 命中，卻在
  15:15／15:20／15:25 又各問了一次，對 TWSE 多打幾十次沒有意義的請求，
  後台進度條也會被一整排綠格灌爆，反而看不出「它暗了多久」這件唯一在量的事。
- 🧮 判斷寫成純函式 `pendingSources(planned, alreadyHit)`（`sourceProbePlan.ts`），
  DB 查詢留在 `index.ts`；表不存在或 RLS 擋掉時退回「全部照探」而不是「全部不探」——
  探針靜音看起來會跟「這個源永遠沒上架」一模一樣，那正是這個實驗最不能造假的讀數。
- 📤 回應新增 `skipped` 欄位，讓安靜的一輪讀得出是「已經有答案」而不是「探針壞了」。
- ⚠️ 取捨講清楚：**上游事後修訂探針看不到**。修訂屬於抓取端的職責
  （`generate-chips` 的 `t86_revisions` 已經在管），不是探針的。

#### 二、移除個股買賣超長條圖；修正「探針命中但資料不更新」

- 🗑️ **移除個股籌碼的「近 N 日買賣超」長條圖**：矩陣已經把每個法人、每一天都攤在畫面上，
  這張圖是把同一批數字再畫一次。連帶移除法人切換鈕與可點擊圖例（它們只服務這張圖）。
- 🐞 **「BFI82U 顯示命中，但資料沒有更新」——不是程式壞掉，是沒有任何東西被排程去抓**：
  `generate-chips` / `sync-market` / `sync-macro` / `sync-fx` 四支 cron 自 0.7.3 的 probe-only
  實驗起全部 `active = f`，而 probe 依設計**只寫 `source_probe_tick`，不會觸發抓取**。
  手動觸發 `sync-market` 立刻回 `reason:"updated"`、`institutionalFilled:1`，證明抓取路徑本身正常。
- ✅ **DEV 四支班表已恢復**，並依探針實測把 `sync-market` 從 15:30／15:45 調整為
  **15:15／15:30／15:45**（UTC `15,30,45 7 * * 1-5`）——2026-08-11 實測 BFI82U 在 15:00／15:05
  仍「尚未齊」，**15:10** 才轉綠。**PROD 班表未更動**，需另行授權。
- 🔍 **後台探針面板不再宣稱「固定盤後 cron 已停用」**：那是一句頁面根本查不到的硬寫死狀態，
  班表一恢復就變成假話。改為明講**命中＝上游有資料 ≠ 已經抓回來**，這正是這次誤判的來源。

#### 三、個股籌碼的三大法人也改用同一套矩陣

- 🧭 **個股 → 籌碼 → 三大法人買賣超改為「法人 × 日期」矩陣**：原本是**一次只看一天**，
  上方用日期鈕切換（`chip-toggle`）。要回答「外資這幾天在買還是在賣」得逐日點過去並自己記住
  7 個數字，而且**任何時候都有 6 天躲在一次點擊之外**。改為 5 列 × N 欄後全部同時在畫面上，
  日期鈕已無事可做，一併移除。
- 🔢 **格子改用約當張數（張）**：個股外資買賣超的股數是八位數（+20,145,000），七欄並排是一面數字牆。
  **確切股數保留在格子的 `title`**，滑鼠停留即可看到，沒有真的失去資訊。
- ➕ **新增「N 日累計」欄**；📈 **「連買連賣」移到法人自己的列**並附波折圖，
  且**一律以買賣超計算**，不隨買進／賣出口徑改變（毛額沒有方向可言）。
- 🔀 **買進／賣出改為口徑切換**（與總體經濟版一致），切換時不套紅綠。
- ♻️ **兩張表共用樣式與底色刻度**：`heatStyle` 移入 `chipFormat.ts`，
  CSS class 由 `.mac-inst-matrix` 改名為 `.inst-matrix`——同一個編碼在兩個尺度上回答同一個問題，
  不該有兩套會各自漂移的實作。
- ℹ️ 融資融券與餘額走勢區塊維持原樣。

---

### 0.7.6（2026-08-11）— 三大法人買賣超改為「單位 × 日期」矩陣

#### 功能摘要

- 🧭 **表格轉置**：總體經濟 → 台股市場的「三大法人買賣超・近 7 個交易日」原本是
  **日期 × 單位**的樹狀展開表——要回答「外資這幾天在買還是在賣」得展開 7 次、跨 7 個區塊
  跳著讀同一個名字的列，且預設只展開最新一天，**外資與投信在其餘 6 天是看不到的**。
  改為 **列＝六個單位、欄＝七個交易日**：6×7 一次全見，**完全沒有展開狀態**。
- 📅 **日期由舊到新，與同卡片的三張圖同向**：舊表是唯一反向（最新在上）的元件。
- 🎨 **格子底色編碼強度**，且**以該單位自己這 7 天的最大值為準**：外資動輒數百億、外資自營商
  只有個位數，用全表同一把尺會讓除了外資與合計以外的列全部是灰的。
- ➕ **新增「7 日累計」欄**：這是舊表算不出來的答案（得自己心算 7 個數字）。
- 📈 **走勢欄移到單位列**：「連 N 日買超／賣超」描述的是**單位**，不是日期；仍讀滿近 15 個
  交易日，連續天數不會被表格的 7 欄截斷。
- 🔀 **買進／賣出改為口徑切換**：原本常駐佔掉 5 欄中的 2 欄，但真正的訊號是買賣超。
  切到買進／賣出時不套紅綠——毛額恆為正，上色等於一個永遠說同一件事的顏色。
- 📱 **首欄（單位）凍結**：橫向捲動後仍看得到是誰的數字。
- 🧩 設計稿：`docs/architecture/macro_inst_index.html`（6 案比較，本次採用方案一）。

---

### 0.7.5（2026-08-11）— BUG-025：收盤後十分鐘行情卡仍顯示「盤中」

#### 功能摘要

- 🐞 **13:30–13:40 的行情卡停在盤中**：`twQuoteTtlMs` 在 13:30 之後只要報價還沒定案就一律退避
  10 分鐘（0.6.42 為了 AUDIT-02 的整夜輪詢而加），於是收盤那一輪拿著 **13:29 的盤中快照**
  被判為新鮮十分鐘——右上角印「盤中」、價量都是收盤前的值，**手動重新整理也沒用**
  （Edge 的 `price_cache` 用同一支函式判定）。
- ✅ 新增 **13:30–14:00 沉澱窗**：未定案的報價在窗內維持 60 秒輪詢，過 14:00 才退回 10 分鐘退避。
  已定案（撮合時間達 13:30:00）仍立刻鎖到隔天 08:25，不會白輪半小時。
- 🔁 需同時部署 **frontend（L1 快取）與 `stock-price` Edge（DB 快取）**，只改一半不會生效。

---

### 0.7.4（2026-08-11）— 修正三個恆為真的探針命中，後台改「一源一列」

#### 功能摘要

- 🐞 **借券／月營收／季報的命中判定原本永遠是「中」**：三者都寫成「端點有沒有資料」，而
  `TWT96U`（盤前就掛當日額度）與兩張 MOPS 彙整表（永遠回整份快照）盤中就恆有資料。
  0.7.3 的窗一開就會全綠，量不到任何落地時間。改為：
  - 借券 → `title` 日期**走過今天**才算命中（`borrowHit`）；窗提前到 **15:00** 才看得到翻日那一刻
  - 月營收／季報 → **出表日期＝今日**才算命中（`mopsIssueRocYmd`）；`data_ymd` 改寫真值，不再填探測日
- 🖥️ **後台探針面板改版**：一源一列 + 命中進度條（一格＝一次 5 分探測），點列展開逐次 log
  （時分／命中／資料日期／列數／耗時／指紋前 8 碼／說明）。窗未開的源仍保留自己的列。
- 🗑️ **移除「排程」表**；問題數不再把實驗期間刻意停用的 cron 算成延遲（原本是 4 個常亮假警報）。
- 📄 `schema.sql` 補上 `source_probe_tick` DDL（0.7.3 只手動建在兩個 DB，SoT 沒有）與實際的 `*/5 * * * *`。
- 🔤 T86 未命中備註錯字「尚日」→「當日」。

---

### 0.7.3（2026-08-11）— 探針實驗：固定盤後 cron 暫停，每 5 分探測命中

#### 功能摘要

- 🧪 **兩日驗證用**：停用 `stock-report-nightly` / `market-daily` / `macro-daily` / `fx-daily`（`active=false`）。
- ⏱️ 僅 **`source-probe` 每 5 分**（`*/5 * * * *`）；Edge 依台北時間窗決定探哪些源。
- 📊 新表 `source_probe_tick`：每源每 slot 記 **hit／沒中**、資料日、指紋、備註。
- 🖥️ 管理後台「探針實驗・命中時序」：如 **1500 沒中**、**1505 中**（今＋昨）。
- ⚠️ **不寫 reports／不自動 generate**；月／季只在 12:00／21:00 附近探測。驗證後再恢復正式班表。

---

### 0.7.2（2026-08-11）— 盤後稀疏班：T86／BFI 兩班 + 晚間融資借券

#### 功能摘要

- ⏱️ **台股夜班改稀疏固定班**（實驗版，先觀察命中率；**尚未**加深夜補洞）：
  - **BFI82U／全市場** `market-daily`：台北 **15:30／15:45**（`sync-market`）
  - **T86 + 融資借券** `stock-report-nightly`：台北 **16:30／16:45**（T86）與 **21:30／21:45**（融資／借券）
  - body 改 **`generate-chips`**（不再掛密集 `generate-all`），避免 cloud free 單請求串 phase 撞 546
- 📝 **日 K／營收歷史**（`generate-market-data`／`generate-history`）此版**未掛自動 cron**，管理後台可手動
- 🖥️ Admin 時間軸 `dueBy`、`describeCron`、ACTION_SCOPE 對齊新班表
- 🔧 DEV + PROD 已 `cron.alter_job`（保留 CRON_SECRET；secret_len=48）

---

### 0.7.1（2026-08-11）— 總經台美分頁；三大法人表；BUG-024 融資融券

#### 功能摘要

- 🎨 **總體經濟**拆二次分頁：**台股**｜**美國經濟**（預設台股）。
- 🎨 **三大法人買賣超**主表：**日期 × 單位 × 買進／賣出／買賣超**；波折圖放大；**「連 N 日買超／賣超」**在圖上方；恢復 **＋／− 展開** 與全部展開／收起（**預設只展開最新交易日**）。
- 🐛 **BUG-024**：0.7.0 誤刪 `chipReportReady` / `fundamentalSoftReady` 導致 chips phase 500、融資融券整區空白；已還原。
- 📚 測試 SoT（`docs/UnitTests/`）、skills（testing / verify / ship）、PROGRESS 歸檔。
- ✅ PROD Edge `stock-report` **v39** 已 deploy（`--no-verify-jwt`）；BUG-024 雲端生效。前端隨 `main` 推送。

---

### 0.7.0（2026-08-10）— 移除搜尋個股與 TOP20；個股分析回到僅持股

#### 功能摘要

- 🗑️ **個股分析**拿掉「搜尋個股」（觀察清單／全市場搜尋）與 **TOP20** 分頁，回到**僅台股持股下拉**（pre-0.6.44 產品形態）。
- 🗑️ Edge 夜批／backfill 範圍改回**全站淨持股**；刪除 `sync-top-tickers` / `ensure-top-tickers`、`meta/top_tickers` 寫入路徑與管理後台「TOP20 名單」。
- 🔐 `generate` / `warm` **恢復持股白名單**（`heldTwTickers`）+ 登入把關；`warm_quota` 仍作第二層上限。
- ✅ **保留** 0.6.44 以降與兩功能無關的修訂：progressive warm、generate 三 phase、手動更新／進度條、FOMC、月營收早申報、daily/fund skip、日 K／布林、BUG-023 等。
- 📦 DB：`tw_watchlist` / `warm_quota` **不強制 DROP**（既有環境免破壞性 migration；code 不再讀觀察清單）。
- ⚠️ 需 deploy `stock-report --no-verify-jwt`；前端推送後前端生效。

---

### 0.6.52（2026-08-10）— MI_INDEX20 連線 RST 不再炸掉盤後

#### 功能摘要

- 🐛 OpenAPI `MI_INDEX20` **Connection reset** 時不再讓 `sync-top-tickers` / `generate-history` 回 **HTTP 500**。
- 重試 + 失敗改走 `STOCK_DAY_ALL` 依成交量排前 20；仍失敗則**沿用 Storage 舊名單**。
- **market-data / history** 只讀 Storage 的 TOP 名單，不再每 phase 重打證交所（避免 RST 拖垮營收補齊）。
- ⚠️ 需 deploy `stock-report --no-verify-jwt`。

---

### 0.6.51（2026-08-10）— TOP20 成交量（MI_INDEX20）；日K／布林回來

#### 功能摘要

- 🔄 **TOP 名單改為證交所「每日成交量前二十名」**（頁面 mi-stock20.html；OpenAPI `exchangeReport/MI_INDEX20`）。
  UI／管理後台文案改 **TOP20**，列表顯示**成交量（張）**，不再用 STOCK_DAY_ALL 成交金額前 30。
- 🎨 **技術面還原日 K、均線、KD**，並新增**布林通道（20, ±2σ）**疊在 K 線上；行情摘要含布林下／中／上。
- ⚠️ 需 deploy `stock-report --no-verify-jwt`；手動「TOP20 名單」或夜班會重寫 `meta/top_tickers.json`。
  夜批標的數約自 35 → 持股∪觀察∪**20**，可減輕盤後負載。

---

### 0.6.50（2026-08-10）— 技術面只留成交量；日線 skip 更穩

#### 功能摘要

- 🎨 **技術面移除日 K／均線／KD**，保留**成交量折線**＋表格（量比／收盤／漲跌）；行情卡摘要去掉均線與 KD，保留 RSI／MACD／量比。
- 🛡️ **盤後日線／基本面**：檔案已達資料日則**不打 Yahoo、不重寫**；Yahoo 空回覆不覆蓋既有有資料的 daily 檔（防丟資料）。
- 📊 手動更新摘要顯示 `dailySkipped` / `fundSkipped` / `allCached`，方便二次手動驗證是否短路。
- ⚠️ UI 精簡**不直接縮短**籌碼／history 秒數；二次手動若 market-data 出現大量 skipped 才是 skip 生效。
- ⚠️ Edge 有 `syncDaily`/`syncFundamental` 變更 → 需 deploy `stock-report --no-verify-jwt`。

---

### 0.6.49（2026-08-10）— 盤後 generate 三階段（防雲端 546）

#### 功能摘要

- 🏗️ **`generate-all` 拆成三 phase**：`chips` → `market-data` → `history`。
  - cron 的 `generate-all` 在約 **110s** 預算內依序跑，時間不夠就 **跳過後段**（下輪再補，P1）。
  - 管理後台改為三個手動 job（各一次 HTTP／各有算力預算），進度條可看出卡在哪段。
- 📝 **P1**：history 仍是一輪月營收+季報上限；完整 12/12 靠夜班多輪，不要求手動一次補滿。
- ⚠️ **需 deploy** `stock-report --no-verify-jwt`（正式／DEV）；前端推 `main` 上線。
- 原因：雲端 Edge 546 compute（本機 self-hosted 較不易重現）。

---

### 0.6.48（2026-08-10）— 手動更新進度條；版號規則釐清

#### 功能摘要

- ✨ **管理後台「手動更新」進度條**：全部／勾選執行時顯示完成比例、目前項目、
  每項狀態（等待／執行中／完成／失敗）、HTTP、耗時與摘要，方便看出卡在哪一步。
- 📝 **版號規則**：`dev` 開發中一律 `x.x.x-dev.N`；**只有正式 release commit** 才去掉 `-dev`；
  release 後 `dev`／`main` 版號必須一致（見 `versioning` skill / CLAUDE.md §12）。
- ⚠️ **僅前端**；推 `main` 後前端生效，不必 redeploy Edge。

---

### 0.6.47（2026-08-10）— 手動更新「全部執行」不再一次請求逾時

#### 功能摘要

- 🐛 **管理後台「手動更新 → 全部執行」** 不再把多個 job 塞進同一個 Edge 請求。
  先前伺服器端依序跑完 `generate-all` 等全部項目，容易超過平台約 150 秒上限，
  瀏覽器只看到 `Edge Function returned a non-2xx status code`（常見 HTTP 504）。
  現改為**每個 job 各打一次**，各自獨立時間預算；逾時訊息也會帶 status／提示。
- ⚠️ **僅前端**：**不必**為此 redeploy Edge。前端部署已停用。
  （正式區 `stock-report` 若仍落後 0.6.46 的 TOP30 action，單獨跑「TOP30 名單」
  仍可能 400，那是另一件 deploy 缺口。）

---

### 0.6.46（2026-08-10）— 新股票提早就緒、TOP30、搜尋個股

#### 功能摘要

- ⚡ **progressive warm**（`phase=core|history`）：新股／觀察先秒級可畫，歷史背景補齊；BUG-A 封印後仍可走 history。
- ✨ **夜批 = 持股 ∪ 觀察 ∪ TOP30**（16:00 起與 T86 同窗）；15:00 仍只有全市場 BFI82U。
- ✨ **個股分析 TOP30** 分頁（成交金額排行、含 ETF、最多兩交易日快照、每頁 10 檔）；空檔可 `ensure-top-tickers` 補抓。
- 🎨 分頁文案：**其他台股 → 搜尋個股**；TOP30 **資料日 = 交易日**（與證交所來源對齊，不再並列民國來源日造成誤解）。
- ✨ FOMC 會議點、market-daily 15 分 + 當日齊備短路等（dev 期間累積）。

#### 部署注意

- ⚠️ 需 deploy `stock-report`（`--no-verify-jwt`）：`phase`、TOP30、`ensure-top-tickers`、`sync-top-tickers`、`reportComplete` scopes。
- ⚠️ 正式區首次需寫入 `meta/top_tickers.json`（管理後台 TOP30 或等 16:00 `generate-all`）。

<details><summary>開發期間明細（dev.1–dev.12）</summary>

#### dev.12（2026-08-10）— release polish

- 🎨 **其他台股 → 搜尋個股**。
- 🐛 **TOP30 資料日對齊交易日**：寫入 ymd 取證交所 `Date`；UI 只顯示一個資料日（西元）。

#### dev.11

- 🐛 TOP30 重新整理失敗不再清空；分頁 10 檔。

#### dev.10

- 🐛 Storage 空時 `ensure-top-tickers`；文案 TOP30。

#### dev.9

- ⚡ market-daily 每 15 分；當日量能+法人齊備短路。

#### dev.8

- ✨ TOP30 分析分頁與兩日 archive。

#### dev.7

- ✨ TOP30 併入 generate-all；雙 scope `reportComplete`。

#### dev.6–dev.1

- progressive warm、薄季報 history、FOMC 會議點、prefetch／觀察清單夜批等。

</details>

### 0.6.45（2026-08-07）— FOMC 目錄補齊

- 🐛 **總經 `sync-macro` 在舊檔已「今日掃過」時會永遠跳過新指標**（prod 手動更新 115ms、`reason=skipped`，FOMC 不進檔）。現在若 Storage 缺 `FRED_SERIES` 任一 id（如 DFEDTARU）會強制重抓。正式區已 deploy `stock-report` v32 並寫入含 FOMC 的 `macro/us.json`。

### 0.6.44（2026-08-07）— 個股分析可查全市場台股

#### 版面

- 🎨 **個股分析標題列**：股票名稱固定在持股／觀察選單旁；切換「其他台股」時不再被搜尋列往下頂。移除灰字提示「個股分析」。

#### 功能摘要（含 dev 期間）

- ✨ **二次分頁**「我的持股｜其他台股」；觀察清單雲端 `tw_watchlist`（每帳最多 5 檔）。
- ✨ **全市場搜尋**非持股台股；`warm` 登入 + 每日額度；月營收早申報可補。
- ⚡ **基本面 soft warm**：有檔先顯示；僅薄檔才 on-demand warm；無進度不重複打 Edge。
- ✨ 管理後台手動更新、FOMC 利率區間、手動更新反映於抓取狀況等（見下方 dev 明細）。

#### 部署注意

- ⚠️ 需套用 `warm_quota` + `take_warm_quota`、`tw_watchlist` 表；deploy `stock-report`（`--no-verify-jwt`）。self-hosted DEV 已套用；正式區若尚未套用需另授權。

<details><summary>開發期間明細（dev.1–dev.8）</summary>

#### dev.8（2026-08-07）

- 🎨 **個股分析標題列**：名稱固定在選單旁；其他台股搜尋改排下方；拿掉灰字「個股分析」。

#### dev.7（2026-08-07）

- ⚡ **基本面載入：有檔先顯示、背景再 warm**。不再為了補歷史先清空畫面。
- ⚡ **warm 觸發放寬**：僅在「無檔 / 月營收 0 / 月 < 6 / 季獲利 0」時 on-demand warm；已有 6+ 月且至少 1 季的交給夜批補滿 12。
- ⚡ **warm 封印**：僅在 `fundamentalComplete: false` **且本輪 backfilled > 0** 才解封；無進度不再每次開頁重打 Edge。
- 📌 **新持股**：進「個股分析」仍會立刻 warm（無檔）；同一 session 若有補到資料可再開再補；其餘靠夜批。**新增交易當下不會自動抓基本面。**

#### dev.6（2026-08-07）

- ✨ **個股分析拆二次分頁**：`我的持股`｜`其他台股`。非持股改為可雲端同步的觀察清單（表 `tw_watchlist`，每帳最多 5 檔；本機模式寫 localStorage）。已持股不可佔格；買進變持股會自動剔除。
- 🐛 **月營收早申報可見**（如川湖 7 月營收在 8/10 前已上 MOPS）。`publishedMonths` 永遠含上個月；公告窗未關的月份不寫入 `revenueBackfilledThrough`，避免 partial MOPS 頁把「沒資料」釘死。openapi `t187ap05_L` 仍可能停在上上月，早鳥改走 MOPS 補洞。
- ⚠️ **需同步**：套用 `tw_watchlist` 表 + RLS + max-5 trigger；deploy `stock-report`（月營收邏輯）。只上前端不上表 → 觀察清單退回 localStorage；只上表不上 Edge → 早申報仍缺月。

#### dev.5（2026-08-07）

- ✨ **美國總經新增 FOMC 目標利率區間**（FRED `DFEDTARU` / `DFEDTARL`）。以決議變動日為階梯點，畫面顯示 `下限–上限%`，版型與 CPI 等同列；不參與月頻「落後 N 期」比較。

#### dev.4（2026-08-07）

- 📝 **market-daily 補上抓取對象說明**（FMTQIK / MI_5MINS_HIST / BFI82U → `market/daily.json`）。排程表 `describeScope` 先前漏了 `sync-market`，畫面上看不出這班抓什麼。

#### dev.3（2026-08-07）

- 🐛 **手動更新會反映在「抓取狀況」排程表**。先前手動只打 handler、不經 pg_cron，圖表有更新但最後執行時間空白。現在寫入 `admin_run_log`，並與 `cron.job_run_details` 合併顯示（標「手動」／「排程」）。

#### dev.2（2026-08-07）

- ✨ **管理後台新增「手動更新」**：管理員可勾選或全部觸發與 cron 相同的五項批次（盤後個股 / 全市場 / 美總經 / 匯率 / 探測）。走 `admin-run` + 管理員 JWT，**不把 CRON_SECRET 送到瀏覽器**。

#### dev.1（2026-08-07）

- ✨ **個股分析頁可搜尋未持股的上市櫃台股**。持股下拉仍列你的台股；旁邊「查詢其他台股」走與交易表單相同的 `searchStocks`。搜到自己已持有的代號仍走持股路徑，保留成本與 ROI。
- 🔐 **`stock-report` 的 `generate` / `warm` 改以登入帳號把關**，不再限制「必須有人持有該代號」。`warm`（會打 Yahoo/MOPS）另加每帳號每日 30 次上限；計次走 Postgres 函式 `take_warm_quota`（原子遞增，併發打不穿）。額度表/函式故障時 **fail-closed**（503），避免白名單撤掉後無上限。`generate` 只讀批次已備的籌碼快取，不加計次。
- 🐛 **搜過的個股日 K 過期會再 warm**。夜批只刷新有人持有的 `daily/*.json`，純搜尋留下的檔會永遠停在搜尋當日；現在對照籌碼報告的 `dataDate`，落後就補抓。
- ⚠️ **需同步（順序）**：先套用 `warm_quota` 表 + `take_warm_quota` 函式，再 deploy `stock-report`（`--no-verify-jwt`）。只上前端不上 Edge → 非持股 403；只上 Edge 未建表 → warm 503。DEV（self-hosted）已套用；正式區待授權。

</details>

### 0.6.43（2026-08-06）— 稽核清單收尾

- 🐛 **後台排程認不得的 cron 會標示「未解析的排程」**，不再原樣印出。原樣印出本身沒說謊，
  但在畫面上看起來像刻意的呈現，分不出「少一條分支」與「就是要顯示原字串」——
  BUG-012 與 BUG-014 都躲在這裡。
- 🐛 **本機模式寫入失敗會說明原因**。原本直接拋出瀏覽器的原始錯誤，變成沒人接住的例外：
  資料沒存成功，畫面上什麼都沒說。現在會顯示「儲存空間已滿」或「無痕視窗無法寫入」。
- 🐛 **總經發布期別的月份改用取正模數**，避免負數月份（今天的年份碰不到，是拆掉一個陷阱）。
- 🐛 **台股市場「顯示全部」真的能看到整份檔案**（最多 120 天），不再被圖表用的 60 天切片卡住。

### 0.6.42（2026-08-06）— 稽核找到的四個問題

- 🐛 **試撮價在庫存總覽掛上「試撮」標記**。08:30–09:00 與 13:25–13:30 的價格是**還沒成交的預估值**，
  報價卡一直寫著「試撮中」，庫存總覽卻用同一個數字算未實現損益、什麼都沒說。
- 🐛 **備援報價不再整夜每分鐘重抓**。Yahoo 備援永遠不回撮合時間，而 0.6.37 之後「沒有撮合時間」＝「未定案」＝
  短 TTL，於是 MIS 中斷期間每檔股票整夜每分鐘抓一次、沒有上限。改為 **10 分鐘**重試 ——
  不鎖定（那是 0.6.37 修的 BUG-011，必須保留），但流量降為十分之一。
- 🐛 **匯率區間在月底會少算幾天**。`2026-05-31` 往前推 3 個月原本會得到 `2026-03-03`（而非 02-28），
  區間最多短少三天且畫面上看不出來。
- 🐛 **盤後籌碼的指紋改用分隔字元串接**。原本用空字串串接，`['12','3']` 與 `['1','23']` 會產生同一個指紋 ——
  而那個指紋正是判定「今日 T86 是否定案」的閘門。

### 0.6.41（2026-08-05）— 後台排程的最後一列也讀得懂了

- 🐛 **總經排程（`macro-daily`）原本也是印原始 cron 字串**。核對 BUG-012 時發現的同類問題：
  `describeCron` 的步進分支要求結尾是平日 `1-5`，而這個排程是**每天**，因此一條都沒中。
  現在讀作「每日 20:00–次日 02:30 每 30 分」——**「次日」不能省**，否則會被讀成早上跑。
- 🐛 **步進區間的結束分鐘改為由步長算出**，不再寫死 `:45`。原本只有 15 分步長的排程用得對，
  換成 30 分就會少報 15 分鐘。

### 0.6.40（2026-08-05）— 時間軸圖例分開交代兩套排程

- 🐛 **時間軸上方的圖例不再寫死「盤後批次 16:00–23:45」**。那句話本身沒錯，但它是
  pg_cron 裡那個值的**第二份副本**，而且整段只提這一套排程 —— 0.6.38 把全市場移到 15:00 之後，
  圖例等於在說「今天最早的班次是 16:00」，與事實不符。使用者就是這樣發現的。
- 現在兩套排程分開講，且**都從 cron 讀出來**：個股的法人 / 日 K / 融資融券 / 借券走盤後批次，
  三大法人・全市場走獨立排程。判定說明也改寫成「全市場可能 15:00 那輪就到手，個股 T86 要等 16:30，
  兩者都正常」。

### 0.6.39（2026-08-05）— 後台排程讀得出新的半小時班表

- 🐛 **後台「排程」那一列不再顯示原始 cron 字串**。0.6.38 把 `market-daily` 改成
  `0,30 7-10 * * 1-5`（台北 15:00–18:30 每半小時），但 `describeCron` 沒有對應的分支，
  整條表達式原樣印出來 —— 畫面上因此**從頭到尾沒提到 15:00**，使用者一眼就看出來了。
  現在讀作「週一至週五 15:00–18:30 每 30 分」。
  單一分鐘的整點區間（`0 8-10`）仍逐班列出，三班分開寫比「每 60 分」好讀。

### 0.6.38（2026-08-05）— 成交量表格、版面合併、年度收益搜尋、法人金額提早開抓

- 📋 **技術面新增每日成交量表格**，並把 KD 與成交量對調（日 K → KD → 成交量 → 表格）。
  欄位為 日期 / 成交量 / **量比** / 收盤 / 漲跌 —— 量比講得出「今天是 20 日均量的幾倍」，
  這是長條圖給不了的；1.5 倍以上加粗。預設 20 列，可展開到目前區間全部。
  ⚠️ 這張表與上方「行情」卡**本來就會有落差**（2026-08-05 的 2330：日線批次 35,214 張、MIS 31,851 張），
  兩個來源兩個口徑，表格下方已標明。
- 📋 **台股市場新增每日成交量表格**：日期 / 成交股數 / 成交金額 / 筆數 / 加權指數 / 漲跌，預設 7 列可展開。
  不必動後端 —— `tradeVolumeShares` 與 `transactions` 早就存在檔案裡，只是從沒顯示過。
  股數與金額並列是刻意的：同一天可以「股數較少但金額較大」，那就是資金往高價股移動的樣子。
- 🔍 **年度收益新增搜尋欄位**：可用代號、原名或中文名（AAPL → 蘋果）過濾。
  搜尋會**連年度合計一起重算**，而不是只把明細藏起來 —— 否則年度那一列的總額
  會對不上畫面上任何一筆。上方四張 KPI 卡維持全部交易的累計，不受搜尋影響。
- 🧩 **個股分析：「報價」改名「行情」，技術面的「指標摘要」併進來**。
  合併時拿掉摘要裡的收盤 / 開高低 / 成交量 —— 上面的報價已經即時顯示同樣的東西。
  留下的是報價給不了的：均線、KD、RSI、MACD 柱、量比。
  ⚠️ 兩半可能是**不同日期**（報價是即時、摘要來自盤後日線批次），故摘要保留自己的資料日。
- 🧩 **總體經濟：美國指標的 chip 列與近期走勢表合併為同一張卡**。
  拆成兩張時，「資料更新於」與「重新整理」看起來只管上面那張。
- ⏱ **三大法人買賣金額（BFI82U）提早到 15:00 開抓**，並改為每半小時一班（15:00–18:30）。
  證交所約 15:00–15:30 公布，原本 16:00 才起跑。撲空的班次不寫檔、不動 `asOf`，
  成本只有兩個請求，所以提早沒有代價。
  ⚠️ 15:00 那班能不能拿到，還取決於 FMTQIK（每日市場成交資訊）是否也已公布。

### 0.6.37（2026-08-05）— 修正收盤鎖定把「盤中快照」凍住

- 🐛 **收盤後只鎖「確認是收盤定案值」的報價**。0.6.36 在 13:30 之後一律鎖定，
  連拿不到撮合時間的快取也照鎖 —— 正式區當天就出事：升級前寫入的快取列沒有
  `trade_time`（那是盤中某一刻的快照），卻被鎖到隔天 08:25，
  個股分析的報價卡因此一路顯示「盤中」、開高低量全是「—」。
  原本的推理「現在是 13:30 之後，當日不會再有新價」對**價格**成立，
  對**這筆是不是收盤定案值**不成立。
- 同一個原則也套用到 14:00 之後：先前「過了 14:00 一律鎖定」會把撮合時間停在
  盤中時刻的列凍一整夜，現在一樣要確認定案才鎖。
- 代價是來源持續回非定案值時整夜維持每分鐘重試 —— 那是異常狀態，本來就該持續重試。

### 0.6.36（2026-08-05）— 個股分析改放報價；台股收盤後不再抓價

- 🐛 **修正後台時間軸的基準日**：先前綁在「個股籌碼報告的資料日」，
  但軸上五列來自不同批次 —— 個股 T86 走盤後批次（16:30 才到手）、
  全市場 BFI82U 走獨立的 `market-daily`（16:00 就到）。
  結果每天 16:00–16:30 之間，**準時到手的全市場那列會被算成 25 小時、判定為「延遲」並畫到軸最右端**
  （2026-08-05 實際發生）。基準日改取各來源資料日的最大值，標題也跟著同一個基準。
- 時間戳落在本輪軸範圍外的列（例如個股還停在昨天）一律顯示「等待中」，
  不再拿上一輪的時間戳去算座標（那會畫成 −22.5 小時、被夾到軸最左，看起來像超早到手）。
  ⚠️ 借券的資料日**刻意不參與**基準日計算：它自報的是公布日（次一交易日），天生比本輪多一天。

- **個股分析的第一張卡由「我的持股」換成「報價」**：開盤、最高、成交量、昨收、最低、
  預估（試撮價）、今收共七格。收盤後那格叫「今收」，盤中叫「成交」——
  盤中根本還沒有收盤價，沿用同一個字只會讓人誤讀。
- 七格全部來自現價本來就會回的同一筆 TWSE MIS 回應（`o/h/l/v/y/z/ip`），**零額外請求**。
  ⚠️ 刻意**不用** TWSE OpenAPI 的日收盤端點（`STOCK_DAY_AVG_ALL` / `STOCK_DAY_ALL`）：
  2026-08-05 15:23 實測，收盤後兩小時它仍停在前一個交易日，
  當時 2330 它回 2320（其實是昨收），MIS 回的今收是 2405，差 3.6%。
- **台股收盤後不再對外抓價**：13:30 收盤到隔天 08:25 試撮前，報價快取一路有效，
  期間背景輪詢全部命中快取、零請求；08:25 後自動恢復每分鐘更新。
  規則只看台北時鐘，不查交易日曆——週末與國定假日一到 13:30 就自然落入長效期。
  手動「重新整理」仍可強制抓取。
- 庫存總覽現價的 tooltip 補上「哪一天」：收盤後標交易日與「收盤」，
  快取價明說「這是上次抓到的價格，不一定是今天的」（先前隔夜看到的快取價
  會被描述成「較昨收 …」，而那個昨收其實是前天的）。
- 個股分析頁不再顯示任何持股數字，PDF 匯出範圍改為四段全含（報價是公開市場資料）。

### 0.6.35（2026-08-05）— 美國總經改成台股法人表那種讀法

- **五張 KPI 字卡壓成一行 chip**（只有名稱與最新值），細節全交給下方的表。
- **走勢表由「一列一個月份」改成「一列一個指標」**，右側掛該指標自己的走勢線與
  「連 N 期上升 / 下降」，點左側「＋」展開該指標逐期的數值與較上期。
  轉置的理由：法人表的「趨勢／連續」描述的是「合計」這一個序列，而五個總經指標
  沒有合計可言（單位是 %、千人、指數），一列一個指標語意才成立。
- ⚠️ **顏色規則改為全表一致：紅＝比上期高、綠＝比上期低。**
  非農就業先前是依「數值正負」上色（就業增加＝紅），現在跟著看升降 ——
  所以「+57 千人但比上期少 72」會是綠的。表格下方已標明**紅不等於好消息**。
- 迷你走勢線抽成共用的 `SparkCell`，台股法人表與總經表共用同一份繪製。

### 0.6.34（2026-08-05）— 現價漲跌著色；台股三張圖同步 hover；總經卡片改用連續期數

- **庫存總覽的現價改用顏色說話**：字級回到與其他欄位一致，改成**比昨收高是紅色、低是綠色**
  （0.6.20 的放大加粗取消）。放大只說得出「這欄重要」，顏色說得出「今天是漲是跌」。
  滑鼠停在價格上會顯示漲跌金額、幅度與昨收。
- **昨收不多花一次請求**：證交所 MIS 的 `y` 與 Yahoo 的 `chartPreviousClose` 本來就在
  同一筆回應裡，先前被丟棄。⚠️ **`price_cache` 新增 `prev_close` 欄位**（見 `schema.sql`）
  —— 快取一命中就不會再問來源，基準不跟著存的話顏色會在 TTL 內外之間閃。
  **需重新部署 `stock-price` 並執行該 ALTER**（測試區已完成）。
  台股 OpenAPI 備援路徑沒有昨收，走到那條時該檔顯示平盤色。
- **台股市場的三張圖改成上中下疊放，並共用同一個 hover**：滑到某一天，日 K、指數走勢、
  成交金額會同時反白那天並各自給出提示。左右並排時每張只有一半寬度，
  同一個像素位置在兩張圖上不是同一天，對不起來。
- **開高低沒補到的日子改為留白而非略過**：過濾掉會讓 K 線的第 N 根不是另外兩張的第 N 天。
- **美國總經指標卡移除迷你走勢線**，改為「連 N 期上升 / 下降」的 chip（連 2 期以上才顯示）。
  仿台股法人表的「連續」欄，但判定的是**與前一期的升降**而非正負號（CPI 年增率永遠是正的），
  且刻意不套漲跌色 —— 物價或信心「比上期高」本身沒有好壞之分。

### 0.6.33（2026-08-05）— 台股市場卡片整理；全市場法人進到後台時間軸

- **指數改成左 K 線、右走勢線並排**，成交金額維持下方全寬（≤900px 自動疊成一欄）。
- **移除法人買賣超長條圖**：同一份數字已經有表格（看得到金額）與趨勢欄（看得出方向），
  長條圖是第三種說法，只是把卡片拉長。
- **趨勢欄拆成「趨勢」與「連續」兩欄**：原本走勢線與「連 N 日」擠在同一格，
  有標籤的列會把線往左推，整欄的線頭線尾對不齊。
- **表格加「全部展開 / 全部收起」**，不必一列一列點。
- **表格下方說明縮成一句**，抓取週期整段移到後台 ——
  前端自備一份班次常數必然與 pg_cron 漂移（實際漂過：卡片寫「最多 5 天」時後端已是 15）。
- **後台時間軸新增「三大法人・全市場」一列**，既有那列改名為「三大法人・個股」：
  兩者一個是 T86（每檔持股、單位股）、一個是 BFI82U（整個集中市場、單位元），
  先前都叫「三大法人」，看起來像已經涵蓋了。

### 0.6.32（2026-08-05）— 法人買進 / 賣出與趨勢；抓取週期進到後台

- **法人統計表可展開看買進與賣出金額**。證交所的 `BFI82U` 本來就有這兩欄，
  先前只取了買賣差額 —— 現在點日期左邊的「＋」就能看到六個單位各自的買進、賣出、買賣超。
- **表格多一欄「趨勢」**：合計買賣超近 15 個交易日的迷你走勢線，加上「連 N 日買超 / 賣超」。
  走勢刻意比表格的 7 列長 —— 它回答的是「這天處在什麼走勢裡」，不受表格顯示幾列限制。
- **抓取週期寫在卡片上**：台北時間 16:00 / 17:00 / 18:00、僅平日。
- **管理員後台新增「台股全市場」一段**：最新交易日、法人金額補到哪一天、
  買進 / 賣出的回補進度、缺開高低的天數。週期直接翻譯自 pg_cron，前端不另存一份常數。
- ⚠️ **舊資料的買進 / 賣出需要時間補齊**：0.6.32 之前補到的日子只存了差額，
  盤後排程每輪最多重抓 15 天（本版由 5 調高），120 天約 3 個工作天補完；
  補完之前那些日子沒有展開鈕。

### 0.6.31（2026-08-05）— 大盤法人買賣超補上逐日表格；年度收益加報酬率

- **「年度收益」的年度 / 個股 / 逐筆賣出三層都多一欄「報酬率」**：已實現損益 ÷ 賣出成本，
  主行含費、副行未含費（與左邊三欄同一體例）。只買未賣或超賣導致分母為 0 時顯示「—」，
  不會出現 `NaN%` 或 `Infinity%`。

- **「台股市場」的法人買賣超長條圖下方多一張表**，逐日列出外資、外資自營商、投信、
  自營商（自行 / 避險）與合計的金額（億元）。長條圖看得出方向，但看不出當天到底幾億。
- 表格由新到舊、圖由舊到新（與月營收、獲利能力兩處一致，刻意相反）。
- 還沒補到法人金額的日子整列顯示「—」，不以 0 冒充。

### 0.6.30（2026-08-04）— 大盤日 K 線；法人買賣超改看一週

- **「總體經濟 → 台股市場」多了加權指數的日 K 線**（開高低收，近一季）。
- **三大法人買賣超改成只看最近 7 個交易日**，與個股分析的籌碼圖一致 ——
  兩張圖問的是同一件事，一張看一週、另一張看一季會讓人以為在比不同的東西。
  成交金額與指數維持一季：那是「行情在什麼位置」的脈絡。
- 開高低與收盤是不同來源，最新一兩天可能只有收盤 —— 那幾天不畫 K 棒，
  不會拿收盤價冒充開盤（否則會畫出一排看起來像真的十字線）。

### 0.6.29（2026-08-04）— 新加入的股票不必等到隔天；移除新聞

- **新加入的股票第一次開啟個股分析時，會直接把基本面歷史補到滿**
  （近 12 個月月營收、近 12 季獲利能力與每股盈餘）。原本這些只在夜間批次補，
  而批次在當天資料齊了之後會整段短路 —— 晚上加的股票當天一輪都補不到，隔天才開始長。
  代價是第一次開頁的「基本面」那段要多等約半分鐘；補不完會在下次開頁自動接著補。
- **新聞功能整個移除**：AI 分析不再有「消息面」，相關的抓取、儲存與提示詞段落全部刪除。
  （0.6.13 移除的只是管理後台的新聞追蹤，功能本體當時仍在。）

> 這一版的 Edge Function 已部署至兩區，舊的新聞檔也已清除。

### 0.6.28（2026-08-04）— 每股盈餘、以及台股大盤的量能與法人買賣超

- **「基本面 → 獲利能力」多了每股盈餘 (EPS)**：KPI 一格、季度表一欄、
  以及**獨立一張走勢圖**。EPS 的單位是元、比率是 %，兩者不能畫在同一條縱軸上。
- EPS 來自季報，比比率晚幾天才補上 —— 最新一季可能先顯示「—」，
  此時 KPI 會退回最近一筆有數字的那一季並標明是哪一季，不會整格空著。
- **「總體經濟」頁多了「台股市場」區塊**：每日成交金額與三大法人買賣超（全市場、單位億元），
  搭配最近交易日的成交金額、加權指數、法人買賣超與外資買賣超四格。
- 大盤的法人買賣超約 15:00–15:30 才公布、且逐日回補，最新一兩天沒有長條是還沒補到。

> 這一版含 Edge Function 與排程異動，兩區皆已部署（`market-daily` 排程已建立）。
> EPS 由回補逐季補上，每輪 2 季，補滿 12 季約需數輪。

### 0.6.27（2026-08-04）— 法人買賣超圖也能關掉個別法人

- **「近 N 日買賣超」的並排圖，點圖例就能把某個法人關掉**，與獲利能力走勢圖同一套操作。
- 外資的量級常常是投信的數十倍，把外資關掉之後**縱軸會依剩下的重算**，
  另外三家彼此的差別才看得出來。
- 切到單一法人檢視時圖例講的是紅買綠賣，不是身分，故不提供切換。

### 0.6.26（2026-08-04）— 獲利能力走勢圖可以只留想看的那條

- **點圖例就能把某條線關掉**（再點一次回來），想單看稅後純益率就把另外三條收起來。
- 關掉之後**縱軸會依剩下的線重算** —— 這才是重點：稅後純益率單獨看時會撐滿整張圖，
  不會再被毛利率的尺度壓在底下。
- 關掉的項目仍留在圖例上（色塊變成空心），不會找不到怎麼開回來；
  最後一條不給關，免得整張圖變成空的座標軸。

### 0.6.25（2026-08-04）— 獲利能力看得到走勢了

- **「個股分析 → 基本面 → 獲利能力」多一張 12 季走勢圖**，毛利率／營益率／稅前／稅後
  四條線畫在同一張圖上。12 季的數字本來就在表格裡，但表格讀不出方向；
  四條線疊在一起還能直接看出**它們之間的落差** —— 毛利率與營益率的距離就是營業費用率。
- 圖在表之上，與月營收同一個順序。只有一季時不畫圖（一個點連不成線）。
- 金融業沒有毛利率，那條線會斷開，其餘三條照常。
- 順帶修正說明文字：季度序列實際保留 **12 季**，原本仍寫著 8 季（0.6.22 已改為 12）。

### 0.6.24（2026-08-04）— 移除表格收合

- **0.6.23 的表格收合整個拿掉**，個股分析回到「頁面上有什麼就是什麼」。
- 連帶拿掉右上的「全部收起 / 全部展開」，以及匯出 PDF 前那段「先展開、擷取完再還原」
  的處理 —— 收合沒了，PDF 一直就是完整的。

### 0.6.23（2026-08-04）— 個股分析的表格可以收合了

- **每張表格的標題都變成開關**，點一下就收起來，長頁不必再一直往下捲。
  收起時標題那一行的時間戳與單位仍然看得見 —— 那正是「要不要展開來看」的依據。
- 右上多一顆**「全部收起 / 全部展開」**。
- 只有表格可收合，圖表不動：圖表本來就是一眼看完的東西，收起來省不到什麼。
- 匯出 PDF 前會自動全部展開再擷取、事後還原 —— 不會因為你收起了某張表，
  PDF 就默默少一段。

### 0.6.22（2026-08-04）— 補齊季度獲利能力的歷史

- **「個股分析 → 基本面」的季度獲利能力補齊到 12 季**。原本每晚抓的官方端點只給
  「最新一季」，要湊滿得等三年，所以那張季度表長期只有一兩列；現在改由公開資訊觀測站的
  季報彙總回補，兩區都已補到 2023 Q2 起連續 12 季，毛利率／營益率／稅前／稅後的
  趨勢終於看得出來。
- 之後每季新的財報照常由每晚批次接上，回補補滿後不會再發任何對外請求。
- 金融業沒有「毛利率」這個概念，那一欄會是空的，其餘三項照常。

### 0.6.20（2026-08-04）— 修好「最後登入」、總經頁看得到持股獲利能力

- **修好管理後台的「最後登入」**。那個時間本來就不會動 —— 只有真的重新登入才會更新，
  一直沒登出的帳號會永遠停在很舊的時間，看起來像壞掉。改成**「最近活動」**，
  看的是最近一次連線。
- **總經頁新增「持股獲利能力」**：把每一檔持股的毛利率／營益率／稅前純益率／稅後純益率
  橫向排開比較，各帶一條近 8 季走勢線。這些數字原本只在「個股分析 → 基本面」裡，
  一次看一檔，比不出來。只有台股個股有這份資料，ETF 與美股顯示「—」。
- **庫存總覽的現價放大加粗**。它是那張表上唯一隨時在動的數字，其餘都是成本與換算。
- **帳號選單的「原始碼」改用 GitHub 官方圖示**。

### 0.6.19（2026-08-04）— 導覽整理、總經走勢線、管理後台

- **分頁列依功能重排**：庫存總覽／個股分析／年度收益／交易紀錄是「我的部位」，
  總體經濟／外幣匯率是「市場環境」，兩組之間加一道分隔線。
- **「抓取狀況」離開分頁列**，收進新的**管理後台**（右上角帳號選單進入，只有管理員看得到）。
  後台目前有抓取狀況與 AI 連線設定兩塊。
- **AI 設定從「個股分析 → AI 分析」搬到管理後台**。那份表單本來就只有管理員能用，
  卻長在一個所有人每天都會開的分頁裡。
- **總經指標卡加上近 12 期走勢線**，落後的指標直接在卡片上標「落後 N 期」並改畫虛線。
- **GitHub 連結從頁尾移進帳號選單**，頁尾只留免責聲明。
- **AI 提示詞可以在網頁上改了**。管理後台多了「提示詞」一頁，
  分析與追問的準則都能直接編輯，不必改程式碼重新部署。
  安全規則（不得給買賣指令與目標價、結尾免責聲明、攤平風險提示、追問的框限）
  由系統固定接在後面、改不了，畫面上會照實印出來讓你知道自己改不到什麼。
- **管理後台多了「帳號」一頁**：看得到所有註冊帳號的建立時間與最後登入時間，
  也能直接指派或收回管理員權限。改完之後那個帳號要重新登入才會生效，
  這句話寫在畫面上。
- 這一版更新了 Supabase：`app_settings` 加兩個欄位存提示詞、Edge Function 加兩個管理員專用動作。

### 0.6.18（2026-08-04）— 程式碼整理

- **畫面與功能完全沒有變化**，這一版只整理程式碼本身：把幾處重複的寫法收成一份，
  讓之後改東西時不會漏改其中一份。
- 影響的是「抓取狀況」頁的班次時間軸、總經發布行事曆、以及盤後批次的台北時間換算。
- 測試 721 項全過（新增 4 項）。

### 0.6.17（2026-07-31）— 下期發布日改用官方公告日

- 「抓取狀況」頁的「下期預計」原本顯示的是**推估區間**（如 08-10 ~ 14），
  現在直接顯示**官方公告的確定日期**（如 2026-08-12）。
- 底層改動：發布行事曆只留後端一份，由後端算好回傳給畫面。
  原本前後端各有一份常數，遲早會不一致，而不一致的症狀
  （畫面說 8/12、後端卻按 8/14 判定）幾乎看不出來。

### 0.6.16（2026-07-31）— 修好「三大法人」被誤判成延遲

- **三大法人明明準時到手卻顯示「延遲」。** 判定的期限是 16:30，而那一輪實際在
  **16:30:03** 才寫入 —— 差三秒就被判成延遲，同一刻抓到的日 K 線卻顯示正常，
  畫面一紅一綠像壞掉。判定改成以「輪次」為單位（含該輪 15 分鐘緩衝），
  不再卡精確秒數。
- 圖例補上說明：淡色區塊是**證交所公布資料的時間**，不是我們的抓取排程
  （盤後批次是週一至週五 16:00–23:45 每 15 分一輪），兩者容易混淆。

### 0.6.15（2026-07-31）— 總經改為「發布日才密集抓，抓到就不抓」

- **改用官方發布行事曆決定什麼時候去抓**。以前是每天固定兩班盲抓，
  現在平常每天只抓一次，**到了官方公布日才從公布時刻起密集掃，一抓到就停**。
  結果是更即時（從「最慢隔天」變成「公布後半小時內」）而且對外請求反而變少。
- 官方公布日是**提前公告的確定日期**（不是區間）：核心 CPI 8/12、核心 PPI 8/13、
  非農就業 8/7、核心 PCE 8/26，皆美東上午 8:30。真正不確定的是「官方公布 →
  FRED 收錄」之間的延遲，密集掃描就是為了追這一段。
- 消費者信心暫不納入密集掃 —— 它在 FRED 上已停更（6 月的數字遲遲沒有），
  仍由每天那一次例行抓取跟進，來源恢復就會自動拿到。

### 0.6.14（2026-07-31）— 排程說明抓取範圍，發布日改用實測區間

- **每個排程都寫明自己抓什麼**。原本只看得到 `generate-all`、`sync-macro` 這種代號，
  現在名稱下方直接說明範圍（例如 macro-daily 是「FRED 五個序列：核心 CPI / PPI / PCE、
  非農就業、消費者信心」）。
- **下期預計改用區間**。原本顯示單一日期（如 08-12），是我依「一般慣例」填的、沒有根據。
  這版改以 ALFRED 的 vintage 反查近三期的**實際發布日**來歸納區間 ——
  結果發現實際日期每月都在跳（核心 CPI 橫跨 10–14 日、核心 PCE 橫跨 25–30 日），
  給單一日期等於假裝精確。原本「非農＝每月第一個週五」的規則也是錯的（實測 7/2 是週四）。
- 落後的指標改為顯示**落後幾期**，「落後 1 期」與「落後 3 期」意思完全不同 ——
  後者代表來源可能停更了。

### 0.6.13（2026-07-31）— 總經也有了時間軸，手機版修正

- **總經新增「今日班次」時間軸**，跟台股盤後同一種讀法：一天 24 小時的軸上標出
  美東發布時刻、當天兩班各自跑了沒、資料最後變動在幾點。
  順帶把「21:00 那班在冬令會跑在美東發布之前」這件事畫了出來 ——
  那正是先前總經固定慢一天的成因。
- **告知下次抓取時間**：「今日 21:00（6h 23m 後）」。另外每個指標也列出下期預計發布日
  （非農 8/7、CPI 8/12、PCE 8/28…），但那是**依慣例推估**、非官方行事曆，
  畫面上有標示；排程並不依賴它，還是每天兩班照跑。
- **手機上看不出哪一項延遲了**。時間軸需要約 700px 才畫得完，手機只能左右滑，
  而預設停在最左邊 —— 借券那種「隔天早上才補到」的項目落在右半邊，等於白畫。
  現在手機改成直接把狀態與時間列在每一列右側，一眼就看得到。
- 順帶修好手機上狀態標籤看不見、圖例文字被擠成一字一行的問題。
- **移除個股新聞的追蹤**（不再顯示於此頁）。

### 0.6.12（2026-07-31）— 新增「抓取狀況」頁（僅管理員）

- **新增「抓取狀況」頁，只有管理員帳號看得到。** 以時間軸呈現當日台股盤後那一輪：
  三大法人、日 K 線、融資融券、借券、個股新聞各自**預期什麼時候公布、實際幾點抓到**，
  晚了多久一眼看得出來。這三個籌碼來源的公布時間差達 7 小時，
  過去只能靠翻報告的時間戳去猜。
- **排程一覽**：四個 pg_cron 排程的執行時機（已換算成台北時間的白話）、
  今日執行與失敗次數、最後執行時間，以及**每個排程實際打的是哪一區** ——
  曾經發生過測試區的排程打到正式區，這一欄就是為此而存在。
- **總經與檔案涵蓋**：五項指標各自的最新期別，落後的會標出來；
  日線 / 基本面 / 新聞各有幾檔到位。

### 0.6.11（2026-07-31）— 修好總經數據永遠慢一天

- **總體經濟頁的數字總是慢一天才更新**，冬令時更是每個月都慢。
  美國的物價與就業數據在台灣時間深夜才公布，而排程雖然排了兩班（21:00、23:00）
  就是為了「第一班沒等到就讓第二班補」，實際上第一班只要跑完就會讓第二班整個跳過 ——
  就算第一班撲空也一樣。核心 PCE 的六月數字就是這樣卡了一天。
  現在兩班都會真的去看一次，有新數字才更新。
- **順帶跟上官方的事後修正**：FRED 會回頭修改已經公布過的月份
  （七月三十日那次就同時改了四月和五月的數字），現在這類修正也會一併更新。
- 畫面上的「資料更新於」現在只在**數字真的變了**的時候才跳。月報一個月才動一次，
  所以若已隔了幾天，旁邊會補上「（最後檢查 …）」—— 分得出是「這個月還沒公布」
  還是「排程壞了」。

### 0.6.10（2026-07-31）— 修好「融資融券」永遠是空的

- 個股分析的籌碼頁，**融資融券那一區永遠停在「今日融資融券尚未公布」**，
  即使已經是深夜、資料早就公布了也一樣；走勢圖也總是少最新的一天。
  原因出在盤後批次：融資融券約 21:00 才公布，那一輪確實有抓到，
  但判斷「要不要重新產生報告」的條件寫錯了，抓到了也不會寫進報告，
  要等隔天下午才補上——而那時畫面早就換看新的一天了。現在當天的資料一到就會立刻更新。

### 0.6.9（2026-07-29）— AI 分析在本地模型上也能穩定跑

先前把 AI 設定指到本地或自架的 OpenAI 相容端點（Ollama / vLLM 等）時，
常常一下子「分析失敗」、一下子只寫半段就斷掉。這一版把三個原因一次處理完。

- **推理型模型也能用了**（deepseek-r1 / qwq / gpt-oss 等），不必為此換模型：
  - 送出請求時會先要求端點關掉思考 —— 這份工作不需要推理，數字都是程式算好的。
  - 端點不支援時，改用模型的思考內容，但**會在最前面標明「這是思考過程、不是正式結論」**；
    思考包含推導草稿與中途自我修正，數字可能是模型後來否定掉的。
  - 正文裡夾著 `<think>` 的情況會自動剝掉，只留正式結論。
- **不會再寫到一半就斷**：先前呼叫這類端點時沒有指定輸出上限，用的是端點預設值，
  而很多端點預設只有幾百 token。現在會明確送出上限。
- **失敗時講得出原因**：原本不論成因都只顯示「回傳結構未包含有效的
  choices[0].message.content」。現在會分別指出是模型把答案放在思考欄位、
  輸出額度用完、模型拒答、被安全過濾擋下，還是模型名稱不存在。

其他：

- **AI 分析新增操作框架的語彙**：金字塔建倉（下跌分批加碼）、倒金字塔停利
  （上漲分批賣出）、非等距網格、馬丁格爾變體。AI 可以用這些名詞描述目前數據
  落在哪個情境，但**仍不會給出明確的買賣指令、比例或價位**。
  提到馬丁格爾時會一併說明它的前提（標的不歸零且資金無限，真實帳戶並不成立）；
  提到攤平時會提醒攤平會放大部位、不等於降低風險。
- 修好手機上**個股分析的個股切換選單被擠成一小塊**的問題（只看得到「18…」）。
  現在選單在手機上獨占一列，長股名（例如「00929 復華台灣科技優息」）也完整顯示。

### 0.6.8（2026-07-29）— 個股分析改為單頁，折線圖改成 Google Finance 風格

#### 個股分析不再需要切分頁

籌碼、基本面、技術面、我的持股四個分頁併成一頁到底，順序為
**我的持股 → 籌碼 → 基本面 → 技術面**，每段一張卡片。AI 分析仍是獨立分頁。

- 「下載 PDF」改為匯出籌碼＋基本面＋技術面，**不含持股數字**（個資不進匯出檔）。
  匯出倍率會依內容長度自動調整，避免長頁在 iOS Safari 上產出空白檔。
- 圖表改為**整張圖一個鍵盤焦點**、進去後用方向鍵逐點移動。
  原本每個資料點都是一個 Tab 停留點，一年份的日 K 就有 244 個。

#### 折線圖新樣式

匯率頁 2 張、籌碼頁融資／融券 2 張、基本面月營收 1 張：

- 線下方**漸層面積填充**，往下淡出。
- hover 時出現**垂直虛線**，並在該點畫實心圓。
- **提示框貼著資料點**上下移動，不再固定在圖表頂端；最左／最右的點也不會超出容器。
- 資料點超過 20 個時不再逐點畫圓（一年 260 顆圓點會把線糊成一條毛毛蟲）。
- **基本面的月營收新增走勢圖**，營收缺漏的月份斷線不內插。
- K 線、成交量長條、KD 三張圖維持原樣。

### 0.6.7（2026-07-29）— 新增外幣匯率頁

以台幣為本位的第六個頂層頁面，支援美元、日圓、歐元、人民幣、港幣、英鎊、澳幣、韓元 8 種外幣。

- **幣別卡為即時中價**（最多延遲 10 分鐘，開頁才查、不開頁就不抓），
  顯示「1 單位外幣可換多少台幣」與當日升貶方向；點卡片切換，選擇會記住。
- **走勢圖兩個方向並排**：「新臺幣 / 外幣」與「外幣 / 新臺幣」，可切 3 個月 / 6 個月 / 1 年，
  各自顯示區間高低與漲跌幅（兩者互為倒數，高低點日期會對調）。
  歷史由每日排程 `fx-daily`（台北 11:00 / 17:00）預產於 `fx/twd.json`。
- 資料超過 3 天未更新時頁首顯示警示 —— 這頁的數字會被拿去換錢，
  而舊檔在畫面上與新檔長得一模一樣。
- ⚠️ **匯率為市場中價，非銀行牌告匯率。** 原訂採用台灣銀行牌告匯率，但其端點已被
  JS 人機驗證擋住（整站皆然，Edge Function 無法通過），故改用 Yahoo Finance。
  實際結匯請以往來銀行的現金／即期買賣價為準（通常有 0.3%～1% 的價差）。

其他修正：

- **個股分析的個股切換下拉**改用與頁首工作區選單同一個元件（BUG-005）——
  它的樣式在 0.6.6 被當成死 CSS 刪除，退化成沒有樣式的瀏覽器原生控制項。
- 修掉圖表 Y 軸對小於 1 的數字一律標成「0」的問題（既有圖表數值都 ≥ 1 所以沒踩到，匯率會）。

### 0.6.6（2026-07-28）— 手機改用底部導覽列

手機上分頁不再擠在頁首第二行，改成像一般行動 App 那樣固定在螢幕底部，
圖示在上、名稱在下，拇指構得到。

- **頁首從兩列變一列**（106px → 58px），只剩品牌、工作區、帳號。
- **不再需要靠收窄間距硬擠**：底部列每格是直式的，375px 螢幕上
  五個分頁每格 71px、就算加到第六個也還有 59px（原本五個就差 1px 折行）。
- 「新增交易」浮動鈕上移讓開導覽列；版本徽章改到頁尾下方
  —— 手機的左下角已經不是空地了。
- 桌機完全不變。

### 0.6.5（2026-07-28）— AI 分析可以繼續問，新增總經與獲利能力

**「AI 解讀」更名為「AI 分析」，而且產生分析後可以繼續追問。**
對話嚴格框在「這檔股票的數據」之內，問到範圍外（閒聊、其他個股、寫作、時事）
會一字不差回一句固定的婉拒 —— 固定句才看得出框限有沒有被繞過。
也擋提示詞注入：「忽略上述指示」「你現在是別的角色」一律視同越界。

- 刻意**不做關鍵字過濾**：「這檔跟聯電比呢」會被誤擋，
  「用這檔資料寫首詩」卻過得去，而且黑名單永遠追不上繞法。
- 框限規則**每一輪都重送**，對話變長也不會被稀釋。上限 10 輪。
- **順便修掉「切分頁 AI 結果就消失」**：分析與對話存進瀏覽器工作階段，
  切回來直接還原，不必重按（＝不重複計費）。

**新增「總體經濟」頁面**：核心 CPI、核心 PPI、核心 PCE、非農就業、消費者信心，
資料來自美國聖路易聯準銀行 FRED，每天自己排程更新（與台股交易日無關）。

> 「核心」只有 CPI / PPI / PCE 有標準定義（排除食品與能源）。非農採市場實際看的
> 月增人數；消費者信心與 CCI 實質是同一件事，免費且仍在更新的只有密西根大學那支。

**基本面新增「獲利能力」**：毛利率、營益率、稅前純益率、稅後純益率，
由證交所按季彙總。序列逐季累積，最多保留 8 季。

以上兩類資料都會一併餵給 AI，但明令**總經是背景不是個股因果**，
不得用來推導這檔股票的漲跌。

#### 頁首也整理過

**右側由 8 個控制項收斂成 2 個選單**：工作區選單、帳號選單。
原本「工作區下拉 ＋ 新增 ＋ 重新命名 ＋ 費率 ＋ 刪除 ＋ 主題 ＋ email ＋ 登出」
一字排開，其中四顆是無標籤圖示，而刪除工作區就緊鄰重新命名。
現在管理動作收在工作區選單裡，**刪除隔一條分隔線並用紅色**。

順手修掉三個量出來的版面問題：

- **寬螢幕的頁首比窄螢幕還高** —— ≥1221px 時 email 一顯示就撐成兩列（106px），
  ≤1220px 反而是單列。現在每個寬度都是 70px。
- **375px 的工作區下拉塌成 39px**，只剩一個箭頭，看不出目前在哪個工作區 ——
  而工作區決定畫面上每一個數字。
- **分頁從四個變五個後在 375px 折行**（高度由 36px 變 57px），已收窄該尺寸的間距。

### 0.6.4（2026-07-28）— 月營收一次補滿 12 個月

月營收原本要**整整一年**才長得滿：TWSE 的 `t187ap05_L` 端點只回最新一個月、
不吃年月參數，所以每檔股票的營收史只能每月一筆慢慢累積，新加入的標的第一個月只有 1 筆。

改接公開資訊觀測站的分月報表（`t21sc03`），把缺的月份一次補齊。

- **缺口驅動、補滿即短路**：先算出還缺哪幾個月，全滿就一個對外請求都不發。
  日後新增持股也會自動補滿，不必手動跑任何東西。
- **順便涵蓋上櫃**：同一份報表有上市 / 上櫃兩版，代號不重疊。
  上櫃股從此看得到月營收（估值三項仍只有上市才有，改以獨立註記說明）。
- 單次上限 4 個月，12 個月分 3 輪補完 —— 防的是 Edge Function 的執行時間上限。
- 回補**只填缺口、不覆蓋既有值**：月營收會更正重發，
  讓歷史爬取蓋掉最新的更正數字等於補歷史反而弄髒現況。

#### 這一版另外修掉的三件事

**1. ETF 會把整批回補卡死。** ETF 不在月營收報表內、缺口永遠填不滿，
於是把「最新那幾個月」永久釘在待抓清單上，真正的公司再也拿不到更舊的資料。
根因是少記了一件事：缺口不該是「檔案裡沒有的月份」，而是「**還沒去找過**的月份」。
改為在檔案裡記錄「已經找到哪個月份為止」，ETF 三輪之後就收斂。

**2. 每晚的批次會抹掉回補進度。** 批次是整份重建檔案，而新增的進度欄位沒被帶過去，
等於每個交易日重走一遍 12 個月。順手把建檔與註記判斷抽成純函式並補上測試 ——
這類欄位遺漏在原本的位置既沒有型別檢查也沒有測試碰得到。

**3. 資料被瀏覽器快取一小時，而且使用者救不了自己。**
盤後批次寫檔時沒有指定快取策略，SDK 預設一小時，於是前端拿到的可能是舊資料。
最惡劣的是 `Ctrl+Shift+R` **沒有用** —— 硬重整只跳過文件與其子資源的快取，
不涵蓋 JS 之後才發出的請求，所以只有無痕視窗才正確。前後端一起修掉。

#### 順帶改善的可觀測性

- **月營收標題旁標示資料產出時間**：「資料更新於 07-28 10:25（共 12 個月）」。
  與估值的「資料日」是兩件事 —— 那個是資料自己宣告的日期，這個是我們寫檔的時刻。
  上面第 3 點就是靠這行才定位到的。
- **個股分析頁加「重新整理」鈕**：強制重抓籌碼、技術面與基本面，
  不必整頁重載、也不必切換股票。

### 0.6.3（2026-07-27）— 加一支資料源探針，讓「幾點更新」變成可量測的事實

想知道估值檔與借券**實際上幾點更新**，結果發現手上的儀器根本量不到 ——
`batch_run_log.bwibbu_date` 看似在記這件事，記的其實是**快取值**：
當天第一輪抓完就整天吃快取，一整晚 12 輪全記成同一個值。
**那不是 12 次觀測，是同一次被讀了 12 遍**；批次一收工更是完全不記。

新增獨立的探針：每 15 分鐘對這兩個來源看一眼，記下它們**自己宣告是哪一天的**、
內容指紋有沒有變，寫進 `source_probe_log`。

- **刻意不碰批次**：不寫快取、不寫報告、不動任何批次狀態。
  盤後批次「資料到齊就收工、該輪零對外請求」的性質完全不受影響。
- 內容指紋一律**先把列排序再算** —— TWSE 的端點不保證列順序穩定（0.6.2 的教訓）。
- 問題答完就能停，一行 SQL，不必重新部署。

### 0.6.2（2026-07-27）— 修好輪詢永遠不會收工的 bug；個股分析自動換上最新報告

**盤後批次永遠不短路（0.6.1 上線當晚實測發現）**

三大法人端點回的 1334 列，內容與集合每次都一樣，但**列的順序每次都不同**
（末欄相同的幾列之間，端點的排序不穩定）。判斷「資料還會不會再改」是比對整包 JSON 的指紋，
順序一變指紋就變，於是每輪都被判定成「又被改寫了」，永遠等不到定稿、永遠不會收工 ——
一天 32 輪全部真的去抓，輪詢改版省下來的東西全部吐回去。

改成先把列排序再算指紋，只看「哪幾檔、各是多少」這個語意，不看端點今天高興怎麼排。

**個股分析頁自動換上最新報告**

0.6.1 把盤後批次改成每 15 分鐘輪詢之後，**報告會在你看著的當下更新**，
而個股分析頁只在開頁那一刻抓一次 —— 分頁開著不動就會一直停在開頁時的快照。
（實際遇到：20:15 的批次已寫出當天的籌碼，20:15 之前開的分頁仍顯示前一個交易日。）

- 分頁切回前景時比對報告的產生時間，**換過一份才替換畫面**；沒變就不動，
  避免每次切回都重繪、洗掉捲動位置與展開狀態。
- 查無報告時保留畫面上現有那份，不會清空。
- 沿用現價既有的 `visibilitychange` 作法，不另開計時器 ——
  背景分頁的計時器會被瀏覽器節流，而切回前景本來就是要看資料的時刻。

### 0.6.1（2026-07-27）— 盤後批次改為輪詢，不再用時鐘猜資料何時發布

原本的三班制（17:30 / 22:30 / 23:30）是照「各資料源大約幾點公布」訂的，
而那個認知在 2026-07-27 一天之內被實測推翻三處（三大法人的時間窗、借券的時間、
甚至借券那份資料的語意）。改法是**別再猜時間，改成密集輪詢＋看內容判斷**。

- **T86 改寫偵測**：三大法人自 16:00 起每 15 分鐘更新，當天第一次抓到的**不一定是定稿**。
  改為定稿前每輪重抓比對，連續兩次內容相同才凍結。舊作法「第一次抓到就永不更新」
  會把初版鎖成當天的答案，比晚抓一次還糟。
- **短路**：今天該有的都到齊且已定稿，該輪一個對外請求都不發。
- **不重複產報告**：輸入（資料日＋三源內容＋持股清單）沒變就不重產，
  讓報告上的產生時間只在真的有變動時才跳。
- **當日執行上限 40 次**：防的是自己的判斷邏輯出錯，以及批次密鑰外流時的最後一道剎車。
- 借券端點沒有日期參數、原本每輪都要重抓 244KB；已有「日期 ≥ 今天」的快取就直接用。
- `batch_run_log` 增記各源「自己宣告的資料日」與改寫次數 —— TWSE 端點不給
  `Last-Modified`，這是唯一能記下來的時間事實，用來事後回答「它到底幾點更新」。

### 0.6.0（2026-07-27）— AI 助理、基本面與消息面

個股分析從三個分頁擴充為五個（籌碼 / 技術面 / **基本面** / 我的持股 / **AI 解讀**），
並讓 AI 依據程式算好的技術面、籌碼、基本面與新聞標題產出白話解讀。

**AI 解讀**
- 個股分析新增「AI 解讀」分頁，**要按下按鈕才會呼叫模型**，不會自動產生任何 AI 文字。
- 支援 `google`（Gemini）與 `openai-compatible`（Ollama / vLLM 等）。使用者自帶端點與金鑰，
  專案不內建金鑰、不代付費用。
- **模型拿不到原始序列**：MA5/20/60、KD、RSI、量能比與 7 日籌碼摘要都由程式算好才餵進去。
  也不含持股、成本與未實現損益。
- 輸出固定為「3–5 段數據解讀＋建議操作＋注意事項＋免責聲明」。建議操作僅限中性、
  條件式的觀察性參考，不得給明確買賣指令、目標價或報酬預期。
- 逾時 180 秒（含讀取回應主體，不只連線階段），以支援本機推論較慢的 local model。
- **截斷不再靜默**：Gemini 2.5 起的思考 token 會計入 `maxOutputTokens`，故上限設 8192
  並關閉思考；被截斷時保留已產生的文字並標明不完整，絕不把半截當成完整結果。

**基本面（新分頁）**
- 本益比 / 殖利率 / 股價淨值比（TWSE OpenAPI `BWIBBU_ALL`，每日）與近 12 個月月營收
  （`t187ap05_L`，含月增與年增；單位千元，檔內自累積）。
- 個股分析頁標題旁顯示**產業別 badge**。
- ETF 與上櫃標的不在 TWSE 這三份資料中，會明確顯示「暫不支援」而非「稍後補上」。

**消息面**
- 盤後批次以「名稱＋代號」查 Google News RSS，近 14 天最多 10 則標題餵給 AI。
  查詢一定要帶代號——只用名稱會抓錯標的（實測「陽明」回的全是陽明交通大學的新聞）。

**AI 設定改為全站共用**
- 由每帳號一份改為 `app_settings` 全域單列：不分帳號、不分工作區。
- 所有登入帳號可讀（前端直連時金鑰終究得進瀏覽器，這是架構的必然），
  **寫入僅限帶 `app_metadata.role = 'admin'` 的帳號**（RLS 檢查 JWT，貼完 tag 要重新登入）。

**新股票不必等夜間批次**
- 技術面與基本面查無資料時，前端補叫 `stock-report` 的 `warm` action 當場產生。
- 額度防護四道：持股白名單、與批次共用的跳過條件、**日線查無也寫空殼檔**
  （否則會變成每次開頁重打的無限迴圈）、前端同代號每個 session 只試一次。

**批次執行紀錄**
- 新增 `batch_run_log` 資料表，每次盤後批次寫一列，記錄該班次跑的時候
  當天的個股三大法人（T86）到了沒。用來實證微調 cron 時段。
- 起因：原本的註解把「大盤買賣金額統計表」與「個股買賣超日報」混為一談
  （實測 15:42 前者已發布、後者尚未），導致第一班的餘裕被高估。

**升級需要做的事**
- 重新套用 `sources/supabase/schema.sql`（新增 `app_settings`、`batch_run_log`；
  並清掉 0.6.0-dev.1 曾短暫存在的 `user_settings.ai_*` 欄位）。
- 重新部署：`supabase functions deploy stock-report --no-verify-jwt`。
- 為管理員帳號貼上 `{"role":"admin"}` tag（語法見 schema.sql §4.1 註解）。

已知限制：
- **本機模式沒有個股分析頁**（資料在 Supabase，本機模式無帳號可存）。
- **Ollama / vLLM 等本機端點尚未實機驗證**：從 `https://` 網域呼叫 `http://localhost`
  除了要設 `OLLAMA_ORIGINS`，還可能被瀏覽器的私有網路限制擋下。詳見 `docs/agent/PLAN.md` §M7。
- 月營收第一次只會有 1 筆，逐月累積到 12 筆。


### 0.5.0（2026-07-26）— 技術面 K 線

個股分析的「技術面」分頁從佔位頁換成真實內容：

- **日 K 線 + 均線**：紅漲綠跌蠟燭，疊上 MA5（週線）/ MA20（月線）/ MA60（季線），
  可切換近 3 月 / 近 6 月 / 近 1 年。
- **成交量**與 **KD 指標**（含 20 / 80 參考線）各一張圖。
- **指標摘要**：收盤與漲跌、開高低、成交量與量能比、三條均線與排列狀態、KD、RSI(14)、MACD 柱。

資料由既有的盤後批次順帶抓取（Yahoo 日線，一年份約 10.8KB / 檔），存進既有的 `reports`
bucket，前端直接下載。**沒有新增資料表**，也不必管保留期 —— 每晚整份覆寫。

用的是**原始收盤價、不做除權息還原**，與券商 App 看到的均線一致；除權息當天會有跳空。

> ⚠️ 需重新部署 `stock-report` 並跑過一次盤後批次，技術面才會有資料。

### 0.4.1（2026-07-26）— 修正 0.4.0 的線上故障

**症狀**：開啟個股分析的籌碼分頁一律顯示「伺服器回傳的報告格式不符，請稍後再試」。

**原因**：0.4.0 把報告結構升到 schema 3（新增 `sources`），但前端的守門仍是
`schema === 2` 的等號比對 —— 於是 Storage-first 全數判為未命中、即點即產也被擋下，
籌碼分頁整個不可用。文件與 commit message 當時寫的是「前端接受 `>= 2`」，
但那個改動其實來自已被回退的分支，從未真正進到這一版。

**修正**：改為 `MIN_REPORT_SCHEMA = 2` 搭配 `>=` 比對 —— 伺服器新增欄位對舊前端是無害的加法，
不該讓整份報告失效。並補上會**在修正前失敗**的回歸測試（schema 3 與未來版本都必須被接受），
把這條規則釘住。

### 0.4.0（2026-07-26）

**盤後批次改為分段執行，能更新的先更新**
- 三個資料源的公布時間差很多：三大法人約 15:00–15:30、融資融券約 21:00–22:00、借券約 21:00–22:30。
  原本等最晚的那個才產報，等於讓最早就緒的三大法人白白晚 6 小時才看得到。
- 改為每交易日跑三段（**17:30 / 22:30 / 23:30**）。批次本身冪等且會自我補完，
  多跑幾次自然逐步補齊；第二、三班幾乎全快取命中，實測約 2 秒。

**每個區塊各自標示資料日與更新時間**
- 報告新增 `sources` 欄位（schema 3），逐項記錄各資料源的資料日期與實際抓取時間。
  資料直接取自既有的 `chip_raw_cache.updated_at`，沒有新增資料表。
- 前端在三大法人、融資融券、借券各區塊旁顯示「資料日 X · 更新於 Y」，
  一眼看得出哪塊是新的、哪塊還沒到。
- 融資融券未到時的文案由「來源暫時無回應」改為「今日尚未公布（約 21:00–22:00），稍晚會自動補上」
  —— 分段執行下這是常態而非故障，舊文案會讓人以為壞了。

**借券改用自帶日期的端點（修掉一個會被分段執行放大的坑）**
- 借券端點沒有 `date` 參數、回的永遠是「目前最新」。分段執行後，早班拿到的其實是前一天的資料，
  若照舊存成「今天」，後面幾班會因快取已存在而**永遠沿用那份錯的**。
- 改用 rwd 版（`title` 自帶日期），以「資料自己宣告的日期」為快取鍵，早晚班不會互相污染。
- 順帶修正一個語意錯位：「可借券賣出股數」其實是**下一個交易日**的額度
  （實測最後交易日 07/24 時，資料標的是 07/27），原本被混在收盤日底下顯示。

### 0.3.10（2026-07-26）

**夜間排程時間由 20:30 改為 23:30**
- 查證後發現原本的 20:30 對兩個資料源都太早：**融資融券**約 21:00–22:00 才公布
  （偶爾延至 23:00）、**借券**約 21:00–22:30。只有三大法人（約 15:00–15:30）來得及。
- 排太早不會報錯，而是**無聲的錯**：當天算得上交易日（T86 有資料），但融資融券為空，
  前端會顯示「查無此股當日資料」；借券的端點沒有 date 參數，更會把**前一天的數字快取成今天的**，
  完全看不出異狀。
- 改為 23:30（仍在台北當日內，不影響交易日判斷）。真遇到更誇張的延遲也不會壞 ——
  隔天的批次會把前一天缺的補回來。理由與各資料源的公布時間都寫進 `schema.sql` §6c 註解。

### 0.3.9（2026-07-26）

**盤後報告端點的濫用防護**
- `stock-report` 為了讓夜間 cron 進得來，是以 `--no-verify-jwt` 部署的公開端點，
  專案網址曾暴露在公開 bundle 裡 —— 任何人都能無限次呼叫 `generate`。
- 改為**只接受目前確實持有的台股代號**（非持股一律回 403）。攻擊者最多只能打這幾檔，
  而它們的當日資料早已被夜間批次快取，因此**無法逼這個專案去大量抓 TWSE**，
  只剩單純的 DB 讀取。前端不受影響（下拉選單本來就只列自己的持股）。
- 這修的是**額度**不是資料安全：該端點原本就只回公開的 TWSE 資料、不碰任何個資，
  也無法被注入內容。真正的風險是免費方案的 Edge Function 額度被外人燒光，
  連帶讓報價功能（共用同一份額度）一起停擺。

**修正原始檔快取被過度清除**
- `prune` 的保留期是**日曆日**，但報告需要的是 7 個**交易日** —— 兩者相差 2–3 天，
  導致每晚都把隔天還要用的資料砍掉、隔天再重抓（實測正式區 prune 後只剩 6 個交易日可用）。
- 快取保留期改為與 `LOOKBACK_DAYS` 一致（14 個日曆日，正是 `loadSeries` 會回頭找的範圍）；
  Storage 的報告保留期維持 7 天（前端只讀最新一份）。夜間批次會因此明顯變快。

### 0.3.8（2026-07-26）

**個股分析改為獨立分頁**
- 不再是從庫存總覽下鑽的檢視，而是導覽列上的獨立分頁。頁內以**下拉選單切換個股**，
  看另一檔不必返回再點。選單**只列台股持股** —— 盤後籌碼只涵蓋上市台股，
  不放點了才發現沒東西的選項。無台股持股時顯示空狀態。
- 庫存總覽因此移除「個股分析」欄，回到純持股表。
- 未設定 Supabase（本機模式）時整個分頁隱藏，與盤後報告一路以來的入口規則一致。

**移除「服務狀態」功能**
- 整頁與其健檢邏輯（`serviceHealth`）皆刪除。原本頁內的 GitHub Repository 連結
  改置於**頁尾免責聲明下方**。

**夜間排程修正**
- `schema.sql` 的 cron 呼叫補上 `timeout_milliseconds := 60000`。pg_net 預設只有 5000ms，
  但每天第一次執行要抓當天的盤後大檔，實測需 10–13 秒。批次本身不受影響
  （逾時後 Edge Function 仍會跑完），修正的是**可觀測性** ——
  修正前 `net._http_response` 每晚都記成 `status_code = null`，無法分辨成功與失敗。

**內部整理**
- 庫存總覽的 `buildRows` 抽成共用的 `utils/holdingRows.ts`，讓兩頁的持股損益計算是同一份。

**⚠️ 升級需要的後端動作**（正式區與測試區皆已完成）
- 重新執行 `sources/supabase/schema.sql` 的第 6 段（或僅重新排定 `stock-report-nightly`），
  使 cron 帶上 `timeout_milliseconds`。前端改動不需要重新部署 Edge Function。

### 0.3.7（2026-07-25）

**個股分析頁與盤後籌碼報告**
- **庫存總覽台股每列新增「分析」按鈕**，下鑽至獨立的個股分析頁，內含 `籌碼 / 技術面 / 我的持股`
  三個分頁籤（技術面為佔位頁，日線 / 週線 / 季線待歷史股價儲存就緒後接上）。
- **三大法人**：買進 / 賣出 / 買賣超 / 約當張數 / **連買連賣**，列出 外資 / 外資自營商 / 投信 /
  自營商 / 三大法人合計。表格可回看 7 個交易日中任一天，連買連賣隨所看日期重算。
- **融資融券**：買進 / 賣出 / 償還 / 今日餘額 / 較前日 / **連增連減**。改用帶 `date` 參數的 TWSE
  rwd 端點（舊的 OpenAPI 端點沒有 date、只能取當天，這是先前做不出走勢圖的原因），舊端點保留為當日備援。
- **近 7 日走勢圖（自繪 SVG，不引入圖表函式庫）**：買賣超長條圖可切單一法人或四個法人並排比較
  （並排時附圖例標明顏色對應）＋ 融資、融券餘額折線圖（兩者量級差距大，各自獨立縱軸）。
  支援 hover 看數值，缺資料的日子斷線不內插。
- **可下載 PDF**：深色主題也輸出淺色文件（擷取前動態套上淺色容器）。報告表頭標明代號、
  資料日期與報告更新時間，PDF 自己看得出是哪支股票、哪一天、什麼時候產的。
- **單位標示清楚**：三大法人是「股」、融資融券是「張」，兩者不可混算，UI 各自標示。

**盤後自動產生 + Storage-first（快 10 倍）**
- Supabase `pg_cron` 每交易日分三段（17:30 / 22:30 / 23:30 台北）觸發 `generate-all`，一次產出全體持有台股的**共用**報告
  （三大法人 / 融資融券 / 借券本就全市場共用），存進公開的 `reports` Storage bucket。
- 前端改為先讀預產好的報告、查無再 fallback 即點即產。實測 **0.8 秒 vs 8 秒**。
  個人「持股概況」不進共用報告，由前端自行渲染（共用報告不含任何個資）。
- 報告內嵌最近 7 個交易日 history；單次呼叫最多回補 5 個缺漏日，不足時照常出圖並標示
  「歷史資料回補中」，隔日排程自然補齊。只保留 7 天，同批次清掉更舊的報告與原始檔快取。
- 伺服器只回結構化 JSON、不再產生 HTML，畫面全部由 React 繪製。

**版本標記**
- 版號**一律不帶 `v` 前綴**，只有 `x.x.x`（正式）或 `x.x.x-dev.x`（測試）兩種形式。
- 左下角版本徽章只顯示版號本身，不再顯示作者。

**⚠️ 升級需要的後端動作**（正式區與測試區皆已完成）
1. SQL Editor 執行 `sources/supabase/schema.sql` 的第 5 段（建 `chip_raw_cache`）。
2. `supabase functions deploy stock-report --no-verify-jwt`。
3. （啟用盤後自動產報）`supabase secrets set CRON_SECRET=<隨機字串>`，
   再執行 schema 第 6 段（建 `reports` bucket、啟用 `pg_cron`/`pg_net`、排定每交易日三段式批次）。
   詳細步驟與常見問題見 [`sources/supabase/README.md`](sources/supabase/README.md)。

### 0.2.5（2026-07-21）
- **交易紀錄搜尋欄位（代號 / 名稱快速過濾）**：工具列新增搜尋輸入框，輸入代號（如 `2330` / `AAPL`）或名稱（如 `台積` / `蘋果`）即時過濾交易列表。
- 支援美股中文譯名搜尋對照（如輸入 `蘋果` 可命中 `AAPL`），並顯示獨立的筆數提示（「顯示 X / Y 筆」）與無命中狀態。
- 過濾時維持勾選狀態，全選與「刪除選取」按鈕僅作用於可見列，CSV 匯出維持匯出全部交易。

### 0.2.4（2026-07-20）
- **庫存總覽新增「投入成本」欄**：目前持股當初投入的金額（平均買入成本 × 持有股數，含買進手續費），也就是「現在還壓在裡面」的錢；已賣出的部分不計入。欄位順序為「持有股數 → 投入成本 → 平均買入成本」，先看總額再看單價。金額同樣採「含費 / 未含費」雙行。
- 計算引擎未變動：數字取自既有的持股部位成本（`cost` / `rawCost`）。
- **CI**：Build 用的 Node 由 20 升至 24，解除 Node 20 runtime 淘汰警告。

### 0.2.3（2026-07-20）
- **台股現價改用證交所 MIS 即時行情**：原本台股報價來自 Yahoo Finance（本身延遲 15–20 分鐘），改為直接取用證交所 MIS 即時行情，Yahoo 降為失敗時的備援；美股維持 Yahoo。
- **修正快取 TTL 疊加**：Edge Function 的資料庫快取回傳的報價可能已存在近 10 分鐘，但前端收到後一律當成「剛取得」再快取 10 分鐘，兩層疊加後畫面上的價格最舊可達約 30 分鐘。現在 Edge Function 會回傳報價的**實際取得時間**，前端據此判斷新鮮度，兩層 TTL 不再疊加。
- **現價自動更新**：以往頁面開著不動就不會再更新現價（需手動按重新整理）。現在每 60 秒背景輪詢一次，分頁從背景切回前景時也會補抓；TTL 內的代號直接命中本機快取，不會真的發出請求。
- 快取 TTL 依市場區分：台股 60 秒、美股 10 分鐘。綜合以上，台股現價延遲由最壞約 30 分鐘壓縮至約 1 分鐘。
- **年度收益移除「買進總支出」欄**：該欄包含當年買進但尚未賣出的部位，與同一列的賣出成本 / 賣出收入 / 已實現損益不是同一批股票，並列容易讓人誤以為可以互相加減。移除後每一列自洽：`已實現損益 = 賣出收入 − 賣出成本`。「僅買進」個股的賣出三欄改顯示「—」而非整排 0（該列仍保留，其手續費與筆數需計入年度合計）。
- 計算引擎完全未變動，既有損益公式與數字不受影響（`buyAmt` / `buyGross` 仍保留於引擎，僅停止顯示）。
- ⚠️ 本次含 Edge Function 變更，需重新部署才會生效：`supabase functions deploy stock-price --no-verify-jwt`（資料庫 schema 無需異動）。

### 0.2.2（2026-07-18）
- **年度收益新增「賣出成本」欄**：顯示當年賣出部位的取得成本（賣出當下的移動平均成本 × 賣出股數），讓每一列成立 `已實現損益 = 賣出收入 − 賣出成本`，數字可自行驗算。
- **金額改「含費 / 未含費」雙行顯示**（與庫存總覽的平均成本同構）：主數字為實際付出與收到的錢（含手續費與證交稅），副行為單純成交價金。以台股常見情境為例，未含費的帳面價差會明顯高於實際落袋金額——證交稅 0.3%（ETF 0.1%）通常才是吃掉獲利的大宗。
- **個股明細補齊只買未賣的股票**：當年只有買進、尚未賣出的個股以往不會出現在展開明細（但年度列的買進金額已包含它），現在會列出並標示「僅買進」。明細列也改為與年度列同表格，欄位確實對齊。
- **欄位說明「?」提示**：庫存總覽與年度收益的每個欄位都可查看定義；其中「現價」明確說明時間差——報價來源最長延遲 20 分鐘，加上系統 10 分鐘快取，畫面上的價格最舊可能是約 30 分鐘前的成交價。
- 計算引擎僅新增欄位，既有損益公式與數字完全不變。

### 0.2.1（2026-07-18）
- **移除「全部工作區（總覽）」功能**：經評估後整個下架跨工作區彙總檢視（彙總模組、選單選項、唯讀模式與相關欄位全數移除），單一工作區的既有功能、邏輯與損益計算公式完全不受影響（45/45 單元測試 + 端到端驗證通過）。
- **保留防護**：CSV 匯入時若偵測到含「工作區」欄且包含多個工作區的備份檔（0.2 期間由總覽匯出），仍會整批拒絕，避免不同券商的交易混入同一工作區污染移動平均成本。
- 舊版曾切到總覽的使用者，重新載入會自動回到第一個工作區。

### 0.2（2026-07-18）
- 畫面左下角新增固定版本標籤（`版本 | 作者`），登入頁亦顯示。
- 交易紀錄表格自適應寬度：一般桌面視窗（≥1024px）不再出現橫向捲軸；過長股票名稱以「…」截斷（滑鼠停留顯示完整名稱）。
- 修復：刪除交易失敗時不再誤顯示成功通知；切換工作區時清空勾選狀態；同代號重複查價去重。
