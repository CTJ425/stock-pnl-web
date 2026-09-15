# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 162 國際指數分頁（日／韓／美 8 檔）與盤中 60 秒輪詢
- Status: ✅ **RELEASED 0.9.54**（已合併 `main` 上線；Edge Function 部署待授權）
- Timestamp: 2026-09-15 11:36:00 Asia/Taipei

---

## 📅 Log: 2026-09-15 11:36:00 Asia/Taipei (Task 162, 0.9.54 國際指數分頁上線)

總體經濟頁新增第三個子分頁「國際指數」，顯示日經 225、KOSPI、KOSDAQ、道瓊、S&P 500、那斯達克、費城半導體、羅素 2000 共 8 檔，盤中每 60 秒更新。

資料路徑沒有新增任何 API。Edge Function `stock-price` 的 `prices` action 本來就不檢查 market 白名單，`yahooSymbols()` 對非 `TPE` 的 market 原樣回傳 ticker，8 檔指數一次 POST 取回。`^TOPX`（TOPIX）已排除 —— Yahoo 回 HTTP 200 但 `regularMarketPrice` 是 null。

刻意不走 `priceProxy.fetchPrices`：`PriceRequestItem.market` 綁在 `Market = 'TPE' | 'US'`，而 `Market` 是持股與損益的型別，放寬它會碰到金額計算；`fetchPrices` 的 localStorage L1 快取對非台股又是 10 分鐘，會讓 60 秒輪詢拿到舊值。改為新增 `indexQuotes.ts`，只做顯示、不持有快取、不匯入 `Market`。

伺服器端只改一行：`cacheTtlMsFor` 新增 `IDX:` 分支回 60 秒，`TPE:` 與 `US:` 分支未動。覆核確認 `freshAfter` 的粗篩不需要跟著改 —— 它只放寬 DB 撈列的時間窗，逐列 TTL 仍由 `cacheTtlMsFor` 把超過 60 秒的 IDX 列剔除。

收尾跑全套測試時抓到一個規格疏漏：專案有一條全域守則測試 `invokeTimeout.test.ts`，要求每個 `functions.invoke` 都必須帶 `timeout`，而規格把呼叫形狀寫死成只有 `body`。`indexQuotes.ts` 與其測試同步補上 `timeout: 15_000`。

驗證：`npm test` 123 檔 / 1,976 測試全過 exit 0；`npm run build` exit 0；`npm run typecheck:edge` exit 0。reviewer 八項逐點覆核 PASS，無 finding。

E2E 與真瀏覽器覆驗後合併 `main`，版號 0.9.54，commit `859feca`，`dev` 與 `main` 同版。GitHub Release 由 workflow 自動建立，CI 綠燈。

E2E 全套在本機模式跑前後兩次，失敗清單與未套用本版變更的基準線**完全相同**（同樣 10 passed / 6 failed），所以本版沒有造成迴歸。那 6 條是既有紅燈：其中「總體經濟」「外幣匯率」兩條的成因已查明 —— `AppShell.tsx` 的 `SUPABASE_ONLY_TABS` 在本機模式把這兩個分頁整個拿掉，導覽列上根本沒有那顆按鈕，測試等的是一個不會出現的元素。

登入牆讓瀏覽器看不到雲端分頁，改以一個暫時的獨立進入點把 `GlobalIndices` 單獨掛起來，用 `.env` 的 DEV 專案跑真瀏覽器，看完即刪。實測（11:27 台北）：8 檔指數全部取得真實報價，日本標「午休」（東京 12:26，正好落在 11:30–12:30）、韓國標「盤中」、美國標「已收盤」；整整 60 秒後只重送 `^KS11` 與 `^KQ11` 兩檔，與「只問有開盤的市場」的規格一致。手機 375px 兩欄、無水平溢出。

視覺覆驗抓到一個瑕疵並修掉：`.rpt-card` 是 `flex: 1 1 140px`，只有一檔的日本組會把卡片拉成整列寬。`.gix-groups .rpt-card` 加上 `max-width: 320px`，約束只落在新網格內，不動共用類別。

未完成：`stock-price` Edge Function 尚未部署。推 `main` 不會部署 Edge，`cacheTtlMsFor` 的 `IDX:` 60 秒分支在部署前不會生效。

## 📅 Log: 2026-09-15 10:05:00 Asia/Taipei (P1~P4 系統架構、部署與測試文檔同步)

依據稽核發現全面完成 P1~P4 文檔校正與現況同步：
1. **P1 (部署安全與 Edge 規範)**：
   - `docs/CLAUDE-tw.md`：更正 Edge Functions 部署指令，明確區分 `stock-price` 與 `ai-proxy` 維持 `verify_jwt=true`，而 `stock-report` 與 `backup-transactions` 帶 `--no-verify-jwt`；移除已廢除之 `architect` 角色與不存在之 `.claude/hooks/` 參照。
   - `sources/supabase/README.md`：新增 `ai-proxy` 部署說明（共 4 支 Edge Functions），更新 `backup-transactions`（含 `r2.ts`、`cronSecret.ts` 共 4 檔）與 `stock-report`（18 檔）、`stock-price`（7 檔）檔數；移除已廢棄之 PDF 下載與 Google News RSS 描述。
2. **P2 (專案總覽現狀同步)**：
   - `README.md`：移除 PDF 下載說明與死依賴（`jsPDF` / `html2canvas`）、目錄樹清除 `newsProxy` 與 `reportPdf`；更新測試規模至 121 檔 / 1,947 tests (100% PASS)；更正 pg_cron 排程數至 7 個（含覆驗清單補入 `app-log-prune`）；更新 AI proxy 架構與 Edge 4 支函數說明。
3. **P3 (追蹤檔案 Size Discipline 與缺陷分析)**：
   - `docs/agent/TASK.md`：將 Task 145 已完成項目 (BUG-063..071) 收攏為 `- **Done**: `，保留待處理的 OPT-1 / OPT-2；清除 Task 132/133 過時之 Docker Compose 敘述。
   - `docs/agent/BUG_FIX.md` / `FIXED_BUG.md`：將已於 PROD 配置之 Supabase Redirect URLs 移至 `FIXED_BUG.md` (BUG-082)；完成 BUG-079 程式碼深入分析，釐清 `estimateUnrealized`（取自 lot.feeRate）與 `breakEvenPrice`（取自 workspace feeRate 導致 0.6 解讀歧異）之根本原因。
4. **P4 (測試指南與架構歷程註記)**：
   - `docs/UnitTests/`：移除過時之 Docker 網域 `korq9tvdz0jd7yblr72p.ivan.lab` 並替換為 Supabase Cloud DEV ref `zyebvayngwrqzoaicbwd`；將 `backup-transactions`、`ai-proxy`、`stock-price` 之單元測試補入 `README.md` 與 `UNIT.md`；於 `E2E.md` 完整列出 10 支 E2E 與驗證腳本。
   - `docs/agent/SPEC.md` / `PLAN.md`：同步個股分析頁三層分頁結構（`analysis` 含籌碼/基本面/技術面、`whatif` 損益試算、`ai` AI分析分頁標註校正）；註記已移除之 PDF / html2canvas；更新 0.9.51 AI proxy 金鑰隔離架構；釐清 `PLAN.md` 中 Cloudflare Worker 廢除與 R2 異地備份採用之邊界。

全套驗證：`npm test` 121 檔 / 1,947 測試 100% 通過；`npm run typecheck:edge`、`npm run build`、`npm run lint` 全數 exit 0。
