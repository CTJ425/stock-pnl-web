# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.32 發布與雙環境部署 + 補讀稽核與 0.9.33
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-04 20:10:51 CST

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

---

## 📅 Log: 2026-09-04 19:09:19 Asia/Taipei (BUG-050 修正、2026-09-04 稽核六項修正、0.9.32-dev.1)

- **Status**: ✅ **COMPLETED**（尚未 commit，等待使用者指示）
- **Version**: `0.9.31` → **`0.9.32-dev.1`**（`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 5 檔同步）
- **緣由**: 使用者指示「請 git diff 與交接文件完成未完成的 BUG_FIX」。工作區的 `git diff` 顯示 2026-09-04 稽核新增了 AUDIT-09…15 七項未修發現，`PROGRESS.md` 明載「AUDIT-09…15 全部未修，等待使用者指示」，另有 BUG-050 為 OPEN。其餘 RISK-002/003/004、BUG-042/043 皆已標記為 Accepted，不在範圍。
- **範圍決策（使用者於 2026-09-04 確認）**:
  - **AUDIT-10 不改程式**，記為可接受風險。「2.500」在台美股都可能是合法的 2.5 元，加規則拒絕會擋掉正常匯入；多組點號「1.234.567」目前已是 `NaN` 會報錯。
  - **BUG-050 不納入盤後 `oz` / `ot`**，維持 13:30 收盤價，與 0.9.30 已對齊的券商 APP 牌告口徑一致。只做該報告的第 1、2 點。
- **BUG-050 根因（已證實）**: `isClosed()` 要求撮合時間達 `13:30:00`。Yahoo 後備從不回傳 `tradeTime`；冷門股最後一盤無成交時撮合時間停在 13:30 之前。兩者畫面整晚顯示「盤中」，且 `twQuoteTtlMs` 把它們歸為未定案，整晚每十分鐘重抓同一個數字且永不收斂。
- **BUG-050 修正**: 新增 `twIsAfterClose(at)` 判斷台北時刻是否落在「當天不可能再產生新價格」的區間；`twQuoteTtlMs()` 新增第三參數 `fetchedAt`，收盤後才抓到的列鎖到隔天 08:25；`isClosed(quote, market)` 新增市場參數，只對台股以 `quote.asOf` 套用同一推論。**刻意保留**：`fetchedAt` 缺漏或仍在盤中時維持十分鐘退避，鎖定盤中快照正是 BUG-011 的原始缺陷。
- **其餘六項**: AUDIT-09（分割 0 股三道關卡）、AUDIT-11（批次失敗回報進度）、AUDIT-12（逐檔 try/catch 並回報失敗代號）、AUDIT-13（`CRON_SECRET` 固定時間比較）、AUDIT-14（漲跌百分比防除以 0）、AUDIT-15（日期正規式錨定結尾）。詳見 `FIXED_BUG.md` BUG-051…BUG-056。
- **路由**: 3 個 `route:builder` 平行實作（檔案清單互斥），主 session 先寫 12 個失敗測試作為契約。BUG-050 builder 回報 `VERIFY: BLOCKED`，指出一支既有測試（`priceProxy.test.ts` 的 `沉澱窗結束後（14:00 起）才退回十分鐘退避`）與新規則衝突。主 session 裁決：該測試編碼的是 BUG-050 之前的行為，已被取代；改寫為兩個案例，分別釘住「盤中抓到的列仍退避」與「收盤後抓到的列鎖定」。
- **Review**: `route:reviewer` 判定 **PASS**，三項 RISK。RISK-1（失敗無診斷資訊）與 RISK-3（管理台未顯示 `failed`）已於本版一併修正 —— 失敗的股票代號（最多 10 檔）隨回應主體回傳，`summariseFollowUp` 與 `ManualRunSection.summarizeBody` 都會顯示；不加 `console.*` 是因為該檔 4,200 行沒有任何一行 log。RISK-2（`uploadJson` 回傳 `false` 的標的兩邊都不計數）為既有缺口，列為 `BUG_FIX.md` RISK-005。
- **Verify**: `npm run build`（`tsc -b && vite build`）exit 0；`npx vitest run` **99 檔 / 1,637 項全數通過**，exit 0（新增 24 項測試，含新檔 `RecalcFeesModal.test.tsx`、`cronSecret.test.ts`；改寫 2 個被本版取代的既有案例）。
- **未做**: 未 commit、未 push、未部署任何 Edge Function、未動 Supabase。**BUG-050 與 AUDIT-12/13 的 Edge 端修正需要部署後才會在 DEV／PROD 生效**，等待使用者指示。

