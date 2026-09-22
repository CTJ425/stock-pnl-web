# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.64 — Task 166 稽核修補第 2 批（股利、費用口徑、分割與重算原子化）
- Status: ✅ **0.9.64 on `dev` and `main`**；DEV／PROD 皆已套用 DDL 並重新部署 `stock-report`
- Timestamp: 2026-09-23 02:45:00 Asia/Taipei

---

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

## 📅 Log: 2026-09-22 21:44:30 Asia/Taipei (Task 166 batch 1, 0.9.63)

**使用者要求：對整個專案做最詳細的元件／流程／項目拆解稽核，再依建議全部改善。** 稽核報告列出 139 項發現（2 項 P1、25 項 P2、112 項 P3），分 5 批修補，本次為第 1 批（Lane 2：spec + 先寫失敗測試 + builder + reviewer）。

- 使用者決策：保留公開註冊但要求信箱驗證與 8 碼密碼；AI 只開放管理員；R2 完全移除；每批 DEV 驗證後直接上 PROD。
- 規格：`docs/agent/specs/166-audit-remediation.md`（含 5 批的範圍與第 1、2 批的完整契約）。
- 程式：`ai-proxy/handler.ts`／`index.ts`、`StockDetail/StockDetailPage.tsx`、`utils/csv.ts`、`Transactions/CsvImportModal.tsx`／`TransactionsPage.tsx`、`AppShell.tsx`、`Auth/AuthPage.tsx`、`stock-report/index.ts`、`backup-transactions/index.ts`（刪 `r2.ts`）、`services/adminBackups.ts`、`Admin/BackupsSection.tsx`、`Admin/ManualRunSection.tsx`、`supabase/schema.sql`、`supabase/config.toml`。
- 測試：新增 `CsvImportModal.test.tsx`（重複列不匯入的接線）、csv 防注入與民國年案例、`ai-proxy` 非管理員 403 案例、`StockDetailPage` 非管理員看不到 AI 分頁；移除 3 個 R2 斷言。
- Reviewer：R2 移除 PASS；CSV PASS（RISK：缺元件測試 → 已補）；夜間批次 FAIL（manifest 條件未計入預算略過、chips 早期拋錯不留紀錄）→ 已修正並重驗。
- **Verify**：`npm test` 2,574 通過／7 略過／0 失敗；`npm run build`、`npm run typecheck:edge` exit 0。
- **Deploy**：DEV 與 PROD 皆套用 `batch_run_log.skipped_for_budget`、`get_ai_settings()` 管理員判斷、移除 `backup_run_log` r2 欄位；部署 `ai-proxy`、`stock-report`（`--no-verify-jwt`）、`backup-transactions`（`--no-verify-jwt`）；Auth 設定 `mailer_autoconfirm=false`、`password_min_length=8`。
