# 庫存總覽「觀察股票」獨立 Block 架構設計與改版方案

- **文件版本**: `1.0.0`
- **設計狀態**: `PROPOSED / MOCKUP READY`
- **原型展示**: [`docs/architecture/watchlist_dashboard_redesign.html`](file:///root/dev/stock-pnl-web/docs/architecture/watchlist_dashboard_redesign.html)
- **更新時間**: `2026-08-24 Asia/Taipei`

---

## 1. 結論與核心改動概述 (Executive Summary)

依據需求，將原本附屬於「個股分析」第四標籤頁的觀察股票，回歸並升格為「**庫存總覽 (DashboardPage)**」上的**專屬獨立區塊 (Dedicated Block)**。

### 核心特性
1. **獨立 Block 佈局**：位於 `Active 持股` 下方，擁有獨立的 Header Banner、標的容量計數 (`N/30`) 與快捷操作工具列。
2. **雙檢視模式自由切換 (View Switcher)**：
   - **條列模式 (Table View)**：緊湊清晰的數據表格，包含代號、名稱、現價（紅漲綠跌）、漲跌幅、7日微趨勢/振幅區間及快速分析按鈕。
   - **小資訊圖卡模式 (Card Grid View)**：現代 Bento 風格卡片網格，提供豐富的視覺數據（7日 Sparkline 折線走勢、外資/投信籌碼標籤、當日高低價 Range Bar）。
3. **無縫深度導流 (Seamless Drilldown)**：點擊條列中的任意股票或點擊圖卡，即可直接切換至「**個股分析 (AnalysisPage)**」讀取該檔標的的完整籌碼、基本面、技術面與損益試算內容。
4. **狀態持久化**：使用者的檢視模式偏好 (`'table' | 'cards'`) 儲存於 `localStorage`，重新整理或重啟維持上次選擇。

---

## 2. 資訊架構與畫面佈局 (Information Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│ 頂部導覽列 (AppHeader): [ 庫存總覽 | 個股分析 | 年度收益 | 交易紀錄 | 總經 | 匯率 ] │
└─────────────────────────────────────────────────────────────┘
                              │
   ┌──────────────────────────┴──────────────────────────┐
   ▼                                                     ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│  🇹🇼 台股持倉 KPI                     │  │  🇺🇸 美股持倉 KPI                     │
│  市值 / 成本 / 未實現損益             │  │  市值 / 成本 / 未實現損益             │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 💼 Active 持股 (台股 TWD / 美股 USD 表格)                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 👁️ 【全新獨立 Block】觀察股票清單  [ 5/30 ]    [ ☷ 條列 | ⊞ 圖卡 ]   [ + 加入觀察 ]  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [ 條列模式 Table Mode ]                                                         │
│  代號  │  名稱/產業  │  最新現價  │  今日漲跌  │  7日走勢/振幅區間  │  操作        │
│  2308  │  台達電     │   398.50   │  +8.50(+2%)│  📈 391.0 - 402.0 │ [分析→] [×] │
│                                                                                 │
│  ── 或 ──                                                                       │
│                                                                                 │
│  [ 小資訊圖卡模式 Cards Grid Mode ]                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │ 2308 台達電  [電子] ×│  │ 2382 廣達    [伺服] ×│  │ 3008 大立光  [光電] ×│   │
│  │ $398.50  +2.18%  🔺  │  │ $278.00  -1.24%  🔻  │  │ $2,740   +1.67%  🔺  │   │
│  │ 📈 7日微走勢折線圖   │  │ 📊 外資 -1420張 | PE │  │ ══●══ 當日高低價區間 │   │
│  │ 量: 14,230張 ➔ 分析  │  │ 量: 22,450張 ➔ 分析  │  │ 量: 820張   ➔ 分析  │   │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                              │ (點擊任意一檔股票)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 📊 個股分析 (AnalysisPage) —— 載入選定之觀察股票 (如 2308 台達電)                   │
│  [ 標籤頁: 分析內容 (行情/籌碼/基本面/技術面) | 損益試算 | AI 分析 ]                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 圖卡三種風格設計分析 (Card Style Options)

在互動原型 [`watchlist_dashboard_redesign.html`](file:///root/dev/stock-pnl-web/docs/architecture/watchlist_dashboard_redesign.html) 中，我們實現了三種不同資訊密度的圖卡呈現方式，可依產品偏好選擇或組合：

| 圖卡風格 | 視覺重點 | 適用場景 | 包含欄位 |
| :--- | :--- | :--- | :--- |
| **風格 A: 簡約微趨勢 (Sparkline)** *(推薦)* | 7日動態折線圖 + 即時成交量 | 直觀感受短期走勢方向與動能 | 代號、名稱、產業、現價、漲跌%、7日 Sparkline SVG、成交量 |
| **風格 B: 籌碼與價值 (Chips & PE)** | 三大法人外資動態 + 本益比 | 重視盤後籌碼面與估值水準的投資人 | 代號、名稱、產業、現價、漲跌%、外資買賣超張數、PE 倍數、成交量 |
| **風格 C: 振幅區間 (Range Bar)** | 今日高低價區間進度條 | 盤中即時追蹤股價處於當日高低點位置 | 代號、名稱、產業、現價、漲跌%、最低/最高價標註、進度條、波段位置 |

---

## 4. 程式碼模組架構與改動清單 (Codebase Modifications)

### (1) `sources/src/components/Dashboard/DashboardPage.tsx`
- **職責**：庫存總覽頁面容器。
- **改動**：
  - 新增 `onNavigateToAnalysis?: (ticker: string) => void` Prop。
  - 在 `Active 持股` 區塊下方引入 `<WatchlistBlock onSelectTicker={onNavigateToAnalysis} />`。

### (2) `sources/src/components/Dashboard/WatchlistBlock.tsx` (新元件 / 重構 WatchTab)
- **職責**：獨立管理觀察名單之載入、批次報價、檢視模式切換、加入與刪除。
- **改動**：
  - 維護 `viewMode: 'table' | 'cards'` 狀態，初始化時讀取 `localStorage.getItem('stock_watchlist_view_mode')`。
  - 整合 `<WatchlistTable />` 與 `<WatchlistCardGrid />`。
  - 使用 `fetchPrices()` 批次抓取清單內全部台股報價，異常時降級為 `—`。
  - 點擊列/卡片呼叫 `onSelectTicker(item.ticker, item.name)`。

### (3) `sources/src/components/AppShell.tsx`
- **職責**：頂層頁面切換與跨頁狀態協調。
- **改動**：
  - 新增 `activeAnalysisTicker: string | null` 狀態。
  - 在 `DashboardPage` 點擊觀察標的或持股時：
    ```typescript
    const handleSelectStock = (ticker: string) => {
      setActiveAnalysisTicker(ticker)
      setView('analysis')
    }
    ```
  - 將 `activeAnalysisTicker` 作為 `initialTicker` 傳入 `<AnalysisPage initialTicker={activeAnalysisTicker} />`。

### (4) `sources/src/components/StockDetail/StockDetailPage.tsx` & `AnalysisPage.tsx`
- **職責**：個股分析呈現。
- **改動**：
  - 移除原先第 4 籤頁 `觀察股票`（因為已在總覽具備專屬頂級 Block），使個股分析專注於核心的三個功能頁：`分析內容`、`損益試算`、`AI 分析`。
  - 保留對 `initialTicker` 的解析邏輯，無論是持股或純觀察股票，都能正常載入個股分析。

---

## 5. 互動原型體驗指引

請在瀏覽器中開啟以下檔案檢視完整設計與互動：
👉 **[`/root/dev/stock-pnl-web/docs/architecture/watchlist_dashboard_redesign.html`](file:///root/dev/stock-pnl-web/docs/architecture/watchlist_dashboard_redesign.html)**

### 可操作功能：
1. **切換「條列模式」與「小資訊圖卡」**：觀察雙重視覺表現與排版流暢度。
2. **切換「風格 A / B / C」**：在圖卡模式下測試 Sparkline 走勢圖、籌碼標籤與區間條。
3. **點擊任一標的**：觸發「個股分析」模擬彈窗/畫面，檢視無縫導流體驗。
4. **點擊「+ 加入觀察標的」**：即時搜尋與動態新增標的。
5. **點擊「×」移除**：測試即時刪除與計數徽章變更。
6. **點擊「🌓 切換深/淺色」**：驗證 Dark / Light 雙主題下的色彩與玻璃質感。
