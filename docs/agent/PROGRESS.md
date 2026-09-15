# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 交接文件全面稽核校正，並補上 `ai-proxy` 的 PROD 部署
- Status: ✅ **COMPLETED**（8 處文件錯誤已修；四支 Edge Function 兩邊齊備）
- Timestamp: 2026-09-15 13:22:19 Asia/Taipei

---

## 📅 Log: 2026-09-15 13:22:19 Asia/Taipei (交接文件稽核校正 + ai-proxy 上 PROD)

以現行程式碼為依據稽核 11 份宣稱現況的文件，逐條要求「文件出處 + 程式碼反證」兩邊引用。確認 13 條錯誤，修掉其中低風險的 8 條。

**已修**：測試數字 121 檔 / 1,947 條 → 123 / 1,976（`README.md` 兩處、`TASK.md` 一處）；`TASK.md` 現行版本 0.9.53 → 0.9.54；`README.md` 目錄樹補上 `ci.yml`；`SPEC.md:46` 的 `file:///home/ivan/...` 死連結改為相對路徑並標明 `system_design.md` 是 2026-07 起始設計書而非現行架構；`SPEC.md` 兩處 cron 排程敘述與 `schema.sql` 不符，改為實際值並附行號；`TASK.md` 的 mobile audit 條目說明補上「報告只有 17 個 finding，第 18、19 項是後來追加」。

**未修，需另開任務**：`README.md:65`、`SPEC.md:485`／`:762` 把「總體經濟」描述成單一 FRED 指標頁，`PLAN.md` 則完全沒有總體經濟頁、國際指數與外幣匯率頁的段落。那是重寫不是改字。

**駁回三類誤報**：`PROGRESS.md` 日誌條目裡的舊測試數字是當時的量測記錄，不是現況宣稱；`system_design.md` 的內容停在原始三張表是歷史，該檔開宗明義是起始設計規劃書；「`PLAN.md` 停在 0.6.6-dev.1」實際 grep 得到 0.9.52。

**稽核本身的限制**：`SPEC.md` 只查了 4/10+ 段、`PLAN.md` 7/12 段，實際錯誤數會多於 13 條。`CHANGELOG.md` 與三個 `*_ARCHIVE.md` 依範圍定義未查。

**一條自己撤回的誤判**：稽核過程中一度報出「`schema.sql` 有兩個 `cron.schedule`（`stock-report-nightly:449`、`market-daily:949`）在線上不存在」，並判定重建 cron 會多出兩個排程。**該結論錯誤，已撤回。** 那兩行都在 `--` 註解裡，是「這個已退役的排程要怎麼還原」的說明範例，不會執行；抽取用的正規表示式沒有排除註解行才誤判。排除註解後重新抽取：`schema.sql` 有 **7 個**會執行的 `cron.schedule`（`market-data-daily`、`history-daily`、`source-probe`、`macro-daily`、`fx-daily`、`backup-daily`、`app-log-prune`），每一個都配一組 `cron.unschedule`，與線上 `cron.job` 的 7 筆逐一相同。**`schema.sql` 沒有排程漂移，不需要修改。** 教訓：對 SQL 檔做結構性抽取時，先濾掉註解行再比對，否則註解裡的範例 SQL 會被當成程式碼。

**`ai-proxy` 補上 PROD**：稽核發現 0.9.51 把 Google 金鑰移到伺服器端後，該函式從未部署到 PROD，正式站的金鑰仍走瀏覽器直連。前置條件實測後比預期小：PROD 的 `app_settings` 已有 `ai_provider` / `ai_model` 欄位（PostgREST 回 200 + 空陣列），`ai-proxy` 只需要環境自動注入的 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY`，兩者都在。部署後 PROD 四支函式齊全，`ai-proxy` v1、`verify_jwt=true`、bundle 雜湊 `0e9155260cf390ce` 與 DEV 相同；四支的雜湊兩邊逐一相同。冒煙測試：不帶 JWT 回 401（閘道層），帶 anon JWT 回函式自己的「登入憑證無效或已過期」401，證明程式碼確實在跑。

## 📅 Log: 2026-09-15 11:47:54 Asia/Taipei (Task 162, 0.9.54 國際指數分頁上線與 Edge 部署)

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

使用者授權後部署 `stock-price` 到 DEV 與 PROD。DEV v17→v18、PROD v8→v9，兩邊 bundle 雜湊由 `11056263f7a843fc` 變為 `1067c30dfcbee8b6`（兩邊相同），`verify_jwt=true` 未變 —— `stock-price` 不帶 `--no-verify-jwt`，那是 `stock-report` 才需要的。

生效證明不看版號、只看行為：間隔 92 秒呼叫兩次 `prices` action，DEV `asOf` 由 `03:46:01` 變 `03:47:33`、PROD 由 `03:46:02` 變 `03:47:35`，兩邊都重新抓取。舊的 10 分鐘 TTL 下第二次會回同一個 `asOf`。

部署過程踩到一次已記錄的陷阱：這個 shell 的 `SUPABASE_ACCESS_TOKEN` 屬於另一個帳號的組織，`functions list` 回 403 privileges。每一道 supabase 指令都要用 `env -u SUPABASE_ACCESS_TOKEN` 執行，不要因為 403 就去重新登入或換 token。
