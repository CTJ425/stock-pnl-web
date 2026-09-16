# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.56 —— 總體經濟國際指數下鑽、報價時間戳與 7 走勢區間（Task 164 Phase A/B 定版）
- Status: ✅ **RELEASED 0.9.56**（已合併 `main`；Task 164 Phase A/B 結案，Phase C 待獨立進行）
- Timestamp: 2026-09-16 09:50:00 Asia/Taipei

---

## 📅 Log: 2026-09-16 09:50:00 Asia/Taipei (0.9.56, 總體經濟國際指數下鑽與走勢區間正式定版)

**Phase A 國際指數卡片強化**：
- `GlobalIndices` 新增台灣加權指數（`^TWII`）群組，置於第一順位。
- 每個市場群組標題顯示開收盤時間文字（`SESSION_HOURS`：台灣、日本、韓國、美國冬夏令時間）。
- 每張指數卡片顯示報價時間戳記（`asOf`，格式 `MM/DD HH:mm`）及盤中狀態標籤，無效或空值時安全回退為 `null` 且不渲染時間標籤。
- 卡片全面支援點擊進入下鑽詳情頁（`IndexDetail`）。

**Phase B 指數下鑽詳情頁與 7 走勢區間**：
- 新增 `IndexDetail` 組件：包含返回按鈕、市場開盤時段條、當日 6 格統計帶（開盤、最高、最低、昨收、漲跌點數、漲跌幅）與無成交量線的 `IntradayChart`。
- 新增 `indexTrend.ts`：提供 7 個走勢區間（`1d`、`5d`、`6m`、`ytd`、`1y`、`5y`、`all`，依規範排除 `1m`），並依區間分流 intraday 與 daily 遠端資料。
- `dailyProxy.ts` 之 `fetchRemoteDaily` 新增 `market` 參數（預設 `'TPE'`），並將快取鍵隔離為 `${market}:${ticker}:${range}` 避免不同市場快取碰撞。
- 嚴格遵守負向規範：外盤指數不顯示三大法人、收盤統計或成交量。

**總體經濟次分頁重構與加權指數下鑽**：
- 總體經濟次分頁由「國際指數」（預設）與「美國經濟」組成。
- 加權指數點擊下鑽進入完整台股市場分析（`TwMarketSection` / `TwIndexToday`），提供 `onBack` 返回按鈕退回清單。

**TwMarketSection 架構解耦、走勢圖恆常渲染與 Fallback**：
- 移除原本因盤後歷史資料檔未產生導致大盤看板被早退阻擋問題，`<TwIndexToday>` 常態渲染。
- `TwIndexToday` 解除走勢圖條件限制，永遠渲染 `<IntradayChart>`，保持 7 區間按鈕可點選。
- 支援開盤前即時報價 fallback（傳入 `quote` 或 `fetchIndexQuotes(['^TWII'])`），避免開盤前大盤看板呈現全橫線。

**驗證**：
- 129 檔測試檔 / 2,030 條測試全數通過（0 失敗）；`npm run build`、`npm test`、`npm run lint` 皆 exit 0。

## 📅 Log: 2026-09-16 09:26:00 Asia/Taipei (0.9.56-dev.4, 加權指數看板解耦與走勢圖恆常渲染)

**TwMarketSection 架構解耦**：
- 移除原本盤後歷史資料檔未產生（`market === null`）時的早退判斷，將 `<TwIndexToday>` 提到判斷前獨立常態渲染。
- 當 `market === null` 時傳入 `closeStats={null}` 與 `recentInstDays={null}`，下方歷史成交量與日 K 走勢區塊保留無資料提示，使無盤後歷史檔案時大盤看板與走勢圖依然正常呈現。

**TwIndexToday 走勢圖恆常渲染**：
- 移除 `{chartSeries !== null && <IntradayChart ... />}` 條件限制，改為永遠渲染 `<IntradayChart>`（比照 `IndexDetail.tsx`）。
- 即使開盤前 Yahoo `1d` 分時走勢圖尚未生成，走勢圖框架與 7 個區間切換按鈕依然保留，使用者隨時可點選「5日」或長期歷史走勢瀏覽。

**即時報價 Fallback**：
- 當 `todaySeries === null` 時，支援透過外部傳入之 `quote` 或 `fetchIndexQuotes(['^TWII'])` 補齊最新價格（`last`）、`prevClose`、`change`、`changePct` 與開高低數值，避免開盤前大盤看板全為橫線。

**驗證**：
- `TwIndexToday.test.tsx` 新增走勢圖恆常渲染、quote prop 填補以及 `fetchIndexQuotes` fallback 報價測試。
- `TwMarketSection.test.tsx` 新增 `market === null` 時頂部 `TwIndexToday` 依然獨立渲染之單元測試。
- 129 檔測試檔 / 2,029 條測試全數通過（0 失敗）；`npm run build` 與 `npm run lint` 皆 exit 0。
