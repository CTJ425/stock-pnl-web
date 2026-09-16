# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.56 —— 總體經濟國際指數下鑽、報價時間戳與 7 走勢區間（Task 164 Phase A/B 定版）
- Status: ✅ **RELEASED 0.9.56**（已合併 `main`；Task 164 Phase A/B 結案，Phase C 待獨立進行）
- Timestamp: 2026-09-16 10:10:00 Asia/Taipei

---

## 📅 Log: 2026-09-16 10:10:00 Asia/Taipei (0.9.56, 總體經濟國際指數下鑽與走勢區間正式定版)

**Phase A 國際指數卡片強化**：
- `GlobalIndices` 新增台灣加權指數（`^TWII`）群組，置於第一順位。
- 每個市場群組標題顯示開收盤時間文字（`SESSION_HOURS`：台灣、日本、韓國、美國冬夏令時間）。
- 每張指數卡片顯示報價時間戳記（`asOf`，格式 `MM/DD HH:mm`）及盤中狀態標籤，無效或空值時回退為 `null`。
- 卡片支援點擊進入下鑽詳情頁（`IndexDetail`）。

**Phase B 指數下鑽詳情頁與 7 走勢區間**：
- 新增 `IndexDetail` 組件：包含返回按鈕、市場開盤時段條、當日 6 格統計帶與無成交量線的 `IntradayChart`。
- 新增 `indexTrend.ts`：提供 7 個走勢區間（`1d`、`5d`、`6m`、`ytd`、`1y`、`5y`、`all`，排除 `1m`），分流 intraday 與 daily 遠端資料。
- `dailyProxy.ts` 之 `fetchRemoteDaily` 新增 `market` 參數，快取鍵隔離為 `${market}:${ticker}:${range}`。
- 嚴格遵守負向規範：外盤指數不顯示三大法人、收盤統計或成交量。

**總體經濟次分頁重構與加權指數下鑽**：
- 總體經濟次分頁由「國際指數」（預設）與「美國經濟」組成。
- 加權指數點擊下鑽進入完整台股市場分析（`TwMarketSection` / `TwIndexToday`），提供 `onBack` 返回按鈕。

**大盤看板解耦、走勢圖恆常渲染與 Fallback**：
- 移除原本因無盤後歷史檔導致大盤看板被阻擋問題，`<TwIndexToday>` 常態渲染。
- `TwIndexToday` 解除走勢圖條件限制，永遠渲染 `<IntradayChart>`，保持 7 區間按鈕可點選。
- 支援開盤前即時報價 fallback（`TwIndexToday` 與 `IndexDetail` 同步支援傳入 `quote` 或 `fetchIndexQuotes`），避免開盤前大盤看板與詳情頁呈現全橫線或空狀態。
- 修復 `GlobalIndices` 匯出 `INDICES` 觸發的 Fast Refresh 警告，並以 `now` 狀態驅動 60 秒定時刷新確保休市時狀態標籤即時更新。

**驗證**：
- 129 檔測試檔 / 2,033 條測試全數通過（0 失敗）；`npm run build`、`npm test`、`npm run lint` 皆 exit 0。

## 📅 Log: 2026-09-16 09:26:00 Asia/Taipei (0.9.56-dev.4, 加權指數看板解耦與走勢圖恆常渲染)

**TwMarketSection 架構解耦**：
- 移除原本無盤後歷史檔案時的早退判斷，將 `<TwIndexToday>` 提到判斷前獨立常態渲染；下方歷史區塊保留無資料提示。

**TwIndexToday 走勢圖恆常渲染**：
- 移除條件限制，改為永遠渲染 `<IntradayChart>`（比照 `IndexDetail`），保持 7 區間按鈕隨時可點選。

**即時報價 Fallback**：
- 當 `todaySeries === null` 時，支援透過外部傳入之 `quote` 或 `fetchIndexQuotes(['^TWII'])` 補齊最新價格與開高低數值。

**驗證**：
- `TwIndexToday.test.tsx` 新增走勢圖恆常渲染、quote prop 填補以及 `fetchIndexQuotes` fallback 測試。
- `TwMarketSection.test.tsx` 新增無盤後檔案時頂部 `TwIndexToday` 依然獨立渲染之測試。
- 129 檔測試檔 / 2,029 條測試全數通過；`npm run build` 與 `npm run lint` 皆 exit 0。
