# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 交接文件全面稽核校正，並補上 `ai-proxy` 的 PROD 部署
- Status: ✅ **COMPLETED**（8 處文件錯誤已修；四支 Edge Function 兩邊齊備）
- Timestamp: 2026-09-15 13:35:00 Asia/Taipei

---

## 📅 Log: 2026-09-15 13:35:00 Asia/Taipei (0.9.54 上線、文件稽核、ai-proxy 補 PROD)

**0.9.54 國際指數分頁上線**：日經 225、KOSPI、KOSDAQ、道瓊、S&P 500、那斯達克、費城半導體、羅素 2000，盤中每 60 秒只重抓當下開盤的市場。Edge `stock-price` 已部署 DEV + PROD；間隔 92 秒呼叫兩次 `prices`，兩邊 `asOf` 都更新，證明新的 60 秒 TTL 生效（舊值是 10 分鐘）。

**BUG-083 已修**：E2E 的刪除流程走 App 自己的確認 Modal（`Common/useConfirm.tsx`），不是原生 `confirm`，所以 `page.on('dialog')` 永遠不觸發，腳本從沒按過那顆「刪除」。補上點擊後全套 16/16 exit 0，並加了 preflight 擋下用錯模式的整批誤判。

**文件稽核**：以現行程式碼核對 11 份宣稱現況的文件，確認 13 條錯誤，修掉 8 條低風險（測試數字、版本、死連結、兩處 cron 排程敘述）。剩餘缺口記在 Task 163。**撤回一條誤判**：`schema.sql` 的 cron 沒有漂移 —— 那兩行在 `--` 註解裡，是已退役排程的還原範例。教訓：對 SQL 檔做結構性抽取要先濾掉註解行。

**`ai-proxy` 補上 PROD**：0.9.51 把 Google 金鑰移到伺服器端後，該函式從未部署到 PROD，正式站的金鑰一直走瀏覽器直連。今日補上，四支函式的 bundle 雜湊兩邊逐一相同，`verify_jwt` 未變。

**`verify.sql` 補洞**：表清單漏了 `app_log`（列 14，實際 15），重建後缺表會靜默通過 `assert_setup_ok()`。已補並對 DEV 重新安裝，10 項全 PASS。

**未解**：代理人無法對 PROD 跑 `verify_setup()` —— CLI 2.111.0 的 `db query` 不接受 `--project-ref`，PostgREST 的 `rpc/verify_setup` 被 `permission denied for schema cron` 擋下，PROD 連線字串是 secret。

完整記述見 `PROGRESS_ARCHIVE.md` 中同日 13:35 與 11:47 的兩筆。
