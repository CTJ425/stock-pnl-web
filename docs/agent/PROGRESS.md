# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 深度稽核九項查證與修正、0.9.34 發布與雙環境部署
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-05 09:22:10 Asia/Taipei

---

## 📅 Log: 2026-09-05 09:21:54 Asia/Taipei (深度稽核九項查證與修正、0.9.34 發布)

- **Status**: ✅ **COMPLETED** —— 已合併 `main`，DEV 與 PROD Edge 均已部署並驗證
- **Version**: `0.9.33` → **`0.9.34`**（`main` 與 `dev` 同為 `2799991`）
- **緣由**: 使用者先問「有確認過 Antigravity 找出的 BUG 都屬實嗎」，接著指示「依查證屬實的部分修復、驗證並直接部署合併」。

### 查證（先於修復）
九項深度稽核發現先前只被歸檔、未經查證。逐條核對後：**七項完全成立、兩項部分成立、無一被駁回**。
同時修正原報告四處錯誤主張：BUG-066 第 5 處成因實為 GoTrue Admin API 分頁而非 PostgREST `max_rows`
（照原歸因實作會白做工）；BUG-066 引用 `config.toml` 作為雲端證據但該檔管的是本機堆疊；
BUG-068「鎖死」誇大（輸入框未 disabled）；BUG-069「無條件上傳」不正確（在 `if (regenerate)` 內）。

### 修復
三波 builder，主 session 先寫 15 個失敗測試作為契約。三項 P0 都是融券帳務的靜默金額錯誤。
`route:reviewer` 判定 **FAIL** 並攔下兩個 BLOCKER，皆於同版修正並各自補測試：
- **BUG-072**：`handleAdminStatus` 的 `pagedSelect` 呼叫端忽略 `r.error`，把分頁中途失敗的部分資料
  當成完整結果 —— 正是分頁工作要消除的缺陷，在呼叫端被重新引入。由 0.9.34 自身引入。
- **BUG-073**：BUG-067 讓融券列首次可被選取後，暴露出股數與均價取自共用多頭腿、損益取自選中列的
  接縫，同檔有多空時畫面數字自相矛盾。

### 兩個由本專案自身修正引入的缺陷（模式相同，值得記住）
- **BUG-069** 的可觸發性來自 0.9.32 的 BUG-053：加上逐筆 `try/catch` 之前，例外會中止整輪，
  manifest 根本不會被寫入。
- **BUG-073** 的可達性來自本版的 BUG-067。
兩者都是「修好一個缺陷，讓另一個原本到不了的缺陷浮現」。修正本身都沒錯，但**修好一個可達性問題時，
要一併檢查它讓什麼變得可達**。

### Verify
`npm run build`、`npm run typecheck:edge`、`npm run lint` 全部 exit 0；
`npx vitest run` 99 檔 / **1,684** 項通過（新增 15 項）。

### Edge Function 部署（2026-09-05 01:26–01:41 UTC）
使用者於本輪明確授權新 token 後完成。**DEV 先行，確認部署後的 cron 回 200 才推 PROD** ——
BUG-070 改動了 `backup-transactions` 的 `CRON_SECRET` 比對方式，若有缺陷會讓兩環境的備份排程全部 401。

| Function | 版本 | Hash | verify_jwt |
| --- | --- | --- | --- |
| `stock-report` | v6 → **v7** | `9ad5501c…` → `c4a1f053…` | false ✓ |
| `backup-transactions` | v2 → **v3** | `32d4fac…` → `7c05cd47…` | false ✓ |
| `stock-price` | v4（0.9.34 未動，未重新部署） | `9609330f…` | true ✓ |

兩環境部署後三個 function 的 `ezbr_sha256` 完全一致。
- **DEV** 01:30 UTC 回 200，部署後零非-200。
- **PROD** 01:40 UTC 回 200，部署後零非-200；`verify_setup()` 十項全 PASS，`cron target host` 正確。
- 查詢完畢後 link 已還原回 DEV。

**0.9.34 至此完整上線**：程式碼、`main`、GitHub Release、兩環境 Edge 全部到位。
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

