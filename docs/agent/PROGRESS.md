# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.55 —— Task 145 收尾（路由層分割、memo 穩定化）與 Task 163 文件補完
- Status: ✅ **RELEASED 0.9.55**（已合併 `main`；Task 145 與 163 均已結案歸檔）
- Timestamp: 2026-09-15 14:44:45 Asia/Taipei

---

## 📅 Log: 2026-09-15 14:44:45 Asia/Taipei (0.9.55, Task 145 與 163 收尾)

**OPT-1 路由層分割**：`MacroPage`、`FxPage`、`AdminConsolePage` 改為 `React.lazy`。三者都不在首屏路徑上 —— 都要點分頁才會到 —— 留在進入點只是讓每個使用者都下載它們。bundle 由單檔拆成四塊（`FxPage` 9.85 kB、`MacroPage` 37.21 kB、`AdminConsolePage` 70.04 kB），`index` 從超過 500 kB 降到 496.62 kB，Vite 的 chunk 警告消失。具名匯出要用 `.then((m) => ({ default: m.X }))` 轉成 `default`，`lazy` 只吃這個形狀。

**OPT-2 memo 穩定化**：`IntradayChart` 的 `series?.points ?? []` 每次 render 都產生新陣列，讓下游三個 `useMemo` 全部失效並串連重繪。改為模組層 `EMPTY_POINTS` 常數後，三條 `react-hooks(exhaustive-deps)` 警告消失。

**Task 163 文件補完**：`README.md` 與 `SPEC.md` 都補上總體經濟的三個子分頁；`PLAN.md` 新增 §T 涵蓋 Macro 與 Fx 兩頁架構。補查 `SPEC.md` 與 `PLAN.md` 剩餘段落後只再找到 2 條並已修：`timeline.ts` 測試數 29 → 23，以及 0.9.54 引入的錯誤行號 `schema.sql:710`（那行在註解裡）→ 728。**同一個坑踩了兩次** —— 註解裡的 SQL 被當成程式碼，第一次造成 cron 漂移的誤判，第二次造成錯誤行號。

**交接熱檔清理**：`PROGRESS.md` 8,584 → 2,169 bytes（回到 4096 上限內），`TASK.md` 17,269 → 15,447 bytes。移出的是已完成與已被推翻的內容，全部進 `*_ARCHIVE.md`，無損檢查 PASS（移出 8,237、移入 9,848）。清出的最有價值一項是 `TASK.md` 內部的自相矛盾：一行寫「`ai-proxy` PROD 尚未部署」，與同檔第 14 行直接打架。`BUG_FIX.md` 未動 —— 14 條全部仍然成立。

**驗證**：1,976 測試、`build`、`typecheck:edge`、`lint` 皆 exit 0，`npm audit` 0 vulnerabilities，**E2E 全套 16/16 exit 0**（Supabase 模式真瀏覽器）。E2E 是本版的關鍵驗證：延遲載入最可能壞在真實瀏覽器的分頁切換上，單元測試看不到。

## 📅 Log: 2026-09-15 13:35:00 Asia/Taipei (0.9.54 上線、文件稽核、ai-proxy 補 PROD)

**0.9.54 國際指數分頁上線**：日經 225、KOSPI、KOSDAQ、道瓊、S&P 500、那斯達克、費城半導體、羅素 2000，盤中每 60 秒只重抓當下開盤的市場。Edge `stock-price` 已部署 DEV + PROD；間隔 92 秒呼叫兩次 `prices`，兩邊 `asOf` 都更新，證明新的 60 秒 TTL 生效（舊值是 10 分鐘）。

**BUG-083 已修**：E2E 的刪除流程走 App 自己的確認 Modal（`Common/useConfirm.tsx`），不是原生 `confirm`，所以 `page.on('dialog')` 永遠不觸發，腳本從沒按過那顆「刪除」。補上點擊後全套 16/16 exit 0，並加了 preflight 擋下用錯模式的整批誤判。

**文件稽核**：以現行程式碼核對 11 份宣稱現況的文件，確認 13 條錯誤，修掉 8 條低風險（測試數字、版本、死連結、兩處 cron 排程敘述）。剩餘缺口記在 Task 163。**撤回一條誤判**：`schema.sql` 的 cron 沒有漂移 —— 那兩行在 `--` 註解裡，是已退役排程的還原範例。教訓：對 SQL 檔做結構性抽取要先濾掉註解行。

**`ai-proxy` 補上 PROD**：0.9.51 把 Google 金鑰移到伺服器端後，該函式從未部署到 PROD，正式站的金鑰一直走瀏覽器直連。今日補上，四支函式的 bundle 雜湊兩邊逐一相同，`verify_jwt` 未變。

**`verify.sql` 補洞**：表清單漏了 `app_log`（列 14，實際 15），重建後缺表會靜默通過 `assert_setup_ok()`。已補並對 DEV 重新安裝，10 項全 PASS。

**未解**：代理人無法對 PROD 跑 `verify_setup()` —— CLI 2.111.0 的 `db query` 不接受 `--project-ref`，PostgREST 的 `rpc/verify_setup` 被 `permission denied for schema cron` 擋下，PROD 連線字串是 secret。

完整記述見 `PROGRESS_ARCHIVE.md` 中同日 13:35 與 11:47 的兩筆。
