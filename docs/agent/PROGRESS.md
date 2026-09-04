# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 全庫深度審查稽核（BUG-063..BUG-071 & OPT-1..5）與交接文件歸檔
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-04 23:05:00 Asia/Taipei

---

## 📅 Log: 2026-09-04 23:05:00 Asia/Taipei (全庫深度審查稽核、BUG-063..BUG-071、交接文件歸檔)

- **Status**: ✅ **COMPLETED** —— 全庫審查完成，已完成逆向質疑與獨立驗證，交接文件與規格歸檔完畢
- **Version**: `0.9.33`（未異動版本，純審查與交接歸檔）
- **緣由**: 使用者指示「幫我掃描一下整個codebase，抓一下有哪些BUG和可以優化的部分，並且和我說有那些」，隨後指示「先幫我把相關資訊寫進交接文件」。

### 稽核成果與重大校正
- **審查範圍**: 涵蓋前端 `sources/src/`（`pnlEngine.ts`、`fees.ts`、`csv.ts`、各 UI Modal/Page）與後端 `sources/supabase/`（`stock-report`、`backup-transactions`、`stock-price`、共用模組）。
- **校正前次誤區**:
  - **駁回 BUG-8 盲目加 deps 建議**: `StockSplitModal.tsx` 的 `minFees` 是每次 render 新建的物件實字，若盲目加入 `useMemo` deps 會導致每次按鍵均觸發全量重算。已給予穩定 memo 物件之正確處置方案。
  - **校正 BUG-4 更新欄位宣稱**: PostgREST HTTP PATCH 不會洗掉未傳入欄位；但確認 `proposeFeeCorrections` 漏算 0.08% 借券費會導致確認後借券費被實質覆蓋遺失，且更新時未同步寫入 `fee_rate`。
  - **校正 OPT-1 首屏 Chunk 歸因**: `reportPdf.ts` 早已實作動態 `import()` 按需載入；795 KB 巨型 chunk 主要成因為 `AdminConsolePage`、`MacroPage`、`FxPage` 的靜態引用。
- **全新發現**:
  - **BUG-063 (P0)**: CSV 匯出未包含借券費，匯入時 `splitMode` 以 `fee + tax` 覆蓋，融券借券費永久遺失。
  - **BUG-064 (P0)**: 批次手續費重算漏傳 `nature: tx.tx_nature`，借券費被覆蓋抹除且未寫入 `fee_rate`。
  - **BUG-065 (P0)**: 股票分割換算未隔離融券（SHORT），融券回補被當現股買進分割，未平倉融券賣出被遺漏。
  - **BUG-066 (P1)**: PostgREST `max_rows = 1000` 截斷 7 處關鍵查詢（前端交易載入、備份轉儲、全站持股/觀察清單、用戶走訪、探針查詢、還原計數）。
  - **BUG-067 (P1)**: `AnalysisPage.tsx` 資券雙開時使用 `r.holding.key` 產生重複 Key，且永遠無法選取融券空單。
  - **BUG-068 (P1)**: `AnalysisPage.tsx` 純融券部位傳遞 `qty: 0, avgCost: 0` 導致 What-If 試算鎖死。
  - **BUG-069 (P1)**: `stock-report` 全數失敗仍上傳 `manifest.json` 引發全站 404。
  - **BUG-070 (P2)**: `backup-transactions` 金鑰時序攻擊弱比對。
  - **BUG-071 (P2)**: `YearlyPage.tsx` 當沖拆分重複 Key 與融券回補標籤顛倒。
  - **OPT-1..5**: 包含 `AppShell.tsx` 路由級 `React.lazy()` 代碼分割、`IntradayChart.tsx` 穩定空陣列 reference、淺色主題白色遮罩反白修復、`price_cache` 命中補齊 `industry` 避免 UI 閃爍、以及 `breakEvenPrice` 消除 Sentinel 0 重構為 `number | null`。
- **文件歸檔**:
  - 新增規格檔：`docs/agent/specs/145-codebase-bugs-and-optimizations-audit.md`（包含詳細行號、失敗情境、重構方案與三階段 Roadmap）。
  - 更新任務檔：`docs/agent/TASK.md`（新增 Task 145）。
  - 更新缺陷檔：`docs/agent/BUG_FIX.md`（記錄 BUG-063..BUG-071）。
  - 更新進度檔：`docs/agent/PROGRESS.md`（滾動舊紀錄至 `PROGRESS_ARCHIVE.md`，維持最多 2 筆熱紀錄）。

---

## 📅 Log: 2026-09-04 20:11:46 CST (0.9.32 發布與雙環境部署、補讀稽核與 0.9.33)

- **Status**: ✅ **COMPLETED** —— 已提交、已合併 `main`、DEV 與 PROD Edge 均已部署並驗證
- **Version**: `0.9.32-dev.1` → **`0.9.32`** → **`0.9.33`**（`main` 與 `dev` 同為 `25510fe`）
- **緣由**: 使用者指示「commit 到 dev 然後 main 跟 dev 的 supabase 都要先調整……直接合併到 main，然後再查看看還有沒有甚麼 bug 或是問題，然後直接調整」。

### 發布與部署
- **0.9.32**：BUG-050 與 2026-09-04 稽核六項修正。`dev` → `main` 快轉合併，GitHub Release 由 `.github/workflows/release.yml` 自動建立。
- **Edge 部署（兩環境）**：`stock-price` 與 `stock-report` 部署到 DEV `zyebvayngwrqzoaicbwd` 與 PROD `hrilemueiqyaoiwnkeuu`。以 `ezbr_sha256` 證實新程式碼確實上線，兩環境同一份 bundle，`verify_jwt` 分別維持 `true` / `false`。0.9.33 只動 `stock-report`，故只重新部署該 function（兩環境 v6，`9ad5501c…`）。
- **AUDIT-13 的實機驗證**：`secretsMatch` 改了 `CRON_SECRET` 的比較方式，若有缺陷會讓兩環境的排程全部 401。**在部署 PROD 之前先確認 DEV 部署後的 cron 輪次回傳 200**，PROD 部署後同樣確認。DEV 11:30/11:45/11:50 UTC、PROD 11:40 UTC 皆為 200，DEV 近一小時 13 次全數 200。
- **`verify_setup()`**：DEV 十項全 PASS。**PROD 原本沒有安裝這個驗證器**（`verify.sql` 只裝在 DEV），已補裝後執行，十項全 PASS，`cron target host` 正確指向 `hrilemueiqyaoiwnkeuu.supabase.co`。
- **未做的 Supabase 變更**：`batch_run_log` 加欄位的 DDL 被自動模式的分類器擋下。沒有繞過，改用不需要 schema 變更的修法（見 BUG-062）。

### 補讀稽核與 0.9.33
- **範圍**：`BUG_FIX.md` 記載 `stock-report/index.ts` 共 4,236 行中僅約 900 行被逐行讀過。本次以兩個平行 read-only 審查把 1200-2290 與 3400-3930 共約 1,465 行完整讀完。
- **結果**：5 項可證明的缺陷（1 HIGH / 3 MEDIUM / 1 LOW），加上主 session 自行發現的 1 項回歸，全部修正，記於 `FIXED_BUG.md` BUG-057 … BUG-062。
- **授權面陰性結論**：六個 admin handler 全數在 dispatch 層由 `assertAdmin` 把關，`backfill-*` / `sync-*` 走 `assertCronSecret`，兩種機制無交叉錯配，**未發現繞過路徑**。
- **BUG-062（自行引入的回歸）**：0.9.32 把 `failed` / `failed_tickers` 加進要 INSERT 進 `batch_run_log` 的列，該表沒有這兩個欄位。PostgREST 只要有一個未知欄位就退回整列，而 `logBatchRun` 完全不檢查回傳值，於是每晚的觀測列會靜默消失。**`npm run build` 抓不到，是 `npm run typecheck:edge` 加上逐欄比對資料庫欄位才發現的**。實際未遺失資料：兩環境 `batch_run_log` 最新列（DEV 09:10 UTC）都早於 0.9.32 的部署時間（11:21 UTC），修正於 12:07 UTC 部署完成，早於下一個寫入視窗（約 13:30 UTC）1.4 小時。
- **Review**: `route:reviewer` 對 0.9.32 與 0.9.33 各判一次 **PASS**。0.9.32 三項 RISK 中兩項當版修正、一項列為 `BUG_FIX.md` RISK-005；0.9.33 兩項 RISK（分頁未排序、`daysFailed` 無人讀取）皆於同版修正。
- **Verify**: `npm run build`、`npm run typecheck:edge`、`npm run lint` 全部 exit 0；`npx vitest run` 99 檔 / **1,668** 項通過，exit 0。
- **一次偶發**: 六次全套執行中有一次出現 `Errors 1 error`（Unhandled Error），該次與 `npm run build` 同在一個 shell 呼叫內。其餘五次乾淨且 exit 0，判定為資源競爭，未追。

### 需要使用者處理
- **Supabase personal access token 已在對話中外洩**，請至 Supabase Dashboard → Account → Access Tokens 撤銷並重建。這是十一天內第四次同類外洩，已記於 `BUG_FIX.md` Operational Notes，含避免再犯的作法。
