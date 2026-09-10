# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 股票搜尋補上 Carbon 載入轉圈動畫（Task 151, 0.9.39-dev.1）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 10:09:24 Asia/Taipei

---

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

---

## 📅 Log: 2026-09-09 18:00:00 Asia/Taipei (Task 150, 0.9.38)

**修復 0.9.37 引入之 Carbon 資料表四階對比造成 .pnl-up / .pnl-down 顏色覆蓋問題**

- **根因**: 0.9.37 於 `sources/src/index.css` 引入之 `.data-table td`（指定 `$text-secondary`）、`.data-table td.num > div:first-child`（指定 `$text-primary`）以及 `.data-table tbody tr:hover td`（指定 `$text-primary`）因 CSS 權重高於全域 `.pnl-up` / `.pnl-down`，導致資料表儲存格的現價漲跌、保本賣出價、未實現損益與未實現報酬率失去紅綠顏色，並在 hover 時被強制覆蓋為文字主色。
- **修復方案**:
  1. 於 `sources/src/index.css` 在 `tr:hover` 規則後補齊 `.data-table` 專屬之損益樣式規則：涵蓋 `.data-table .pnl-up/down/flat`、`td.pnl-*`、`td.num.pnl-*`、主數值 `> div:first-child` 以及滑鼠懸停 `tbody tr:hover` 狀態。
  2. 數值儲存格副標籤（如「未含費 …」、「券商 …」）因匹配 `:not(:first-child)` 與 inline 樣式，精準維持次要／輔助文字階層，不受紅綠主色干擾。
- **驗證**:
  - `DashboardPage.test.tsx` 新增持股列表獲利／虧損之數值儲存格 class 斷言（現價、保本價、未實現淨損益、報酬率）。
  - `sources/src/styles/tablePnlStyles.test.ts` 新增 JSDOM 實體 DOM 計算樣式（`getComputedStyle`）深度驗證，嚴格確認各種單元格類型、階層標籤及 hover 規則在 CSS 級聯下之色彩表現。
  - `npm test` exit 0（108 測試檔 / 1760 測試全數通過）。
  - `npm run build` exit 0。
  - `npm run typecheck:edge` exit 0。
- **版本更新**: 同步 5 檔案升版至 0.9.38，依使用者指示合併至 main。

