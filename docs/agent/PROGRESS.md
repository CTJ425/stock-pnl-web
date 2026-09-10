# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 個股走勢圖區間擴充為八個，尚未部署（Task 154, 0.9.41-dev.1）
- Status: **🔄 IN PROGRESS**
- Timestamp: 2026-09-10 12:26:19 Asia/Taipei

---

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

## 📅 Log: 2026-09-10 11:17:55 Asia/Taipei (Task 153, 0.9.40-dev.1)

**Edge Function 的 twlist 補上完整性檢查，結案 RISK-008**

- **起因**: 0.9.39 的 BUG-075 只修了客戶端直連路徑。Edge Function `stock-price` 的 `twlist` action 仍犯同一個錯，記為 RISK-008，使用者指示直接修掉。
- **根因**: `handleTwList` 用 `Promise.allSettled` 合併任何成功的來源，只有合併後長度為 0 才回 502。上市（TWSE）或上櫃（TPEx）其中之一掛掉時，呼叫端會拿到帶 HTTP 200 的半份清單並快取 30 分鐘。
- **實作方案**: 抽出純邏輯模組 `sources/supabase/functions/stock-price/twList.ts`，不含 Supabase／Deno 匯入，比照 `backup-transactions/backupPlan.ts` 的既有模式以純 vitest 測試。`handleTwList` 只保留 `fetchJson`、兩個 URL、`UA` 標頭與 10 秒逾時，其餘委派給 `buildTwList`；不完整時回 502。`listNumber` 一併移入該模組，`index.ts` 內已無其他呼叫者。
- **Reviewer**: FAIL，1 BLOCKER + 2 RISK。BLOCKER 屬實並已修：第一版的完整性檢查只看 `value.length === 0`，擋不住「陣列非空但每一列都缺代號或缺名稱」的來源——全部被 `push` 丟棄後結果仍是 `ok: true` 的半份清單。改為逐來源計算「結構有效列數」，且刻意在去重之前計算：僅與另一交易所重複的列仍證明此來源有回應，因此計入；整批無效才判定該來源失效。這個順序讓 E5（重複代號）與 E8（整批無效）兩個測試同時成立。
- **主 session 另一處收斂**: builder 依 brief 在兩處 `for...of` 用了 `as` 斷言。改為四段式明確窄化後 TypeScript 能自行證明兩個讀取都在 fulfilled 分支，斷言全部移除，`typecheck:edge` 仍 exit 0。
- **不修的兩項**: RISK-010（來源被上游截斷但非空時兩端都視為完整，理論性，兩個 OpenAPI 目前不分頁）記入 `BUG_FIX.md`；`fetchViaEdge` 未讀取回應內的 `error` 字串，屬既有的觀測性落差，未擴大本次範圍。
- **驗證**:
  - 新增 8 條測試（E1–E8）於 `sources/supabase/functions/stock-price/twList.test.ts`。
  - 反向驗證：E8 在修正 BLOCKER 之前確認轉紅（`expected true to be false`）。
  - `npx vitest run` exit 0（111 測試檔 / 1790 測試全數通過，無 `Errors` 行）。
  - `npm run build` exit 0。
  - `npm run typecheck:edge` exit 0——本次改動在 `supabase/functions/`，此為獨立 gate，`npm run build` 不會檢查該目錄。
- **版本更新**: 同步 4 檔案升版至 0.9.40-dev.1。
- **⚠️ 未部署**: 本次僅修改程式碼。`stock-price` Edge Function 需另行 `supabase functions deploy` 後才會生效，DEV 與 PROD 皆尚未部署。使用者尚未授權部署。
- **✅ 後續部署（2026-09-10 11:37:23 Asia/Taipei）**: 使用者授權後部署至 DEV 與 PROD，來源 commit `290f9d3`。`stock-price` 兩邊皆由 v5 進到 v6，`ezbr_sha256` 由 `30240a50864fb60f…` 變為 `90e9dc2c28836a3a…`；兩邊 sha 相同，證明跑的是同一份新 bundle。判定依據是 sha 前後比對而非 version 號——版號跳動只證明有東西上傳，曾發生過版號較新卻是舊程式碼的情況。`verify_jwt` 維持 `true`，未加 `--no-verify-jwt`（該旗標只有 `stock-report` 需要）。以 `--project-ref` 指定專案，未動 `supabase link`。PROD 部署在 `main` 分支執行。
- **✅ 實機煙霧測試**: DEV 與 PROD 各打一次 `{"action":"twlist"}`，皆回 HTTP 200、27819 筆，且同時含上市 3037 與上櫃 6488，證明完整性檢查沒有誤擋健康路徑。
