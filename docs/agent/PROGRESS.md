# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: BUG-050 修正 + 2026-09-04 稽核六項修正 (0.9.32-dev.1)
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-04 19:09:19 Asia/Taipei

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

---

## 📅 Log: 2026-09-04 15:30:39 CST (BUG-049 修正、0.9.31 發布、全庫稽核)

- **Status**: ✅ **COMPLETED** on `main` and `dev`（兩端同為 `8ee8c01`）
- **Version**: `0.9.30` → `0.9.31-dev.1` → **`0.9.31`**
- **緣由**: 使用者回報 PROD 顯示「2026-04-28 3037 賣出 50 股，但當時持有僅 0 股」，但確認資料應無異常。
- **根因（已證實）**: 匯入批次為所有列寫入同一個 `created_at`。`dataProvider.ts` 與 `pnlEngine.ts` 都只用
  `tx_date` + `created_at` 排序，兩鍵相等時沒有決勝鍵。PostgreSQL 排序不穩定，同一個
  `ORDER BY tx_date, created_at` 在兩種查詢寫法下對同一張 PROD 表回傳相反的順序；`Array.sort` 是穩定排序，
  保留 SELL 在 BUY 之前的錯誤順序，引擎於是在買進入帳前處理賣出。
- **修正**: `pnlEngine.ts` 新增並匯出 `compareTxOrder()`（兩鍵相等時開倉腿優先、再以 `id` 決勝）；
  `computeLedger()`、`TransactionsPage.tsx` 的列表排序與 CSV 匯出、`dataProvider.ts` 的兩個 provider 全部改用它；
  Supabase 查詢另追加 `.order('id')`。
- **實測影響**: 以 PROD 111 筆真實交易重跑引擎，修正前該次載入全站已實現 878,583，修正後 299,807，虛增 578,776 元。
  3037 由 250 股／成本 223,316／已實現 45,548 修正為 200 股／成本 181,257／已實現 3,489。
  15 組同日買賣配對中 14 組暴露於同一缺陷。修正後原序／反序／亂序三種輸入結果完全一致且無任何警告。
- **驗證**: `npm run build` 綠燈；`npx vitest run` 1609 passed / 97 files / exit 0（含 6 個新測試）。
- **Review**: `route:reviewer` 判定 PASS，兩項 RISK。RISK-1（數量不對等的 DAY_TRADE 群組排序改變）已列為
  accepted RISK 記於 `FIXED_BUG.md` BUG-049；RISK-2（列表與匯出排序與引擎不一致）已於同一版修正。
- **稽核**: 三個平行 read-only 審查覆蓋 `supabase/functions/`、`src/services/` + `src/utils/` + `src/types/`、
  `src/components/` + `src/context/`。7 項開放發現記於 `BUG_FIX.md` AUDIT-09…15，未動任何程式碼。
  其中 1 項審查主張（`chip_raw_cache` upsert 缺 `onConflict`）經主 session 查證 PROD 後駁回。
- **未做**: AUDIT-09…15 全部未修，等待使用者指示。無 Supabase 或 Edge Function 異動，未部署。

