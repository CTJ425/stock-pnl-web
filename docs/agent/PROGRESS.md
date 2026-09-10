# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修好查無檔案被當成錯誤的根因，並完成追蹤文件對帳（Task 156/157, 0.9.44, BUG-078）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 15:14:01 Asia/Taipei

---

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

## 📅 Log: 2026-09-10 14:42:14 Asia/Taipei (Task 156, 0.9.43)

**修復非持股股票的四個日線區間讀不到（BUG-077）**

使用者回報 PROD 點 `近 1 年` 或 `本年迄今` 讀不到，附上 `app_log`。該筆記錄是 `action=downloadReportsJson, message=HTTP 400, detail={"path":"daily/2382.json"}`，`app_version=0.9.42`。

- **根因不是計算錯，是覆蓋範圍回歸**。`daily/{ticker}.json` 只有持股才有：2026-09-10 實測 PROD 的 `daily/` 只有 9 個檔案（`0050, 00685L, 009816, 00981A, 2303, 2455, 3037, 3714, 8033`），連 `2330` 都不在。0.9.42 讓行情分頁多了四個讀這份檔案的區間，任何非持股股票一開就壞四個。`一日`／`五日` 與 `近 5 年`／`全部` 都走 Edge 到 Yahoo，所以正常——這個對比正是使用者只在那四個區間看到失敗的原因。
- **修在 `useDailySeries`，不在元件**。加第三層後援：檔案讀不到、`warmStockCore` 也產不出來時，改打 Edge `daily` action 取 `range=5y` 再合成 `DailySeries`。行情與技術面共用同一個 hook，所以一次修好兩邊，`QuoteTab.tsx` 與 `TechnicalTab.tsx` 都沒有改動。
- **取 5y 超集是刻意的**：一次請求供應四個本地區間，之後點 `近 5 年` 免費（`fetchRemoteDaily` 依 ticker 與 range 快取）。也因此**不需要改 Edge，不需要重新部署**——`daily` action 於 0.9.41 就已上線，DEV 與 PROD 都是 v7。
- **`error` 與 `empty` 的區別保留**：Storage 讀取拋錯且後援也拿不到資料時才回 `error`，單純查無資料回 `empty`。
- **一個會騙人的測試結果**：改完後 `vitest` 回 **exit 1**，摘要行卻寫「1841 passed」。原因是四個測試檔用完整替換式 `vi.mock` 蓋掉 `dailyProxy` 而沒有 `fetchRemoteDaily`，產生 32 個 unhandled error。判定依據永遠是 exit code 與 `Errors` 行，不是 passed 數字。四個 mock 已補齊。
- **PROD 實打確認後援可用**：`2382` 與 `2330` 的 `range=5y` 皆回 HTTP 200、1214 根、末根 `2026-09-10`。
- **測試**：新增 5 條（`useDailySeries.test.ts`，先紅後綠），總數 1836 → 1841，三道 gate 皆 exit 0 且無 unhandled error。
- **⚠️ 前端需重新部署才會生效**：本 repo 沒有前端部署 workflow（`.github/workflows/` 只有 `release.yml`，只同步 Release）。`git push` 不會讓正式站拿到這份修正。
