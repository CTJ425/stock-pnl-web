# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.66 — Task 166 稽核修補第 4 批（前端體驗與無障礙）
- Status: ✅ **0.9.66 on `dev` and `main`**；DEV／PROD 皆已套用 `admin_recent_app_logs` DDL 並重新部署三個 Edge Function
- Timestamp: 2026-09-23 09:49:00 Asia/Taipei

---

## 📅 Log: 2026-09-23 09:49:00 Asia/Taipei (Task 166 batch 4, 0.9.66)

**稽核修補第 4 批：前端體驗與無障礙。** 前一段工作已完成殼層、交易、報價管線、管理後台、維運等項目但未提交；本輪以兩個 scout 逐條比對規格，補完剩餘項目後一次提交。

- 本輪補完（四個 builder 平行）：總經 proxy 回傳 `ProxyResult`（ok／empty／invalid）與「資料格式不符」文案（MA-06）；匯率過期改算台北交易日，超過 2 個才警示（MA-10）；`reportPdf.ts` → `downloadBlob.ts`（MA-12）；日誌游標改為 (at, id)，`admin_recent_app_logs` 新增 `p_before_id`（AD-07）；個股頁漲跌停徽章與參考線（新 `priceLimits`）、快取時間、代號不符不渲染、單點畫點、美股量以股計、`dl` 統計格、試算逐欄驗證、價格階梯註明；圖表靜態層 memo 與 `thinLabelStep` X 軸抽稀；基本面最近 9 季滾動視窗、TTM「資料不足 (n/4)」、籌碼空狀態分流、三大法人合計交叉檢查、`fmtUpdatedAt` 固定 Asia/Taipei。
- 主 session 寫的測試：`isStale` 交易日 4 例、MA-06 invalid 狀態 2 例、AD-07 游標 1 例、`thinLabelStep` 3 例、`priceLimits` 6 例；修正 TwMarketSection 兩個漏改的 mock。
- 決策：季報表視窗取 9 季（與舊 2024-Q1 截點在畫面上的季數相同，不突然變寬）。
- Reviewer：PASS；1 項 RISK（RISK-021，dailyProxy／intradayProxy 快取不隨帳號切換清空，資料為公開市場資料）。
- **Verify**：`npx vitest run` 2,613 通過／7 略過／0 失敗；`npm run build`、`npm run typecheck:edge` exit 0。DEV 實測 (at, id) 翻頁：兩頁各 5 筆、重疊 0、遺漏 0。
- **Deploy**：DEV 與 PROD 皆套用 DDL（識別條件檢查通過），部署 `stock-report`（DEV v27／PROD v16）、`stock-price`、`backup-transactions`；兩區 bundle sha 相同（stock-report `3b36b3234516`），未授權呼叫回 401。

## 📅 Log: 2026-09-23 03:30:00 Asia/Taipei (Task 166 batch 3, 0.9.65)

**稽核修補第 3 批：Edge 穩定性與維運。** 四個 builder 平行處理資料來源、Discord 與備份、stock-price、stock-report 路由，再依 reviewer 結果修正。

- 新檔：`supabase/functions/_shared/fetchRetry.ts`（重試、退避、429 上限、整體時間預算）。
- `stock-report/index.ts`：六個上游抓取改用重試、MOPS 迴圈加間隔、探針記錄失敗種類、代號範圍評估 4 併行、Storage 清理分頁、請求本文上限、堆疊遮蔽、暖機日期後援、admin-run 單一 job、最後一位管理員保護與角色稽核、使用者清單分頁、日誌筆數上限。
- `stock-price`：401 防線、截斷回報、Yahoo 後援期限、候選邏輯共用、錯誤分類、TPEx 後援年齡。
- 資料來源：`misParse`（交易時間無法解析時不用買一價）、`twChips`（欄名檢查、OpenAPI 後援註記）、`usMacro`（抓取失敗分流）、`fxRates`（單日漲跌幅合理性）、`twProfitHistory`／`twRevenueHistory`（巢狀表格視為失敗）。
- Discord 與備份：`accountTick` 漏跑可補送、`discordSummary` 長度上限與「日期不明」標記、`discordWebhook` 錯誤分為 5xx／4xx、`holdingsCard` 預算與總長上限連動、備份分頁讀取、備份紀錄寫入失敗改記 `app_log`。
- 資料庫：四張紀錄表 180 天保留排程、`backup_run_log` 外鍵（先把孤兒列設為 NULL）、`config.toml` 宣告 verify_jwt。
- Reviewer：FAIL —— 1 個 BLOCKER（重試讓 MOPS 呼叫超過 cron 60 秒上限）與 5 個風險（Retry-After 無上限、總經／匯率迴圈無預算、Storage 分頁吞錯誤、chunked 請求繞過本文上限、最後管理員檢查有競態）全部修正後重驗通過。
- 測試更新：`accountTick`、`discordSummary`、`discordWebhook` 的舊斷言改寫為新語意；新增民國年、重複匯入、分割重複偵測等案例。
- **Verify**：`npm test` 2,598 通過／7 略過／0 失敗；`npm run build`、`npm run typecheck:edge` exit 0；DEV／PROD 端點未授權呼叫皆回 401。

