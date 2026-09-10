# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 行情走勢圖也擴充為八個區間（Task 155, 0.9.42）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 14:14:51 Asia/Taipei

---

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
- **⚠️ PROD 仍未部署 `stock-price`**：`近 5 年` 與 `全部` 在正式站兩個分頁都還不會有資料，需使用者另行授權。

## 📅 Log: 2026-09-10 12:26:19 Asia/Taipei (Task 154, 0.9.41-dev.1)

**個股走勢圖區間擴充為八個，`近 5 年` 與 `全部` 走 Edge Function 即時代理**

個股技術面日 K 圖的區間選擇器從 `近 3 月 / 近 6 月 / 近 1 年` 改為 `近 1 月 / 近 6 月 / 本年迄今 / 近 1 年 / 近 5 年 / 全部`，與盤中圖的 `一日 / 五日` 合計八個區間。

`近 5 年` 與 `全部` 走線路 A：不進 Storage，由 `stock-price` 新增的 `daily` action 即時代理 Yahoo。夜間批次與 `daily/{ticker}.json` 未動，Supabase 用量不變。`全部` 是月線 —— 實測 `range=max` 帶 `interval=1d` 時 Yahoo 仍回月線，全歷史日線需 `period1=0` 且達 566 KB，過重。

- **實測依據（2026-09-10, 2330.TW）**: `range=5y&interval=1d` 回 1215 根日線、77 KB，其中 2025-08-01 一根五欄皆 null；`range=max` 回 321 根月線、28 KB，且在當月月線後附加一根 timestamp 等於 `meta.regularMarketTime` 的即時列；月線時間戳必須先加 `meta.gmtoffset` 才會落在月初，不加會整條位移一格。
- **reviewer 找到一個 BLOCKER**: `近 5 年` 切到 `全部` 時舊資料會掛在新標籤下顯示且無載入指示，因為清除舊資料只寫在切回本地區間的分支。已修，並補上四條遠端區間測試 —— 原本這一段零覆蓋，所以全綠的測試沒抓到它。
- **一併修掉的風險**: 遠端讀取失敗原本會被快取 5 分鐘，網路瞬斷後使用者連點五分鐘都只重播那個失敗。現在只快取成功結果。
- **測試**: 新增 21 條，總數 1793 → 1814，全部通過。`npm run build`、`npm run typecheck:edge`、`npx vitest run` 三道 gate 皆 exit 0。
- **版本更新**: 同步 4 檔案升版至 0.9.41-dev.1。
- **✅ DEV 部署（2026-09-10 12:47 Asia/Taipei）**: 使用者授權後部署 `stock-price` 至 DEV（`zyebvayngwrqzoaicbwd`），來源 commit `8381e37`，工作區乾淨。版本 v6 → v7，`ezbr_sha256` 由 `90e9dc2c28836a3a…` 變為 `253e6c3d25d6e7ac…`；判定依據是 sha 前後比對而非版號。`verify_jwt` 維持 `true`，未加 `--no-verify-jwt`。以 `--project-ref` 指定專案，未動 `supabase link`。`dailyRange.ts` 跨目錄匯入 `../stock-report/twDaily.ts` 打包無誤，該風險結案。
- **✅ 實機煙霧測試（DEV）**: `range=5y` 回 HTTP 200、granularity `1d`、1213 根（Yahoo 原始 1215，丟掉 2025-08-01 空格與當日未收盤那根，末根為 2026-09-09）；`range=max` 回 granularity `1mo`、320 根（原始 321，丟掉即時列），末根 `2026-09-01` 證明 `gmtoffset` 有生效、月線落在月初；`range=10y` 回 HTTP 400；既有 `intraday` action 仍回 248 點，未受影響。
- **⚠️ PROD 尚未部署**: 需使用者另行授權。
