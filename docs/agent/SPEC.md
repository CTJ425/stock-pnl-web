# System Specification (SPEC.md)

- Agent: Gemini
- Timestamp: 2026-07-21 15:30:00 Asia/Taipei

---

## 🚀 專案概述 (Project Overview)

**Stock PnL Web** 是一套專為台股與美股投資人設計的個股持有與損益管理 Web 應用程式。支援多工作區切換、移動平均成本計算、歷史已實現損益統計以及預扣稅費的未實現損益估算。

---

## 🛠️ 技術架構 (Technology Stack)

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS / Custom CSS
- **Backend / Database**: Supabase (PostgreSQL, Row Level Security, Edge Functions)
- **Deployment**: GitHub Pages (SPA static bundle) + Supabase Edge Functions
- **State & Storage**:
  - 本機模式: LocalStorage (免登入、即時體驗)
  - 雲端模式: Supabase Auth + Database (跨裝置同步)

---

## 核心邏輯規範 (Core Business Logic)

1. **成本與損益計算 (PnL Calculation Engine)**:
   - 使用**移動平均成本法** (Moving Average Cost)。
   - 買入交易：買入手續費計入持股總成本。
   - 賣出交易：計算當前批次已實現損益；如遇超賣情況，以 0 成本計算並顯示警告。
   - 年度收益：移除欄位排序，新增第三層逐筆賣出明細（移動平均成本口徑）；新增 KPI 買賣筆數與手續費/交易稅拆分，並將年度表格之手續費改為費稅雙行顯示。
   - 台股與美股分區計算與獨立統計。
2. **稅費計算 (Fees & Taxes)**:
   - 台股手續費/證交稅無條件捨去至整數。
   - ETF (00開頭) 證交稅為 0.1%，一般股票為 0.3%。
   - 庫存未實現損益預扣賣出手續費與證交稅（預估淨值）。
3. **庫存總覽與券商對齊**:
   - 庫存總覽表僅計算當前持有部位之「未實現損益」與「未實現報酬率」（報酬率 ＝ 未實現損益 ÷ 當前部位總成本）。
   - 歷史已結清損益獨立展示於「年度收益」頁面。

---

## 📑 關聯文件 (References)

- 架構與系統設計文件：[system_design.md](file:///home/ivan/stock-pnl-web/docs/architecture/system_design.md)
- 資料庫 Schema：[supabase_schema.sql](file:///home/ivan/stock-pnl-web/docs/database/supabase_schema.sql)

## 新增模組：服務狀態 (v0.3.0)
- 新增 `serviceHealth.ts` 提供 `runHealthCheck` 執行各項服務健康檢測（含 API 連線及延遲量測），與 `ServiceStatusPage.tsx` 以 GitHub Status 風格展示檢測結果及快取狀態。
- 本機模式下，Supabase 相關檢測自動降級標記為「未啟用 (idle)」。
