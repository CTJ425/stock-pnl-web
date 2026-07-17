# 實作計畫：專案初步分析與網頁版需求對齊 (Initial Project Review)

## Goal Description
我們目前在 `template/stock-pnl` 底下有一個基於 Google Apps Script (GAS) 開發的「Google 試算表股票小幫手」專案。該專案具備完整的交易紀錄管理、移動平均成本法損益計算、庫存總覽 Dashboard（台美股獨立統計、動態價格）、年度收益總覽（歷史已實現損益與展開明細）以及側邊欄交易輸入表單。

本階段的目標是：
1. **分析並理解** template 專案的架構、邏輯與功能。
2. **與使用者對齊** 此專案在 `stock-pnl-web` 工作目錄下的後續開發方向。
3. **制定具體的技術架構與實作計畫**。

---

## User Review Required
> [!NOTE]
> 本文件的 Open Questions 已於 **2026-07-16** 與使用者討論確認，結論標註於下方各問題中；完整設計詳見 `system_design.md`。

---

## Open Questions（已有結論）

1. **本專案的最終目標是什麼？**
   - ✅ **結論：選項 A** — 完整移植為**獨立的網頁應用程式 (Standalone Web App)**，資料儲存於 Supabase (PostgreSQL + Auth + RLS)，不再依賴 Google 試算表。
   - ~~選項 B: 與 Google 試算表聯動的網頁版 UI。~~
   - ~~選項 C: 其它目標。~~

2. **技術棧 (Tech Stack) 的選擇？**
   - ✅ **前端框架**: React（經由 Vite，**TypeScript**，`react-ts` 範本）。
   - ✅ **樣式 (Styling)**: **Vanilla CSS**，暗黑玻璃擬物風 (Glassmorphism)。
   - ✅ **後端與資料庫**: **Supabase**（PostgreSQL + Auth + RLS + Edge Functions）；現價 API 經 Supabase Edge Function 代理。部署於 GitHub Pages。

3. **核心功能優先順序？**
   - ✅ **結論：完全比照原專案功能**，全數納入：
     1. **交易輸入表單**（支援台美股切換、名稱模糊搜尋/代號反查、手續費與證交稅自動計算）。
     2. **庫存總覽 Dashboard**（台美股獨立統計、Active 持股、未實現損益與市值）。
     3. **年度收益總覽**（已實現損益年度彙整、折疊明細、KPI 大字報）。
     4. **資料匯入/匯出 (CSV)** — 使用者舊試算表有真實交易資料需搬遷，**匯入功能排入早期階段**（第三階段）。

---

## Proposed Changes
方向已於 2026-07-16 確認（見上方結論）。具體的技術架構、資料庫 Schema 與階段實作計畫見 `system_design.md`；第一階段（專案初始化與資料庫設計）的實作計畫見 `web_app_migration_plan.md`。

---

## Verification Plan
本階段為需求分析與計畫對齊階段，暫無程式碼修改，因此無需執行驗證。待計畫核准並開始實作後，我們將提供詳細的測試計畫。
