# 🔷 股票損益網站 (Stock PnL Web) MUI 風格 12 大 UX 重構範本建議書

> **核心結論 (Bottom-Line Answer)**：
> 為滿足以 **MUI (Material UI / Material Design 3)** 為視覺基底並**完全著重於 UX 體驗**的重構需求，我們針對專案三大核心功能（股票交易損益、盤後市場與美股總經、後台排程監控），量身設計並產出了 **12 套風格獨特且極致降低操作摩擦力的 MUI UX 原型範本**，主畫廊與原型檔案均已儲存於 [`docs/architecture/`](file:///root/dev/stock-pnl-web/docs/architecture/)。

---

## 1. MUI (MD3) 視覺與極致 UX 體驗原則 (UX Principles & Design Tokens)

本系列 12 大範本完全基於 **Material Design 3 (MD3)** 規範，並將焦點鎖定在 **UX 摩擦力消除 (Frictionless UX)**：

1. **資訊階層與色調層級 (Tonal Surface Hierarchy)**：
   * 放棄過度沉重的卡片陰影，改採用 MD3 色調層級 (Surface Container Colors: `#121212` → `#1e1e1e` → `#2d2d2d`) 區隔資訊次序，提升閱讀順暢度。
2. **零延遲鍵盤與觸控體驗 (Ergonomic Interactivity)**：
   * 全面支援鍵盤快捷熱鍵 (`Cmd+K` 命令列、`Alt+1..3` 分頁切換、`B` 買入、`S` 賣出)。
   * 行動端嚴格遵循 **48px 最小觸控目標 (Touch Targets)** 與大拇指操作熱區 (Thumb-Zone Ergonomics)。
3. **動態保本賣價預警 (Break-Even UX Guardrail)**：
   * 將台股預扣賣出手續費 (0.1425% * 券商折扣) 與證交稅 (0.3% / ETF 0.1%) 計算結果直觀整合於表格與告警元件 (Snackbar) 中，防止未審先賣。

---

## 2. 12 大 MUI UX 重構建議範本總覽對照表

所有 12 個範本均已實作可互動的 HTML 原型，並可於 [`mui_ux_index.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_index.html) 中進行體驗與切換：

| 範本編號與檔名 | MUI 設計主題範式 | 核心 UX 體驗機制 | 目標用戶輪廓 (Target User) |
| :--- | :--- | :--- | :--- |
| 1. [`mui_ux_v1_executive.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v1_executive.html) | **Executive Dark Dashboard** | Tonal Elevation 暗色階層，無眩光全視角決策 | 高階決策者 / 夜間資產掃描 |
| 2. [`mui_ux_v2_compact.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v2_compact.html) | **Compact Operational Workbench** | 極致資料密度 (Dense Padding)，減少捲動點擊 | 當沖交易者 / 高頻損益對照 |
| 3. [`mui_ux_v3_stepper.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v3_stepper.html) | **Guided Step-by-Step Flow** | 漸進式 Wizard 引導 (Stepper)，零認知過載 | 初學者 / 存股新手引導 |
| 4. [`mui_ux_v4_splitpane.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v4_splitpane.html) | **Split-Pane Analytical Desk** | 主從雙欄分割對照 (Master-Detail) | 個股深度分析派 / 波段交易者 |
| 5. [`mui_ux_v5_workspace.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v5_workspace.html) | **Tabbed Workspace Matrix** | 多工作區切換，獨立手續費折扣套用 | 多券商帳戶管理者 (玉山/美股) |
| 6. [`mui_ux_v6_mobile.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v6_mobile.html) | **Mobile Bottom Drawer System** | 大拇指熱區最佳化，底端抽屜 (Sheet Modal) | 行動端隨手看盤 / 出外看盤者 |
| 7. [`mui_ux_v7_a11y.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v7_a11y.html) | **High-Accessibility Console** | WCAG AAA 7:1 超高對比度，大字體與高亮聚焦 | 低視力使用者 / 無障礙極致 |
| 8. [`mui_ux_v8_cmd.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v8_cmd.html) | **Command-Palette Master Desk** | `Cmd+K` 極速命令列與全鍵盤操作 | 鍵盤極客 / 拒用滑鼠效率派 |
| 9. [`mui_ux_v9_risk.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v9_risk.html) | **Risk & Alert Operations Deck** | 即時 Alert 告警、保本價跌破警示 | 風控主管 / 虧損預防保護者 |
| 10. [`mui_ux_v10_datagrid.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v10_datagrid.html) | **Dense Financial DataGrid Pro** | MUI DataGrid 凍結固頂欄位與多欄排序 | 稅務審計員 / 試算表控 |
| 11. [`mui_ux_v11_bento.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v11_bento.html) | **Bento Box Micro-Summary** | 便當盒視覺分塊，3 秒速讀關鍵淨值 | 視覺導向資產看盤者 |
| 12. [`mui_ux_v12_admin.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_v12_admin.html) | **Full Observability Admin** | 排程時間軸與數據源探針即時監控 | 系統維運者 / Supabase 管理員 |

---

## 3. 三大核心功能於 12 大範本中的對齊說明

每個範本均透過互動式 Tab 分頁整合了本專案的 3 大核心業務：

1. **股票交易與損益狀態**：
   * 包含總淨值、預估未實現損益、已實現收益、摩擦成本、保本賣價 (Break-Even Price) 及多工作區手續費率設定。
2. **盤後台股市場與美國總體經濟**：
   * 整合台股三大法人買賣超（外資、投信、自營商）、美國 FRED 核心 CPI (3.3%) / PCE (2.6%) / 非農就業 (+179K) 與外幣中價。
3. **後台排程運作狀況與可觀測性**：
   * 包含 Supabase `pg_cron` 心跳、`twse-chip-batch`、`macro-daily` 執行日誌與數據源探針 Latency (ms)。

---

## 4. 產出檔案清單 (Directory Inventory)

檔案均已完工並存放於 [`docs/architecture/`](file:///root/dev/stock-pnl-web/docs/architecture/)：

* 入口展示畫廊：[`mui_ux_index.html`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_index.html)
* 範本原型 01 ~ 12：`mui_ux_v1_executive.html` ~ `mui_ux_v12_admin.html`
* 本架構規劃書：[`mui_ux_redesign_proposals.md`](file:///root/dev/stock-pnl-web/docs/architecture/mui_ux_redesign_proposals.md)
