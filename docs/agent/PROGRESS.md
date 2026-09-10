# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.40 已部署至 DEV 與 PROD（Task 153, stock-price v6）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 11:37:23 Asia/Taipei

---

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


