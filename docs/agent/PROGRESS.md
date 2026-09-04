# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 個股分析股票產業別顯示字級與清晰度優化
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-04 14:38:00 Asia/Taipei

---

## 📅 Log: 2026-09-04 14:38:00 Asia/Taipei (個股分析股票產業別顯示字級與清晰度優化)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.30-dev.5` → **`0.9.30-dev.6`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者指示：「在個股分析，股票的產業別有些顯示會太小與模糊，先改善這個問題」。
- **根本原因診斷 (First Principles Root Cause Analysis)**:
  1. 個股分析行情卡片 `QuoteTab.tsx` 原標籤帶有 `class="watchlist-card-badge quote-badge"`。
  2. 由於 CSS 順序與相同特異性 (0, 1, 0)，位在檔案後方的 `.watchlist-card-badge` 樣式覆蓋了前面定義的 `.quote-badge`。
  3. 導致其被強制套用 `font-size: 9px`、`max-width: 48px`、`overflow: hidden`、`padding: 0 3px`，以及暗淡灰色 `color: var(--ink-muted)`（在淺色主題對比度低至 2.8:1）。
  4. 8 字長產業別（如「電腦及週邊設備業」）被截斷為省略號，繁體中文字筆畫在 9px 低對比下嚴重模糊失真。
  5. 頂部標題列 `.detail-title .badge` 預設字級僅 11.5px 且顏色為次級墨色，在標題旁邊對比度亦不足。
- **Work**:
  1. **重構與解耦行情卡片產業徽章 (`QuoteTab.tsx`, `index.css`)**:
     - `QuoteTab.tsx` 移除 `watchlist-card-badge` 耦合，僅使用 `.quote-badge`。
     - `.quote-badge` 規格提升：字級提升至 **12.5px**（與旁邊 13px 代碼 `.code` 形成平衡），邊距 `2px 8px`，解除 `max-width: 48px` 限制，完整平整呈現長產業名。
     - 文字色彩提升為最高清晰度 `var(--ink)`（深色模式 `#dfe4ea` 對比度 >12:1，淺色模式 `#0f1319` 對比度 >16:1），邊框使用 `var(--border-strong)`，消除模糊毛邊。
     - 增加 `.m-sym .quote-badge` 雙重特異性守護與 `-webkit-font-smoothing: antialiased`、`letter-spacing: 0.02em`。
  2. **同步優化個股分析標題列產業標籤 (`index.css`)**:
     - 為 `.detail-title .badge` 建立專屬規則，字級提升至 **12px**，文字色彩改用 `var(--ink)`，邊框使用 `var(--border-strong)`，上下層次與行情卡片維持一致。
  3. **個股切換選單產業分組標題銳利化 (`index.css`)**:
     - `.hmenu-head` 由 `var(--ink-muted)` 調整為 `var(--ink-secondary)`，並設定 `font-weight: 600`，使下拉選單中「觀察 ── 電腦及週邊設備業」等分類醒目分明。
  4. **觀看清單小卡徽章基礎對比度修復 (`index.css`)**:
     - `.watchlist-card-badge` 色彩由 `--ink-muted` 提升至 `--ink-secondary`，寬度上限由 48px 增至 56px；條列表格徽章提升至 10.5px。
- **Verify**:
  - JSDOM 計算樣式檢測：`.quote-badge` fontSize: 12.5px, maxWidth: none, color: var(--ink), padding: 2px 8px；`.detail-title .badge` fontSize: 12px, color: var(--ink)。
  - Playwright 深淺雙色截圖實測驗證（`analysis-badge-dark.png` / `analysis-badge-light.png`）：廣達、台積電、元大台灣50 產業標籤清晰無截斷、筆畫分明。
  - 單元測試：97 檔測試檔 / **1,603** 項單元測試全數 PASS。
  - `npm run build`：`tsc -b && vite build` 順利產出 dist，exit 0。
  - `npm run typecheck:edge`：exit 0。
  - `npm run lint`：0 errors。

---

## 📅 Log: 2026-09-04 10:55:00 Asia/Taipei (庫存總覽持股表格黃金比例字級與消除橫向捲軸優化)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.30-dev.4` → **`0.9.30-dev.5`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者回饋：「不過自己好像還是有點大，表格我不想要有下方滑動就可以看到完整的部分，再幫我調整一版看看」。
- **Work**:
  1. **字級微調至黃金比例甜蜜點 (`index.css`)**:
     - 解決前版 14px 偏大問題，將表格單元格 `td` 與數值主字 `.num` 定位至 **13px**。
     - 表頭 `th` 定位至 **12px**，副標文字（未含費、淨收、券商說明）維持 **11px**，清晰好讀且不佔多餘版面。
     - 分組標題列 `.holding-group td` 微調至 **12px**。
  2. **內距壓縮與釋放寬度冗餘，徹底消除橫向捲軸 (`index.css`)**:
     - 表頭 `th` 與單元格 `td` padding 微調至 `9px 7px`，首末欄左右內距縮減為 `10px`。
     - 表頭說明圖示 `.th-head` 與 `.th-plain` 左右內距由 9px 收緊至 7px，使 10 欄總寬度穩定在 1,060px~1,090px 之間。
     - 在內容容器最大寬度 1,140px 下，完全無須橫向滾動即可一眼綜覽全部 10 欄（包含最右側未實現淨損益與未實現報酬率）。
  3. **響應式自適應防護 (`index.css`)**:
     - 加入 `@media (max-width: 1120px)` 智慧微縮（主字 12px、次字 10px、padding 8px 5px），即便在 1024px 筆電或半螢幕視窗下，亦能維持零滾動條。
  4. **設計範本同步更新 (`docs/design/holdings-table-mockup.html`)**:
     - 容器對齊真實 1180px 規範，切換按鈕提供「✨ 黃金平衡款 (13px / 11px・零橫向滑動)」、「上一版微大款 (14px / 11.5px)」與「舊版原尺寸 (12.5px / 10.5px)」即時對照。
- **Verify**:
  - Playwright 多視窗寬度檢測（1024px、1080px、1120px、1140px、1180px、1280px、1366px、1440px、1920px）：全解析度 `hasScroll: false`，水平溢出為 0px。
  - `npm test`：97 檔測試檔 / **1,603** 項單元測試全數 PASS。
  - `npm run build`：`tsc -b && vite build` 順利產出 dist，exit 0。

