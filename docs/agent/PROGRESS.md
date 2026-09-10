# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修復非持股股票的日線區間讀不到（Task 156, 0.9.43, BUG-077）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 14:42:14 Asia/Taipei

---

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

## 📅 Log: 2026-09-10 14:14:51 Asia/Taipei (Task 155, 0.9.42)

**行情分頁的走勢圖也擴充為八個區間**

0.9.41 只改了技術面的 K 線圖，使用者看到成果後反轉了「只擴充 K 線圖」的決定，要求行情分頁的走勢圖也要八個區間。行情圖維持折線，八個區間都是折線；K 棒與指標仍然只在技術面。

`docs/agent/specs/chart-range-eight.md` §7 原本把 `IntradayChart.tsx` 列在「不需改動」，該行已加註修訂並指向新規格 `docs/agent/specs/quote-tab-trend-ranges.md`。

- **改動維持在四個檔案**，關鍵是三個既有事實：`IntradayChart` 實際只讀 `series.points` / `prevClose` / `symbol`，所以 `series` 的型別可以**縮**成 `TrendSeries`，日線組出來的序列不必假造 `interval`；props 改成泛型 `<R extends TrendRange>`，`TwIndexToday.tsx` 推導成 `IntradayRange` 因而完全不用改（直接放寬型別會因參數逆變而編譯失敗）；切片沿用 0.9.41 已測過的 `rangeBars`，x 軸標記沿用 `pickLabelIndices`，沒有第二套規則。
- **日線區間不畫均價線**：一年的累積 VWAP 沒有意義。做法是讓該序列全為 `null`，線段函式自然不產生線，`均價` 欄位顯示 `—`，其餘程式碼不動。
- **reviewer 找到一個 BLOCKER**：effect 讀 `dailyStatus` 卻沒把它放進相依陣列。`useDailySeries` 失敗時只呼叫 `setStatus('error')`，`series` 仍是同一個 `null`，所以 effect 不會重跑，骨架永遠停在載入中。修法是精準相依——只有本地日線分支消費 `dailyStatus`，其餘分支凍結成常數；無條件放進相依會讓預設的一日區間在日線背景載入完成時清空並重抓，每次開頁都閃一次骨架。
- **兩處既定偏離已記入規格**：`ranges` 的雙重轉型（`R` 在泛型內未受約束，單次轉型過不了），以及日線區間外層多包一個帶 `role="group"` 的 `div`（`ChartFrame` 用 `aria-labelledby`，價格圖與成交量圖的名稱只差一個後綴，角色查詢無法區分）。
- **版面事實**：行情與技術面同時顯示在同一頁（技術面是分析分頁裡的附加區塊，不是切換），所以頁面上同時有兩排區間按鈕，五個標籤重複。`StockDetailPage.test.tsx` 的技術面查詢因此必須指定區塊。
- **測試**：新增 22 條，總數 1814 → 1836，全部通過。`npm run build`、`npm run typecheck:edge`、`npx vitest run` 三道 gate 皆 exit 0。
- **不需部署 Edge**：本版為純前端改動。`daily` action 於 0.9.41 上線，DEV 為 v7。
- **✅ PROD 部署（2026-09-10 14:32 Asia/Taipei）**: 使用者授權後部署 `stock-price` 至 PROD（`hrilemueiqyaoiwnkeuu`），在 `main` 分支執行，工作區乾淨，來源 commit `c4a8b9e`。版本 v6 → v7，`ezbr_sha256` 由 `90e9dc2c28836a3a…` 變為 `253e6c3d25d6e7ac…`，**與 DEV 相同**，證明兩邊跑同一份 bundle。`verify_jwt` 維持 `true`，未加 `--no-verify-jwt`。以 `--project-ref` 指定專案，未動 `supabase link`。
- **✅ 實機煙霧測試（PROD）**: `range=5y` 回 HTTP 200、granularity `1d`、1214 根，末根 `2026-09-10`；`range=max` 回 granularity `1mo`、320 根，末根 `2026-09-01`；`range=10y` 回 HTTP 400。回歸：`intraday` 回 271 點，`twlist` 回 27819 筆且同時含上市 3037 與上櫃 6488。
- **📌 DEV 與 PROD 的 5y 根數差一根，是正確行為**: DEV 於 12:47 測得 1213 根、末根 `2026-09-09`；PROD 於 14:32 測得 1214 根、末根 `2026-09-10`。差別在台北時間 13:30 收盤與否——`extractDaily` 的盤中過濾會剔除當日未結算的滾動 Bar，收盤後才保留。
- **🔑 Token 權限差異**: 本次使用的 access token 可列出 PROD，但對 DEV 的 `functions list` 回 401。DEV 稍早已用前一個 token 部署並驗證完畢，不影響結果。兩個 token 都應撤銷。
