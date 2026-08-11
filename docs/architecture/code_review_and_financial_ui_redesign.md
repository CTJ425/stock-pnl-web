# 📈 股票損益網站 (Stock PnL Web) Code Review 與 UI-UX-Pro-Max 六大金融重構建議書

> **核心結論 (Bottom-Line Answer)**：
> 透過載入並執行 **`ui-ux-pro-max` 專屬設計系統引擎 (`search.py --design-system`)**，我們為 `stock-pnl-web` 的 3 大核心功能（股票交易損益、盤後市場與美股總經、後台排程運作監控）產出了符合 **Dark Mode (OLED) / Financial Void** 高質感規範的 **6 套全新金融導向 UI/UX 設計原型**，所有檔案均已存放在 [`docs/architecture/`](file:///root/dev/stock-pnl-web/docs/architecture/)。

---

## 1. UI-UX-Pro-Max 系統級設計規範 (Design System Tokens)

依據 `ui-ux-pro-max` 所產出的金融工具導向規範，系統定義了嚴格的色彩與排版 Token，確保資訊高密度下的視覺舒適度與 WCAG AA/AAA 無障礙對比標準：

### 1.1 色彩代幣系統 (Semantic Color Tokens)
| Token 變數名稱 | Hex / RGBA 值 | 設計語意與金融應用 |
| :--- | :--- | :--- |
| `--color-bg` | `#050811` | 黑色底色 (Deep Void Canvas)，防止 OLED 螢幕耗電與夜間閱讀疲勞 |
| `--color-card` | `#0e1422` | 提升層級之卡片/玻璃擬物面板 (Elevated Surface) |
| `--color-border` | `rgba(255, 255, 255, 0.08)` | 微光髮絲線邊框，維持高質感線條劃分 |
| `--color-up` | `#00e676` | 上漲 / 未實現獲利 (Neon Emerald, 亞洲/美股對比高亮) |
| `--color-down` | `#ff3b5c` | 下跌 / 虧損 (Vibrant Crimson) |
| `--color-gold` | `#ffb700` | 保本價 (Break-Even)、摩擦成本與警示文字 |
| `--color-accent` | `#00f0ff` | 科技青藍 (Electric Cyan)，用於主按鈕、當前分頁與 Focus 狀態 |

### 1.2 字型與階層規範 (Typography Scale)
* **數據/數字專用字型**：`Fira Code` / `JetBrains Mono`（適用於現價、庫存股數、未實現損益、保本價、FRED 數據與 Latency ms）。
* **介面文字/標籤字型**：`Fira Sans` / `Inter` / `Noto Sans TC`（提供清晰可讀的選單與表頭）。
* **對比度標準**：主要文字維持 4.5:1 以上高對比度，輔助說明維持 3:1 以上。

---

## 2. 深度 Code Review 與三大核心功能對齊

我們針對專案當前程式碼進行了嚴謹檢視，並確保 6 大設計版本完全覆蓋以下功能：

### 2.1 功能一：股票交易與損益狀態紀錄 (Stock PnL & Transactions)
* **算法與業務對齊 (`pnlEngine.ts`)**：
  * **移動平均成本法**、台股預扣賣出手續費 (0.1425% * 券商折扣) 與證交稅 (0.3% / ETF 0.1%)。
  * **保本賣價 (Break-Even Price)**：各原型均獨立顯示目標保本賣價與利差安全邊界。
  * **多工作區 (Workspaces)**：支援設定單獨手續費折扣（如 6 折、免手續費）。
* **重構優化建議**：導入 `big.js` 避免浮點數精度誤差，並將 $O(N)$ 帳簿掃描移至 **Web Worker** 背景處理。

### 2.2 功能二：盤後台股市場、美國總體經濟與外幣 (Market & US Macro FRED)
* **數據對齊 (`stock-report` / FRED API)**：
  * 台股盤後三大法人買賣超（外資、投信、自營商）與籌碼動向。
  * 美國 FRED 關鍵總經數據：核心 CPI (3.3%)、核心 PCE (2.6%)、非農就業 NFP (+179K)、消費者信心指數。
  * 台幣本位 8 種外幣即時中價 (如 USD/TWD 32.450) 與歷史走勢。

### 2.3 功能三：後台排程運作狀況與可觀測性 (Admin Scheduled Tasks & Probes)
* **自動化排程對齊 (`batch_run_log`, `source_probe_log`)**：
  * 批次任務監控：`twse-chip-batch` (籌碼)、`macro-daily` (總經) 與 `fx-daily` (匯率) 執行狀態、耗時與比數。
  * 探針日誌：TWSE MIS、Yahoo Finance 與 FRED 成功率 (%) 與 Latency (ms)。
  * Supabase `pg_cron` 心跳監控 (15m 輪詢)。

---

## 3. 六大金融設計建議版本對照表 (Six Redesign Proposals)

所有原型檔均已整合 `ui-ux-pro-max` 的互動分頁機制與色彩 Token：

| 版本檔名 | 金融設計範式 | 目標用戶輪廓 | 核心特色與 UI-UX-Pro-Max 規範實作 |
| :--- | :--- | :--- | :--- |
| 1. [`fin_ui_v1_terminal.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v1_terminal.html) | **Institutional Terminal Pro** | 機構交易員 / 彭博終端機 | 高密度三欄矩陣、跑馬燈、CMD 提示列 (`/` 啟動) 與五檔深度。 |
| 2. [`fin_ui_v2_tradingview.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v2_tradingview.html) | **TradingView Technical Desk** | 技術分析派 / 波段交易者 | K 線圖畫布、均線/RSI/MACD、持倉均價線 (NT$ 840) 疊加。 |
| 3. [`fin_ui_v3_wealth.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v3_wealth.html) | **Swiss Private Wealth Portal** | 瑞士私人銀行 / 家族辦公室 | 典雅香檳金與深藍、資產淨值曲線 (NAV) 與尊榮保本試算。 |
| 4. [`fin_ui_v4_quant.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v4_quant.html) | **Quant & Risk Workstation** | 風控主管 / 量化基金經理人 | 持倉損益動態熱力圖 (Heatmap)、Monte Carlo 模擬與 VaR 風險矩陣。 |
| 5. [`fin_ui_v5_neofintech.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v5_neofintech.html) | **Modern Retail Neo-Fintech Pro** | 新世代零售投資人 (Robinhood Pro) | 現代暗色微光流體卡片、Sparklines 走勢圖與動態保本價滑桿。 |
| 6. [`fin_ui_v6_matrix.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v6_matrix.html) | **Dense Execution PnL Matrix** | 高頻交易者 / 稅務審計師 | 試算表極致數據矩陣、Sticky 固頂標頭、單筆拆解與排程稽核軌跡。 |

---

## 4. 產出檔案清單與驗證 (Directory Inventory)

1. 📄 [`code_review_and_financial_ui_redesign.md`](file:///root/dev/stock-pnl-web/docs/architecture/code_review_and_financial_ui_redesign.md) — 本 UI-UX-Pro-Max 架構全書
2. 🎨 [`fin_ui_index.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_index.html) — 6 大金融 UI/UX 設計版本入口總覽畫廊 (Showcase Hub)
3. 🏛️ [`fin_ui_v1_terminal.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v1_terminal.html) — V1: 機構級金融終端機原型
4. 📈 [`fin_ui_v2_tradingview.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v2_tradingview.html) — V2: TradingView 技術分析戰情室原型
5. ⚜️ [`fin_ui_v3_wealth.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v3_wealth.html) — V3: 瑞士私人銀行財富管理原型
6. ⚛️ [`fin_ui_v4_quant.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v4_quant.html) — V4: 量化風控與損益熱力圖原型
7. 📱 [`fin_ui_v5_neofintech.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v5_neofintech.html) — V5: 現代新銳金融 Neo-Fintech 原型
8. 📊 [`fin_ui_v6_matrix.html`](file:///root/dev/stock-pnl-web/docs/architecture/fin_ui_v6_matrix.html) — V6: 高密度訂單執行與損益矩陣原型
