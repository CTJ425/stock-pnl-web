# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修復觀察清單搜尋兩個缺陷並重整字卡版面（Task 152, 0.9.39-dev.2）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 10:46:33 Asia/Taipei

---

## 📅 Log: 2026-09-10 10:46:33 Asia/Taipei (Task 152, 0.9.39-dev.2)

**修復觀察清單搜尋的兩個缺陷，並重整字卡的名稱與產業別版面**

- **起因**: 使用者回報 DEV 上「加入觀察」搜不到 3037 欣興，並推測是不同工作區或不同使用者加過就不能再新增。
- **查證**: 以 `supabase db query --linked` 實測 DEV（`is_dev=true`）：`tw_watchlist` 的 `rls_on=true`、`policies=1`、`rows_total=10`、`users_total=1`、`rows_3037=1`。推測不成立——`schema.sql:190` 的主鍵是 `(user_id, ticker)`，沒有 workspace 欄位，觀察清單是使用者層級；跨使用者由 RLS 隔離，且 DEV 上只有一個使用者有資料。真正原因是 3037 早已在清單中，被搜尋結果靜默隱藏。
- **BUG-074 加入觀察搜尋把已加入的股票靜默隱藏**: `AddWatchModal.tsx:51` 的 `!watched.includes(row.symbol)` 把已加入的代號整筆移除且不給說明。改為列出但停用、標示「已在觀察清單」，並排序到可加入項目之後，`aria-label` 同步改寫。
- **BUG-075 部分來源失敗的殘缺清單被當成完整清單快取**: `twMarketData.ts` 的 `fetchDirect` 用 `Promise.allSettled` 合併任何成功的來源，TWSE 失敗而 TPEx 成功時回傳「只有上櫃」的清單，而 `getTwStockList` 只擋 `length === 0`，於是殘缺清單被快取 30 分鐘，期間每一檔上市股票都顯示為「查無此股」。改為任一來源 reject 或回空陣列即回傳 `[]`，交給既有後援鏈；`CACHE_KEY` 一併換版為 `tw-list-v2`，避免沿用修正前寫入的殘缺快取。
- **字卡版面重整**: `.watchlist-card-meta` 原本把代號、名稱、產業別擠在同一行，三者同為 `--type-label-01`（12px），而欄寬 `minmax(136px, 1fr)` 扣掉 padding 與刪除鈕僅餘約 100px，名稱與產業別都設 `flex-shrink: 1`，會同時被截斷成省略號。改動兩項：(1) 產業別經 `getGroupCategoryName` 正規化後若與群組標題相同就不重複顯示；(2) 其餘情況產業別移出名稱列，獨立成行、去框去底、改用 `--ink-muted`，名稱改為 `flex: 1 1 auto; min-width: 0` 獨佔整行寬度。層級來自顏色與位置而非字級，因為 `--type-label-01` 已是此專案字級尺標的最小值，且 0.9.37 已刻意移除全部寫死的 px 字級。
- **Reviewer**: PASS，5 項 RISK。其中 2 項當場修掉（來源回 HTTP 200 加空陣列、修正前的快取仍被沿用），3 項記錄不修（`fetchViaEdge` 無完整性檢查列為 RISK-008；「還有 N 筆」計數含不可點項目列為 RISK-009；雙重故障時從半份清單變成明確報錯屬設計取捨，記於 BUG-075）。
- **驗證**:
  - 新增 11 條測試：`twMarketData.test.ts` 6 條（L1–L6）、`AddWatchModal.test.tsx` 3 條、`WatchSection.test.tsx` 2 條。
  - 反向驗證：移除空陣列檢查後 L5 轉紅（`promise resolved "[ { symbol: '6488', …(2) } ]" instead of rejecting`），確認測試為真證據。
  - `npx vitest run` exit 0（110 測試檔 / 1782 測試全數通過，無 `Errors` 行）。
  - `npm run build` exit 0。
  - `npm run typecheck:edge` 未執行：本次未改動 `sources/supabase/functions/`。
- **版本更新**: 同步 4 檔案升版至 0.9.39-dev.2。
- **安全提醒**: 本次查證 DEV 使用了使用者於對話中貼上的 Supabase personal access token。`FIXED_BUG.md` 既有紀錄顯示此情況已重複發生多次，標準處置是改用 `! supabase login`。該 token 應盡快撤銷。

## 📅 Log: 2026-09-10 10:09:24 Asia/Taipei (Task 151, 0.9.39-dev.1)

**買入股票與加入觀察的搜尋補上 Carbon 載入指示，並修掉兩條會讓轉圈停不下來的路徑**

- **問題**: 交易表單的股票名稱欄位會在去抖動 300ms 後打遠端搜尋（`searchStocks`），加入觀察對話框則在開啟時抓台股清單（`getTwStockList`）。兩者過去都沒有任何載入指示，使用者無法分辨「搜尋很慢」與「根本沒在搜尋」。
- **實作方案**:
  1. 新增 `sources/src/components/Common/Spinner.tsx`：Carbon Design 載入指示器，灰色軌道圓 + 3/4 藍色弧線，690ms 一圈，取色自 `--cds-layer-accent-01` 與 `--cds-interactive`，`prefers-reduced-motion: reduce` 時停止動畫。
  2. `sources/src/index.css` 新增 `.cds-spinner`、`@keyframes cds-spin`、`.suggestion-loading`、`.watch-loading` 規則。既有 `.spin` 與 `@keyframes spin` 完全未動，其餘 18 個元件仍沿用。
  3. `sources/src/components/Transactions/TransactionForm.tsx` 新增 `searching` 狀態，於第一個按鍵即為 true（不等去抖動），並新增 `closeSuggestions()` 統一處理「清計時器 + 遞增 `searchSeq` + 清結果 + 停轉圈」，取代原本 5 處分散的 `setSuggestions(null)`。搜尋中只顯示轉圈列，不顯示過期結果。
  4. `sources/src/components/StockDetail/AddWatchModal.tsx` 新增 `listLoading` 狀態，於 `.finally()` 清除，成功與失敗都會停止轉圈。關鍵字過濾本身是同步的本地比對，不加轉圈。
- **Reviewer findings（2 項，皆已修）**:
  - BLOCKER — `tx-nature` 下拉的 `onChange` 從未清除搜尋結果。`nature` 是 `isSpotSell` 的一部分，切換它會隱藏搜尋下拉，但轉圈與計時器不受影響；切回來會看到上一個關鍵字的過期結果。此為 brief 漏列的既有缺陷，已補 `closeSuggestions()`。
  - RISK — `searchTimer` 沒有 unmount 清理，表單在 300ms 內關閉時計時器仍會觸發搜尋。已補 `useEffect` cleanup。
- **另補一項**: builder 依 brief 只寫了 `try/finally`，搜尋被 reject 時雖會停止轉圈，但 rejection 會逸出成 unhandled rejection，使 vitest 摘要顯示 7 passed 卻以 exit 1 收場。已補 `catch`，失敗時顯示「無匹配結果」。
- **驗證**:
  - 新增 12 條測試：`sources/src/components/Transactions/TransactionForm.spinner.test.tsx` 9 條（S1 第一個按鍵即轉圈、S2 結果回來停止、S3 不留過期結果、S4 清空停止、S5 點表單外停止、S6 選定停止、S7 例外時停止、S8 切換交易性質停止、S9 卸載後不再搜尋），`AddWatchModal.test.tsx` 3 條（載入中／載入完成／載入失敗）。
  - S8 與 S9 各自移除對應修正後皆轉紅（`expected "vi.fn()" to not be called at all, but actually been called 1 times`），確認測試為真證據而非空轉。S8 必須用 `fireEvent.change` 而非 `userEvent.selectOptions`：後者會產生 document click，表單外點擊的 effect 會先收合下拉，蓋掉要驗的缺陷。
  - `npx vitest run` exit 0（109 測試檔 / 1772 測試全數通過，無 `Errors` 行）。
  - `npm run build` exit 0。
  - `npm run typecheck:edge` 未執行：本次未改動 `sources/supabase/functions/`。
- **版本更新**: 同步 4 檔案升版至 0.9.39-dev.1（`sources/package.json`、`sources/package-lock.json`、`sources/src/version.ts`、`README.md`）。

