# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-05 16:55:00 Asia/Taipei

---

> **本檔只留進行中與週期性任務。** 已完成的移到 `TASK_ARCHIVE.md`（見 CLAUDE.md §4.1）——
> 這份檔案每個 session 都要載入，歸檔前它有 38.6K tokens，其中九成是完成歷史。
> 詳細的實作經過一律看 `PROGRESS.md`，那裡才是敘事的地方。

## 📋 Active Tasks

### Task 69: 個股分析改放報價卡；台股收盤後不再抓價（0.6.36-dev.1）
- **Status**: ✅ **完成，兩區皆已上線**（測試區 16:10、正式區 16:47；0.6.36 已併入 main）
- **Agent**: Claude
- **Timestamp**: 2026-08-05 16:05:00 Asia/Taipei
- **需求**：使用者要「個股分析刪掉我的持股卡片，改放開盤 / 最高 / 成交量 / 昨收 /
  最低 / 預估 / 今收」，並希望「抓到日收盤價就更新到現價、之後不再打 API，
  直到隔天 8:25 試搓前才恢復」。起因是擔心隔夜再看時價格基準錯亂。
- **原構想被實測否決**：使用者原本要用 TWSE `STOCK_DAY_AVG_ALL` 定義今收。
  2026-08-05 15:23（收盤後兩小時）實測，該端點與 `STOCK_DAY_ALL` 的 `Date` 都還是
  `1150804`（前一交易日），2330 回 2320 —— 那是昨收；當日真正收盤價是 MIS 的 2405，差 3.6%。
  照原構想會把昨收當今收並鎖 17 小時，正好製造出使用者要避免的錯亂。
  **改用 MIS 單一來源**（同一筆回應已含 `o/h/l/v/y/z/d/t/ip`），使用者確認採用。
- **收盤判斷改看時鐘而非資料到齊**：`quoteWindow.ts` 的 `twQuoteTtlMs` 是無狀態純函式，
  不查交易日曆 —— 週末與假日 13:30 後自然落入長 TTL。詳見 `SPEC.md`「報價卡與台股抓價時段」。
- **保留的東西**：`buildHoldingRows` 與 `generateReport` 的 holding 資料流照舊
  （下拉選單要列持股、即點即產要帶脈絡），只是畫面上不再顯示持股數字。
- **驗證**：`npm test -- --run` 56 檔 869 筆全通過（新增 `quoteWindow.test.ts` 9 筆、
  `QuoteTab.test.tsx` 10 筆，擴充 misParse / priceProxy）；`npm run build`、`npm run lint` 乾淨。
- **測試區部署紀錄（2026-08-05 16:00–16:10，使用者明確授權）**：
  1. `supabase functions deploy stock-price --project-ref wqetxuhncvfidqnklyew`
     → v9 升到 **v10**，`verify_jwt` 維持 `true`（**不帶** `--no-verify-jwt`，那是 `stock-report` 專用）。
  2. `price_cache` 補 7 個欄位完成，欄位序：
     `key,price,updated_at,prev_close,open,high,low,volume,trade_date,trade_time,trial`。
  3. 端到端實測（打測試區 Edge）：2330 與 6488 回齊七欄
     （`tradeDate: 20260805`、`tradeTime: 13:30:00`、`trial: false`）；
     AAPL 的 `tradeDate/tradeTime` 為 null、`volume` 67779 張（Yahoo 的股數已除以 1000），皆如設計。
  4. **收盤鎖定實測生效**：把 `TPE:2330` 的 `updated_at` 往回撥 5 分鐘後再打一次，
     回傳的 `asOf` 仍停在 5 分鐘前 —— 舊的 60 秒 TTL 必定會重抓，這是決定性證據。
- **操作環境副作用**：`supabase link` 現在指向**測試區** `wqetxuhncvfidqnklyew`
  （link 是全域的，見 `supabase-ops` skill）。要動正式區必須先重新 link。
- **稽核方式的例外**：skill 要求用 `functions download` 逐檔比對，但此環境的 `download`
  取不到 access token（`projects list` / `deploy` 卻可以，走不同認證路徑）。
  改用「線上版本更新時間（v9 = 08-05 11:35，與 0.6.34 部署時程吻合）」＋「端到端回傳新欄位」
  兩項替代 —— 後者比逐檔比對更有力，因為它證明的是**線上實際在跑的行為**。
- **待驗證（收盤後無法確認，需隔日盤中回頭看）**：
  1. MIS 的 `v` 與 TWSE 日報表 `TradeVolume` 有約 10% 落差（31,851 張 vs Yahoo 的 35,214 張），
     推測是盤後定價交易未計入 —— 單位是「張」已確定，差異來源待隔日用 `STOCK_DAY_ALL` 對帳。
  2. 試撮時段（08:30–09:00）MIS 實際回的 `ip` / `t`，確認「預估」格如預期顯示。

### Task 70: 後台時間軸基準日修正（0.6.36-dev.2）
- **Status**: ✅ **完成並已上線**（0.6.36 已併入 main）—— 純前端，不需要部署 Edge Function
- **Agent**: Claude
- **Timestamp**: 2026-08-05 16:35:00 Asia/Taipei
- **起因**：使用者問「16:00 這班車啟動後，台股盤後・2026-08-04 這一輪 狀態都還是舊的，是 BUG 嗎」。
  查證後分成兩件事：
  1. **資料源時序，不是 bug**：批次用的 `T86?selectType=ALLBUT0999` 在 16:00 / 16:15 都還沒發布
     （同一支 API 換 `selectType=ALL` 已有資料，但那份含權證 ETF 共 16575 筆，
     與批次要的 1339 筆股票是兩份、產製時間不同步）。16:30 那輪 `t86_today` 轉 true、
     `data_ymd` 推進到 20260805，完全如 `timeline.ts` 註解記載的實測。
  2. **但挖出一個真的 bug（BUG-010）**：全市場法人 16:00 已到手卻被判成延遲並畫到軸外。
- **修正**：基準日改取各來源資料日的最大值（`roundBaseYmd`），詳見 `FIXED_BUG.md` BUG-010。
- **使用者定案**：基準日取 max（而非用報價的 tradeDate 判交易日 —— 那要改 Edge 多帶欄位）；
  現在就改、接在 0.6.36-dev.2。
- **驗證**：`npm test -- --run` 57 檔 **874 筆全通過**；`npm run build` 乾淨。

### Task 68: 美國總經改成台股法人表版型（0.6.35）
- **Status**: ✅ **完成** —— 純前端，不需要部署 Edge Function、不需要動 Supabase
- **Agent**: Claude
- **Timestamp**: 2026-08-05 13:20:00 Asia/Taipei
- **需求**：使用者看著台股法人表，要求「CPI 等指數改成和三大法人買賣超類似」，
  並先看了兩個版型範本才定案。
- **轉置而非照抄**：法人表的趨勢／連續描述的是「合計」這一個序列，五個總經指標沒有合計
  （單位是 %、千人、指數）。改成一列一個指標，趨勢／連續才有東西可描述。
- **字卡瘦身成一行 chip**（只有名稱與最新值）；期別、說明、落後徽章全部搬進表格列。
- ⚠️ **顏色語意改變（刻意）**：全表統一「紅＝比上期高、綠＝比上期低」，
  非農就業不再依數值正負上色 —— 「+57 千人但比上期少 72」現在是綠的。
  表格下方的 hint 與 `IndicatorRow` 註解、一條測試都鎖著這件事，**不可刪**。
- **`Charts/SparkCell.tsx`**：迷你走勢線抽成共用元件，兩張表共用繪製；
  streak 判定各自保留（正負號 vs 升降，是兩件事）。

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why it is manual**: the BLS schedule page returns 403 for everything (changing the
  User-Agent does not help), so it cannot be synced automatically; BEA's page is fetchable.
  `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.
- **If it is forgotten**: nothing breaks — once the calendar runs out the code falls back
  to rule-based estimation and marks the entry `stale`. Only precision drops, because the
  scan window no longer lines up with the actual release time.

