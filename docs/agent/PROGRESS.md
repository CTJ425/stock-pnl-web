# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修好查無檔案被當成錯誤的根因，並完成追蹤文件對帳（Task 156/157, 0.9.44, BUG-078）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 15:14:01 Asia/Taipei

---

## 📅 Log: 2026-09-11 13:03:40 Asia/Taipei (Task 158/159 batch 1, 0.9.45)

- **What**: Mobile (iPhone 13 mini, 375×629) and desktop (1440×900, 1024×768) UI/UX audits, published as `docs/design/mobile-ux-audit-iphone13mini.html` and `docs/design/desktop-ux-audit.html`; 32 findings recorded as Task 158 (1–17) and Task 159 (D1–D15). Batch 1 (13 items) shipped.
- **Changed**: `AppShell.tsx`, `DashboardPage.tsx`, `TransactionForm.tsx`, `Toast.tsx`, `index.css`, `index.html`, `manifest.webmanifest`, new `utils/feeRateHint.ts`, 3 PNG icons.
- **Verification**: 117 test files / 1,864 tests, exit 0 (+19 new tests; 1 stale smoke assertion updated to seed holdings); `npm run build` and `npm run typecheck:edge` exit 0. Playwright re-measure at 375×629: FAB 56×56, inputs 16 px, qty input 50 → 215 px, h1 → h2 → h3, no skeleton after load. At 1440 dark: `.pnl-up` 5.33:1, sub-lines 5.31:1, help icon 6.76:1.
- **Review**: reviewer FAIL overruled — the add button is hidden while the workspace loads by design (unchanged `!loading` gate); the Toast unmount-timer note is pre-existing code.
- **Audit corrections**: mobile #11 (`applyTheme()` already updates `theme-color` at runtime) and desktop D4 (the close button existed). Both reports were republished.
- **Deferred**: mobile #8 `viewport-fit=cover` needs a real iPhone. BUG-079 (保本賣出價 vs 淨收 fee interpretation) is open and not investigated.
- **Release**: 0.9.45 merged to `main` and synced to `dev`. Frontend not uploaded to Cloudflare Pages. No Edge change.

## 📅 Log: 2026-09-10 15:14:01 Asia/Taipei (Task 156 & 157, 0.9.44)

**BUG-078：查無檔案被當成錯誤，即時產生因此永遠不會執行**

0.9.43 只處理了症狀。真正的根因在 `downloadReportsJson`：它只把 **404** 當成「檔案不存在」，但 2026-09-10 實測 PROD，Supabase Storage 對不存在的物件回的是 **HTTP 400**，真狀態寫在 body 裡：`{"statusCode":"404","error":"not_found","code":"NoSuchKey"}`。

**傷害不是那筆錯誤紀錄，是那個 throw。** 每個呼叫端都是「先讀檔，讀不到才呼叫 `warmStockCore` 即時產生」，而且兩行在同一個 `try` 裡（`useDailySeries.ts`、`StockDetailPage.tsx:259` 與 `:274`）。拋錯直接跳過即時產生 → 檔案永遠不會被建立 → 下次再訪重複同樣的拋錯。這是自我維持的迴圈，`2382` 因此從 0.9.38 起一直是空的。**先前判定「warm 產不出檔案」是錯的：warm 根本沒被呼叫過。**

- **一處修好七個 proxy**：籌碼、日線、基本面、大盤、外資、總經、匯率全部共用這個函式。
- **真錯誤仍可見**：body 不是查無物件的 400、以及 500／網路中斷／壞 JSON，全部照舊拋錯。`null` 只代表「不存在」。
- **契約測試擋下一次疏忽**：`catchLogging.test.ts` 掃描原始碼，我一開始寫的 `.catch(() => '')` 違反「每個 catch 都要記錄」的契約而轉紅。改成讓 `res.text()` 的例外交給外層處理，行為反而更正確。
- **測試**：`reportsBucket.test.ts` 新增 4 條（先紅後綠），總數 1841 → 1845，三道 gate 皆 exit 0 且無 unhandled error。

**Task 157：追蹤文件與程式碼對帳**

以程式碼與線上實測為準，不採信文件自述。完整對照表在 `TASK.md` 的 Task 157。

- **八項文件說待辦、實際已完成**（紀錄過期）：Task 144-2 執行日誌檢視器、Task 145 的 P0-1／P0-2／P0-3／P1-1／P1-2、Task 76 item 4、quote-yahoo-a 的均價。其中 P0-3 有兩條測試守著，規格本就允許「排除融券並警示」這個解法，先前被判為未完成是誤讀規格。
- **五項確實沒做**：Task 144-3 資源用量監控、Task 144-4 R2 多目標備份、Task 85 探針視窗只重調 1/7、`成交金額`／`昨量` 缺資料來源、Task 145 的 OPT 項未驗證。
- **三項原列風險、實測不成立**：`readDoneSourcesToday` 未分頁但每日僅 74 筆（符合條件 24 筆）不會截斷；`handleAdminUsers` 單次 `listUsers` 是註解寫明的刻意決定；`daily/` 檔案停在 9/9 是批次未到時間，不是過期。
- **Task 154 狀態過期**：所有子項都已完成，狀態卻仍是 🔄 IN PROGRESS，已更正為 ✅ DONE。
- **`TASK.md` 的專案現況標頭停在 0.9.38 / 1,760 測試**，與現況（0.9.44 / 1,845 測試 / `stock-price` v7）差距很大，已整段重寫，並寫入前端部署目標 `https://stock-pnl-web.pages.dev/`。

**PROD `app_log` 全量盤點**：總共只有 5 筆，全是同一個病灶（4 筆 `fundamental/2382.json`、1 筆 `daily/2382.json`）。修掉 BUG-078 後這一類紀錄應該歸零——那是驗證這次修正是否生效的可觀測指標。

**⚠️ 前端需重新建置上傳才會生效**：手動流程見 `README.md` 步驟 9-1。
