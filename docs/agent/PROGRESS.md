# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.65 — Task 166 稽核修補第 3 批（Edge 穩定性與維運）
- Status: ✅ **0.9.65 on `dev` and `main`**；DEV／PROD 皆已套用 DDL 並重新部署三個 Edge Function
- Timestamp: 2026-09-23 03:30:00 Asia/Taipei

---

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

## 📅 Log: 2026-09-23 02:45:00 Asia/Taipei (Task 166 batch 2, 0.9.64)

**稽核修補第 2 批：金額引擎與資料功能。** Lane 2：先寫失敗測試 → builder → reviewer → 修正 → 重驗。

- 規格：`docs/agent/specs/166-audit-remediation.md` § Batch 2 contract。
- 股利（EN-01）：`models.ts` 新增 `DIVIDEND`／`STOCK_DIVIDEND`；`pnlEngine.ts` 新增 `Position.dividends`、`YearSummary.dividendsTw/Us`、`LedgerSummary.dividendCount`，並把股票股利納入 `isOpenLeg`（同日同時間匯入時排在賣出之前）；UI 在交易表單、交易列表、CSV 與年度報表全線支援。
- 費用口徑（BUG-079、EN-02、EN-07、EN-09、EN-10）：`fees.ts` 的回本價改用每批費率並回傳 `number | null`；`holdingRows.ts` 標示美股「券商不適用」；`WhatIfTab`／`DashboardPage` 對 null 顯示「—」；美股提示文字不再宣稱含證交稅。
- 費率設定（EN-05、EN-06、EN-08、BUG-084）：`settings.ts` 停讀殘留的工作區最低手續費；`feeSettings.ts` 以 `onError` 回報雲端寫入失敗，`WorkspaceContext` 顯示在既有錯誤列。
- 原子更新（TX-03、TX-04、TX-09）：新增 RPC `apply_transaction_updates` 與 `tx_split_log`；`dataProvider`／`WorkspaceContext` 新增批次更新與分割紀錄；兩個視窗共用 `batchUpdate.ts`；重複分割會警告並要求二次確認。
- 新增測試：股利引擎 8 例、排序 2 例、回本價口徑 3 例、年度報表 3 例、CSV 匯入重複 3 例、分割重複偵測 2 例、費用重算不碰股利 1 例。
- Reviewer：股利引擎 PASS（isOpenLeg 漏掉股票股利、KPI 筆數與買賣分項不一致 → 已修）；回本價與批次更新 PASS（種子與判準的最低手續費條件不一致、美股提示文字、RPC 無法清空 fee_rate、分割紀錄寫入失敗被吞 → 已修；重複偵測缺測試 → 已補）。
- **Verify**：`npm test` 2,592 通過／7 略過／0 失敗；`npm run build`、`npm run typecheck:edge` exit 0。
- **Deploy**：DEV 與 PROD 皆套用 `tx_type` CHECK、`tx_split_log`、`apply_transaction_updates`，並重新部署 `stock-report`（Edge 引擎副本隨股利改動更新）。

---
